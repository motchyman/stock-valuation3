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
  cash: number;                    // 現金及び現金同等物（＋有価証券）
  interestBearingDebt: number;     // 有利子負債
  // 営業損益（百万円）
  operatingProfit?: number;        // 今期営業利益
  forecastOperatingProfit?: number;// 来期予想営業利益
  operatingAssets?: number;        // 営業資産 = 総資産 - 現金
  operatingLiabilities?: number;   // 営業負債 = 総負債 - 有利子負債
  // はっしゃん式用
  nikkeiEps?: number;              // 計算用EPS（予想経常利益×0.7÷株数）
  // 成長率
  salesGrowthRate?: number;        // 売上高成長率（小数）
  taxRate?: number;                // 実効税率（デフォルト0.30）
  // 株式
  shares: number;                  // 発行済株式数（自己株除く、千株）
  requiredReturn: number;
  lastUpdated?: string;
  priceDate?: string;
  error?: string;
}

export interface ValuationResult extends StockData {
  // 日経マネー式RIM
  netOperatingAssetsPS: number;
  netFinancialAssetsPS: number;
  pvREI: number;
  terminalPV: number;
  theoretical: number;
  updownPct: string;
  reiByYear: { year: number; roe: number; rei: number; pv: number }[];
  // はっしゃん式
  nikkeiTheoretical: number;
  nikkeiUpdownPct: string;
  nikkeiBusinessValue: number;
  nikkeiAssetValue: number;
  nikkeiMarketRisk: number;
  // 共通指標
  pbr: number;
  roa: number;
  assetAdjRatio: number;
  effectiveR: number; // 実際に使われたr（動的計算結果 or 個別設定値）
}

// ── 東証プライム主要銘柄 ─────────────────────────────────────────────
export const PRIME_STOCKS: Omit<StockData, "price"|"previousClose"|"roe"|"forecastROE"|"requiredReturn">[] = [
  { code:"7203",name:"トヨタ自動車",sector:"輸送用機器",bps:4185,eps:878,totalAssets:97940000,equity:31330000,cash:10490000,interestBearingDebt:28650000,shares:13450000 },
  { code:"6758",name:"ソニーグループ",sector:"電気機器",bps:3842,eps:671,totalAssets:31590000,equity:4640000,cash:3820000,interestBearingDebt:3110000,shares:1200000 },
  { code:"6861",name:"キーエンス",sector:"電気機器",bps:55230,eps:10210,totalAssets:5580000,equity:5180000,cash:3890000,interestBearingDebt:0,shares:242000 },
  { code:"8306",name:"三菱UFJフィナンシャル",sector:"銀行業",bps:1523,eps:196,totalAssets:437290000,equity:18450000,cash:68320000,interestBearingDebt:89100000,shares:12130000 },
  { code:"9984",name:"ソフトバンクG",sector:"情報・通信",bps:3621,eps:48,totalAssets:47060000,equity:6210000,cash:4920000,interestBearingDebt:17830000,shares:1700000 },
  { code:"4568",name:"第一三共",sector:"医薬品",bps:1628,eps:76,totalAssets:3320000,equity:2380000,cash:512000,interestBearingDebt:240000,shares:1458000 },
  { code:"9432",name:"日本電信電話",sector:"情報・通信",bps:619,eps:19,totalAssets:29870000,equity:8130000,cash:890000,interestBearingDebt:9240000,shares:43800000 },
  { code:"7974",name:"任天堂",sector:"その他製品",bps:2340,eps:239,totalAssets:3398515,equity:2724327,cash:1414121,interestBearingDebt:0,shares:1164248 },
  { code:"4519",name:"中外製薬",sector:"医薬品",bps:1842,eps:356,totalAssets:1820000,equity:1490000,cash:620000,interestBearingDebt:0,shares:560000 },
  { code:"8035",name:"東京エレクトロン",sector:"電気機器",bps:4921,eps:882,totalAssets:2280000,equity:2000000,cash:490000,interestBearingDebt:0,shares:391000 },
  { code:"6367",name:"ダイキン工業",sector:"機械",bps:5840,eps:635,totalAssets:5510000,equity:3060000,cash:410000,interestBearingDebt:790000,shares:522000 },
  { code:"2914",name:"JT",sector:"食料品",bps:2890,eps:365,totalAssets:6980000,equity:3620000,cash:650000,interestBearingDebt:790000,shares:1250000 },
  { code:"8316",name:"三井住友FG",sector:"銀行業",bps:8420,eps:1164,totalAssets:307240000,equity:13250000,cash:38470000,interestBearingDebt:62300000,shares:1565000 },
  { code:"6098",name:"リクルートHD",sector:"サービス業",bps:1218,eps:195,totalAssets:3610000,equity:2230000,cash:890000,interestBearingDebt:130000,shares:1830000 },
  { code:"4063",name:"信越化学工業",sector:"化学",bps:6382,eps:853,totalAssets:6150000,equity:5760000,cash:1160000,interestBearingDebt:0,shares:902000 },
];

