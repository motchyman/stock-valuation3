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
      const taRaw       = toNum(s.ta_raw)         / 1_000_000;
      const eqRaw       = toNum(s.eq_raw)         / 1_000_000;
      const cashRaw     = toNum(s.cash_raw)       / 1_000_000;
      const npRaw       = toNum(s.np_raw)         / 1_000_000;
      const opRaw       = toNum(s.op_raw)         / 1_000_000;
      const nxfOpRaw    = toNum(s.nxf_op_raw)     / 1_000_000;
      const salesRaw    = toNum(s.sales_raw)      / 1_000_000;
      const nxfSalesRaw = toNum(s.nxf_sales_raw)  / 1_000_000;

      const ibdRawValue = s.ibd_raw;
      const ibdRaw       = toNum(s.ibd_raw) / 1_000_000;

      // EDINETから取得した個別BS項目（NULL/-1/0/正の値を区別）
      const opAssetsRawValue   = s.op_assets_raw;
      const opLiabRawValue     = s.op_liab_raw;
      const opAssetsFromEdinet = toNum(s.op_assets_raw) / 1_000_000;
      const opLiabFromEdinet   = toNum(s.op_liab_raw)   / 1_000_000;

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

      // 有利子負債:
      //   - ibd_rawがNULL（EDINET未処理）→ 推計値（総負債-現金）×0.6
      //   - ibd_raw = -1（EDINETで有報が見つからなかった）→ 0として扱う
      //   - ibd_raw = 0（EDINETで無借金と確認済み）→ そのまま0
      //   - ibd_raw > 0（EDINETで正確に取得済み）→ そのまま使用
      const interestBearingDebt =
        (ibdRawValue === null || ibdRawValue === undefined)
          ? Math.max(totalLiabilities - cashRaw, 0) * 0.6
          : Math.max(ibdRaw, 0);

      // 営業資産・営業負債:
      //   - EDINETの個別BS項目（売上債権・棚卸資産・有形固定資産 等の積み上げ）が
      //     取得済み（0以上）ならそれを最優先で使用
      //   - 未取得（NULL）または取得失敗（-1）の場合は簡易推計にフォールバック
      const hasEdinetBS =
        opAssetsRawValue !== null && opAssetsRawValue !== undefined &&
        opLiabRawValue   !== null && opLiabRawValue   !== undefined &&
        opAssetsFromEdinet >= 0;

      const operatingAssets = hasEdinetBS
        ? opAssetsFromEdinet
        : taRaw - cashRaw;
      const operatingLiabilities = hasEdinetBS
        ? Math.max(opLiabFromEdinet, 0)
        : totalLiabilities - interestBearingDebt;

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
        // 0の場合は「ユーザー未設定」を意味し、calcValuation側で動的rが使われる
        requiredReturn:           toNum(s.required_return) || 0,
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
