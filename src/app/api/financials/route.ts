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

// レートリミット対策: 指定ms待機
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

  // 銘柄マスター取得
  let targets = await fetchPrimeMaster(sectorParam);
  if (codesParam) {
    const codes = codesParam.split(",");
    targets = targets.filter(s => codes.includes(s.code));
  }
  const total  = targets.length;
  const sliced = targets.slice(0, limit);

  const results = [];
  for (const stock of sliced) {
    // レートリミット対策: 1件ごとに300ms待機
    await sleep(300);

    const [priceData, fins] = await Promise.all([
      fetchPrice(stock.code),
      fetchFins(stock.code),
    ]);

    const price         = priceData?.price ?? 0;
    const previousClose = priceData?.previousClose ?? 0;

    // BPS・EPSが空文字の銘柄対応
    // BPS/EPSが取れない場合はEq/NPから直接ROEを計算
    const bpsRaw = toNum(fins?.BPS);
    const epsRaw = toNum(fins?.EPS);
    const npRaw  = toNum(fins?.NP);   // 当期純利益（百万円）
    const eqRaw  = toNum(fins?.Eq);   // 純資産（百万円）
    const taRaw  = toNum(fins?.TA);   // 総資産（百万円）
    const cashRaw = toNum(fins?.CashEq);

    // ROEを計算（BPS/EPSがあればそちらを優先、なければNP/Eqから）
    let bps = bpsRaw;
    let eps = epsRaw;
    let roe = 0;
    if (bps > 0 && eps > 0) {
      roe = eps / bps;
    } else if (eqRaw > 0 && npRaw !== 0) {
      roe = npRaw / eqRaw;
      // BPS・EPSをEq・NPから逆算（株式数推定）
      // sharesは後でeqとbpsから計算するため、ここではroeのみ使用
    }

    // 株式数（千株）= 純資産(百万円) / BPS(円/株) × 1000
    // BPSがない場合は1（理論株価の絶対値は不正確になるがROEは正確）
    const sharesThousand = bps > 0 && eqRaw > 0
      ? (eqRaw / bps) * 1000
      : 1;

    // BPS・EPSがない場合の補完（EqとNPから推定）
    if (bps === 0 && eqRaw > 0 && sharesThousand > 1) {
      bps = (eqRaw / sharesThousand) * 1000;
    }
    if (eps === 0 && npRaw !== 0 && sharesThousand > 1) {
      eps = (npRaw / sharesThousand) * 1000;
    }

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
