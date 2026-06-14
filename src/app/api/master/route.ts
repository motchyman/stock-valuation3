// src/app/api/master/route.ts
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

    // バイナリで受け取りUTF-8としてデコード
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buf);
    const json = JSON.parse(text);

    const all: Record<string, string>[] = json?.data ?? [];
    const prime = all.filter(s => s.Mkt === "0111");

    // デバッグ用: 最初の1件の生データを確認
    const sample = prime[0] ?? null;

    return NextResponse.json({
      total: prime.length,
      sample, // デバッグ用
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
