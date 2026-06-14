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

    // Shift-JISの可能性があるためバイナリで受け取りデコード
    const buf = await res.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("shift-jis").decode(buf);
      // デコード結果が正常なJSONか確認（文字化けしていたらUTF-8で再試行）
      JSON.parse(text);
    } catch {
      text = new TextDecoder("utf-8").decode(buf);
    }

    const json = JSON.parse(text);
    const all: Record<string, string>[] = json?.data ?? [];
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
