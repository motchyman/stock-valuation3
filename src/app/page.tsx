// src/app/page.tsx - サーバーサイド検索対応版
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { StockData, ValuationResult, calcValuation } from "@/lib/stocks";

const FALLBACK: StockData[] = [
  { code:"7203",name:"トヨタ自動車",sector:"輸送用機器",price:3450,previousClose:3420,bps:4185,eps:878,roe:0.210,forecastROE:[0.210,0.180,0.150,0.120,0.100],totalAssets:97940000,equity:31330000,cash:10490000,interestBearingDebt:28650000,shares:13450000,requiredReturn:0.05},
  { code:"6758",name:"ソニーグループ",sector:"電気機器",price:2890,previousClose:2850,bps:3842,eps:671,roe:0.175,forecastROE:[0.175,0.160,0.145,0.130,0.110],totalAssets:31590000,equity:4640000,cash:3820000,interestBearingDebt:3110000,shares:1200000,requiredReturn:0.05},
  { code:"6861",name:"キーエンス",sector:"電気機器",price:67800,previousClose:67200,bps:55230,eps:10210,roe:0.185,forecastROE:[0.185,0.182,0.178,0.160,0.130],totalAssets:5580000,equity:5180000,cash:3890000,interestBearingDebt:0,shares:242000,requiredReturn:0.05},
  { code:"7974",name:"任天堂",sector:"その他製品",price:9344,previousClose:9200,bps:2340,eps:239,roe:0.102,forecastROE:[0.102,0.095,0.090,0.085,0.080],totalAssets:3398515,equity:2724327,cash:1414121,interestBearingDebt:0,shares:1164248,requiredReturn:0.05},
  { code:"8306",name:"三菱UFJフィナンシャル",sector:"銀行業",price:1680,previousClose:1660,bps:1523,eps:196,roe:0.129,forecastROE:[0.129,0.120,0.110,0.100,0.090],totalAssets:437290000,equity:18450000,cash:68320000,interestBearingDebt:89100000,shares:12130000,requiredReturn:0.05},
];

const fmt = (n: number) => Math.round(n).toLocaleString("ja-JP");
const pctColor = (pct: string) => parseFloat(pct) >= 0 ? "#22d3a0" : "#f87171";
const ratingInfo = (pct: string) => {
  const v = parseFloat(pct);
  if (v >= 30)  return { label: "強い割安", color: "#22d3a0", bg: "#052e1a" };
  if (v >= 10)  return { label: "割安",     color: "#86efac", bg: "#052e16" };
  if (v >= 0)   return { label: "やや割安", color: "#bef264", bg: "#1a2e05" };
  if (v >= -15) return { label: "適正",     color: "#fbbf24", bg: "#2d1f05" };
  return               { label: "割高",     color: "#f87171", bg: "#2d0808" };
};

const C = {
  bg: "#08111f", surface: "#0d1b30", border: "#162133",
  accent: "#3b82f6", muted: "#4a6080", text: "#cbd5e1", bright: "#e2f0ff",
};

