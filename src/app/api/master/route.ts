// src/app/api/master/route.ts
// 銘柄マスター取得（東証プライム: Mkt=0111）
// 公式レスポンスキー: "data"
// フィールド: Code, CoName, S33Nm（33業種名）, Mkt, MktNm

import { NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";

export async function GET() {
  if (!API_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });

  try {
    const res = await fetch(
      `${JQ_BASE}/equities/master`,
      {
        headers: { "x-api-key": API_KEY },
        next: { revalidate: 86400 },
      }
    );
    if (!res.ok) return NextResponse.json({ error: `JQ ${res.status}` }, { status: res.status });

    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: Record<string, any>[] = json?.data ?? [];

    // 東証プライムのみ（Mkt = "0111"）
    const prime = all.filter(s => s.Mkt === "0111");

    return NextResponse.json({
      total: prime.length,
      stocks: prime.map(s => ({
        code:   (s.Code ?? "").slice(0, 4),
        name:   s.CoName ?? "",
        sector: s.S33Nm ?? "",
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
