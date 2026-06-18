// src/app/api/edinet-batch/route.ts
import { NextRequest, NextResponse } from "next/server";

const EDINET_KEY = process.env.EDINET_API_KEY ?? "";
const SB_URL     = process.env.SUPABASE_URL ?? "";
const SB_KEY     = process.env.SUPABASE_ANON_KEY ?? "";

async function getCodes(from: number, size: number, mode: string): Promise<{ code: string }[]> {
  if (mode === "init") {
    // ibd_rawが0の銘柄を優先取得
    const url = `${SB_URL}/rest/v1/stocks?select=code&ibd_raw=eq.0&order=code.asc&limit=${size}`;
    const res = await fetch(url, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` },
    } as RequestInit);
    if (res.ok) {
      const data = await res.json();
      if (data.length > 0) return data;
    }
    // 全銘柄埋まったら通常モードにフォールバック
  }
  // 通常モード
  const url = `${SB_URL}/rest/v1/stocks?select=code&order=code.asc&limit=${size}&offset=${from}`;
  const res = await fetch(url, {
    headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` },
  } as RequestInit);
  if (!res.ok) return [];
  return await res.json();
}

async function findLatestReport(secCode: string): Promise<{ docId: string; edinetCode: string } | null> {
  const today = new Date();
  for (let daysBack = 0; daysBack < 400; daysBack++) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysBack);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const dateStr = d.toISOString().split("T")[0];
    try {
      const res = await fetch(
        `https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${dateStr}&type=2&Subscription-Key=${EDINET_KEY}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.results) continue;
      const doc = data.results.find((r: Record<string, string>) =>
        r.secCode === secCode.padEnd(5, "0") &&
        r.docTypeCode === "120" &&
        r.xbrlFlag === "1" &&
        r.withdrawalStatus === "0" &&
        r.disclosureStatus === "0"
      );
      if (doc) return { docId: doc.docID, edinetCode: doc.edinetCode };
      await new Promise(r => setTimeout(r, 50));
    } catch { continue; }
  }
  return null;
}

async function getIBD(docId: string): Promise<number> {
  const TAGS = [
    "ShortTermLoansPayable", "CurrentPortionOfLongTermLoansPayable",
    "ShortTermBondsPayable", "BondsPayable", "LongTermLoansPayable",
    "BorrowingsCurrent", "BorrowingsNoncurrent",
  ];
  try {
    const JSZip = (await import("jszip")).default;
    const res = await fetch(
      `https://api.edinet-fsa.go.jp/api/v2/documents/${docId}?type=1&Subscription-Key=${EDINET_KEY}`,
      { signal: AbortSignal.timeout(25000) }
    );
    if (!res.ok) return 0;
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    let xbrl = "";
    for (const [name, file] of Object.entries(zip.files)) {
      if (
        name.includes("PublicDoc/") &&
        name.endsWith(".xbrl") &&
        !name.match(/lab|cal|def|pre|_ref/)
      ) {
        xbrl = await (file as import("jszip").JSZipObject).async("string");
        if (xbrl.length > 1000) break;
      }
    }
    if (!xbrl) return 0;
    const CONTEXTS = ["ConsolidatedMember", "CurrentYearInstant", "FilingDateInstant"];
    let total = 0;
    const seen = new Set<string>();
    for (const tag of TAGS) {
      if (seen.has(tag)) continue;
      const re = new RegExp(
        `<[^:]+:${tag}[^>]*contextRef="([^"]*)"[^>]*>\\s*([\\d.]+)\\s*</[^:]+:${tag}>`,
        "g"
      );
      let best: number | null = null;
      let bestPri = 999;
      let m: RegExpExecArray | null = null;
      while ((m = re.exec(xbrl)) !== null) {
        const pri = CONTEXTS.findIndex(c => m![1].includes(c));
        const val = parseFloat(m![2]);
        if (val > 0 && pri < bestPri) { best = val; bestPri = pri; }
      }
      if (best !== null) { total += best; seen.add(tag); }
    }
    return total;
  } catch { return 0; }
}

async function save(code: string, ibdRaw: number, edinetCode: string) {
  await fetch(`${SB_URL}/rest/v1/stocks?code=eq.${code}`, {
    method: "PATCH",
    headers: {
      "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", "Prefer": "return=minimal",
    },
    body: JSON.stringify({ ibd_raw: ibdRaw, edinet_code: edinetCode }),
  } as RequestInit);
}

export async function GET(req: NextRequest) {
  if (!EDINET_KEY) return NextResponse.json({ error: "EDINET_API_KEY not set" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const from = parseInt(searchParams.get("from") ?? "0");
  const size = parseInt(searchParams.get("size") ?? "5");
  const mode = searchParams.get("mode") ?? "normal";

  const codes = await getCodes(from, size, mode);
  if (codes.length === 0) {
    return NextResponse.json({ message: "完了", from, processed: 0, mode });
  }

  const results: { code: string; ibd: number; ok: boolean }[] = [];

  for (const { code } of codes) {
    try {
      const report = await findLatestReport(code);
      if (!report) { results.push({ code, ibd: 0, ok: false }); continue; }
      const ibd = await getIBD(report.docId);
      await save(code, ibd, report.edinetCode);
      results.push({ code, ibd, ok: true });
    } catch {
      results.push({ code, ibd: 0, ok: false });
    }
  }

  const nextFrom = from + size;
  return NextResponse.json({
    from, size, mode,
    processed: codes.length,
    results,
    nextFrom,
    nextUrl: `/api/edinet-batch?from=${nextFrom}&size=${size}`,
    message: codes.length < size ? "全銘柄完了！" : `次: /api/edinet-batch?from=${nextFrom}&size=${size}`,
  });
}
