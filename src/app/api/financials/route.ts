// src/app/api/financials/route.ts
// /api/masterへの内部呼び出しをやめ、J-Quantsを直接呼ぶ
import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";
const JQ_H = { "x-api-key": API_KEY };

const YAHOO_MAP: Record<string, string> = {
  "7203":"7203.T","6758":"6758.T","6861":"6861.T","8306":"8306.T",
  "9984":"9984.T","4568":"4568.T","9432":"9432.T","7974":"7974.T",
  "4519":"4519.T","8035":"8035.T","6367":"6367.T","2914":"2914.T",
  "8316":"8316.T","6098":"6098.T","4063":"4063.T",
};

// 銘柄マスター取得（東証プライム）
async function fetchPrimeMaster(sector?: string) {
  const res = await fetch(`${JQ_BASE}/equities/master`, {
    headers: JQ_H, next: { revalidate: 86400 }
  });
  if (!res.ok) return [];
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stocks: Record<string, any>[] = (json?.data ?? []).filter(
    (s: Record<string, string>) => s.Mkt === "0111"
  );
  if (sector) stocks = stocks.filter(s => s.S33Nm === sector);
  return stocks.map(s => ({
    code:   (s.Code ?? "").slice(0, 4),
    name:   s.CoName ?? "",
    sector: s.S33Nm ?? "",
  }));
}

// 株価取得（J-Quants: 84〜114日前）
async function fetchPrice(code: string) {
  try {
    const from = daysAgo(114);
    const to   = daysAgo(84);
    const res  = await fetch(
      `${JQ_BASE}/equities/bars/daily?code=${code}&from=${from}&to=${to}`,
      { headers: JQ_H, next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bars: Record<string, any>[] = json?.data ?? [];
    if (bars.length === 0) return null;
    const sorted = [...bars].sort((a, b) => (b.Date ?? "").localeCompare(a.Date ?? ""));
    return {
      price:         sorted[0]?.AdjC ?? sorted[0]?.C ?? 0,
      previousClose: sorted[1]?.AdjC ?? sorted[1]?.C ?? sorted[0]?.AdjC ?? 0,
      priceDate:     sorted[0]?.Date ?? "",
    };
  } catch { return null; }
}

// 財務サマリー取得
async function fetchFins(code: string) {
  try {
    const res = await fetch(
      `${JQ_BASE}/fins/summary?code=${code}`,
      { headers: JQ_H, next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, any>[] = json?.data ?? json?.summary ?? [];
    if (rows.length === 0) return null;
    const annual = rows.filter(r => r.CurPerType === "FY");
    const pool   = annual.length > 0 ? annual : rows;
    return [...pool].sort((a, b) => (b.DiscDate ?? "").localeCompare(a.DiscDate ?? ""))[0];
  } catch { return null; }
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const codesParam  = searchParams.get("codes");
  const sectorParam = searchParams.get("sector") ?? undefined;
  const limit       = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  if (!API_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });

  // 銘柄リスト取得
  let targets = await fetchPrimeMaster(sectorParam);
  if (codesParam) {
    const codes = codesParam.split(",");
    targets = targets.filter(s => codes.includes(s.code));
  }
  const total   = targets.length;
  const sliced  = targets.slice(0, limit);

  // 並列取得（20件ずつバッチ）
  const BATCH = 20;
  const results = [];
  for (let i = 0; i < sliced.length; i += BATCH) {
    const batch = sliced.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(
      batch.map(async stock => {
        const yahoo = YAHOO_MAP[stock.code] ?? `${stock.code}.T`;
        const [priceData, fins] = await Promise.all([
          fetchPrice(stock.code),
          fetchFins(stock.code),
        ]);

        const price         = priceData?.price ?? 0;
        const previousClose = priceData?.previousClose ?? 0;
        const bps = toNum(fins?.BPS);
        const eps = toNum(fins?.EPS);
        const roe = bps > 0 ? eps / bps : 0;
        const totalAssets      = toNum(fins?.TA);
        const equity           = toNum(fins?.Eq);
        const cash             = toNum(fins?.CashEq);
        const interestBearingDebt = 0;
        const sharesThousand   = bps > 0 && equity > 0 ? (equity / bps) * 1000 : 1;
        const target = 0.08;
        const forecastROE = Array.from({ length: 5 }, (_, idx) => {
          const w = idx / 4;
          return roe * (1 - w) + target * w;
        });

        return {
          code:   stock.code,
          name:   stock.name,
          sector: stock.sector,
          price, previousClose,
          priceDate:   priceData?.priceDate ?? "",
          finDate:     fins?.DiscDate ?? "",
          bps, eps, roe, forecastROE,
          totalAssets, equity,
          operatingAssets:      totalAssets - cash,
          operatingLiabilities: (totalAssets - equity) - interestBearingDebt,
          cash, interestBearingDebt,
          shares:        sharesThousand,
          requiredReturn: 0.05,
          lastUpdated:   new Date().toISOString(),
          yahoo,
        };
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }

  return NextResponse.json({
    stocks: results,
    total,
    fetchedAt: new Date().toISOString(),
  });
}
