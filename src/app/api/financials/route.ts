// src/app/api/financials/route.ts
// 全銘柄を/api/masterから取得して並列処理
import { NextRequest, NextResponse } from "next/server";

const YAHOO_MAP: Record<string, string> = {
  "7203":"7203.T","6758":"6758.T","6861":"6861.T","8306":"8306.T",
  "9984":"9984.T","4568":"4568.T","9432":"9432.T","7974":"7974.T",
  "4519":"4519.T","8035":"8035.T","6367":"6367.T","2914":"2914.T",
  "8316":"8316.T","6098":"6098.T","4063":"4063.T",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const codesParam = searchParams.get("codes");
  const sectorParam = searchParams.get("sector");
  const limitParam  = parseInt(searchParams.get("limit") ?? "50");

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  // 銘柄マスターから対象銘柄を取得
  let targets: { code: string; name: string; sector: string }[] = [];
  try {
    const masterRes = await fetch(`${baseUrl}/api/master`, { next: { revalidate: 86400 } });
    const masterData = await masterRes.json();
    targets = masterData.stocks ?? [];
  } catch {
    targets = [];
  }

  // フィルタリング
  if (codesParam) {
    const codes = codesParam.split(",");
    targets = targets.filter(s => codes.includes(s.code));
  } else if (sectorParam) {
    targets = targets.filter(s => s.sector === sectorParam);
  }

  // 件数制限（一度に取りすぎないように）
  targets = targets.slice(0, limitParam);

  // 並列取得（最大20件同時）
  const BATCH = 20;
  const results = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(
      batch.map(async stock => {
        const yahoo = YAHOO_MAP[stock.code] ?? `${stock.code}.T`;
        const url   = `${baseUrl}/api/stock?code=${stock.code}&yahoo=${yahoo}`;
        const res   = await fetch(url, { next: { revalidate: 3600 } });
        if (!res.ok) throw new Error(`${stock.code} failed`);
        const data  = await res.json();
        return { ...data, name: stock.name, sector: stock.sector, code: stock.code };
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
      else results.push({
        code: batch[results.length % BATCH]?.code ?? "",
        name: batch[results.length % BATCH]?.name ?? "",
        error: "取得失敗",
      });
    }
  }

  return NextResponse.json({
    stocks: results,
    total: targets.length,
    fetchedAt: new Date().toISOString(),
  });
}
