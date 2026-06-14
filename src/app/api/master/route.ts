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

    const buf = await res.arrayBuffer();

    // EUC-JPでデコードを試みる
    let text: string;
    let encoding = "unknown";
    try {
      const decoded = new TextDecoder("euc-jp").decode(buf);
      // デコード結果にJSON的に有効な日本語が含まれるか確認
      const parsed = JSON.parse(decoded);
      const sample = parsed?.data?.[0]?.CoName ?? "";
      // 文字化けパターン（繝・繧・縺など）が含まれていなければEUC-JP成功
      if (!sample.includes("繝") && !sample.includes("繧") && !sample.includes("縺")) {
        text = decoded;
        encoding = "euc-jp";
      } else {
        throw new Error("euc-jp decode failed");
      }
    } catch {
      // Shift-JISを試みる
      try {
        const decoded = new TextDecoder("shift-jis").decode(buf);
        JSON.parse(decoded);
        text = decoded;
        encoding = "shift-jis";
      } catch {
        // フォールバック: UTF-8
        text = new TextDecoder("utf-8").decode(buf);
        encoding = "utf-8";
      }
    }

    const json = JSON.parse(text);
    const all: Record<string, string>[] = json?.data ?? [];
    const prime = all.filter(s => s.Mkt === "0111");
    const sample = prime[0] ?? null;

    return NextResponse.json({
      total: prime.length,
      encoding, // デバッグ用: 実際に使用したエンコーディング
      sample,   // デバッグ用: 最初の1件
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