export const YAHOO_CODES: Record<string, string> = {
  "7203":"7203.T","6758":"6758.T","6861":"6861.T","8306":"8306.T","9984":"9984.T",
  "4568":"4568.T","9432":"9432.T","7974":"7974.T","4519":"4519.T","8035":"8035.T",
  "6367":"6367.T","2914":"2914.T","8316":"8316.T","6098":"6098.T","4063":"4063.T",
};

export const PRIME_STOCKS_LIST = PRIME_STOCKS.map(s => ({
  code: s.code,
  name: s.name,
  sector: s.sector,
  yahoo: YAHOO_CODES[s.code] ?? `${s.code}.T`,
}));

const safe = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// ── はっしゃん式 補助関数 ──────────────────────────────────────────
export function calcAssetDiscountRate(equityRatio: number): number {
  if (equityRatio >= 0.80) return 0.80;
  if (equityRatio >= 0.67) return 0.75;
  if (equityRatio >= 0.50) return 0.70;
  if (equityRatio >= 0.33) return 0.65;
  if (equityRatio >= 0.10) return 0.60;
  return 0.50;
}

export function calcMarketRiskRate(pbr: number): number {
  if (pbr >= 0.50) return 0.000;
  if (pbr >= 0.41) return 0.200;
  if (pbr >= 0.34) return 0.333;
  if (pbr >= 0.25) return 0.500;
  if (pbr >= 0.21) return 0.667;
  if (pbr >= 0.04) return 0.750 + (0.50 - pbr) / 0.50 * 0.20;
  return 0.975;
}

