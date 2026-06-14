// src/lib/stocks.ts
// 財務データは各社の最新決算短信・有価証券報告書ベース

export interface StockData {
  code: string;
  name: string;
  sector: string;
  price: number;
  previousClose: number;
  // 1株あたり指標（円/株）
  bps: number;
  eps: number;
  roe: number;
  forecastROE: number[];
  // バランスシート（百万円）
  totalAssets: number;
  equity: number;
  cash: number;
  interestBearingDebt: number;
  // 株式
  shares: number;           // 発行済株式数（千株）
  requiredReturn: number;
  lastUpdated?: string;
  priceDate?: string;
  error?: string;
}

export interface ValuationResult extends StockData {
  // 計算結果（円/株）
  netOperatingAssetsPS: number;   // 正味営業資産/株（参考値）
  netFinancialAssetsPS: number;   // 正味金融資産/株（参考値）
  pvREI: number;                  // 残余事業利益PV合計
  terminalPV: number;             // うち終端価値PV
  theoretical: number;            // 理論株価
  updownPct: string;              // 乖離率
  reiByYear: { year: number; roe: number; rei: number; pv: number }[];
}

export const PRIME_STOCKS_LIST: { code: string; name: string; sector: string; yahoo: string }[] = [];

const safe = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// ── 理論株価計算（簡易RIMモデル） ────────────────────────────────
// 理論株価 = BPS + 残余事業利益PV
//
// 残余事業利益(REI) = (ROE_t - 要求利回り) × BPS_t
// PV = Σ REI_t / (1+r)^t + 終端価値PV
// 終端価値PV = REI_T+1 / (r - g) / (1+r)^T
// BPS成長: bps = bps * (1 + roe_i * 0.6)（留保率60%）
//
// 注: 正味営業資産・正味金融資産は有利子負債データが取得できないため
//     参考値として表示のみ。理論株価の計算には使用しない。
export function calcValuation(
  stock: StockData,
  forecastYears: number,
  terminalGrowthRate: number
): ValuationResult {
  const r = safe(stock.requiredReturn) || 0.05;

  const perShare = (millionYen: number): number =>
    safe(stock.shares) > 0
      ? (safe(millionYen) / safe(stock.shares)) * 1000
      : 0;

  // 参考値として計算（表示用、理論株価には不使用）
  const totalLiabilities     = safe(stock.totalAssets) - safe(stock.equity);
  const operatingAssets      = safe(stock.totalAssets) - safe(stock.cash);
  const operatingLiabilities = totalLiabilities - safe(stock.interestBearingDebt);
  const netOperatingAssetsPS = perShare(operatingAssets - operatingLiabilities);
  const netFinancialAssetsPS = perShare(safe(stock.cash) - safe(stock.interestBearingDebt));

  // 予想ROE
  const forecastROE =
    stock.forecastROE && stock.forecastROE.length > 0
      ? stock.forecastROE.map(safe)
      : (() => {
          const target = 0.08;
          return Array.from({ length: 5 }, (_, i) => {
            const w = i / 4;
            return (safe(stock.roe) || 0.08) * (1 - w) + target * w;
          });
        })();

  // 残余事業利益PVの計算
  let bps = safe(stock.bps);
  let pvSum = 0;
  const reiByYear: { year: number; roe: number; rei: number; pv: number }[] = [];

  for (let i = 0; i < forecastYears; i++) {
    const roe_i = safe(forecastROE[Math.min(i, forecastROE.length - 1)]);
    const rei   = (roe_i - r) * bps;
    const pv    = rei / Math.pow(1 + r, i + 1);
    pvSum += pv;
    reiByYear.push({ year: i + 1, roe: roe_i, rei: Math.round(rei), pv: Math.round(pv) });
    bps = bps * (1 + roe_i * 0.6); // 留保率60%でBPS成長
  }

  // 終端価値（Gordon Growth Model）
  const lastROE     = safe(forecastROE[Math.min(forecastYears - 1, forecastROE.length - 1)]);
  const terminalREI = (lastROE - r) * bps;
  const terminalPV  = r > terminalGrowthRate
    ? (terminalREI / (r - terminalGrowthRate)) / Math.pow(1 + r, forecastYears)
    : 0;
  pvSum += terminalPV;

  // 理論株価 = BPS + 残余事業利益PV
  const theoretical = safe(stock.bps) + pvSum;

  const updownPct = safe(stock.price) > 0
    ? ((theoretical / safe(stock.price) - 1) * 100).toFixed(1)
    : "0.0";

  return {
    ...stock,
    netOperatingAssetsPS: Math.round(netOperatingAssetsPS),
    netFinancialAssetsPS: Math.round(netFinancialAssetsPS),
    pvREI:      Math.round(pvSum),
    terminalPV: Math.round(terminalPV),
    theoretical: Math.round(theoretical),
    updownPct,
    reiByYear,
  };
}
