// src/app/api/edinet/route.ts
// EDINET APIから有利子負債を取得してSupabaseに保存する
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

const EDINET_KEY = process.env.EDINET_API_KEY ?? "";
const SB_URL     = process.env.SUPABASE_URL ?? "";
const SB_KEY     = process.env.SUPABASE_ANON_KEY ?? "";

// 有利子負債に関連するXBRLタグ（日本基準・IFRS両対応）
// 連結優先、なければ単体
const IBD_TAGS_CONSOLIDATED = [
  // 短期借入金
  "jpcrp_cor:ShortTermLoansPayableCA",
  "jppfs_cor:ShortTermLoansPayable",
  // 1年内返済長期借入金
  "jpcrp_cor:CurrentPortionOfLongTermLoansPayableCA",
  "jppfs_cor:CurrentPortionOfLongTermLoansPayable",
  // 社債（短期）
  "jpcrp_cor:ShortTermBondsPayableCA",
  "jppfs_cor:ShortTermBondsPayable",
  // 社債（長期）
  "jpcrp_cor:BondsPayableNCL",
  "jppfs_cor:BondsPayable",
  // 長期借入金
  "jpcrp_cor:LongTermLoansPayableNCL",
  "jppfs_cor:LongTermLoansPayable",
  // IFRS
  "ifrs-full:BorrowingsCurrent",
  "ifrs-full:BorrowingsNoncurrent",
  "ifrs-full:BondsPayable",
];

// コンテキスト優先順（連結当期 > 単体当期）
const PREFERRED_CONTEXTS = [
  "FilingDateInstant_ConsolidatedMember",
  "CurrentYearInstant_ConsolidatedMember",
  "CurrentYearInstant",
  "FilingDateInstant",
  "CurrentYearDuration_ConsolidatedMember",
  "CurrentYearDuration",
];

// XBRLから有利子負債を抽出
function extractIBDFromXBRL(xbrlContent: string): number {
  const found: Map<string, number> = new Map();

  // XBRLのタグを正規表現でパース
  // 例: <jppfs_cor:ShortTermLoansPayable contextRef="CurrentYearInstant_ConsolidatedMember" decimals="-6" unitRef="JPY">123456000000</jppfs_cor:ShortTermLoansPayable>
  for (const tag of IBD_TAGS_CONSOLIDATED) {
    const tagLocal = tag.split(":")[1]; // コロン以降のローカル名
    // namespace prefixは可変なので、ローカル名で検索
    const regex = new RegExp(
      `<[^:]+:${tagLocal}[^>]*contextRef="([^"]*)"[^>]*>\\s*([\\d.]+)\\s*</[^:]+:${tagLocal}>`,
      "g"
    );
    let match;
    while ((match = regex.exec(xbrlContent)) !== null) {
      const contextRef = match[1];
      const value = parseFloat(match[2]);
      if (!isNaN(value) && value > 0) {
        // コンテキストの優先度を計算
        const priority = PREFERRED_CONTEXTS.findIndex(c => contextRef.includes(c));
        const key = `${tagLocal}:${contextRef}`;
        if (!found.has(tagLocal) || priority < PREFERRED_CONTEXTS.findIndex(c =>
          (found.get(tagLocal + "_ctx") ?? "") === c
        )) {
          found.set(tagLocal, value);
          found.set(tagLocal + "_ctx", priority);
        }
      }
    }
  }

  // 合計（同じコンテキストのものを足す）
  let total = 0;
  const processed = new Set<string>();

  for (const tag of IBD_TAGS_CONSOLIDATED) {
    const tagLocal = tag.split(":")[1];
    if (!processed.has(tagLocal) && found.has(tagLocal)) {
      total += found.get(tagLocal) ?? 0;
      processed.add(tagLocal);
    }
  }

  return total;
}

