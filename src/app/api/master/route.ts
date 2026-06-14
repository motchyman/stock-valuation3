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
        headers: {
          "x-api-key": API_KEY,
          "Accept-Encoding": "identity",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return NextResponse.json({ error: `JQ ${res.status}` }, { status: res.status });

    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buf);
    const json = JSON.parse(text);

    const all: Record<string, string>[] = json?.data ?? [];
    const prime = all.filter(s => s.Mkt === "0111");

    // CoNameのバイト列を確認
    const name0 = prime[0]?.CoName ?? "";
    const name0hex = Array.from(new TextEncoder().encode(name0))
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");

    // 英語名で正しく取れているか確認
    const nameEn0 = prime[0]?.CoNameEn ?? "";

    // 7974(任天堂)を探す
    const nintendo = all.find(s => s.Code?.startsWith("7974"));
    const nintendoName = nintendo?.CoName ?? "not found";
    const nintendoNameHex = Array.from(new TextEncoder().encode(nintendoName))
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");

    return NextResponse.json({
      name0,        // 1件目のCoName
      name0hex,     // そのバイト列
      nameEn0,      // 英語名（正常なはず）
      nintendoName, // 任天堂のCoName
      nintendoNameHex,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