function DetailPanel({ s, forecastYears, terminalG, isMobile, onClose }: {
  s: ValuationResult; forecastYears: number; terminalG: number;
  isMobile: boolean; onClose: () => void;
}) {
  const maxP = Math.max(s.price, s.theoretical) * 1.1;
  const pW   = (s.price / maxP) * 100;
  const tW   = (s.theoretical / maxP) * 100;
  const total = Math.abs(s.netOperatingAssetsPS) + Math.abs(s.netFinancialAssetsPS) + Math.abs(s.pvREI);

  return (
    <div style={isMobile
      ? { position:"fixed", inset:0, zIndex:100, background:C.bg, overflowY:"auto", padding:"0 0 80px" }
      : { width:320, flexShrink:0, borderLeft:`1px solid ${C.border}`, background:C.surface, overflowY:"auto", maxHeight:"calc(100vh - 72px)", position:"sticky", top:72 }
    }>
      <div style={{ position:"sticky", top:0, zIndex:10, background:isMobile?C.bg:C.surface, borderBottom:`1px solid ${C.border}`, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:10, color:C.accent, letterSpacing:3, marginBottom:2 }}>詳細分析</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.bright }}>{s.name}</div>
          <div style={{ fontSize:11, color:C.muted }}>{s.code} · {s.sector}</div>
        </div>
        <button onClick={onClose} style={{ background:C.border, border:"none", color:C.text, cursor:"pointer", borderRadius:8, width:32, height:32 }}>✕</button>
      </div>
      <div style={{ padding:"18px 18px 0" }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.muted, marginBottom:6 }}>
            <span>現在株価</span><span style={{ color:"#93c5fd" }}>理論株価</span>
          </div>
          <div style={{ position:"relative", height:10, background:C.border, borderRadius:5 }}>
            <div style={{ position:"absolute", left:0, width:`${pW}%`, height:"100%", background:"#1e3a6e", borderRadius:5 }} />
            <div style={{ position:"absolute", left:`${Math.min(tW,97)}%`, top:-2, width:4, height:14, background:s.theoretical>s.price?"#22d3a0":"#f87171", borderRadius:2 }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontWeight:700, fontSize:15 }}>
            <span>¥{fmt(s.price)}</span>
            <span style={{ color:"#93c5fd" }}>¥{fmt(s.theoretical)}</span>
          </div>
          <div style={{ textAlign:"center", marginTop:6 }}>
            <span style={{ color:pctColor(s.updownPct), fontWeight:800, fontSize:22 }}>
              {parseFloat(s.updownPct)>=0?"+":""}{s.updownPct}%
            </span>
          </div>
        </div>
        <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:10 }}>理論株価の構成（円/株）</div>
        {[
          { label:"BPS（簿価）", val:s.bps, color:"#818cf8" },
          { label:"残余事業利益PV", val:s.pvREI, color:"#fbbf24" },
        ].map(item => (
          <div key={item.label} style={{ marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:13 }}>
              <span style={{ color:C.muted }}>{item.label}</span>
              <span style={{ color:item.color, fontWeight:700 }}>{item.val>=0?"+":""}{fmt(item.val)}</span>
            </div>
            <div style={{ height:5, background:C.border, borderRadius:3 }}>
              <div style={{ height:"100%", width:`${(Math.abs(item.val)/(Math.abs(s.bps)+Math.abs(s.pvREI)))*100}%`, background:item.color, borderRadius:3, opacity:0.75 }} />
            </div>
          </div>
        ))}
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:4, marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:800 }}>
            <span style={{ color:C.muted }}>理論株価</span>
            <span style={{ color:"#93c5fd" }}>¥{fmt(s.theoretical)}</span>
          </div>
          <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>終端価値PV: ¥{fmt(s.terminalPV)}（残余事業利益PVのうち）</div>
        </div>
        <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:8 }}>残余事業利益の年次明細</div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              {["期","ROE","残余事業利益","PV"].map(h => (
                <th key={h} style={{ padding:"4px 4px", textAlign:"right", color:C.muted, fontWeight:600, fontSize:10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.reiByYear.map(row => (
              <tr key={row.year} style={{ borderBottom:`1px solid ${C.border}22` }}>
                <td style={{ padding:"4px 4px", textAlign:"right", color:C.muted }}>{row.year}</td>
                <td style={{ padding:"4px 4px", textAlign:"right", color:C.muted }}>{(row.roe*100).toFixed(1)}%</td>
                <td style={{ padding:"4px 4px", textAlign:"right", color:row.rei>=0?"#86efac":"#f87171" }}>{row.rei>=0?"+":""}{fmt(row.rei)}</td>
                <td style={{ padding:"4px 4px", textAlign:"right", color:C.text }}>{fmt(row.pv)}</td>
              </tr>
            ))}
            <tr style={{ borderTop:`1px solid ${C.border}` }}>
              <td colSpan={2} style={{ padding:"4px 4px", textAlign:"right", color:C.muted, fontSize:10 }}>終端価値</td>
              <td colSpan={2} style={{ padding:"4px 4px", textAlign:"right", color:"#fbbf24" }}>+{fmt(s.terminalPV)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ margin:"18px 0", padding:12, background:C.bg, borderRadius:6, fontSize:11, color:C.muted, lineHeight:2 }}>
          <div style={{ color:C.accent, marginBottom:4, fontSize:10 }}>計算前提</div>
          要求利回り: <strong style={{ color:C.text }}>{(s.requiredReturn*100).toFixed(1)}%</strong>　
          終端成長率: <strong style={{ color:C.text }}>2.0%</strong><br/>
          予測期間: <strong style={{ color:C.text }}>{forecastYears}年</strong>　
          データ基準日: <strong style={{ color:C.text }}>{s.priceDate ?? "—"}</strong>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [stocks, setStocks]             = useState<StockData[]>(FALLBACK);
  const [allSectors, setAllSectors]     = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>("すべて");
  const [searchText, setSearchText]     = useState("");
  const [loading, setLoading]           = useState(false);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [fetchedAt, setFetchedAt]       = useState<string | null>(null);
  const [forecastYears, setForecastYears] = useState(5);
  const [terminalG, setTerminalG]       = useState(0.02);
  const [selected, setSelected]         = useState<string | null>(null);
  const [sortKey, setSortKey]           = useState("updown");
  const [sortAsc, setSortAsc]           = useState(false);
  const [editRR, setEditRR]             = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile]         = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [totalCount, setTotalCount]     = useState(0);
  const [displayLimit, setDisplayLimit] = useState(50);
  const [apiError, setApiError]         = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    fetch("/api/master")
      .then(r => r.json())
      .then(data => {
        const sectorSet = new Set<string>((data.stocks ?? []).map((s: { sector: string }) => s.sector));
        setAllSectors(Array.from(sectorSet).sort());
        setTotalCount(data.total ?? 0);
      })
      .catch(() => {});
  }, []);

  const fetchYahooPrices = useCallback(async (currentStocks: StockData[]) => {
    setLoadingPrices(true);
    try {
      const CHUNK = 100;
      let updated = [...currentStocks];
      for (let i = 0; i < currentStocks.length; i += CHUNK) {
        const chunk = currentStocks.slice(i, i + CHUNK);
        const codes = chunk.map(s => s.code).join(",");
        const res = await fetch(`/api/prices?codes=${codes}`);
        if (!res.ok) continue;
        const data = await res.json();
        const prices: Record<string, { price: number; previousClose: number } | null> = data.prices ?? {};
        updated = updated.map(s => {
          const p = prices[s.code];
          if (!p || !p.price) return s;
          return { ...s, price: p.price, previousClose: p.previousClose };
        });
        if (i + CHUNK < currentStocks.length) await new Promise(r => setTimeout(r, 500));
      }
      setStocks(updated);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      console.error("Yahoo price fetch error:", e);
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  const fetchData = useCallback(async (sector: string, limit: number, search = "") => {
    setLoading(true);
    setApiError(false);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (sector !== "すべて") params.set("sector", sector);
      if (search) params.set("search", search);
      const res  = await fetch(`/api/financials?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const merged: StockData[] = (data.stocks ?? [])
        .filter((s: StockData & { error?: string }) => !s.error)
        .map((s: StockData) => ({ ...s, requiredReturn: s.requiredReturn ?? 0.05 }));
      if
