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
        cache: "no-store",
      }
    );
    if (!res.ok) return NextResponse.json({ error: `JQ ${res.status}` }, { status: res.status });

    const contentType = res.headers.get("content-type") ?? "";

    // 生バイトの最初の50バイトを16進数で確認
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const first50hex = Array.from(bytes.slice(0, 50))
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");

    // 「極洋」(CoName of 1301)のUTF-8は e6 a5 b5 e6 b4 8b
    // EUC-JPは b6 cb cd cd
    // Shift-JISは 8b ea 97 64

    // UTF-8でデコード試行
    const textUtf8 = new TextDecoder("utf-8").decode(buf);
    const jsonUtf8 = JSON.parse(textUtf8);
    const nameUtf8 = jsonUtf8?.data?.[0]?.CoName ?? "";

    return NextResponse.json({
      contentType,
      first50hex,   // 最初の50バイト(16進)
      nameUtf8,     // UTF-8でデコードした会社名
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
