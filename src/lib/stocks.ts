// src/lib/stocks.ts
export interface StockData {
  code: string;
  name: string;
  sector: string;
  price: number;
  previousClose: number;
  bps: number;
  eps: number;
  nikkeiEps?: number;
  roe: number;
  forecastROE: number[];
  totalAssets: number;
  equity: number;
  cash: number;
  interestBearingDebt: number;
  shares: number;
  requiredReturn: number;
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
  roa: number;
  autoR: number;
  nikkeiTheoretical: number;
  nikkeiUpdownPct: string;
  nikkeiBusinessValue: number;
  nikkeiAssetValue: number;
}

export const PRIME_STOCKS_LIST: { code: string; name: string; sector: string; yahoo: string }[] = [];

const safe = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// ── 日経マネー式 理論株価計算 ─────────────────────────────────────
// 理論株価 = 事業価値 + 資産価値
// 事業価値 = EPS × 15 × ROA × 10 × 財務レバレッジ補正
//   EPS = 予想経常利益 × 0.7 ÷ 発行済株式数（nikkeiEps）
//   ROA = EPS ÷ (BPS ÷ 自己資本比率)
//   財務レバレッジ補正:
//     自己資本比率 < 33.4% → 1 ÷ (自己資本比率 + 0.5)
//     33.4〜66.7% → 1 ÷ (自己資本比率 + 0.333)
//     > 66.7% → 1 ÷ (自己資本比率 + 0.167)
//
// 資産価値 = BPS × 0.7 × (自己資本比率 / 0.5)
//   ※有利子負債が取得できないため、自己資本比率で補正
//   ※自己資本比率が低い（借金が多い）ほど資産価値を割り引く
//   ※自己資本比率50%を基準(補正係数=1.0)とし、上下に調整
//   ※ただし補正係数の上限を1.4(自己資本比率70%相当)に制限
function calcNikkeiMoney(stock: StockData): {
  theoretical: number;
  updownPct: string;
  businessValue: number;
  assetValue: number;
  roa: number;
} {
  const bps   = safe(stock.bps);
  const price = safe(stock.price);

  // 日経マネー式EPS（予想経常利益×0.7÷株式数）
  const eps = safe(stock.nikkeiEps ?? 0) > 0
    ? safe(stock.nikkeiEps)
    : safe(stock.eps);

  if (bps <= 0 || eps <= 0) {
    const assetValue = bps * 0.7;
    return {
      theoretical: Math.round(assetValue),
      updownPct: price > 0 ? ((assetValue / price - 1) * 100).toFixed(1) : "0.0",
      businessValue: 0,
      assetValue: Math.round(assetValue),
      roa: 0,
    };
  }

  const totalAssets = safe(stock.totalAssets);
  const equity      = safe(stock.equity);

  // 自己資本比率（J-Quantsから取得 or TA/Eqから計算）
  const equityRatio = totalAssets > 0 ? equity / totalAssets : 0.5;

  // ROA = EPS ÷ (BPS ÷ 自己資本比率)
  const roa = equityRatio > 0 ? eps * equityRatio / bps : 0;

  // 財務レバレッジ補正（日経マネー式）
  let leverageAdj: number;
  if (equityRatio < 0.334) {
    leverageAdj = 1 / (equityRatio + 0.5);
  } else if (equityRatio <= 0.667) {
    leverageAdj = 1 / (equityRatio + 0.333);
  } else {
    leverageAdj = 1 / (equityRatio + 0.167);
  }

  // 事業価値 = EPS × 15 × ROA × 10 × 財務レバレッジ補正
  const businessValue = eps * 15 * roa * 10 * leverageAdj;

  // 資産価値 = BPS × 0.7 × 自己資本比率補正
  // 自己資本比率50%を基準(1.0)として線形補正
  // 例: 自己資本比率20% → 補正0.4、50% → 1.0、80% → 1.4(上限)
  const assetAdjRatio = Math.min(equityRatio / 0.5, 1.4);
  const assetValue = bps * 0.7 * assetAdjRatio;

  const theoretical = Math.round(businessValue + assetValue);
  const updownPct = price > 0
    ? ((theoretical / price - 1) * 100).toFixed(1)
    : "0.0";

  return {
    theoretical,
    updownPct,
    businessValue: Math.round(businessValue),
    assetValue:    Math.round(assetValue),
    roa,
  };
}

