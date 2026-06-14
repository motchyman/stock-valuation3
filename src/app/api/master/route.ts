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
          "Accept-Encoding": "identity", // gzip/圧縮を無効化
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return NextResponse.json({ error: `JQ ${res.status}` }, { status: res.status });

    const contentType = res.headers.get("content-type") ?? "";
    const contentEncoding = res.headers.get("content-encoding") ?? "none";

    const buf = await res.arrayBuffer();

    // CoNameが含まれる部分のバイト列を確認（500バイト目以降）
    const bytes = new Uint8Array(buf);
    const mid100hex = Array.from(bytes.slice(500, 560))
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");

    const textUtf8 = new TextDecoder("utf-8").decode(buf);
    const jsonUtf8 = JSON.parse(textUtf8);
    const nameUtf8 = jsonUtf8?.data?.[0]?.CoName ?? "";

    return NextResponse.json({
      contentType,
      contentEncoding,
      mid100hex,  // 500〜560バイト目（日本語が含まれる範囲のはず）
      nameUtf8,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