// 書類一覧APIから指定銘柄の最新有価証券報告書を検索
async function findLatestReport(secCode: string): Promise<{ docId: string; edinetCode: string; periodEnd: string } | null> {
  // 直近400日を遡って検索（1年内に決算書が必ずある）
  const today = new Date();

  for (let daysBack = 0; daysBack < 400; daysBack++) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysBack);
    // 土日はスキップ（EDINETは平日のみ）
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;

    const dateStr = d.toISOString().split("T")[0];

    try {
      const url = `https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${dateStr}&type=2&Subscription-Key=${EDINET_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;

      const data = await res.json();
      if (!data.results) continue;

      // 証券コードは5桁（4桁+0）
      const secCode5 = secCode.padEnd(5, "0");
      const doc = data.results.find((r: Record<string, string>) =>
        r.secCode === secCode5 &&
        r.docTypeCode === "120" &&   // 有価証券報告書
        r.xbrlFlag === "1" &&
        r.withdrawalStatus === "0" &&
        r.disclosureStatus === "0"
      );

      if (doc) {
        return {
          docId: doc.docID,
          edinetCode: doc.edinetCode,
          periodEnd: doc.periodEnd ?? "",
        };
      }

      // レートリミット対策（10ms待機）
      await new Promise(r => setTimeout(r, 10));
    } catch {
      continue;
    }
  }
  return null;
}

// XBRLファイルをZIPから取得して有利子負債を抽出
async function getIBDFromDoc(docId: string): Promise<number> {
  try {
    // type=1でZIPファイル（XBRL含む）を取得
    const url = `https://api.edinet-fsa.go.jp/api/v2/documents/${docId}?type=1&Subscription-Key=${EDINET_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return 0;

    const arrayBuffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // XBRLファイルを探す（jpcrpまたはjppfsのXBRL）
    let xbrlContent = "";
    for (const [filename, file] of Object.entries(zip.files)) {
      // 本文XBRLは通常 PublicDoc/ 以下の .xbrl ファイル
      if (
        filename.includes("PublicDoc/") &&
        filename.endsWith(".xbrl") &&
        !filename.includes("lab") &&
        !filename.includes("cal") &&
        !filename.includes("def") &&
        !filename.includes("pre") &&
        !filename.includes("_ref")
      ) {
        xbrlContent = await (file as JSZip.JSZipObject).async("string");
        if (xbrlContent.length > 1000) break; // 本文XBRLが見つかった
      }
    }

    if (!xbrlContent) return 0;
    return extractIBDFromXBRL(xbrlContent);
  } catch (e) {
    console.error("XBRL取得エラー:", e);
    return 0;
  }
}

// Supabaseに保存
async function saveToSupabase(code: string, ibdRaw: number, edinetCode: string): Promise<boolean> {
  const url = `${SB_URL}/rest/v1/stocks?code=eq.${code}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey":        SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        "return=minimal",
    },
    body: JSON.stringify({ ibd_raw: ibdRaw, edinet_code: edinetCode }),
  } as RequestInit);
  return res.ok;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const save = searchParams.get("save") !== "false";

  if (!EDINET_KEY) return NextResponse.json({ error: "EDINET_API_KEY not set" }, { status: 500 });
  if (!code)       return NextResponse.json({ error: "code required" }, { status: 400 });

  // 1. 書類一覧から最新の有報を検索
  const report = await findLatestReport(code);
  if (!report) {
    return NextResponse.json({ code, error: "有価証券報告書が見つかりません" });
  }

  // 2. XBRLから有利子負債を抽出
  const ibdRaw = await getIBDFromDoc(report.docId);

  // 3. Supabaseに保存
  if (save && SB_URL) {
    await saveToSupabase(code, ibdRaw, report.edinetCode);
  }

  return NextResponse.json({
    code,
    edinetCode:  report.edinetCode,
    periodEnd:   report.periodEnd,
    docId:       report.docId,
    ibdRaw,
    ibdBillion:  Math.round(ibdRaw / 100_000_000) / 10 + "億円",
  });
}