// ── RIMモデル 理論株価計算 ─────────────────────────────────────────
export function calcValuation(
  stock: StockData,
  forecastYears: number,
  terminalGrowthRate: number,
  useAutoR: boolean = false,
  payoutRatio: number = 0.4,
): ValuationResult {
  const equityRatio = safe(stock.totalAssets) > 0
    ? safe(stock.equity) / safe(stock.totalAssets)
    : 0.5;

  const roa = safe(stock.bps) > 0 && equityRatio > 0
    ? safe(stock.eps) * equityRatio / safe(stock.bps)
    : 0;

  const leverageAdj = equityRatio > 0
    ? (equityRatio < 0.334 ? 1 / (equityRatio + 0.5)
      : equityRatio <= 0.667 ? 1 / (equityRatio + 0.333)
      : 1 / (equityRatio + 0.167))
    : 1.2;

  const autoR = roa * leverageAdj;
  const r = useAutoR && autoR > 0.01 && autoR < 0.5
    ? autoR
    : (safe(stock.requiredReturn) || 0.05);

  const perShare = (millionYen: number): number =>
    safe(stock.shares) > 0
      ? (safe(millionYen) / safe(stock.shares)) * 1000
      : 0;

  const totalLiabilities     = safe(stock.totalAssets) - safe(stock.equity);
  const operatingAssets      = safe(stock.totalAssets) - safe(stock.cash);
  const operatingLiabilities = totalLiabilities - safe(stock.interestBearingDebt);
  const netOperatingAssetsPS = perShare(operatingAssets - operatingLiabilities);
  const netFinancialAssetsPS = perShare(safe(stock.cash) - safe(stock.interestBearingDebt));

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

  const retentionRate = 1 - payoutRatio;
  let bps = safe(stock.bps);
  let pvSum = 0;
  const reiByYear: { year: number; roe: number; rei: number; pv: number }[] = [];

  for (let i = 0; i < forecastYears; i++) {
    const roe_i = safe(forecastROE[Math.min(i, forecastROE.length - 1)]);
    const eps_i = roe_i * bps;
    const rei   = eps_i - r * bps;
    const pv    = rei / Math.pow(1 + r, i + 1);
    pvSum += pv;
    reiByYear.push({ year: i + 1, roe: roe_i, rei: Math.round(rei), pv: Math.round(pv) });
    bps = bps * (1 + roe_i * retentionRate);
  }

  const lastROE     = safe(forecastROE[Math.min(forecastYears - 1, forecastROE.length - 1)]);
  const terminalEPS = lastROE * bps;
  const terminalREI = terminalEPS - r * bps;
  const terminalPV  = r > terminalGrowthRate
    ? (terminalREI / (r - terminalGrowthRate)) / Math.pow(1 + r, forecastYears)
    : 0;
  pvSum += terminalPV;

  const theoretical = safe(stock.bps) + pvSum;
  const updownPct = safe(stock.price) > 0
    ? ((theoretical / safe(stock.price) - 1) * 100).toFixed(1)
    : "0.0";

  const pbr = safe(stock.bps) > 0 && safe(stock.price) > 0
    ? safe(stock.price) / safe(stock.bps)
    : 0;

  const nikkei = calcNikkeiMoney(stock);

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
    nikkeiTheoretical:   nikkei.theoretical,
    nikkeiUpdownPct:     nikkei.updownPct,
    nikkeiBusinessValue: nikkei.businessValue,
    nikkeiAssetValue:    nikkei.assetValue,
  };
}
