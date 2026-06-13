// src/app/api/batch/route.ts
// 【生値保存方式】J-Quantsから取得した値は変換せずそのままraw列に保存する。
// 単位変換・ROE等の計算はすべて financials/route.ts 側で行う。
import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const JQ_KEY  = process.env.JQUANTS_API_KEY ?? "";
const JQ_H    = { "x-api-key": JQ_KEY };
const SB_URL  = process.env.SUPABASE_URL ?? "";
const SB_KEY  = process.env.SUPABASE_ANON_KEY ?? "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

// マスターはSupabaseから読む（J-Quantsへの追加リクエストを避ける）
async function fetchMaster() {
  const res = await fetch(
    `${SB_URL}/rest/v1/stocks?select=code,name,sector&order=code`,
    {
      headers: {
        "apikey":        SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Range":         "0-1999",
      },
    }
  );
  if (!res.ok) throw new Error(`master(supabase) ${res.status}`);
  return await res.json();
}

async function fetchPriceRaw(code: string) {
  const url = `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(120)}&to=${daysAgo(90)}`;
  const res = await fetch(url, { headers: JQ_H });
  const text = await res.text();
  return { url, status: res.status, body: text.slice(0, 1000) };
}

async function fetchPrice(code: string) {
  try {
    const res = await fetch(
      `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(120)}&to=${daysAgo(90)}`,
      { headers: JQ_H }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const bars: Record<string, unknown>[] = json?.data ?? [];
    if (bars.length === 0) return null;
    const sorted = [...bars].sort((a, b) =>
      String(b.Date ?? "").localeCompare(String(a.Date ?? ""))
    );
    return {
      price:         toNum(sorted[0]?.AdjC ?? sorted[0]?.C),
      previousClose: toNum(sorted[1]?.AdjC ?? sorted[1]?.C ?? sorted[0]?.AdjC),
      priceDate:     String(sorted[0]?.Date ?? ""),
    };
  } catch { return null; }
}

// fins/summaryの最新FY行をそのまま返す（変換しない）
async function fetchFins(code: string) {
  try {
    const res = await fetch(
      `${JQ_BASE}/fins/summary?code=${code}`,
      { headers: JQ_H }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const rows: Record<string, unknown>[] = json?.data ?? [];
    if (rows.length === 0) return null;
    const annual = rows.filter(r => r.CurPerType === "FY");
    const pool   = annual.length > 0 ? annual : rows;
    return [...pool].sort((a, b) =>
      String(b.DiscDate ?? "").localeCompare(String(a.DiscDate ?? ""))
    )[0];
  } catch { return null; }
}

async function upsertToSupabase(records: Record<string, unknown>[]) {
  const res = await fetch(`${SB_URL}/rest/v1/stocks`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Prefer":        "resolution=merge-duplicates",
    },
    body: JSON.stringify(records),
  });
  return res.ok;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startFrom = parseInt(searchParams.get("from") ?? "0");
  const batchSize = parseInt(searchParams.get("size") ?? "50");
  const debugCode = searchParams.get("debug");

  if (!JQ_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });
  if (!SB_URL) return NextResponse.json({ error: "SUPABASE_URL not set" }, { status: 500 });

  // デバッグモード: 生レスポンスを確認
  if (debugCode) {
    const type = searchParams.get("type") ?? "price";
    if (type === "fins") {
      const url = `${JQ_BASE}/fins/summary?code=${debugCode}`;
      const res = await fetch(url, { headers: JQ_H });
      const text = await res.text();
      return NextResponse.json({ url, status: res.status, body: text });
    }
    const raw = await fetchPriceRaw(debugCode);
    return NextResponse.json(raw);
  }

  let allStocks;
  try {
    allStocks = await fetchMaster();
  } catch (e) {
    return NextResponse.json({
      success: 0, errors: 0, processed: 0,
      total: 0,
      nextFrom: startFrom,
      nextUrl: `/api/batch?from=${startFrom}&size=${batchSize}`,
      message: `masterエラー(リトライ): ${String(e)}`,
    });
  }

  const targets = allStocks.slice(startFrom, startFrom + batchSize);
  const total   = allStocks.length;

  const records: Record<string, unknown>[] = [];
  let successCount = 0;
  let errorCount   = 0;

  try {
    for (const stock of targets) {
      await sleep(1800);

      const [priceData, fins] = await Promise.all([
        fetchPrice(stock.code),
        fetchFins(stock.code),
      ]);

      // ── 株価・コード情報のみここで設定。財務系は全て無変換のraw列へ ──
      records.push({
        code:           stock.code,
        name:           stock.name,
        sector:         stock.sector,

        price:          priceData?.price ?? 0,
        previous_close: priceData?.previousClose ?? 0,
        price_date:     priceData?.priceDate ?? "",
        fin_date:       String(fins?.DiscDate ?? ""),

        // ── 財務生値（J-Quantsの値をそのまま保存。単位変換はfinancials側） ──
        ta_raw:     toNum(fins?.TA),       // 総資産（円）
        eq_raw:     toNum(fins?.Eq),       // 純資産（円）
        cash_raw:   toNum(fins?.CashEq),   // 現金等（円）
        np_raw:     toNum(fins?.NP),       // 純利益（円）
        sh_out_raw: toNum(fins?.ShOutFY),  // 発行済株式数（株）
        tr_sh_raw:  toNum(fins?.TrShFY),   // 自己株式数（株）
        avg_sh_raw: toNum(fins?.AvgSh),    // 平均株式数（株）
        bps_raw:    toNum(fins?.BPS),      // 1株あたり純資産（円）
        eps_raw:    toNum(fins?.EPS),      // 1株あたり純利益（円）

        sales_raw: toNum(fins?.Sales),     // 売上高（円）
        op_raw:    toNum(fins?.OP),        // 営業利益（円）
        odp_raw:   toNum(fins?.OdP),       // 経常利益（円）
        cfo_raw:   toNum(fins?.CFO),       // 営業CF（円）
        cfi_raw:   toNum(fins?.CFI),       // 投資CF（円）
        cff_raw:   toNum(fins?.CFF),       // 財務CF（円）

        div_ann_raw:       toNum(fins?.DivAnn),        // 1株あたり年間配当（円）
        div_total_ann_raw: toNum(fins?.DivTotalAnn),   // 配当総額（円）
        payout_ratio_raw:  toNum(fins?.PayoutRatioAnn),// 配当率

        nxf_sales_raw:   toNum(fins?.NxFSales),  // 来期予想売上高（円）
        nxf_op_raw:      toNum(fins?.NxFOP),     // 来期予想営業利益（円）
        nxf_np_raw:      toNum(fins?.NxFNp),     // 来期予想純利益（円）
        nxf_eps_raw:     toNum(fins?.NxFEPS),    // 来期予想EPS（円）
        nxf_div_ann_raw: toNum(fins?.NxFDivAnn), // 来期予想年間配当（円）

        updated_at: new Date().toISOString(),
      });

      if (records.length >= 10) {
        const ok = await upsertToSupabase(records);
        if (ok) successCount += records.length;
        else errorCount += records.length;
        records.length = 0;
      }
    }

    if (records.length > 0) {
      const ok = await upsertToSupabase(records);
      if (ok) successCount += records.length;
      else errorCount += records.length;
    }
  } catch (e) {
    return NextResponse.json({
      success: successCount, errors: errorCount + 1,
      processed: targets.length,
      total,
      nextFrom: startFrom,
      nextUrl: `/api/batch?from=${startFrom}&size=${batchSize}`,
      message: `処理エラー(リトライ): ${String(e)}`,
    });
  }

  const nextFrom = startFrom + batchSize;
  return NextResponse.json({
    success:   successCount,
    errors:    errorCount,
    processed: targets.length,
    total,
    nextFrom:  nextFrom < total ? nextFrom : null,
    nextUrl:   nextFrom < total ? `/api/batch?from=${nextFrom}&size=${batchSize}` : null,
    message:   nextFrom < total
      ? `次: /api/batch?from=${nextFrom}&size=${batchSize}`
      : "全銘柄完了！",
  });
}
