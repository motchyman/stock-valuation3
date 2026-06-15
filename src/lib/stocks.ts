// src/lib/stocks.ts
export interface StockData {
  code: string;
  name: string;
  sector: string;
  price: number;
  previousClose: number;
  bps: number;
  eps: number;
  roe: number;
  forecastROE: number[];
  totalAssets: number;
  equity: number;
  cash: number;
  interestBearingDebt: number;
  shares: number;           // 発行済株式数（千株）
  requiredReturn: number;   // 株主資本コスト(r)
  lastUpdated?: string;
  priceDate?: string;
  error?: string;
}

export interface ValuationResult extends StockData {
  netOperatingAssetsPS: number;
  netFinancialAssetsPS: number;
  pvREI: number;
  terminalPV: number;
  theoretical: number;
  updownPct: string;
  reiByYear: { year: number; roe: number; rei: number; pv: number }[];
  pbr: number;
  roa: number;              // 計算に使用したROA
  autoR: number;            // 自動計算した株主資本コスト
}

export const PRIME_STOCKS_LIST: { code: string; name: string; sector: string; yahoo: string }[] = [];

const safe = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// ── 日経マネー式 理論株価計算 ─────────────────────────────────────
// 理論株価 = BPS + 残余利益PV
// 残余利益 = EPS - (BPS × r)  ※ = (ROE - r) × BPS と等価
// r(株主資本コスト) = ROA × 財務レバレッジ補正
//   ROA = EPS ÷ (BPS ÷ 自己資本比率)
//   財務レバレッジ補正 = 1 ÷ (自己資本比率 + 0.333)  ※自己資本比率33.4〜66.7%の場合
//   ※自己資本比率 = equity / totalAssets
// BPS成長: bps_next = bps × (1 + roe × 留保率)  留保率=(1-配当性向)デフォルト0.4
// useAutoR=trueの場合はROAベースで自動計算、falseの場合はrequiredReturnをそのまま使用
export function calcValuation(
  stock: StockData,
  forecastYears: number,
  terminalGrowthRate: number,
  useAutoR: boolean = false,
  payoutRatio: number = 0.4,  // 配当性向（留保率 = 1 - payoutRatio）
): ValuationResult {
  const equityRatio = safe(stock.totalAssets) > 0
    ? safe(stock.equity) / safe(stock.totalAssets)
    : 0.5;

  // ROA = EPS ÷ (BPS ÷ 自己資本比率)
  const roa = safe(stock.bps) > 0 && equityRatio > 0
    ? safe(stock.eps) / (safe(stock.bps) / equityRatio)
    : 0;

  // 財務レバレッジ補正
  const leverageAdj = equityRatio > 0
    ? 1 / (equityRatio + 0.333)
    : 1.2;

  // 自動計算した株主資本コスト
  const autoR = roa * leverageAdj;

  // 実際に使用するr
  const r = useAutoR && autoR > 0.01 && autoR < 0.5
    ? autoR
    : (safe(stock.requiredReturn) || 0.05);

  const perShare = (millionYen: number): number =>
    safe(stock.shares) > 0
      ? (safe(millionYen) / safe(stock.shares)) * 1000
      : 0;

  // 参考値
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
          return Array.from({ length: forecastYears }, (_, i) => {
            const w = i / Math.max(forecastYears - 1, 1);
            return (safe(stock.roe) || 0.08) * (1 - w) + target * w;
          });
        })();

  // 留保率
  const retentionRate = 1 - payoutRatio;

  let bps = safe(stock.bps);
  let pvSum = 0;
  const reiByYear: { year: number; roe: number; rei: number; pv: number }[] = [];

  for (let i = 0; i < forecastYears; i++) {
    const roe_i = safe(forecastROE[Math.min(i, forecastROE.length - 1)]);
    const eps_i = roe_i * bps;           // EPS = ROE × BPS
    const rei   = eps_i - r * bps;       // 残余利益 = EPS - (BPS × r)
    const pv    = rei / Math.pow(1 + r, i + 1);
    pvSum += pv;
    reiByYear.push({ year: i + 1, roe: roe_i, rei: Math.round(rei), pv: Math.round(pv) });
    bps = bps * (1 + roe_i * retentionRate); // BPS成長
  }

  // 終端価値（Gordon Growth Model）
  const lastROE     = safe(forecastROE[Math.min(forecastYears - 1, forecastROE.length - 1)]);
  const terminalEPS = lastROE * bps;
  const terminalREI = terminalEPS - r * bps;
  const terminalPV  = r > terminalGrowthRate
    ? (terminalREI / (r - terminalGrowthRate)) / Math.pow(1 + r, forecastYears)
    : 0;
  pvSum += terminalPV;

  // 理論株価 = BPS + 残余利益PV
  const theoretical = safe(stock.bps) + pvSum;

  const updownPct = safe(stock.price) > 0
    ? ((theoretical / safe(stock.price) - 1) * 100).toFixed(1)
    : "0.0";

  const pbr = safe(stock.bps) > 0 && safe(stock.price) > 0
    ? safe(stock.price) / safe(stock.bps)
    : 0;

  return {
    ...stock,
    netOperatingAssetsPS: Math.round(netOperatingAssetsPS),
    netFinancialAssetsPS: Math.round(netFinancialAssetsPS),
    pvREI:       Math.round(pvSum),
    terminalPV:  Math.round(terminalPV),
    theoretical: Math.round(theoretical),
    updownPct,
    reiByYear,
    pbr,
    roa,
    autoR,
  };
}