// ── 理論株価計算（はっしゃん式 + 日経マネー式RIM）───────────────────
//
// page.tsxの呼び出し:
//   calcValuation(s, forecastYears, terminalG, false, payoutRatio, ibdK)
//
export function calcValuation(
  stock: StockData,
  forecastYears: number,
  terminalGrowthRate: number,
  _unused: boolean = false,
  _payoutRatio: number = 0.3,
  _ibdK: number = 0
): ValuationResult {
  const taxRate = safe(stock.taxRate) || 0.30;
  const sharesK = safe(stock.shares); // 千株

  // 百万円 → 円/株
  const toPS = (millionYen: number): number =>
    sharesK > 0 ? (safe(millionYen) / sharesK) * 1000 : 0;

  // ── 共通指標 ──────────────────────────────────────────────────────
  const pbr = safe(stock.bps) > 0 ? safe(stock.price) / safe(stock.bps) : 0;
  const equityRatio = safe(stock.totalAssets) > 0
    ? safe(stock.equity) / safe(stock.totalAssets) : 0;

  // ── r（要求利回り）の動的計算 ────────────────────────────────────
  // 誌面脚注（p.59）: 株主要求利回り8% × 自己資本比率
  //                  + 負債金利3%×(1-実効税率) × (1-自己資本比率)
  // ユーザーが個別にrequiredReturnを設定（デフォルト5%以外）している場合はそれを優先
  const dynamicR = equityRatio > 0
    ? 0.08 * equityRatio + 0.03 * (1 - taxRate) * (1 - equityRatio)
    : 0.05;
  const userSetR = safe(stock.requiredReturn);
  const r = (userSetR > 0 && Math.abs(userSetR - 0.05) > 0.0001)
    ? userSetR
    : Math.max(0.03, Math.min(0.10, dynamicR)); // 3%〜10%にクリップ

  // ── はっしゃん式 ──────────────────────────────────────────────────
  const nikkeiEps = safe(stock.nikkeiEps) > 0 ? safe(stock.nikkeiEps) : safe(stock.eps);
  const bpsPerEqRatio = equityRatio > 0 ? safe(stock.bps) / equityRatio : 0;
  const roa = bpsPerEqRatio > 0 ? nikkeiEps / bpsPerEqRatio : 0;
  const roaCapped = Math.min(roa, 0.30);
  let leverage: number;
  if (equityRatio >= 0.667)      leverage = 1.0;
  else if (equityRatio >= 0.334) leverage = 1 / (equityRatio + 0.333);
  else                           leverage = 1.5;
  const nikkeiBusinessValue = nikkeiEps * 15 * roaCapped * 10 * leverage;
  const assetAdjRatio = calcAssetDiscountRate(equityRatio);
  const nikkeiAssetValue = safe(stock.bps) * assetAdjRatio;
  const riskRate = calcMarketRiskRate(pbr);
  const nikkeiMarketRisk = (nikkeiBusinessValue + nikkeiAssetValue) * riskRate;
  const nikkeiTheoretical = Math.max(0, nikkeiBusinessValue + nikkeiAssetValue - nikkeiMarketRisk);
  const nikkeiUpdownPct = safe(stock.price) > 0
    ? ((nikkeiTheoretical / safe(stock.price) - 1) * 100).toFixed(1) : "0.0";

  // ── 日経マネー式RIM ───────────────────────────────────────────────
  const totalLiabilities = safe(stock.totalAssets) - safe(stock.equity);

  const ibd = safe(stock.interestBearingDebt) > 0
    ? safe(stock.interestBearingDebt)
    : totalLiabilities * 0.4;

  const opAssets = safe(stock.operatingAssets) > 0
    ? safe(stock.operatingAssets)
    : safe(stock.totalAssets) - safe(stock.cash);
  const opLiabilities = safe(stock.operatingLiabilities) > 0
    ? safe(stock.operatingLiabilities)
    : totalLiabilities - ibd;

  const netOperatingAssets   = opAssets - opLiabilities;
  const netOperatingAssetsPS = toPS(netOperatingAssets);

  const netFinancialAssets   = safe(stock.cash) - ibd;
  const netFinancialAssetsPS = toPS(netFinancialAssets);

  const opProfit = safe(stock.operatingProfit) > 0
    ? safe(stock.operatingProfit)
    : safe(stock.eps) * sharesK / 1_000;

  const nopat0 = opProfit * (1 - taxRate);
  const rei0   = nopat0 - netOperatingAssets * r;
  const g      = Math.min(Math.max(safe(stock.salesGrowthRate) || 0, 0), 0.20);

  let pvSum = 0;
  const reiByYear: { year: number; roe: number; rei: number; pv: number }[] = [];

  for (let i = 0; i < forecastYears; i++) {
    const rei_i  = rei0 * Math.pow(1 + g, i);
    const rei_ps = toPS(rei_i);
    const pv     = rei_ps / Math.pow(1 + r, i + 1);
    pvSum += pv;
    reiByYear.push({ year: i + 1, roe: safe(stock.roe), rei: Math.round(rei_ps), pv: Math.round(pv) });
  }

  // ── 終端価値: 予測期間後、5年かけて成長率が0まで緩やかに減衰 ────────
  // 誌面（p.59）: 「利益成長は最大5期先まで。その後はゆるやかに減少」
  let terminalPV = 0;
  if (terminalGrowthRate > 0 && r > 0) {
    const decayYears = 5;
    const baseValue = rei0 * Math.pow(1 + g, forecastYears); // 予測期間末の残余事業利益（百万円）
    let cumulativeGrowth = 1;
    for (let j = 0; j < decayYears; j++) {
      // j年目の成長率: terminalGrowthRateから線形に0まで減衰
      const decayG = terminalGrowthRate * (1 - (j + 1) / decayYears);
      cumulativeGrowth *= (1 + decayG);
      const rei_j = baseValue * cumulativeGrowth;
      const rei_j_ps = toPS(rei_j);
      const pv_j = rei_j_ps / Math.pow(1 + r, forecastYears + j + 1);
      terminalPV += pv_j;
    }
    // 予測期間PV合計の2倍を上限とする（暴発防止）
    terminalPV = Math.max(0, Math.min(terminalPV, Math.abs(pvSum) * 2));
  }
  pvSum += terminalPV;

  const theoretical = netOperatingAssetsPS + netFinancialAssetsPS + pvSum;
  const updownPct = safe(stock.price) > 0
    ? ((theoretical / safe(stock.price) - 1) * 100).toFixed(1) : "0.0";

  return {
    ...stock,
    netOperatingAssetsPS: Math.round(netOperatingAssetsPS),
    netFinancialAssetsPS: Math.round(netFinancialAssetsPS),
    pvREI:       Math.round(pvSum),
    terminalPV:  Math.round(terminalPV),
    theoretical: Math.round(theoretical),
    updownPct,
    reiByYear,
    nikkeiTheoretical: Math.round(nikkeiTheoretical),
    nikkeiUpdownPct,
    nikkeiBusinessValue: Math.round(nikkeiBusinessValue),
    nikkeiAssetValue:    Math.round(nikkeiAssetValue),
    nikkeiMarketRisk:    Math.round(nikkeiMarketRisk),
    pbr,
    roa,
    assetAdjRatio,
    nikkeiEps,
    effectiveR: r,
  };
}
