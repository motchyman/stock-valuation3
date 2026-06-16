// src/app/api/financials/route.ts
import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

const TARGET_ROE = 0.08;

function convertRow(s: Record<string, unknown>) {
  const equity      = toNum(s.eq_raw)   / 1_000_000;
  const totalAssets = toNum(s.ta_raw)   / 1_000_000;
  const cash        = toNum(s.cash_raw) / 1_000_000;
  const netProfit   = toNum(s.np_raw)   / 1_000_000;

  const odpRaw   = toNum(s.odp_raw)    / 1_000_000;
  const nxfOpRaw = toNum(s.nxf_op_raw) / 1_000_000;

  const shOut = toNum(s.sh_out_raw) / 1000;
  const trSh  = toNum(s.tr_sh_raw)  / 1000;
  const avgSh = toNum(s.avg_sh_raw) / 1000;

  const bpsRaw = toNum(s.bps_raw);
  const epsRaw = toNum(s.eps_raw);

  const sharesNet = shOut > 0 && trSh >= 0
    ? shOut - trSh
    : avgSh > 0 ? avgSh
    : (bpsRaw > 0 && equity > 0 ? (equity / bpsRaw) * 1000 : 0);

  const shares = sharesNet > 0 ? sharesNet : avgSh > 0 ? avgSh : sharesNet;

  const bps = bpsRaw > 0 ? bpsRaw
    : (shares > 1 ? (equity / shares) * 1000 : 0);

  const eps = (netProfit !== 0 && shares > 1)
    ? (netProfit / shares) * 1000
    : epsRaw;

  // 日経マネー式EPS = 経常利益(or来期予想営業利益) × 0.7 ÷ 株式数
  const odpBase = nxfOpRaw > 0 ? nxfOpRaw : odpRaw;
  const nikkeiEps = (odpBase > 0 && shares > 1)
    ? (odpBase / shares) * 1000 * 0.7
    : eps;

  const roe = bps > 0 && eps !== 0 ? eps / bps
    : (equity > 0 && netProfit !== 0 ? netProfit / equity : 0);

  const nxfEps = toNum(s.nxf_eps_raw);
  const roeYear1 = nxfEps > 0 && bps > 0 ? nxfEps / bps : roe;

  const forecastROE = Array.from({ length: 5 }, (_, i) => {
    if (i === 0) return roeYear1;
    const w = i / 4;
    return roe * (1 - w) + TARGET_ROE * w;
  });

  const operatingAssets      = totalAssets - cash;
  const operatingLiabilities = totalAssets - equity;

  // 推計有利子負債 = max(0, (総負債 - 現金) × 0.6)
  // 総負債の約60%が有利子負債という仮定
  const totalDebt    = totalAssets - equity;
  const estimatedIBD = Math.max(0, (totalDebt - cash) * 0.6);

  return {
    bps, eps, nikkeiEps, roe, forecastROE,
    totalAssets, equity,
    operatingAssets, operatingLiabilities,
    cash,
    interestBearingDebt: estimatedIBD,  // 推計値（百万円）
    shares,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sector = searchParams.get("sector");
  const codes  = searchParams.get("codes");
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");
  const search = searchParams.get("search") ?? "";

  if (!SB_URL) return NextResponse.json({ error: "SUPABASE_URL not set" }, { status: 500 });

  const cols = [
    "code", "name", "sector",
    "price", "previous_close", "price_date", "fin_date",
    "required_return", "updated_at",
    "ta_raw", "eq_raw", "cash_raw", "np_raw",
    "sh_out_raw", "tr_sh_raw", "avg_sh_raw",
    "bps_raw", "eps_raw", "nxf_eps_raw",
    "odp_raw", "nxf_op_raw",
  ].join(",");

  let url = `${SB_URL}/rest/v1/stocks?select=${cols}&limit=${limit}&offset=${offset}`;
  if (sector) url += `&sector=eq.${encodeURIComponent(sector)}`;
  if (codes)  url += `&code=in.(${codes.split(",").map(c => `"${c}"`).join(",")})`;
  if (search) url += `&or=(name.ilike.*${encodeURIComponent(search)}*,code.ilike.*${encodeURIComponent(search)}*)`;

  try {
    const res = await fetch(url, {
      headers: {
        "apikey":        SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Prefer":        "count=exact",
      },
    } as RequestInit);

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const data = (await res.json()) as Record<string, unknown>[];

    const stocks = data.map(s => {
      const calc = convertRow(s);
      return {
        code:                 s.code,
        name:                 s.name,
        sector:               s.sector,
        price:                toNum(s.price),
        previousClose:        toNum(s.previous_close),
        priceDate:            s.price_date,
        finDate:              s.fin_date,
        bps:                  calc.bps,
        eps:                  calc.eps,
        nikkeiEps:            calc.nikkeiEps,
        roe:                  calc.roe,
        forecastROE:          calc.forecastROE,
        totalAssets:          calc.totalAssets,
        equity:               calc.equity,
        operatingAssets:      calc.operatingAssets,
        operatingLiabilities: calc.operatingLiabilities,
        cash:                 calc.cash,
        interestBearingDebt:  calc.interestBearingDebt,
        shares:               calc.shares,
        requiredReturn:       toNum(s.required_return) || 0.05,
        lastUpdated:          s.updated_at,
      };
    });

    const contentRange = res.headers.get("content-range") ?? "";
    const total = contentRange
      ? parseInt(contentRange.split("/")[1] ?? "0")
      : stocks.length;

    return NextResponse.json({ stocks, total, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
