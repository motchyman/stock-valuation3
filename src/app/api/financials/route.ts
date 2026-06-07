// src/app/api/financials/route.ts
import { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_ANON_KEY ?? "";

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
   const stocks = (data as Record<string, unknown>[]).map(s => ({
     code:                 s.code,
     name:                 s.name,
     sector:               s.sector,
     price:                s.price,
     previousClose:        s.previous_close,
     priceDate:            s.price_date,
     finDate:              s.fin_date,
     bps:                  s.bps,
     eps:                  s.eps,
     roe:                  s.roe,
     forecastROE:          s.forecast_roe ?? [],
     totalAssets:          s.total_assets,
     equity:               s.equity,
     operatingAssets:      s.operating_assets,
     operatingLiabilities: s.operating_liabilities,
     cash:                 s.cash,
     interestBearingDebt:  0,
     shares:               s.shares,
     requiredReturn:       s.required_return ?? 0.05,
     lastUpdated:          s.updated_at,
   }));

   const contentRange = res.headers.get("content-range") ?? "";
   const total = contentRange
     ? parseInt(contentRange.split("/")[1] ?? "0")
     : stocks.length;

   return NextResponse.json({ stocks, total, fetchedAt: new Date().toISOString() });
 } catch (e) {
   return NextResponse.json({ error: String(e) }, { status: 500 });
 }
}
