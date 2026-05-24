// src/app/api/financials/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PRIME_STOCKS_LIST } from "@/lib/stocks";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const codesParam = searchParams.get("codes");
  const targets = codesParam
    ? PRIME_STOCKS_LIST.filter(s => codesParam.split(",").includes(s.code))
    : PRIME_STOCKS_LIST;

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const results = await Promise.allSettled(
    targets.map(async stock => {
      const url = `${baseUrl}/api/stock?code=${stock.code}&yahoo=${stock.yahoo}`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) throw new Error(`${stock.code} fetch failed`);
      const data = await res.json();
      return { ...data, name: stock.name, sector: stock.sector, code: stock.code };
    })
  );

  const stocks = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { code: targets[i].code, name: targets[i].name, sector: targets[i].sector, error: "データ取得失敗" };
  });

  return NextResponse.json({ stocks, fetchedAt: new Date().toISOString() });
}
