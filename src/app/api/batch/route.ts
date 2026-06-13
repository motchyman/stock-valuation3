// src/app/api/batch/route.ts
// 【生値保存方式】J-Quantsから取得した値は変換せずそのままraw列に保存する。
// 単位変換・ROE等の計算はすべて financials/route.ts 側で行う。
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

// デバッグ用: 価格エンドポイントの生レスポンス（ヘッダー含む）を返す
async function fetchPriceRaw(code: string) {
  const url = `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(120)}&to=${daysAgo(90)}`;
  const res = await fetch(url, { headers: JQ_H });
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { url, status: res.status, headers, body: text.slice(0, 1000) };
}

// fetchPriceの結果に加え、失敗時はステータスコード/エラー内容を返す（診断用）
async function fetchPrice(code: string): Promise<
  | { ok: true; price: number; previousClose: number; priceDate: string }
  | { ok: false; reason: string }
> {
  try {
    const res = await fetch(
      `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(120)}&to=${daysAgo(90)}`,
      { headers: JQ_H }
    );
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const json = await res.json();
    const bars: Record<string, unknown>[] = json?.data ?? [];
    if (bars.length === 0) return { ok: false, reason: "empty data" };
    const sorted = [...bars].sort((a, b) =>
      String(b.Date ?? "").localeCompare(String(a.Date ?? ""))
    );
    return {
      ok: true,
      price:         toNum(sorted[0]?.AdjC ?? sorted[0]?.C),
      previousClose: toNum(sorted[1]?.AdjC ?? sorted[1]?.C ?? sorted[0]?.AdjC),
      priceDate:     String(sorted[0]?.Date ?? ""),
    };
  } catch (e) {
    return { ok: false, reason: `exception: ${String(e)}` };
  }
}

// fins/summaryで使用するフィールド一覧
const FIN_FIELDS = [
  "TA", "Eq", "CashEq", "NP", "ShOutFY", "TrShFY", "AvgSh", "BPS", "EPS",
  "Sales", "OP", "OdP", "CFO", "CFI", "CFF",
  "DivAnn", "DivTotalAnn", "PayoutRatioAnn",
  "NxFSales", "NxFOP", "NxFNp", "NxFEPS", "NxFDivAnn",
] as const;

// fins/summaryから財務データを取得。
// 同じCurPerType="FY"でも、開示によってはBPS/EPS/配当のみで
// TA/Eq/ShOutFY等が空（業績予想修正の開示など）の場合がある。
// そのまま最新1行を使うとTA/Eq=0となり理論株価が¥0になるバグが発生するため、
// フィールドごとに「直近の開示の中で値が入っている最初のもの」を採用してマージする。
async function fetchFins(code: string): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string }
> {
  try {
    const res = await fetch(
      `${JQ_BASE}/fins/summary?code=${code}`,
      { headers: JQ_H }
    );
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const json = await res.json();
    const rows: Record<string, unknown>[] = json?.data ?? [];
    if (rows.length === 0) return { ok: false, reason: "empty data" };
    const annual = rows.filter(r => r.CurPerType === "FY");
    const pool   = annual.length > 0 ? annual : rows;
    const sorted = [...pool].sort((a, b) =>
      String(b.DiscDate ?? "").localeCompare(String(a.DiscDate ?? ""))
    );

    const merged: Record<string, unknown> = { DiscDate: sorted[0]?.DiscDate ?? "" };
    for (const field of FIN_FIELDS) {
      for (const row of sorted) {
        const v = row[field];
        if (v !== undefined && v !== null && v !== "") {
          merged[field] = v;
          break;
        }
      }
    }
    return { ok: true, data: merged };
  } catch (e) {
    return { ok: false, reason: `exception: ${String(e)}` };
  }
}

// Supabaseへupsert。失敗時はレスポンス本文（エラー詳細）も返す（診断用）
async function upsertToSupabase(records: Record<string, unknown>[]): Promise<{ ok: boolean; body?: string }> {
  if (records.length === 0) return { ok: true };
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
  if (res.ok) return { ok: true };
  const body = await res.text();
  return { ok: false, body: body.slice(0, 1000) };
}

