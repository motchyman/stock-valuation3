// src/app/api/financials/route.ts
// タイムアウト対策: 銘柄マスター取得と財務取得を分離
// Vercel無料プラン10秒制限対応

import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";
const JQ_H = { "x-api-key": API_KEY };

async function fetchWithTimeout(url: string, options: RequestInit & { next?: { revalidate: number } }, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
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

async function fetchPrimeMaster(sector?: string) {
  try {
    const res = await fetchWithTimeout(
      `${JQ_BASE}/equities/master`,
      { headers: JQ_H, next: { revalidate: 86400 } }
    );
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
  } catch { return []; }
}

async function fetchPrice(code: string) {
  try {
    const res = await fetchWithTimeout(
      `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(114)}&to=${daysAgo(84)}`,
      { headers: JQ_H, next: { revalidate: 3600 } },
      5000
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

async function fetchFins(code: string) {
  try {
    const res = await fetchWithTimeout(
      `${JQ_BASE}/fins/summary?code=${code}`,
      { headers: JQ_H, next: { revalidate: 86400 } },
      5000
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

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const codesParam  = searchParams.get("codes");
  const sectorParam = searchParams.get("sector") ?? undefined;
  const limit       = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);

  if (!API_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });

  let targets = await fetchPrimeMaster(sectorParam);
  if (codesParam) {
    const codes = codesParam.split(",");
    targets = targets.filter(s => codes.includes(s.code));
  }
  const total  = targets.length;
  const sliced = targets.slice(0, limit);

  const BATCH = 5;
  const results = [];
  for (let i = 0; i < sliced.length; i += BATCH) {
    const batch = sliced.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(
      batch.map(async stock => {
        const [priceData, fins] = await Promise.all([
          fetchPrice(stock.code),
          fetchFins(stock.code),
        ]);

        const price         = priceData?.price ?? 0;
        const previousClose = priceData?.previousClose ?? 0;
        const bps  = toNum(fins?.BPS);
        const eps  = toNum(fins?.EPS);
        const roe  = bps > 0 ? eps / bps : 0;
        const totalAssets = toNum(fins?.TA);
        const equity      = toNum(fins?.Eq);
        const cash        = toNum(fins?.CashEq);
        const sharesThousand = bps > 0 && equity > 0 ? (equity / bps) * 1000 : 1;
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
          priceDate:           priceData?.priceDate ?? "",
          finDate:             fins?.DiscDate ?? "",
          bps, eps, roe, forecastROE,
          totalAssets, equity,
          operatingAssets:      totalAssets - cash,
          operatingLiabilities: totalAssets - equity,
          cash,
          interestBearingDebt:  0,
          shares:               sharesThousand,
          requiredReturn:       0.05,
          lastUpdated:          new Date().toISOString(),
        };
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }

  return NextResponse.json({
    stocks:    results,
    total,
    fetchedAt: new Date().toISOString(),
  });
}
