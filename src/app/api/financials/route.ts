// src/app/api/financials/route.ts
// 【生値保存方式】SupabaseのrawカラムからJ-Quantsの生値を読み込み、
// 単位変換・ROE・予想ROE・営業資産/負債等の計算をここで行う。
import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

// 予想ROEの逓減先（業界平均想定）
const TARGET_ROE = 0.08;

// ── 単位変換ルール（project-summary.md準拠） ──────────────────────
//  TA, Eq, CashEq, NP             : 円 → ÷1,000,000 で百万円
//  ShOutFY, TrShFY, AvgSh         : 株 → ÷1,000 で千株
//  BPS, EPS                       : 円/株のまま使用可
//
// ShOutFY・BPSが開示データに含まれない銘柄が存在する（例: 1332ニッスイ）。
// この場合、AvgSh（平均株式数）から株式数を求める。
// またEPSは業績修正後の開示で空になり、古い期のEPSが残ることがあるため、
// NP（修正後の最新値）と株式数から再計算した値を優先する。
function convertRow(s: Record<string, unknown>) {
  // 円 → 百万円
  const totalAssets = toNum(s.ta_raw)   / 1_000_000;
  const equity      = toNum(s.eq_raw)   / 1_000_000;
  const cash        = toNum(s.cash_raw) / 1_000_000;
  const netProfit   = toNum(s.np_raw)   / 1_000_000;

  // 株 → 千株
  const shOut = toNum(s.sh_out_raw) / 1000;
  const avgSh = toNum(s.avg_sh_raw) / 1000;

  const bpsRaw = toNum(s.bps_raw);
  const epsRaw = toNum(s.eps_raw);

  // 発行済株式数（千株）: ShOutFY → AvgSh → Eq/BPS の優先順でフォールバック
  const shares = shOut > 0
    ? shOut
    : avgSh > 0
      ? avgSh
      : (bpsRaw > 0 && equity > 0 ? (equity / bpsRaw) * 1000 : 0);

  // 1株あたり純資産: BPSが無ければEq/sharesから逆算
  const bps = bpsRaw > 0
    ? bpsRaw
    : (shares > 1 ? (equity / shares) * 1000 : 0);

  // 1株あたり純利益: NPと株式数から再計算（業績修正でEPSが空/古い値のままの開示があるため）
  const eps = (netProfit !== 0 && shares > 1)
    ? (netProfit / shares) * 1000
    : epsRaw;

  // ROE = EPS / BPS（BPSが無ければ NP / Eq で代用）
  const roe = bps > 0 && eps !== 0
    ? eps / bps
    : (equity > 0 && netProfit !== 0 ? netProfit / equity : 0);

  // J-Quants /fins/summary には有利子負債項目が無いため0固定
  const interestBearingDebt = 0;

  const operatingAssets      = totalAssets - cash;
  const operatingLiabilities = (totalAssets - equity) - interestBearingDebt;

  // 来期予想EPSがあれば1年目のROEに反映、2〜5年目は業界平均(8%)へ逓減
  const nxfEps = toNum(s.nxf_eps_raw);
  const roeYear1 = nxfEps > 0 && bps > 0 ? nxfEps / bps : roe;

  const forecastROE = Array.from({ length: 5 }, (_, i) => {
    if (i === 0) return roeYear1;
    const w = i / 4;
    return roe * (1 - w) + TARGET_ROE * w;
  });

  return {
    bps, eps, roe, forecastROE,
    totalAssets, equity,
    operatingAssets, operatingLiabilities,
    cash, interestBearingDebt,
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

  // 計算に必要な生値カラムのみ取得
  const cols = [
    "code", "name", "sector",
    "price", "previous_close", "price_date", "fin_date",
    "required_return", "updated_at",
    "ta_raw", "eq_raw", "cash_raw", "np_raw",
    "sh_out_raw", "avg_sh_raw", "bps_raw", "eps_raw", "nxf_eps_raw",
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
