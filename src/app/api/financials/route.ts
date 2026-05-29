// src/app/api/financials/route.ts
import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";
const JQ_H = { "x-api-key": API_KEY };

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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPrimeMaster(sector?: string) {
  try {
    const res = await fetch(`${JQ_BASE}/equities/master`, {
      headers: JQ_H, next: { revalidate: 86400 }
    } as RequestInit);
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
    const res = await fetch(
      `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(114)}&to=${daysAgo(84)}`,
      { headers: JQ_H, next: { revalidate: 3600 } } as RequestInit
    );
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bars: Record<string, any>[] = json?.data ?? [];
    if (bars.length === 0) return null;
    const sorted = [...bars].sort((a, b) => (b.Date ?? "").localeCompare(a.Date ?? ""));
    return {
      price:         toNum(sorted[0]?.AdjC ?? sorted[0]?.C),
      previousClose: toNum(sorted[1]?.AdjC ?? sorted[1]?.C ?? sorted[0]?.AdjC),
      priceDate:     sorted[0]?.Date ?? "",
    };
  } catch { return null; }
}

async function fetchFins(code: string) {
  try {
    const res = await fetch(
      `${JQ_BASE}/fins/summary?code=${code}`,
      { headers: JQ_H, next: { revalidate: 86400 } } as RequestInit
    );
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, any>[] = json?.data ?? json?.summary ?? [];
    if (rows.length === 0) return null;
    const annual = rows.filter(r => r.CurPerType === "FY");
    const pool   = annual.length > 0 ? annual : rows;
    return [...pool].sort((a, b) =>
      (b.DiscDate ?? "").localeCompare(a.DiscDate ?? "")
    )[0];
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const codesParam  = searchParams.get("codes");
  const sectorParam = searchParams.get("sector") ?? undefined;
  const limit       = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);

  if (!API_KEY) return NextResponse.json({ error: "NO API KEY" }, { status: 500 });

  let targets = await fetchPrimeMaster(sectorParam);
  if (codesParam) {
    const codes = codesParam.split(",");
    targets = targets.filter(s => codes.includes(s.code));
  }
  const total  = targets.length;
  const sliced = targets.slice(0, limit);

  const results = [];
  for (const stock of sliced) {
    await sleep(500);

    const [priceData, fins] = await Promise.all([
      fetchPrice(stock.code),
      fetchFins(stock.code),
    ]);

    const price         = priceData?.price ?? 0;
    const previousClose = priceData?.previousClose ?? 0;

    const bpsRaw = toNum(fins?.BPS);
    const epsRaw = toNum(fins?.EPS);
    const npRaw  = toNum(fins?.NP);
    const eqRaw  = toNum(fins?.Eq);
    const taRaw  = toNum(fins?.TA);
    const cashRaw = toNum(fins?.CashEq);

    // 株式数: ShOutFY（千株）を優先、なければBPS/Eqから推計
    const shOutFY = toNum(fins?.ShOutFY);
    const sharesThousand = shOutFY > 0
      ? shOutFY
      : bpsRaw > 0 && eqRaw > 0
        ? (eqRaw / bpsRaw) * 1000
        : 1;

    // BPS・EPSの補完
    const bps = bpsRaw > 0 ? bpsRaw
      : sharesThousand > 1 ? (eqRaw / sharesThousand) * 1000 : 0;
    const eps = epsRaw > 0 ? epsRaw
      : sharesThousand > 1 ? (npRaw / sharesThousand) * 1000 : 0;

    // ROE計算
    const roe = bps > 0 && eps !== 0 ? eps / bps
      : eqRaw > 0 && npRaw !== 0 ? npRaw / eqRaw : 0;

    const totalAssets = taRaw;
    const equity      = eqRaw;
    const cash        = cashRaw;

    const target = 0.08;
    const forecastROE = Array.from({ length: 5 }, (_, i) => {
      const w = i / 4;
      return roe * (1 - w) + target * w;
    });

    results.push({
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
    });
  }

  return NextResponse.json({
    stocks:    results,
    total,
    fetchedAt: new Date().toISOString(),
  });
}
