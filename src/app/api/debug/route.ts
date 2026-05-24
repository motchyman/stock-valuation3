// src/app/api/debug/route.ts - 公式仕様準拠版
import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";
const H = { "x-api-key": API_KEY };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "fins";
  const code = searchParams.get("code") ?? "6758";

  if (mode === "master") {
    const res  = await fetch(`${JQ_BASE}/equities/master`, { headers: H, cache: "no-store" });
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: Record<string, any>[] = json?.data ?? [];
    const prime = all.filter(s => s.Mkt === "0111");
    return NextResponse.json({
      status: res.status,
      totalAll: all.length,
      totalPrime: prime.length,
      samplePrime: prime.slice(0, 2),
      responseKeys: Object.keys(json),
    });
  }

  if (mode === "price") {
    const from = (() => { const d = new Date(); d.setDate(d.getDate()-114); return d.toISOString().slice(0,10).replace(/-/g,""); })();
    const to   = (() => { const d = new Date(); d.setDate(d.getDate()-84);  return d.toISOString().slice(0,10).replace(/-/g,""); })();
    const res  = await fetch(`${JQ_BASE}/equities/bars/daily?code=${code}&from=${from}&to=${to}`, { headers: H, cache: "no-store" });
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any>[] = json?.data ?? json?.bars ?? [];
    return NextResponse.json({
      status: res.status, from, to,
      total: data.length,
      sample: data.slice(-2),
      responseKeys: Object.keys(json),
    });
  }

  // fins/summary
  const res  = await fetch(`${JQ_BASE}/fins/summary?code=${code}`, { headers: H, cache: "no-store" });
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Record<string, any>[] = json?.data ?? json?.summary ?? [];
  const annual = rows.filter(r => r.CurPerType === "FY");
  const latest = [...(annual.length > 0 ? annual : rows)]
    .sort((a,b) => (b.DiscDate??"").localeCompare(a.DiscDate??""))[0] ?? null;

  return NextResponse.json({
    status: res.status,
    totalRows: rows.length,
    annualRows: annual.length,
    latestFin: latest,
    responseKeys: Object.keys(json),
  });
}
