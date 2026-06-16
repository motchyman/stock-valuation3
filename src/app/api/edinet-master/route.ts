// src/app/api/edinet-master/route.ts
// EDINETコードリストをダウンロードして証券コード→EDINETコードのマッピングをSupabaseに保存
import { NextResponse } from "next/server";
import JSZip from "jszip";

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_ANON_KEY ?? "";

export async function GET() {
  try {
    // EDINETコードリストZIPをダウンロード
    const res = await fetch(
      "https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/EdinetcodeDlInfo.zip",
      { signal: AbortSignal.timeout(30000) }
    );
    if (!res.ok) return NextResponse.json({ error: "ダウンロード失敗" }, { status: 500 });

    const arrayBuffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // CSVファイルを探す
    let csvContent = "";
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.endsWith(".csv")) {
        csvContent = await (file as JSZip.JSZipObject).async("string");
        break;
      }
    }

    if (!csvContent) return NextResponse.json({ error: "CSV not found" }, { status: 500 });

    // CSVをパース（Shift-JISの可能性あり → 文字化け対策）
    const lines = csvContent.split("\n").slice(2); // 最初の2行はヘッダ
    const mapping: { code: string; edinetCode: string }[] = [];

    for (const line of lines) {
      const cols = line.split(",");
      if (cols.length < 7) continue;
      const edinetCode = cols[0]?.trim().replace(/"/g, "");
      const secCode    = cols[6]?.trim().replace(/"/g, ""); // 証券コード列
      if (edinetCode && secCode && secCode.length === 4) {
        mapping.push({ code: secCode, edinetCode });
      }
    }

    // Supabaseに一括更新
    let updated = 0;
    const CHUNK = 50;
    for (let i = 0; i < mapping.length; i += CHUNK) {
      const chunk = mapping.slice(i, i + CHUNK);
      for (const { code, edinetCode } of chunk) {
        const url = `${SB_URL}/rest/v1/stocks?code=eq.${code}`;
        const r = await fetch(url, {
          method: "PATCH",
          headers: {
            "apikey":        SB_KEY,
            "Authorization": `Bearer ${SB_KEY}`,
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal",
          },
          body: JSON.stringify({ edinet_code: edinetCode }),
        } as RequestInit);
        if (r.ok) updated++;
      }
    }

    return NextResponse.json({ total: mapping.length, updated });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
