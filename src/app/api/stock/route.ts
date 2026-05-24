// src/app/api/stock/route.ts
// J-Quants API v2 公式仕様準拠版
// レスポンスキー: data（銘柄マスター・株価共通）
// 株価フィールド: C=終値, O=始値, AdjC=調整済み終値

import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";
const JQ_H = () => ({ "x-api-key": API_KEY });

// Freeプランで取得可能な日付（84日前〜）
function getDateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// ── 株価取得（J-Quants: 84〜114日前の範囲） ──────────────────────────
async function fetchPriceJQ(code: string) {
  try {
    const from = getDateStr(114);
    const to   = getDateStr(84);
    const res  = await fetch(
      `${JQ_BASE}/equities/bars/daily?code=${code}&from=${from}&to=${to}`,
      { headers: JQ_H(), next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    // 公式レスポンスキーは "data"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bars: Record<string, any>[] = json?.data ?? json?.bars ?? [];
    if (bars.length === 0) return null;
    const sorted = [...bars].sort((a, b) =>
      (b.Date ?? "").localeCompare(a.Date ?? "")
    );
    // 終値フィールド: C（調整前）または AdjC（調整済み）
    const price  = sorted[0]?.AdjC ?? sorted[0]?.C ?? 0;
    const prev   = sorted[1]?.AdjC ?? sorted[1]?.C ?? price;
    return { price, previousClose: prev, priceDate: sorted[0]?.Date ?? "" };
  } catch { return null; }
}

// ── 株価取得（Yahoo Finance: 最新値） ────────────────────────────────
async function fetchPriceYahoo(yahooCode: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCode}?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? 0;
    if (!price) return null;
    return {
      price,
      previousClose: meta?.chartPreviousClose ?? price,
      priceDate: "realtime",
    };
  } catch { return null; }
}

// ── 財務サマリー取得（J-Quants: /fins/summary） ───────────────────────
// レスポンスキー: "summary"
// フィールド: BPS, EPS, TA, Eq, CashEq, CurPerType, DiscDate
async function fetchFinSummary(code: string) {
  try {
    const res = await fetch(
      `${JQ_BASE}/fins/summary?code=${code}`,
      { headers: JQ_H(), next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, any>[] = json?.summary ?? [];
    if (rows.length === 0) return null;
    // 本決算(FY)の最新を優先
    const annual = rows.filter(r => r.CurPerType === "FY");
    const pool   = annual.length > 0 ? annual : rows;
    return [...pool].sort((a, b) =>
      (b.DiscDate ?? "").localeCompare(a.DiscDate ?? "")
    )[0];
  } catch { return null; }
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code      = searchParams.get("code");
  const yahooCode = searchParams.get("yahoo");
  if (!code)    return NextResponse.json({ error: "code required" },           { status: 400 });
  if (!API_KEY) return NextResponse.json({ error: "JQUANTS_API_KEY not set" }, { status: 500 });

  // 株価: Yahoo優先 → J-Quantsフォールバック
  const [yahooPrice, jqPrice, fins] = await Promise.all([
    yahooCode ? fetchPriceYahoo(yahooCode) : Promise.resolve(null),
    fetchPriceJQ(code),
    fetchFinSummary(code),
  ]);

  const priceData     = yahooPrice ?? jqPrice;
  const price         = priceData?.price ?? 0;
  const previousClose = priceData?.previousClose ?? 0;
  const isRealtime    = !!yahooPrice;

  // 財務: fins/summaryの公式フィールド名
  const bps = toNum(fins?.BPS);   // 1株あたり純資産（円/株）
  const eps = toNum(fins?.EPS);   // 1株あたり純利益（円/株）
  const roe = bps > 0 ? eps / bps : 0;

  // BS項目（百万円）
  const totalAssets      = toNum(fins?.TA);
  const equity           = toNum(fins?.Eq);
  const totalLiabilities = totalAssets - equity;
  const cash             = toNum(fins?.CashEq);
  // fins/summaryに有利子負債項目なし → fins/detailsが必要（有料）
  const interestBearingDebt = 0;

  const operatingAssets      = totalAssets - cash;
  const operatingLiabilities = totalLiabilities - interestBearingDebt;

  // 発行済株式数（千株）= 純資産(百万円) / BPS(円/株) = 百万株 → ×1000 = 千株
  const sharesThousand = bps > 0 && equity > 0
    ? (equity / bps) * 1000
    : 1;

  // 将来ROE推計（今期から業界平均8%へ5年で収束）
  const target = 0.08;
  const forecastROE = Array.from({ length: 5 }, (_, i) => {
    const w = i / 4;
    return roe * (1 - w) + target * w;
  });

  return NextResponse.json({
    code,
    price,
    previousClose,
    isRealtime,
    priceDate:   priceData?.priceDate ?? "",
    finDate:     fins?.DiscDate ?? "",
    bps, eps, roe,
    forecastROE,
    totalAssets,
    equity,
    operatingAssets,
    operatingLiabilities,
    cash,
    interestBearingDebt,
    shares: sharesThousand,
    requiredReturn: 0.05,
    lastUpdated: new Date().toISOString(),
  });
}
