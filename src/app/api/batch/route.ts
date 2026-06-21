// src/app/api/batch/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JQ_BASE = "https://api.jquants.com/v2";
const JQ_KEY  = process.env.JQUANTS_API_KEY ?? "";
const JQ_H    = { "x-api-key": JQ_KEY };
const SB_URL  = process.env.SUPABASE_URL ?? "";
const SB_KEY  = process.env.SUPABASE_ANON_KEY ?? "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

// 営業日を探す（土日を除く）
function getBusinessDay(daysAgo: number): string {
  const d = new Date();
  let count = 0;
  while (count < daysAgo) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// 全銘柄を確実に取得（Rangeヘッダーによる2000件制限を撤廃）
async function fetchMaster() {
  const res = await fetch(
    `${SB_URL}/rest/v1/stocks?select=code,name,sector&order=code&limit=5000`,
    {
      headers: {
        "apikey":        SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Prefer":        "count=exact",
      },
    }
  );
  if (!res.ok) throw new Error(`master(supabase) ${res.status}`);
  return await res.json();
}

// 全銘柄の株価を日付指定で一括取得（pagination対応）
async function fetchAllPrices(): Promise<Map<string, { price: number; previousClose: number; priceDate: string }>> {
  const priceMap = new Map<string, { price: number; previousClose: number; priceDate: string }>();

  // 無料プランは90〜120日前のみ → 91〜95日前の営業日を試す
  for (let daysAgo = 91; daysAgo <= 120; daysAgo++) {
    const date = getBusinessDay(daysAgo);
    let paginationKey = "";
    let totalFetched = 0;

    while (true) {
      const url = paginationKey
        ? `${JQ_BASE}/equities/bars/daily?date=${date}&pagination_key=${encodeURIComponent(paginationKey)}`
        : `${JQ_BASE}/equities/bars/daily?date=${date}`;

      const res = await fetch(url, { headers: JQ_H });

      if (res.status === 429) {
        await sleep(60000); // 1分待機
        continue;
      }
      if (!res.ok) break;

      const json = await res.json();
      const bars: Record<string, unknown>[] = json?.data ?? [];

      for (const bar of bars) {
        const code = String(bar.Code ?? "").slice(0, 4); // 5桁→4桁
        const price = toNum(bar.AdjC ?? bar.C);
        if (price > 0 && !priceMap.has(code)) {
          priceMap.set(code, {
            price,
            previousClose: price,
            priceDate: String(bar.Date ?? ""),
          });
        }
      }

      totalFetched += bars.length;
      paginationKey = String(json?.pagination_key ?? "");

      if (!paginationKey || bars.length === 0) break;
      await sleep(12000); // 1分5リクエスト制限対策
    }

    if (priceMap.size > 0) {
      console.log(`株価取得完了: date=${date}, ${priceMap.size}銘柄`);
      break;
    }
    await sleep(12000);
  }

  return priceMap;
}

async function fetchWithRetry(url: string): Promise<Response> {
  const res = await fetch(url, { headers: JQ_H });
  if (res.status === 429) {
    await sleep(60000);
    return fetch(url, { headers: JQ_H });
  }
  return res;
}

const FIN_FIELDS = [
  "TA", "Eq", "CashEq", "NP", "ShOutFY", "TrShFY", "AvgSh", "BPS", "EPS",
  "Sales", "OP", "OdP", "CFO", "CFI", "CFF",
  "DivAnn", "DivTotalAnn", "PayoutRatioAnn",
  "NxFSales", "NxFOP", "NxFNp", "NxFEPS", "NxFDivAnn",
] as const;

async function fetchFins(code: string): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string }
> {
  try {
    const url = `${JQ_BASE}/fins/summary?code=${code}`;
    const res = await fetchWithRetry(url);
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
  for (const group of Array.from(groups.values())) {
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
  const mode      = searchParams.get("mode") ?? "both";
  const startFrom = parseInt(searchParams.get("from") ?? "0");
  const batchSize = parseInt(searchParams.get("size") ?? "10");
  const codesParam = searchParams.get("codes");

  if (!JQ_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });
  if (!SB_URL) return NextResponse.json({ error: "SUPABASE_URL not set" }, { status: 500 });

  // ── 株価モード：全銘柄一括取得 ──────────────────────────────────────
  if (mode === "price") {
    const priceMap = await fetchAllPrices();
    if (priceMap.size === 0) {
      return NextResponse.json({ error: "株価取得失敗（レート制限または無データ）", success: 0 });
    }

    const records: Record<string, unknown>[] = [];
    for (const [code, p] of priceMap.entries()) {
      records.push({
        code,
        price:          p.price,
        previous_close: p.previousClose,
        price_date:     p.priceDate,
        updated_at:     new Date().toISOString(),
      });
    }

    // 500件ずつSupabaseにupsert
    let success = 0;
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const result = await upsertToSupabase(chunk);
      if (result.ok) success += chunk.length;
    }

    return NextResponse.json({
      success,
      total: priceMap.size,
      nextUrl: null,
      message: "全銘柄株価更新完了",
    });
  }

  // ── 財務モード：銘柄ごとに取得（レート制限考慮）────────────────────
  let targets: { code: string; name: string; sector: string }[];
  let total: number;

  if (codesParam) {
    const codes = codesParam.split(",").map(c => c.trim()).filter(Boolean);
    const res = await fetch(
      `${SB_URL}/rest/v1/stocks?select=code,name,sector&code=in.(${codes.map(c => `"${c}"`).join(",")})`,
      { headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` } }
    );
    targets = res.ok ? await res.json() : codes.map(c => ({ code: c, name: "", sector: "" }));
    total = targets.length;
  } else {
    let allStocks;
    try {
      allStocks = await fetchMaster();
    } catch (e) {
      return NextResponse.json({
        success: 0, errors: 0, processed: 0, total: 0,
        nextFrom: startFrom,
        nextUrl: `/api/batch?mode=${mode}&from=${startFrom}&size=${batchSize}`,
        message: `masterエラー(リトライ): ${String(e)}`,
      });
    }
    targets = allStocks.slice(startFrom, startFrom + batchSize);
    total   = allStocks.length;
  }

  const records: Record<string, unknown>[] = [];
  let successCount = 0;
  let errorCount   = 0;
  let errorBodies: string[] = [];
  const finsFailures: { code: string; reason: string }[] = [];

  try {
    for (const stock of targets) {
      // name/sectorが取得できていない銘柄は誤って空上書きしないようスキップ
      if (!stock.name) {
        finsFailures.push({ code: stock.code, reason: "name missing in master, skipped to avoid overwrite" });
        continue;
      }

      await sleep(13000); // 1分5リクエスト制限 → 13秒/リクエスト
      const finsResult = await fetchFins(stock.code);
      if (!finsResult.ok) {
        finsFailures.push({ code: stock.code, reason: finsResult.reason });
        continue;
      }
      const fins = finsResult.data;
      records.push({
        code:            stock.code,
        name:            stock.name,
        sector:          stock.sector,
        updated_at:      new Date().toISOString(),
        fin_date:        String(fins.DiscDate ?? ""),
        ta_raw:          toNum(fins.TA),
        eq_raw:          toNum(fins.Eq),
        cash_raw:        toNum(fins.CashEq),
        np_raw:          toNum(fins.NP),
        sh_out_raw:      toNum(fins.ShOutFY),
        tr_sh_raw:       toNum(fins.TrShFY),
        avg_sh_raw:      toNum(fins.AvgSh),
        bps_raw:         toNum(fins.BPS),
        eps_raw:         toNum(fins.EPS),
        sales_raw:       toNum(fins.Sales),
        op_raw:          toNum(fins.OP),
        odp_raw:         toNum(fins.OdP),
        cfo_raw:         toNum(fins.CFO),
        cfi_raw:         toNum(fins.CFI),
        cff_raw:         toNum(fins.CFF),
        div_ann_raw:     toNum(fins.DivAnn),
        div_total_ann_raw: toNum(fins.DivTotalAnn),
        payout_ratio_raw: toNum(fins.PayoutRatioAnn),
        nxf_sales_raw:   toNum(fins.NxFSales),
        nxf_op_raw:      toNum(fins.NxFOP),
        nxf_np_raw:      toNum(fins.NxFNp),
        nxf_eps_raw:     toNum(fins.NxFEPS),
        nxf_div_ann_raw: toNum(fins.NxFDivAnn),
      });
    }

    const result = await upsertGrouped(records);
    successCount = result.success;
    errorCount   = result.errors;
    errorBodies  = result.errorBodies;
  } catch (e) {
    return NextResponse.json({
      success: successCount, errors: errorCount + 1,
      processed: targets.length, total,
      nextFrom: startFrom,
      nextUrl: `/api/batch?mode=fins&from=${startFrom}&size=${batchSize}`,
      message: `処理エラー(リトライ): ${String(e)}`,
    });
  }

  const nextFrom = codesParam ? null : startFrom + batchSize;
  const hasMore  = !codesParam && nextFrom !== null && nextFrom < total;
  return NextResponse.json({
    success:      successCount,
    errors:       errorCount,
    errorBodies,
    processed:    targets.length,
    total,
    finsFailCount: finsFailures.length,
    finsFailures,
    nextFrom:     hasMore ? nextFrom : null,
    nextUrl:      hasMore ? `/api/batch?mode=fins&from=${nextFrom}&size=${batchSize}` : null,
    message:      hasMore ? `次: /api/batch?mode=fins&from=${nextFrom}&size=${batchSize}` : "全銘柄完了！",
  });
}
