// StockDataインターフェースに追加
operatingProfit?: number;         // 今期営業利益（百万円）
forecastOperatingProfit?: number; // 来期予想営業利益（百万円）
operatingAssets?: number;         // 営業資産（百万円）= 総資産-現金
operatingLiabilities?: number;    // 営業負債（百万円）= 総負債-有利子負債
salesGrowthRate?: number;         // 売上高成長率
taxRate?: number;                 // 実効税率（デフォルト0.30）

// calcValuation() 全面置き換え
export function calcValuation(
  stock: StockData,
  forecastYears: number,
  terminalGrowthRate: number
): ValuationResult {
  const r = safe(stock.requiredReturn) || 0.05;
  const taxRate = safe(stock.taxRate) || 0.30;

  // 百万円→円/株の変換係数
  // shares = 千株 → × 1000 = 株 → ÷ は不要（百万円/千株×1000 = 円/株）
  const sharesK = safe(stock.shares); // 千株
  const toPS = (millionYen: number): number =>
    sharesK > 0 ? (millionYen / sharesK) * 1000 : 0;

  // ── ① 正味営業資産（百万円→円/株）──
  const totalLiabilities = safe(stock.totalAssets) - safe(stock.equity);
  const operatingAssets = stock.operatingAssets !== undefined
    ? safe(stock.operatingAssets)
    : safe(stock.totalAssets) - safe(stock.cash);
  const operatingLiabilities = stock.operatingLiabilities !== undefined
    ? safe(stock.operatingLiabilities)
    : totalLiabilities - safe(stock.interestBearingDebt);
  const netOperatingAssets = operatingAssets - operatingLiabilities; // 百万円
  const netOperatingAssetsPS = toPS(netOperatingAssets);

  // ── ② 正味金融資産（百万円→円/株）──
  const netFinancialAssets = safe(stock.cash) - safe(stock.interestBearingDebt); // 百万円
  const netFinancialAssetsPS = toPS(netFinancialAssets);

  // ── ③ 残余事業利益PV（日経マネー式）──
  // 残余事業利益 = 営業利益×(1-税率) - 正味営業資産 × 要求利回り
  // operatingProfit が取れない場合は eps×sharesK/1000 で代替
  const opProfit = safe(stock.operatingProfit) > 0
    ? safe(stock.operatingProfit)
    : safe(stock.eps) * sharesK / 1_000; // EPS×株数(百万株) = 百万円

  // 今期残余事業利益（百万円）
  const nopat0 = opProfit * (1 - taxRate);
  const rei0 = nopat0 - netOperatingAssets * r;

  // 成長率（売上高成長率、上限20%、デフォルト0）
  const g = Math.min(Math.max(safe(stock.salesGrowthRate) || 0, 0), 0.20);

  let pvSum = 0;
  const reiByYear: { year: number; roe: number; rei: number; pv: number }[] = [];

  for (let i = 0; i < forecastYears; i++) {
    const rei_i = rei0 * Math.pow(1 + g, i); // 百万円
    const rei_ps = toPS(rei_i); // 円/株
    const pv = rei_ps / Math.pow(1 + r, i + 1);
    pvSum += pv;
    // roeは参考値として残す（表示用）
    const bps_i = safe(stock.bps) * Math.pow(1 + (safe(stock.roe) || 0.08) * 0.6, i);
    reiByYear.push({
      year: i + 1,
      roe: safe(stock.roe) || 0,
      rei: Math.round(rei_ps),
      pv: Math.round(pv),
    });
  }

  // 終端価値（Gordon Growth Model）
  const lastREI_ps = toPS(rei0 * Math.pow(1 + g, forecastYears));
  const terminalPV = r > terminalGrowthRate
    ? (lastREI_ps / (r - terminalGrowthRate)) / Math.pow(1 + r, forecastYears)
    : 0;
  pvSum += terminalPV;

  const theoretical = netOperatingAssetsPS + netFinancialAssetsPS + pvSum;
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