// PostgRESTの一括upsertは「同じバッチ内の全行で同じカラム構成」が必要。
// 価格取得/財務取得の成否によりレコードのキー集合が異なる場合があるため、
// キー集合が同一のグループに分けてそれぞれ別々にupsertする。
async function upsertGrouped(records: Record<string, unknown>[]): Promise<{ success: number; errors: number; errorBodies: string[] }> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of records) {
    const key = Object.keys(r).sort().join(",");
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let success = 0;
  let errors  = 0;
  const errorBodies: string[] = [];
  for (const group of groups.values()) {
    const result = await upsertToSupabase(group);
    if (result.ok) success += group.length;
    else {
      errors += group.length;
      if (result.body) errorBodies.push(result.body);
    }
  }
  return { success, errors, errorBodies };
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
  let errorBodies: string[] = [];

  // 診断用: 価格/財務取得の失敗内容を記録
  const priceFailures: { code: string; reason: string }[] = [];
  const finsFailures: { code: string; reason: string }[] = [];

  try {
    for (const stock of targets) {
      // J-Quants Freeプラン: 60req/分。1銘柄2リクエスト×sleep2200msで約54.5req/分に抑える。
      await sleep(2200);

      const [priceResult, finsResult] = await Promise.all([
        fetchPrice(stock.code),
        fetchFins(stock.code),
      ]);

      if (!priceResult.ok) priceFailures.push({ code: stock.code, reason: priceResult.reason });
      if (!finsResult.ok)  finsFailures.push({ code: stock.code, reason: finsResult.reason });

      if (!priceResult.ok && !finsResult.ok) {
        // 両方取得失敗 → 既存DB値を一切変更しない
        continue;
      }

      const record: Record<string, unknown> = {
        code:   stock.code,
        name:   stock.name,
        sector: stock.sector,
        updated_at: new Date().toISOString(),
      };

      // ── 株価情報: 取得できた場合のみ更新（失敗時は既存値を保持） ──
      if (priceResult.ok) {
        record.price          = priceResult.price;
        record.previous_close = priceResult.previousClose;
        record.price_date     = priceResult.priceDate;
      }

      // ── 財務生値: 取得できた場合のみ更新（失敗時は既存値を保持） ──
      if (finsResult.ok) {
        const fins = finsResult.data;
        record.fin_date = String(fins.DiscDate ?? "");

        record.ta_raw     = toNum(fins.TA);       // 総資産（円）
        record.eq_raw     = toNum(fins.Eq);       // 純資産（円）
        record.cash_raw   = toNum(fins.CashEq);   // 現金等（円）
        record.np_raw     = toNum(fins.NP);       // 純利益（円）
        record.sh_out_raw = toNum(fins.ShOutFY);  // 発行済株式数（株）
        record.tr_sh_raw  = toNum(fins.TrShFY);   // 自己株式数（株）
        record.avg_sh_raw = toNum(fins.AvgSh);    // 平均株式数（株）
        record.bps_raw    = toNum(fins.BPS);      // 1株あたり純資産（円）
        record.eps_raw    = toNum(fins.EPS);      // 1株あたり純利益（円）

        record.sales_raw = toNum(fins.Sales);     // 売上高（円）
        record.op_raw    = toNum(fins.OP);        // 営業利益（円）
        record.odp_raw   = toNum(fins.OdP);       // 経常利益（円）
        record.cfo_raw   = toNum(fins.CFO);       // 営業CF（円）
        record.cfi_raw   = toNum(fins.CFI);       // 投資CF（円）
        record.cff_raw   = toNum(fins.CFF);       // 財務CF（円）

        record.div_ann_raw       = toNum(fins.DivAnn);        // 1株あたり年間配当（円）
        record.div_total_ann_raw = toNum(fins.DivTotalAnn);   // 配当総額（円）
        record.payout_ratio_raw  = toNum(fins.PayoutRatioAnn);// 配当率

        record.nxf_sales_raw   = toNum(fins.NxFSales);  // 来期予想売上高（円）
        record.nxf_op_raw      = toNum(fins.NxFOP);     // 来期予想営業利益（円）
        record.nxf_np_raw      = toNum(fins.NxFNp);     // 来期予想純利益（円）
        record.nxf_eps_raw     = toNum(fins.NxFEPS);    // 来期予想EPS（円）
        record.nxf_div_ann_raw = toNum(fins.NxFDivAnn); // 来期予想年間配当（円）
      }

      records.push(record);
    }

    // キー構成が同じものごとにグループ化してupsert
    const result = await upsertGrouped(records);
    successCount = result.success;
    errorCount   = result.errors;
    errorBodies  = result.errorBodies;
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
    errorBodies, // Supabaseからの実際のエラー内容（診断用）
    processed: targets.length,
    total,
    priceFailCount: priceFailures.length,
    finsFailCount:  finsFailures.length,
    priceFailures,
    finsFailures,
    nextFrom:  nextFrom < total ? nextFrom : null,
    nextUrl:   nextFrom < total ? `/api/batch?from=${nextFrom}&size=${batchSize}` : null,
    message:   nextFrom < total
      ? `次: /api/batch?from=${nextFrom}&size=${batchSize}`
      : "全銘柄完了！",
  });
}
