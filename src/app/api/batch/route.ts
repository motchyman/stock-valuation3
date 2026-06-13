// src/app/api/batch/route.ts
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

      const bpsRaw  = toNum(fins?.BPS);
      const epsRaw  = toNum(fins?.EPS);
      const npRaw   = toNum(fins?.NP)     / 1_000_000;
      const eqRaw   = toNum(fins?.Eq)     / 1_000_000;
      const taRaw   = toNum(fins?.TA)     / 1_000_000;
      const cashRaw = toNum(fins?.CashEq) / 1_000_000;
      const shOut   = toNum(fins?.ShOutFY);

      const sharesThousand = shOut > 0 ? shOut
        : bpsRaw > 0 && eqRaw > 0 ? (eqRaw / bpsRaw) * 1000 : 1;

      const bps = bpsRaw > 0 ? bpsRaw
        : sharesThousand > 1 ? (eqRaw / sharesThousand) * 1000 : 0;
      const eps = epsRaw > 0 ? epsRaw
        : sharesThousand > 1 ? (npRaw / sharesThousand) * 1000 : 0;
      const roe = bps > 0 && eps !== 0 ? eps / bps
        : eqRaw > 0 && npRaw !== 0 ? npRaw / eqRaw : 0;

      const target = 0.08;
      const forecastRoe = Array.from({ length: 5 }, (_, i) => {
        const w = i / 4;
        return roe * (1 - w) + target * w;
      });

      records.push({
        code:                 stock.code,
        name:                 stock.name,
        sector:               stock.sector,
        price:                priceData?.price ?? 0,
        previous_close:       priceData?.previousClose ?? 0,
        price_date:           priceData?.priceDate ?? "",
        fin_date:             String(fins?.DiscDate ?? ""),
        bps, eps, roe,
        forecast_roe:         forecastRoe,
        total_assets:         taRaw,
        equity:               eqRaw,
        operating_assets:     taRaw - cashRaw,
        operating_liabilities: taRaw - eqRaw,
        cash:                 cashRaw,
        shares:               sharesThousand,
        required_return:      0.05,
        updated_at:           new Date().toISOString(),
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
