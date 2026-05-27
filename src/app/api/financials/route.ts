// src/app/api/financials/route.ts - エラー詳細表示版
import { NextRequest, NextResponse } from "next/server";

const JQ_BASE = "https://api.jquants.com/v2";
const API_KEY = process.env.JQUANTS_API_KEY ?? "";
const JQ_H = { "x-api-key": API_KEY };

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "3");

  if (!API_KEY) return NextResponse.json({ error: "NO API KEY" }, { status: 500 });

  const errors: string[] = [];

  // Step1: 銘柄マスター取得
  let targets: { code: string; name: string; sector: string }[] = [];
  try {
    const res = await fetch(`${JQ_BASE}/equities/master`, { headers: JQ_H });
    const json = await res.json();
    const all: Record<string, any>[] = json?.data ?? [];
    const prime = all.filter(s => s.Mkt === "0111");
    targets = prime.slice(0, limit).map(s => ({
      code:   (s.Code ?? "").slice(0, 4),
      name:   s.CoName ?? "",
      sector: s.S33Nm ?? "",
    }));
    errors.push(`master: OK ${prime.length}銘柄, status=${res.status}`);
  } catch (e) {
    errors.push(`master ERROR: ${String(e)}`);
    return NextResponse.json({ errors }, { status: 500 });
  }

  // Step2: 各銘柄の株価・財務取得
  const results = [];
  for (const stock of targets) {
    const stockErrors: string[] = [];

    // 株価
    let price = 0, previousClose = 0, priceDate = "";
    try {
      const from = daysAgo(114);
      const to   = daysAgo(84);
      const res  = await fetch(
        `${JQ_BASE}/equities/bars/daily?code=${stock.code}&from=${from}&to=${to}`,
        { headers: JQ_H }
      );
      const json = await res.json();
      const bars: Record<string, any>[] = json?.data ?? [];
      const sorted = [...bars].sort((a, b) => (b.Date ?? "").localeCompare(a.Date ?? ""));
      price         = sorted[0]?.AdjC ?? sorted[0]?.C ?? 0;
      previousClose = sorted[1]?.AdjC ?? sorted[1]?.C ?? price;
      priceDate     = sorted[0]?.Date ?? "";
      stockErrors.push(`price: status=${res.status} bars=${bars.length}`);
    } catch (e) {
      stockErrors.push(`price ERROR: ${String(e)}`);
    }

    // 財務
    let bps = 0, eps = 0, roe = 0, totalAssets = 0, equity = 0, cash = 0;
    let finDate = "";
    try {
      const res  = await fetch(`${JQ_BASE}/fins/summary?code=${stock.code}`, { headers: JQ_H });
      const json = await res.json();
      const rows: Record<string, any>[] = json?.data ?? json?.summary ?? [];
      const annual = rows.filter(r => r.CurPerType === "FY");
      const pool   = annual.length > 0 ? annual : rows;
      const fin    = [...pool].sort((a, b) => (b.DiscDate ?? "").localeCompare(a.DiscDate ?? ""))[0];
      bps         = toNum(fin?.BPS);
      eps         = toNum(fin?.EPS);
      roe         = bps > 0 ? eps / bps : 0;
      totalAssets = toNum(fin?.TA);
      equity      = toNum(fin?.Eq);
      cash        = toNum(fin?.CashEq);
      finDate     = fin?.DiscDate ?? "";
      stockErrors.push(`fins: status=${res.status} rows=${rows.length} BPS=${bps} EPS=${eps}`);
    } catch (e) {
      stockErrors.push(`fins ERROR: ${String(e)}`);
    }

    const sharesThousand = bps > 0 && equity > 0 ? (equity / bps) * 1000 : 1;
    const target = 0.08;
    const forecastROE = Array.from({ length: 5 }, (_, i) => {
      const w = i / 4;
      return roe * (1 - w) + target * w;
    });

    results.push({
      code: stock.code, name: stock.name, sector: stock.sector,
      price, previousClose, priceDate, finDate,
      bps, eps, roe, forecastROE,
      totalAssets, equity,
      operatingAssets:      totalAssets - cash,
      operatingLiabilities: totalAssets - equity,
      cash, interestBearingDebt: 0,
      shares: sharesThousand,
      requiredReturn: 0.05,
      lastUpdated: new Date().toISOString(),
      _debug: stockErrors,
    });
  }

  return NextResponse.json({
    stocks: results,
    total: targets.length,
    fetchedAt: new Date().toISOString(),
    _errors: errors,
  });
}
