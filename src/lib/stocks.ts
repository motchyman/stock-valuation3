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
  cash: number;             // 現金及び現金同等物（＋有価証券）
  interestBearingDebt: number;  // 有利子負債
  // 株式
  shares: number;           // 発行済株式数（自己株除く、千株）
  requiredReturn: number;
  lastUpdated?: string;
  error?: string;
}

export interface ValuationResult extends StockData {
  // 計算結果（円/株）
  netOperatingAssetsPS: number;   // 正味営業資産
  netFinancialAssetsPS: number;   // 正味金融資産
  pvREI: number;                  // 残余事業利益PV合計
  terminalPV: number;             // うち終端価値PV
  theoretical: number;            // 理論株価
  updownPct: string;              // 乖離率
  reiByYear: { year: number; roe: number; rei: number; pv: number }[];
}

// ── 東証プライム主要銘柄 ─────────────────────────────────────────────
// 財務データ: 各社最新決算短信・有価証券報告書より
// 単位: 百万円（totalAssets, equity, cash, interestBearingDebt）
//       千株（shares）
//       円/株（bps, eps）
export const PRIME_STOCKS: Omit<StockData, "price"|"previousClose"|"roe"|"forecastROE"|"requiredReturn">[] = [
  {
    code: "7203", name: "トヨタ自動車", sector: "輸送用機器",
    // 2024年3月期（連結）
    bps: 4_185, eps: 878,
    totalAssets:          97_940_000,
    equity:               31_330_000,
    cash:                 10_490_000,   // 現金及び現金同等物
    interestBearingDebt:  28_650_000,   // 有利子負債
    shares:               13_450_000,   // 千株（自己株除く）
  },
  {
    code: "6758", name: "ソニーグループ", sector: "電気機器",
    // 2024年3月期（連結）
    bps: 3_842, eps: 671,
    totalAssets:          31_590_000,
    equity:                4_640_000,
    cash:                  3_820_000,
    interestBearingDebt:   3_110_000,
    shares:                1_200_000,
  },
  {
    code: "6861", name: "キーエンス", sector: "電気機器",
    // 2024年3月期（連結）
    bps: 55_230, eps: 10_210,
    totalAssets:          5_580_000,
    equity:               5_180_000,
    cash:                 3_890_000,
    interestBearingDebt:          0,
    shares:                 242_000,
  },
  {
    code: "8306", name: "三菱UFJフィナンシャル", sector: "銀行業",
    // 2024年3月期（連結）
    bps: 1_523, eps: 196,
    totalAssets:         437_290_000,
    equity:               18_450_000,
    cash:                 68_320_000,
    interestBearingDebt:  89_100_000,
    shares:               12_130_000,
  },
  {
    code: "9984", name: "ソフトバンクG", sector: "情報・通信",
    // 2024年3月期（連結）
    bps: 3_621, eps: 48,
    totalAssets:          47_060_000,
    equity:                6_210_000,
    cash:                  4_920_000,
    interestBearingDebt:  17_830_000,
    shares:                1_700_000,
  },
  {
    code: "4568", name: "第一三共", sector: "医薬品",
    // 2024年3月期（連結）
    bps: 1_628, eps: 76,
    totalAssets:          3_320_000,
    equity:               2_380_000,
    cash:                   512_000,
    interestBearingDebt:    240_000,
    shares:                1_458_000,
  },
  {
    code: "9432", name: "日本電信電話", sector: "情報・通信",
    // 2024年3月期（連結）
    bps: 619, eps: 19,
    totalAssets:          29_870_000,
    equity:               8_130_000,
    cash:                   890_000,
    interestBearingDebt:   9_240_000,
    shares:               43_800_000,
  },
  {
    code: "7974", name: "任天堂", sector: "その他製品",
    // 2025年3月期（連結）決算短信 2025/5/8
    bps: 2_340, eps: 239,
    totalAssets:          3_398_515,
    equity:               2_724_327,
    cash:                 1_414_121,   // 現金及び現金同等物（CF末残）
    interestBearingDebt:          0,   // 有利子負債なし
    shares:               1_164_248,   // 千株（自己株除く）
  },
  {
    code: "4519", name: "中外製薬", sector: "医薬品",
    // 2024年12月期（連結）
    bps: 1_842, eps: 356,
    totalAssets:          1_820_000,
    equity:               1_490_000,
    cash:                   620_000,
    interestBearingDebt:          0,
    shares:                 560_000,
  },
  {
    code: "8035", name: "東京エレクトロン", sector: "電気機器",
    // 2024年3月期（連結）
    bps: 4_921, eps: 882,
    totalAssets:          2_280_000,
    equity:               2_000_000,
    cash:                   490_000,
    interestBearingDebt:          0,
    shares:                 391_000,
  },
  {
    code: "6367", name: "ダイキン工業", sector: "機械",
    // 2024年3月期（連結）
    bps: 5_840, eps: 635,
    totalAssets:          5_510_000,
    equity:               3_060_000,
    cash:                   410_000,
    interestBearingDebt:    790_000,
    shares:                 522_000,
  },
  {
    code: "2914", name: "JT", sector: "食料品",
    // 2023年12月期（連結）
    bps: 2_890, eps: 365,
    totalAssets:          6_980_000,
    equity:               3_620_000,
    cash:                   650_000,
    interestBearingDebt:    790_000,
    shares:                1_250_000,
  },
  {
    code: "8316", name: "三井住友FG", sector: "銀行業",
    // 2024年3月期（連結）
    bps: 8_420, eps: 1_164,
    totalAssets:         307_240_000,
    equity:               13_250_000,
    cash:                 38_470_000,
    interestBearingDebt:  62_300_000,
    shares:                1_565_000,
  },
  {
    code: "6098", name: "リクルートHD", sector: "サービス業",
    // 2024年3月期（連結）
    bps: 1_218, eps: 195,
    totalAssets:          3_610_000,
    equity:               2_230_000,
    cash:                   890_000,
    interestBearingDebt:    130_000,
    shares:                1_830_000,
  },
  {
    code: "4063", name: "信越化学工業", sector: "化学",
    // 2024年3月期（連結）
    bps: 6_382, eps: 853,
    totalAssets:          6_150_000,
    equity:               5_760_000,
    cash:                 1_160_000,
    interestBearingDebt:          0,
    shares:                 902_000,
  },
];

