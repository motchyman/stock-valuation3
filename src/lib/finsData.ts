// src/lib/finsData.ts
// 主要15銘柄の財務データ（2024年度本決算ベース）
// 更新頻度: 年1〜2回（決算発表後）
// 単位: bps/eps=円/株, operatingAssets等=百万円, shares=千株

export interface FinsRecord {
  bps:                  number; // 1株あたり純資産（円）
  eps:                  number; // 1株あたり当期純利益（円）
  operatingAssets:      number; // 営業資産（百万円）
  operatingLiabilities: number; // 営業負債（百万円）
  cash:                 number; // 現金等（百万円）
  interestBearingDebt:  number; // 有利子負債（百万円）
  shares:               number; // 発行済株式数（千株）
  priceDefault:         number; // APIが失敗した時のフォールバック株価
  updatedAt:            string; // データ更新日
}

export const FINS_DATA: Record<string, FinsRecord> = {
  // ── トヨタ自動車 (7203) ──────────────────────────────────────────
  "7203": {
    bps: 3820, eps: 581,
    operatingAssets: 55000000, operatingLiabilities: 20000000,
    cash: 9500000, interestBearingDebt: 7200000,
    shares: 14200000, priceDefault: 3450,
    updatedAt: "2025-05",
  },
  // ── ソニーグループ (6758) ────────────────────────────────────────
  "6758": {
    bps: 2980, eps: 512,
    operatingAssets: 16500000, operatingLiabilities: 7100000,
    cash: 4200000, interestBearingDebt: 3100000,
    shares: 1200000, priceDefault: 2890,
    updatedAt: "2025-05",
  },
  // ── キーエンス (6861) ────────────────────────────────────────────
  "6861": {
    bps: 58200, eps: 10200,
    operatingAssets: 9100000, operatingLiabilities: 2000000,
    cash: 5100000, interestBearingDebt: 0,
    shares: 242000, priceDefault: 67800,
    updatedAt: "2025-05",
  },
  // ── 三菱UFJフィナンシャル (8306) ────────────────────────────────
  "8306": {
    bps: 1580, eps: 168,
    operatingAssets: 340000000, operatingLiabilities: 298000000,
    cash: 48000000, interestBearingDebt: 72000000,
    shares: 12800000, priceDefault: 1680,
    updatedAt: "2025-05",
  },
  // ── ソフトバンクG (9984) ─────────────────────────────────────────
  "9984": {
    bps: 8200, eps: 780,
    operatingAssets: 30000000, operatingLiabilities: 11000000,
    cash: 13000000, interestBearingDebt: 19000000,
    shares: 1700000, priceDefault: 9120,
    updatedAt: "2025-05",
  },
  // ── 第一三共 (4568) ──────────────────────────────────────────────
  "4568": {
    bps: 3200, eps: 420,
    operatingAssets: 10500000, operatingLiabilities: 3500000,
    cash: 2300000, interestBearingDebt: 1900000,
    shares: 1458000, priceDefault: 4520,
    updatedAt: "2025-05",
  },
  // ── 日本電信電話 (9432) ──────────────────────────────────────────
  "9432": {
    bps: 185, eps: 21,
    operatingAssets: 19500000, operatingLiabilities: 8200000,
    cash: 3100000, interestBearingDebt: 8800000,
    shares: 43000000, priceDefault: 182,
    updatedAt: "2025-05",
  },
  // ── 任天堂 (7974) ────────────────────────────────────────────────
  "7974": {
    bps: 7800, eps: 920,
    operatingAssets: 2300000, operatingLiabilities: 520000,
    cash: 2600000, interestBearingDebt: 0,
    shares: 115000, priceDefault: 8900,
    updatedAt: "2025-05",
  },
  // ── 中外製薬 (4519) ──────────────────────────────────────────────
  "4519": {
    bps: 1850, eps: 280,
    operatingAssets: 1800000, operatingLiabilities: 480000,
    cash: 620000, interestBearingDebt: 0,
    shares: 1480000, priceDefault: 4200,
    updatedAt: "2025-05",
  },
  // ── 東京エレクトロン (8035) ──────────────────────────────────────
  "8035": {
    bps: 4200, eps: 820,
    operatingAssets: 2100000, operatingLiabilities: 680000,
    cash: 580000, interestBearingDebt: 0,
    shares: 473000, priceDefault: 24000,
    updatedAt: "2025-05",
  },
  // ── ダイキン工業 (6367) ──────────────────────────────────────────
  "6367": {
    bps: 6800, eps: 820,
    operatingAssets: 3800000, operatingLiabilities: 1600000,
    cash: 480000, interestBearingDebt: 820000,
    shares: 290000, priceDefault: 19000,
    updatedAt: "2025-05",
  },
  // ── JT (2914) ────────────────────────────────────────────────────
  "2914": {
    bps: 2950, eps: 310,
    operatingAssets: 4200000, operatingLiabilities: 1800000,
    cash: 520000, interestBearingDebt: 980000,
    shares: 2000000, priceDefault: 4100,
    updatedAt: "2025-05",
  },
  // ── 三井住友FG (8316) ────────────────────────────────────────────
  "8316": {
    bps: 5800, eps: 620,
    operatingAssets: 280000000, operatingLiabilities: 248000000,
    cash: 38000000, interestBearingDebt: 52000000,
    shares: 1380000, priceDefault: 9200,
    updatedAt: "2025-05",
  },
  // ── リクルートHD (6098) ──────────────────────────────────────────
  "6098": {
    bps: 1250, eps: 180,
    operatingAssets: 2800000, operatingLiabilities: 1100000,
    cash: 820000, interestBearingDebt: 280000,
    shares: 1520000, priceDefault: 9800,
    updatedAt: "2025-05",
  },
  // ── 信越化学工業 (4063) ──────────────────────────────────────────
  "4063": {
    bps: 8200, eps: 1050,
    operatingAssets: 3200000, operatingLiabilities: 820000,
    cash: 1200000, interestBearingDebt: 0,
    shares: 630000, priceDefault: 5800,
    updatedAt: "2025-05",
  },
};
