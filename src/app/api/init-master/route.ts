// src/app/api/init-master/route.ts
import { NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const JQ_KEY  = process.env.JQUANTS_API_KEY ?? "";
const SB_URL  = process.env.SUPABASE_URL ?? "";
const SB_KEY  = process.env.SUPABASE_ANON_KEY ?? "";

export async function GET() {
  const res = await fetch(`${JQ_BASE}/equities/master`, {
    headers: { "x-api-key": JQ_KEY },
  });
  if (!res.ok) return NextResponse.json({ error: `master ${res.status}` }, { status: 500 });

  // Shift-JISの可能性があるためバイナリで受け取りデコード
  const buf = await res.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("shift-jis").decode(buf);
    JSON.parse(text);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }

  const json = JSON.parse(text);
  const stocks = (json?.data ?? [])
    .filter((s: Record<string, string>) => s.Mkt === "0111")
    .map((s: Record<string, string>) => ({
      code:   (s.Code ?? "").slice(0, 4),
      name:   s.CoName ?? "",
      sector: s.S33Nm ?? "",
    }));

  for (let i = 0; i < stocks.length; i += 50) {
    const chunk = stocks.slice(i, i + 50);
    await fetch(`${SB_URL}/rest/v1/stocks`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Prefer":        "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });
  }

  return NextResponse.json({ count: stocks.length, message: "マスター登録完了" });
}