// Yahoo Finance コード対応表
export const YAHOO_CODES: Record<string, string> = {
  "7203": "7203.T", "6758": "6758.T", "6861": "6861.T",
  "8306": "8306.T", "9984": "9984.T", "4568": "4568.T",
  "9432": "9432.T", "7974": "7974.T", "4519": "4519.T",
  "8035": "8035.T", "6367": "6367.T", "2914": "2914.T",
  "8316": "8316.T", "6098": "6098.T", "4063": "4063.T",
};

// J-Quants用コード一覧（株価取得用）
export const PRIME_STOCKS_LIST = PRIME_STOCKS.map(s => ({
  code: s.code,
  name: s.name,
  sector: s.sector,
  yahoo: YAHOO_CODES[s.code] ?? `${s.code}.T`,
}));

// ── NaN安全処理 ──────────────────────────────────────────────────────
const safe = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// ── 理論株価計算 ──────────────────────────────────────────────────────
// 計算式:
//   理論株価 = ①正味営業資産/株 + ②正味金融資産/株 + ③残余事業利益PV
//
//   ①正味営業資産/株 = (営業資産 - 営業負債) / 発行済株式数
//     営業資産     = 総資産 - 現金及び現金同等物
//     営業負債     = 総負債 - 有利子負債
//
//   ②正味金融資産/株 = (現金及び現金同等物 - 有利子負債) / 発行済株式数
//
//   ③残余事業利益 = (ROE - 要求利回り) × BPS
//     PV = Σ REI_t / (1+r)^t + 終端価値PV
//     終端価値PV = REI_T+1 / (r - g) / (1+r)^T
export function calcValuation(
  stock: StockData,
  forecastYears: number,
  terminalGrowthRate: number
): ValuationResult {
  const r = safe(stock.requiredReturn) || 0.05;

  // 百万円/千株 × 1000 = 円/株
  const perShare = (millionYen: number): number =>
    safe(stock.shares) > 0
      ? (safe(millionYen) / safe(stock.shares)) * 1000
      : 0;

  // ① 正味営業資産
  const totalLiabilities       = safe(stock.totalAssets) - safe(stock.equity);
  const operatingAssets        = safe(stock.totalAssets) - safe(stock.cash);
  const operatingLiabilities   = totalLiabilities - safe(stock.interestBearingDebt);
  const netOperatingAssetsPS   = perShare(operatingAssets - operatingLiabilities);

  // ② 正味金融資産
  const netFinancialAssetsPS   = perShare(safe(stock.cash) - safe(stock.interestBearingDebt));

  // ③ 残余事業利益PV
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
  const lastROE    = safe(forecastROE[Math.min(forecastYears - 1, forecastROE.length - 1)]);
  const terminalREI = (lastROE - r) * bps;
  const terminalPV  = r > terminalGrowthRate
    ? (terminalREI / (r - terminalGrowthRate)) / Math.pow(1 + r, forecastYears)
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
