// src/app/api/debug/route.ts - 銘柄マスターのフィールド確認
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
   const all: Record<string, any>[] = json?.data ?? [];
   // 1332のデータを探す
   const target = all.find(s => (s.Code ?? "").startsWith("1332")) ?? all[0];
   return NextResponse.json({
     status: res.status,
     total: all.length,
     // 全フィールドを表示（株式数フィールドを探す）
     sampleFields: target ? Object.keys(target) : [],
     sample: target,
   });
 }

 // fins/summary
 const res  = await fetch(`${JQ_BASE}/fins/summary?code=${code}`, { headers: H, cache: "no-store" });
 const json = await res.json();
 const rows: Record<string, any>[] = json?.data ?? [];
 const annual = rows.filter(r => r.CurPerType === "FY");
 const latest = [...(annual.length > 0 ? annual : rows)]
   .sort((a, b) => (b.DiscDate ?? "").localeCompare(a.DiscDate ?? ""))[0] ?? null;

 return NextResponse.json({
   status: res.status,
   totalRows: rows.length,
   annualRows: annual.length,
   latestFin: latest,
 });
}