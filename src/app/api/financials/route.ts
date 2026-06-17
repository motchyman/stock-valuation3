// src/app/api/financials/route.ts
import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sector = searchParams.get("sector");
  const codes  = searchParams.get("codes");
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");
  const search = searchParams.get("search") ?? "";

  if (!SB_URL) return NextResponse.json({ error: "SUPABASE_URL not set" }, { status: 500 });

  let url = `${SB_URL}/rest/v1/stocks?select=*&limit=${limit}&offset=${offset}`;
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

    const data = await res.json();
    const stocks = (data as Record<string, unknown>[]).map(s => {
      // J-Quantsは円単位 → ÷1,000,000 で百万円
      // 株数は株単位  → ÷1,000 で千株
      const taRaw       = toNum(s.ta_raw)         / 1_000_000;
      const eqRaw       = toNum(s.eq_raw)         / 1_000_000;
      const cashRaw     = toNum(s.cash_raw)       / 1_000_000;
      const npRaw       = toNum(s.np_raw)         / 1_000_000;
      const opRaw       = toNum(s.op_raw)         / 1_000_000;
      const nxfOpRaw    = toNum(s.nxf_op_raw)     / 1_000_000;
      const salesRaw    = toNum(s.sales_raw)      / 1_000_000;
      const nxfSalesRaw = toNum(s.nxf_sales_raw)  / 1_000_000;
      const ibdRaw      = toNum(s.ibd_raw)        / 1_000_000;

      const shOutRaw = toNum(s.sh_out_raw) / 1_000;
      const trShRaw  = toNum(s.tr_sh_raw)  / 1_000;
      const sharesThousand = shOutRaw > trShRaw && trShRaw > 0
        ? shOutRaw - trShRaw
        : shOutRaw;

      const bpsRaw    = toNum(s.bps_raw);
      const epsRaw    = toNum(s.eps_raw);
      const nxfEpsRaw = toNum(s.nxf_eps_raw);

      const bps = bpsRaw > 0
        ? bpsRaw
        : (eqRaw > 0 && sharesThousand > 0 ? (eqRaw / sharesThousand) * 1000 : 0);
      const eps = epsRaw;
      const roe = bps > 0 ? eps / bps
        : (eqRaw > 0 && npRaw !== 0 ? npRaw / eqRaw : 0);

      const salesGrowthRate = salesRaw > 0 && nxfSalesRaw > 0
        ? Math.min(Math.max((nxfSalesRaw - salesRaw) / salesRaw, 0), 0.20)
        : 0;

      const totalLiabilities = taRaw - eqRaw;
      const interestBearingDebt = ibdRaw > 0
        ? ibdRaw
        : Math.max(totalLiabilities - cashRaw, 0) * 0.6;

      const operatingAssets      = taRaw - cashRaw;
      const operatingLiabilities = totalLiabilities - interestBearingDebt;

      const nxfOpForCalc = nxfOpRaw > 0 ? nxfOpRaw : opRaw;
      const nikkeiEps = sharesThousand > 0
        ? (nxfOpForCalc * 0.7 / sharesThousand) * 1000
        : 0;

      return {
        code:                     s.code,
        name:                     s.name,
        sector:                   s.sector,
        price:                    toNum(s.price),
        previousClose:            toNum(s.previous_close),
        priceDate:                s.price_date,
        finDate:                  s.fin_date,
        bps,
        eps,
        nxfEps:                   nxfEpsRaw,
        nikkeiEps,
        roe,
        forecastROE:              s.forecast_roe ?? [],
        totalAssets:              taRaw,
        equity:                   eqRaw,
        cash:                     cashRaw,
        interestBearingDebt,
        operatingAssets,
        operatingLiabilities,
        operatingProfit:          opRaw > 0 ? opRaw : 0,
        forecastOperatingProfit:  nxfOpRaw > 0 ? nxfOpRaw : opRaw,
        salesGrowthRate,
        shares:                   sharesThousand,
        requiredReturn:           toNum(s.required_return) || 0.05,
        lastUpdated:              s.updated_at,
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
