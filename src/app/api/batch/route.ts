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
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { url, status: res.status, headers, body: text.slice(0, 1000) };
}

async function fetchWithRetry(url: string): Promise<Response> {
  const res = await fetch(url, { headers: JQ_H });
  if (res.status === 429) {
    await sleep(10000);
    return fetch(url, { headers: JQ_H });
  }
  return res;
}

async function fetchPrice(code: string): Promise<
  | { ok: true; price: number; previousClose: number; priceDate: string }
  | { ok: false; reason: string }
> {
  try {
    const url = `${JQ_BASE}/equities/bars/daily?code=${code}&from=${daysAgo(120)}&to=${daysAgo(90)}`;
    const res = await fetchWithRetry(url);
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
  const mode       = searchParams.get("mode") ?? "both";
  const startFrom  = parseInt(searchParams.get("from") ?? "0");
  const batchSize  = parseInt(searchParams.get("size") ?? "10");
  const debugCode  = searchParams.get("debug");
  const codesParam = searchParams.get("codes");

  if (!JQ_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });
  if (!SB_URL) return NextResponse.json({ error: "SUPABASE_URL not set" }, { status: 500 });

  if (debugCode) {
    const type = searchParams.get("type") ?? "price";
    if (type === "fins") {
      const url = `${JQ_BASE}/fins/summary?code=${debugCode}`;
      const res = await fetch(url, { headers: JQ_H });
      const text = await res.text();
      return NextResponse.json({ url, status: res.status, body: text });
    }
    return NextResponse.json(await fetchPriceRaw(debugCode));
  }

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
  const priceFailures: { code: string; reason: string }[] = [];
  const finsFailures:  { code: string; reason: string }[] = [];

  try {
    for (const stock of targets) {
      let priceResult: Awaited<ReturnType<typeof fetchPrice>> | null = null;
      let finsResult:  Awaited<ReturnType<typeof fetchFins>>  | null = null;

      if (mode === "price" || mode === "both") {
        await sleep(2000);
        priceResult = await fetchPrice(stock.code);
        if (!priceResult.ok) priceFailures.push({ code: stock.code, reason: priceResult.reason });
      }

      if (mode === "fins" || mode === "both") {
        await sleep(2000);
        finsResult = await fetchFins(stock.code);
        if (!finsResult.ok) finsFailures.push({ code: stock.code, reason: finsResult.reason });
      }

      if (mode === "both" && priceResult && !priceResult.ok && finsResult && !finsResult.ok) continue;
      if (mode === "price" && priceResult && !priceResult.ok) continue;
      if (mode === "fins" && finsResult && !finsResult.ok) continue;

      const record: Record<string, unknown> = {
        code:       stock.code,
        name:       stock.name,
        sector:     stock.sector,
        updated_at: new Date().toISOString(),
      };

      if (priceResult?.ok) {
        record.price          = priceResult.price;
        record.previous_close = priceResult.previousClose;
        record.price_date     = priceResult.priceDate;
      }

      if (finsResult?.ok) {
        const fins = finsResult.data;
        record.fin_date          = String(fins.DiscDate ?? "");
        record.ta_raw            = toNum(fins.TA);
        record.eq_raw            = toNum(fins.Eq);
        record.cash_raw          = toNum(fins.CashEq);
        record.np_raw            = toNum(fins.NP);
        record.sh_out_raw        = toNum(fins.ShOutFY);
        record.tr_sh_raw         = toNum(fins.TrShFY);
        record.avg_sh_raw        = toNum(fins.AvgSh);
        record.bps_raw           = toNum(fins.BPS);
        record.eps_raw           = toNum(fins.EPS);
        record.sales_raw         = toNum(fins.Sales);
        record.op_raw            = toNum(fins.OP);
        record.odp_raw           = toNum(fins.OdP);
        record.cfo_raw           = toNum(fins.CFO);
        record.cfi_raw           = toNum(fins.CFI);
        record.cff_raw           = toNum(fins.CFF);
        record.div_ann_raw       = toNum(fins.DivAnn);
        record.div_total_ann_raw = toNum(fins.DivTotalAnn);
        record.payout_ratio_raw  = toNum(fins.PayoutRatioAnn);
        record.nxf_sales_raw     = toNum(fins.NxFSales);
        record.nxf_op_raw        = toNum(fins.NxFOP);
        record.nxf_np_raw        = toNum(fins.NxFNp);
        record.nxf_eps_raw       = toNum(fins.NxFEPS);
        record.nxf_div_ann_raw   = toNum(fins.NxFDivAnn);
      }

      records.push(record);
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
      nextUrl: `/api/batch?mode=${mode}&from=${startFrom}&size=${batchSize}`,
      message: `処理エラー(リトライ): ${String(e)}`,
    });
  }

  const nextFrom = codesParam ? null : startFrom + batchSize;
  const hasMore  = !codesParam && nextFrom !== null && nextFrom < total;
  return NextResponse.json({
    success:   successCount,
    errors:    errorCount,
    errorBodies,
    processed: targets.length,
    total,
    priceFailCount: priceFailures.length,
    finsFailCount:  finsFailures.length,
    priceFailures,
    finsFailures,
    nextFrom:  hasMore ? nextFrom : null,
    nextUrl:   hasMore ? `/api/batch?mode=${mode}&from=${nextFrom}&size=${batchSize}` : null,
    message:   hasMore ? `次: /api/batch?mode=${mode}&from=${nextFrom}&size=${batchSize}` : "全銘柄完了！",
  });
}
