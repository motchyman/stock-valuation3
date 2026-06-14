// src/app/api/prices/route.ts
// Yahoo Finance v8から複数銘柄の現在株価をまとめて取得する
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchYahooPrice(yahooCode: string): Promise<{
  price: number;
  previousClose: number;
} | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCode}?interval=1d&range=5d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 300 }, // 5分キャッシュ
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? 0;
    if (!price) return null;
    return {
      price,
      previousClose: meta?.chartPreviousClose ?? price,
    };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // codes=7203,6758,... (4桁コード、カンマ区切り)
  const codesParam = searchParams.get("codes") ?? "";
  const codes = codesParam.split(",").map(c => c.trim()).filter(Boolean);

  if (codes.length === 0) {
    return NextResponse.json({ error: "codes required" }, { status: 400 });
  }
  if (codes.length > 100) {
    return NextResponse.json({ error: "max 100 codes per request" }, { status: 400 });
  }

  const results: Record<string, { price: number; previousClose: number } | null> = {};

  // 並列で取得(Yahoo Financeはレート制限が緩い)
  await Promise.all(
    codes.map(async (code) => {
      const yahooCode = `${code}.T`;
      const data = await fetchYahooPrice(yahooCode);
      results[code] = data;
    })
  );

  return NextResponse.json({ prices: results, fetchedAt: new Date().toISOString() });
}
