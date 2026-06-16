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
  nikkeiMarketRisk: number;
  nikkeiIbdPerShare: number;
  assetAdjRatio: number;
}

export const PRIME_STOCKS_LIST: { code: string; name: string; sector: string; yahoo: string }[] = [];

const safe = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// ── 資産価値の割引評価率（自己資本比率別・p.62）──────────────────
function calcAssetDiscountRate(equityRatio: number): number {
  if (equityRatio >= 0.80) return 0.80;
  if (equityRatio >= 0.67) return 0.75;
  if (equityRatio >= 0.50) return 0.70;
  if (equityRatio >= 0.33) return 0.65;
  if (equityRatio >= 0.10) return 0.60;
  return 0.50;
}

// ── 市場リスク減額率（PBR別・p.62）────────────────────────────────
// PBR 0.5倍未満の場合のみ減額
function calcMarketRiskRate(pbr: number): number {
  if (pbr >= 0.50) return 0.000;
  if (pbr >= 0.41) return 0.200;
  if (pbr >= 0.34) return 0.333;
  if (pbr >= 0.25) return 0.500;
  if (pbr >= 0.21) return 0.667;
  if (pbr >= 0.04) {
    // 0.04〜0.20倍: 75〜95%を線形補間
    return 0.75 + (0.20 - pbr) / (0.20 - 0.04) * 0.20;
  }
  if (pbr > 0.00) {
    // 0〜0.03倍: 97.5〜99.5%を線形補間
    return 0.975 + (0.03 - pbr) / 0.03 * 0.02;
  }
  return 0.000;
}

// ── はっしゃん式（日経マネー誌p.62〜63）理論株価計算 ────────────────
//
// 理論株価 = 事業価値 + 資産価値 - 市場リスク
//
// ⒜ 事業価値 = EPS × 15 × ROA(上限30%) × 10 × 財務レバレッジ補正
//   EPS = 予想経常利益×0.7 ÷ 発行済株式数(自己株除く)
//   ROA = EPS ÷ (BPS ÷ 自己資本比率)  ※上限30%
//   財務レバレッジ補正:
//     66.7%以上   → 1倍
//     33.4〜66.7% → 1÷(自己資本比率+0.333)
//     33.4%未満   → 1.5倍
//
// ⒝ 資産価値 = BPS × 割引評価率（自己資本比率別）
//   80%以上→80%, 67%以上→75%, 50%以上→70%,
//   33%以上→65%, 10%以上→60%, 10%未満→50%
//
// ⒞ 市場リスク = (事業価値+資産価値) × 減額率
//   PBR 0.5倍以上→0%, 0.41〜0.49→20%, 0.34〜0.40→33.3%,
//   0.25〜0.33→50%, 0.21〜0.24→66.7%, 0.04〜0.20→75〜95%,
//   0〜0.03→97.5〜99.5%
function calcNikkeiMoney(stock: StockData): {
  theoretical: number;
  updownPct: string;
  businessValue: number;
  assetValue: number;
  marketRisk: number;
  ibdPerShare: number;
  assetAdjRatio: number;
  roa: number;
} {
  const bps   = safe(stock.bps);
  const price = safe(stock.price);

  // 日経マネー式EPS（予想経常利益×0.7÷発行済株式数(自己株除く)）
  const eps = safe(stock.nikkeiEps ?? 0) > 0
    ? safe(stock.nikkeiEps)
    : safe(stock.eps);

  const totalAssets = safe(stock.totalAssets);
  const equity      = safe(stock.equity);
  const equityRatio = totalAssets > 0 ? equity / totalAssets : 0.5;

  // ⒝ 資産価値 = BPS × 割引評価率
  const assetDiscountRate = calcAssetDiscountRate(equityRatio);
  const assetValue = bps * assetDiscountRate;

  // 現在の株価ベースのPBR（市場リスク計算用）
  // 株価未取得時はリスクなし扱い
  const currentPbr = price > 0 && bps > 0 ? price / bps : 99;

  if (bps <= 0 || eps <= 0) {
    const marketRiskRate = calcMarketRiskRate(currentPbr);
    const marketRisk = assetValue * marketRiskRate;
    const total = Math.max(assetValue - marketRisk, 0);
    return {
      theoretical: Math.round(total),
      updownPct: price > 0 ? ((total / price - 1) * 100).toFixed(1) : "0.0",
      businessValue: 0,
      assetValue: Math.round(assetValue),
      marketRisk: Math.round(marketRisk),
      ibdPerShare: 0,
      assetAdjRatio: assetDiscountRate,
      roa: 0,
    };
  }

  // ⒜ 事業価値
  // ROA = EPS ÷ (BPS ÷ 自己資本比率)、上限30%
  const roaRaw = equityRatio > 0 ? eps * equityRatio / bps : 0;
  const roa = Math.min(roaRaw, 0.30);

  // 財務レバレッジ補正（p.62の表通り）
  let leverageAdj: number;
  if (equityRatio >= 0.667) {
    leverageAdj = 1.0;
  } else if (equityRatio >= 0.334) {
    // 33.4〜66.7%: 1÷(自己資本比率+0.333)
    leverageAdj = 1 / (equityRatio + 0.333);
  } else {
    leverageAdj = 1.5;
  }

  const businessValue = eps * 15 * roa * 10 * leverageAdj;

  // ⒞ 市場リスク（PBR 0.5倍未満の場合のみ）
  const marketRiskRate = calcMarketRiskRate(currentPbr);
  const marketRisk = (businessValue + assetValue) * marketRiskRate;

  const theoretical = Math.max(Math.round(businessValue + assetValue - marketRisk), 0);
  const updownPct = price > 0
    ? ((theoretical / price - 1) * 100).toFixed(1)
    : "0.0";

  return {
    theoretical,
    updownPct,
    businessValue: Math.round(businessValue),
    assetValue:    Math.round(assetValue),
    marketRisk:    Math.round(marketRisk),
    ibdPerShare:   0,  // はっしゃん式では有利子負債を別途引かない
    assetAdjRatio: assetDiscountRate,
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
  ibdK: number = 0.6,  // RIMモデルの有利子負債推計係数（はっしゃん式では未使用）
): ValuationResult {
  const equityRatio = safe(stock.totalAssets) > 0
    ? safe(stock.equity) / safe(stock.totalAssets)
    : 0.5;

  const roa = safe(stock.bps) > 0 && equityRatio > 0
    ? safe(stock.eps) * equityRatio / safe(stock.bps)
    : 0;

  // RIMモデル用の財務レバレッジ（autoR計算用）
  const leverageAdj = equityRatio >= 0.667 ? 1.0
    : equityRatio >= 0.334 ? 1 / (equityRatio + 0.333)
    : 1.5;

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
    nikkeiMarketRisk:    nikkei.marketRisk,
    nikkeiIbdPerShare:   nikkei.ibdPerShare,
    assetAdjRatio:       nikkei.assetAdjRatio,
  };
}
