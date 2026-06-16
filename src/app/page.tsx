// src/app/page.tsx - 日経マネー計算値 + 誌面参考値 並列表示版
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

interface NikkeiRef {
  theoretical: number;
  price: number;
  divergence: string;
  evaluation: string;
}

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

function DetailPanel({ s, nikkeiRef, forecastYears, terminalG, isMobile, onClose }: {
  s: ValuationResult; nikkeiRef: NikkeiRef | null;
  forecastYears: number; terminalG: number;
  isMobile: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<"rim"|"nikkei_calc"|"nikkei_ref">("nikkei_calc");
  const maxP = Math.max(s.price, s.theoretical, s.nikkeiTheoretical, nikkeiRef?.theoretical ?? 0) * 1.1 || 1;

  return (
    <div style={isMobile
      ? { position:"fixed", inset:0, zIndex:100, background:C.bg, overflowY:"auto", padding:"0 0 80px" }
      : { width:340, flexShrink:0, borderLeft:`1px solid ${C.border}`, background:C.surface, overflowY:"auto", maxHeight:"calc(100vh - 72px)", position:"sticky", top:72 }
    }>
      <div style={{ position:"sticky", top:0, zIndex:10, background:isMobile?C.bg:C.surface, borderBottom:`1px solid ${C.border}`, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:10, color:C.accent, letterSpacing:3, marginBottom:2 }}>詳細分析</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.bright }}>{s.name}</div>
          <div style={{ fontSize:11, color:C.muted }}>{s.code} · {s.sector}</div>
        </div>
        <button onClick={onClose} style={{ background:C.border, border:"none", color:C.text, cursor:"pointer", borderRadius:8, width:32, height:32 }}>✕</button>
      </div>

      {/* タブ */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}` }}>
        {([
          ["nikkei_calc","日経マネー計算"],
          ["nikkei_ref","誌面掲載値"],
          ["rim","RIMモデル"],
        ] as const).map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex:1, padding:"8px 4px", border:"none", cursor:"pointer",
            background:tab===key?"#1e3a6e":"transparent",
            color:tab===key?"#93c5fd":C.muted,
            borderBottom:tab===key?`2px solid ${C.accent}`:"2px solid transparent",
            fontSize:10, fontWeight:700,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding:"16px 18px 0" }}>
        {/* 4本比較バー */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>株価 vs 各理論株価</div>
          {[
            { label:"現在株価",          color:"#60a5fa", val:s.price },
            { label:"日経マネー計算値",  color:"#34d399", val:s.nikkeiTheoretical },
            { label:"誌面掲載値(参考)",  color:"#86efac", val:nikkeiRef?.theoretical ?? 0 },
            { label:"RIM理論株価",       color:"#93c5fd", val:s.theoretical },
          ].map(item => (
            <div key={item.label} style={{ marginBottom:5 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.muted, marginBottom:2 }}>
                <span>{item.label}</span>
                <span style={{ color:item.color }}>{item.val > 0 ? `¥${fmt(item.val)}` : "—"}</span>
              </div>
              <div style={{ height:5, background:C.border, borderRadius:3 }}>
                <div style={{ height:"100%", width:`${Math.min((item.val/maxP)*100,100)}%`, background:item.color, borderRadius:3 }} />
              </div>
            </div>
          ))}
        </div>

        {/* タブ別詳細 */}
        {tab === "nikkei_calc" && (
          <>
            <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:10 }}>日経マネー式 計算値</div>
            <div style={{ textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:28, fontWeight:800, color:"#34d399" }}>¥{fmt(s.nikkeiTheoretical)}</div>
              <div style={{ fontSize:16, color:pctColor(s.nikkeiUpdownPct), fontWeight:700, marginTop:4 }}>
                {parseFloat(s.nikkeiUpdownPct)>=0?"+":""}{s.nikkeiUpdownPct}%
              </div>
            </div>
            {[
              { label:"事業価値 (EPS×15×ROA×10×補正)", val:s.nikkeiBusinessValue, color:"#fbbf24" },
              { label:"資産価値 (BPS×0.7)",              val:s.nikkeiAssetValue,    color:"#818cf8" },
            ].map(item => (
              <div key={item.label} style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:12 }}>
                  <span style={{ color:C.muted, fontSize:10 }}>{item.label}</span>
                  <span style={{ color:item.color, fontWeight:700 }}>{item.val>=0?"+":""}{fmt(item.val)}</span>
                </div>
                <div style={{ height:5, background:C.border, borderRadius:3 }}>
                  <div style={{ height:"100%", width:`${(Math.abs(item.val)/(Math.abs(s.nikkeiBusinessValue)+Math.abs(s.nikkeiAssetValue)||1))*100}%`, background:item.color, borderRadius:3, opacity:0.8 }} />
                </div>
              </div>
            ))}
            <div style={{ padding:10, background:C.bg, borderRadius:6, fontSize:11, color:C.muted, lineHeight:2, marginTop:8 }}>
              <div style={{ color:C.accent, marginBottom:2, fontSize:10 }}>計算詳細</div>
              EPS(経常×0.7/株): <strong style={{ color:C.text }}>¥{s.nikkeiEps ? fmt(s.nikkeiEps) : "—"}</strong><br/>
              ROA: <strong style={{ color:C.text }}>{(s.roa*100).toFixed(1)}%</strong>　
              自己資本比率: <strong style={{ color:C.text }}>{s.totalAssets>0?((s.equity/s.totalAssets)*100).toFixed(1):"—"}%</strong>
            </div>
          </>
        )}

        {tab === "nikkei_ref" && (
          <>
            <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:10 }}>日経マネー誌 掲載値（参考）</div>
            {nikkeiRef?.theoretical ? (
              <>
                <div style={{ textAlign:"center", marginBottom:16 }}>
                  <div style={{ fontSize:28, fontWeight:800, color:"#86efac" }}>¥{fmt(nikkeiRef.theoretical)}</div>
                  <div style={{ fontSize:16, color:nikkeiRef.evaluation==="+"?"#22d3a0":"#f87171", fontWeight:700, marginTop:4 }}>
                    {nikkeiRef.divergence}
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                  {[
                    { label:"掲載時株価", val:`¥${fmt(nikkeiRef.price)}` },
                    { label:"現在株価",   val:s.price>0?`¥${fmt(s.price)}`:"取得中" },
                    { label:"日経計算値", val:`¥${fmt(s.nikkeiTheoretical)}` },
                    { label:"差異",       val:`¥${fmt(Math.abs(s.nikkeiTheoretical - nikkeiRef.theoretical))}` },
                  ].map(item => (
                    <div key={item.label} style={{ background:C.bg, borderRadius:6, padding:"8px 10px" }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{item.label}</div>
                      <div style={{ fontWeight:700, color:C.text }}>{item.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding:10, background:C.bg, borderRadius:6, fontSize:10, color:C.muted }}>
                  ※ 日経マネー2026年7月号別冊付録掲載値。計算式・基準日が当アプリと異なります。
                </div>
              </>
            ) : (
              <div style={{ padding:30, textAlign:"center", color:C.muted }}>この銘柄の掲載データがありません</div>
            )}
          </>
        )}

        {tab === "rim" && (
          <>
            <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:10 }}>RIM理論株価の内訳</div>
            <div style={{ textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:28, fontWeight:800, color:"#93c5fd" }}>¥{fmt(s.theoretical)}</div>
              <div style={{ fontSize:16, color:pctColor(s.updownPct), fontWeight:700, marginTop:4 }}>
                {parseFloat(s.updownPct)>=0?"+":""}{s.updownPct}%
              </div>
            </div>
            {[
              { label:"BPS（簿価純資産）", val:s.bps,   color:"#818cf8" },
              { label:"残余利益PV",        val:s.pvREI, color:"#fbbf24" },
            ].map(item => (
              <div key={item.label} style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:13 }}>
                  <span style={{ color:C.muted }}>{item.label}</span>
                  <span style={{ color:item.color, fontWeight:700 }}>{item.val>=0?"+":""}{fmt(item.val)}</span>
                </div>
                <div style={{ height:5, background:C.border, borderRadius:3 }}>
                  <div style={{ height:"100%", width:`${(Math.abs(item.val)/(Math.abs(s.bps)+Math.abs(s.pvREI)||1))*100}%`, background:item.color, borderRadius:3, opacity:0.75 }} />
                </div>
              </div>
            ))}
            <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10, marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:800 }}>
                <span style={{ color:C.muted }}>RIM理論株価</span>
                <span style={{ color:"#93c5fd" }}>¥{fmt(s.theoretical)}</span>
              </div>
              <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>終端価値PV: ¥{fmt(s.terminalPV)}</div>
            </div>
            <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:8 }}>残余利益の年次明細</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                  {["期","ROE","残余利益","PV"].map(h => (
                    <th key={h} style={{ padding:"4px", textAlign:"right", color:C.muted, fontWeight:600, fontSize:10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.reiByYear.map(row => (
                  <tr key={row.year} style={{ borderBottom:`1px solid ${C.border}22` }}>
                    <td style={{ padding:"4px", textAlign:"right", color:C.muted }}>{row.year}</td>
                    <td style={{ padding:"4px", textAlign:"right", color:C.muted }}>{(row.roe*100).toFixed(1)}%</td>
                    <td style={{ padding:"4px", textAlign:"right", color:row.rei>=0?"#86efac":"#f87171" }}>{row.rei>=0?"+":""}{fmt(row.rei)}</td>
                    <td style={{ padding:"4px", textAlign:"right", color:C.text }}>{fmt(row.pv)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop:`1px solid ${C.border}` }}>
                  <td colSpan={2} style={{ padding:"4px", textAlign:"right", color:C.muted, fontSize:10 }}>終端価値</td>
                  <td colSpan={2} style={{ padding:"4px", textAlign:"right", color:"#fbbf24" }}>+{fmt(s.terminalPV)}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ margin:"14px 0", padding:10, background:C.bg, borderRadius:6, fontSize:11, color:C.muted, lineHeight:2 }}>
              <div style={{ color:C.accent, marginBottom:2, fontSize:10 }}>計算前提</div>
              r: <strong style={{ color:C.text }}>{(s.requiredReturn*100).toFixed(1)}%</strong>　
              終端成長率: <strong style={{ color:C.text }}>{(terminalG*100).toFixed(1)}%</strong>　
              予測期間: <strong style={{ color:C.text }}>{forecastYears}年</strong>
            </div>
          </>
        )}
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
  const [forecastYears, setForecastYears] = useState(10);
  const [terminalG, setTerminalG]       = useState(0.02);
  const [payoutRatio, setPayoutRatio]   = useState(0.4);
  const [selected, setSelected]         = useState<string | null>(null);
  const [sortKey, setSortKey]           = useState("updown");
  const [sortAsc, setSortAsc]           = useState(false);
  const [editRR, setEditRR]             = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile]         = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [totalCount, setTotalCount]     = useState(0);
  const [displayLimit, setDisplayLimit] = useState(50);
  const [apiError, setApiError]         = useState(false);
  const [minPbr, setMinPbr]             = useState(0);
  const [maxPbr, setMaxPbr]             = useState(0);
  const [nikkeiMap, setNikkeiMap]       = useState<Map<string, NikkeiRef>>(new Map());

  useEffect(() => {
    fetch("/nikkei_prices.csv")
      .then(r => r.text())
      .then(text => {
        const lines = text.split("\n").slice(1);
        const map = new Map<string, NikkeiRef>();
        for (const line of lines) {
          const cols = line.split(",");
          if (cols.length < 7) continue;
          const code = cols[0].trim();
          const theoretical = parseFloat(cols[3]);
          const price = parseFloat(cols[4]);
          const divergence = cols[5].trim();
          const evaluation = cols[6].trim();
          if (code && !isNaN(theoretical)) {
            map.set(code, { theoretical, price, divergence, evaluation });
          }
        }
        setNikkeiMap(map);
      })
      .catch(() => {});
  }, []);

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
      if (merged.length === 0 && !search) {
        setApiError(true); setStocks(FALLBACK);
      } else {
        setStocks(merged);
        setFetchedAt(data.fetchedAt);
        fetchYahooPrices(merged);
      }
    } catch {
      setApiError(true); setStocks(FALLBACK);
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, [fetchYahooPrices]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData(selectedSector, displayLimit, searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, selectedSector, displayLimit, fetchData]);

  const handleSectorChange = (sector: string) => {
    setSelectedSector(sector);
    setDisplayLimit(50);
    setSelected(null);
    setSearchText("");
  };

  const results: ValuationResult[] = useMemo(
    () => stocks.map(s => calcValuation(s, forecastYears, terminalG, false, payoutRatio)),
    [stocks, forecastYears, terminalG, payoutRatio]
  );

  const filtered = useMemo(() => results.filter(s => {
    if (s.price <= 0 || s.bps <= 0) return true;
    if (minPbr > 0 && s.pbr < minPbr) return false;
    if (maxPbr > 0 && s.pbr > maxPbr) return false;
    return true;
  }), [results, minPbr, maxPbr]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let va: number, vb: number;
    if (sortKey === "updown")      { va = parseFloat(a.updownPct);        vb = parseFloat(b.updownPct); }
    else if (sortKey === "nikkei") { va = parseFloat(a.nikkeiUpdownPct);  vb = parseFloat(b.nikkeiUpdownPct); }
    else if (sortKey === "price")  { va = a.price;                        vb = b.price; }
    else if (sortKey === "theory") { va = a.theoretical;                  vb = b.theoretical; }
    else if (sortKey === "roe")    { va = a.roe;                          vb = b.roe; }
    else                           { va = parseInt(a.code);               vb = parseInt(b.code); }
    return sortAsc ? va - vb : vb - va;
  }), [filtered, sortKey, sortAsc]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const updateRR = (code: string, val: string) => {
    setStocks(prev => prev.map(s =>
      s.code === code ? { ...s, requiredReturn: Math.max(0.01, Math.min(0.3, parseFloat(val)/100 || 0.05)) } : s
    ));
  };

  const selectedResult = selected ? results.find(r => r.code === selected) ?? null : null;
  const selectedNikkei = selected ? nikkeiMap.get(selected) ?? null : null;

  const Header = (
    <div style={{ position:"sticky", top:0, zIndex:50, borderBottom:`1px solid ${C.border}`, background:C.surface, padding:isMobile?"12px 16px":"16px 24px", display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:9, letterSpacing:3, color:C.accent }}>TOKYO PRIME · RIM</div>
        <h1 style={{ margin:"2px 0 0", fontSize:isMobile?16:19, fontWeight:800, color:C.bright }}>理論株価アナリシス</h1>
        <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
          {loading ? "取得中…" : apiError ? "⚠ デモデータ" : loadingPrices ? `${totalCount}銘柄 · 株価更新中…` : `${totalCount}銘柄 · ${fetchedAt ? new Date(fetchedAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})+"更新" : ""}`}
        </div>
      </div>
      <button onClick={() => setShowSettings(!showSettings)} style={{ background:showSettings?C.accent:C.border, border:"none", color:C.bright, cursor:"pointer", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:600 }}>⚙ 設定</button>
      <button onClick={() => fetchData(selectedSector, displayLimit, searchText)} disabled={loading} style={{ background:"transparent", border:`1px solid ${C.accent}`, color:C.accent, cursor:"pointer", borderRadius:8, padding:"6px 10px", fontSize:12 }}>↻</button>
    </div>
  );

  const SettingsPanel = showSettings && (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:isMobile?"14px 16px":"14px 24px", display:"flex", flexWrap:"wrap", gap:20, alignItems:"flex-start" }}>
      <div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:6, letterSpacing:2 }}>予測期間(RIM)</div>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {[1,3,5,7,10,15].map(y => (
            <button key={y} onClick={() => setForecastYears(y)} style={{
              width:36, height:30, borderRadius:6, border:"1px solid",
              borderColor:forecastYears===y?C.accent:C.border,
              background:forecastYears===y?"#1e3a6e":"transparent",
              color:forecastYears===y?"#93c5fd":C.muted,
              cursor:"pointer", fontSize:12, fontWeight:700,
            }}>{y}</button>
          ))}
          <span style={{ lineHeight:"30px", fontSize:12, color:C.muted }}>年</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:6, letterSpacing:2 }}>
          終端成長率: <strong style={{ color:"#93c5fd" }}>{(terminalG*100).toFixed(1)}%</strong>
        </div>
        <input type="range" min={0} max={5} step={0.5}
          value={(terminalG*100).toFixed(1)}
          onChange={e => setTerminalG(parseFloat(e.target.value)/100)}
          style={{ width:120, accentColor:C.accent }} />
      </div>
      <div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:6, letterSpacing:2 }}>
          配当性向: <strong style={{ color:"#93c5fd" }}>{(payoutRatio*100).toFixed(0)}%</strong>
        </div>
        <input type="range" min={0} max={80} step={5}
          value={(payoutRatio*100).toFixed(0)}
          onChange={e => setPayoutRatio(parseFloat(e.target.value)/100)}
          style={{ width:120, accentColor:C.accent }} />
      </div>
      <div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:6, letterSpacing:2 }}>PBRフィルター（0=無効）</div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input type="number" min={0} max={20} step={0.1} value={minPbr||""} placeholder="最小"
            onChange={e => setMinPbr(parseFloat(e.target.value)||0)}
            style={{ width:52, background:C.bg, border:`1px solid ${C.border}`, color:C.bright, borderRadius:6, padding:"4px 6px", fontSize:12, textAlign:"center" }} />
          <span style={{ color:C.muted }}>〜</span>
          <input type="number" min={0} max={20} step={0.1} value={maxPbr||""} placeholder="最大"
            onChange={e => setMaxPbr(parseFloat(e.target.value)||0)}
            style={{ width:52, background:C.bg, border:`1px solid ${C.border}`, color:C.bright, borderRadius:6, padding:"4px 6px", fontSize:12, textAlign:"center" }} />
          <span style={{ color:C.muted, fontSize:12 }}>倍</span>
          {(minPbr>0||maxPbr>0) && (
            <button onClick={() => {setMinPbr(0);setMaxPbr(0);}}
              style={{ background:C.border, border:"none", color:C.muted, cursor:"pointer", borderRadius:6, padding:"4px 8px", fontSize:11 }}>リセット</button>
          )}
        </div>
      </div>
    </div>
  );

  const FilterBar = (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:isMobile?"10px 12px":"10px 24px" }}>
      <input type="text" placeholder="銘柄名・コードで検索..."
        value={searchText} onChange={e => setSearchText(e.target.value)}
        style={{ width:"100%", marginBottom:10, padding:"8px 12px", background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, color:C.bright, fontSize:13, boxSizing:"border-box" as const }}
      />
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4 }}>
        {["すべて", ...allSectors].map(sector => (
          <button key={sector} onClick={() => handleSectorChange(sector)} style={{
            flexShrink:0, padding:"5px 12px", borderRadius:20, border:"1px solid",
            borderColor:selectedSector===sector?C.accent:C.border,
            background:selectedSector===sector?"#1e3a6e":"transparent",
            color:selectedSector===sector?"#93c5fd":C.muted,
            fontSize:11, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
          }}>{sector}</button>
        ))}
      </div>
    </div>
  );

  const MobileList = (
    <div style={{ padding:"12px 12px 100px" }}>
      <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto" }}>
        {[
          {key:"nikkei", label:"日経計算↓"},
          {key:"updown", label:"RIM乖離率"},
          {key:"price",  label:"株価"},
          {key:"roe",    label:"ROE"},
        ].map(s => (
          <button key={s.key} onClick={() => handleSort(s.key)} style={{
            flexShrink:0, padding:"6px 12px", borderRadius:20, border:"1px solid",
            borderColor:sortKey===s.key?C.accent:C.border,
            background:sortKey===s.key?"#1e3a6e":"transparent",
            color:sortKey===s.key?"#93c5fd":C.muted,
            fontSize:12, fontWeight:600, cursor:"pointer",
          }}>{s.label}{sortKey===s.key?(sortAsc?" ↑":" ↓"):""}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign:"center", color:C.muted, padding:40 }}>取得中…</div>
      ) : sorted.map(s => {
        const rating = ratingInfo(s.nikkeiUpdownPct);
        const isEdit = editRR[s.code];
        const changePct = s.previousClose > 0 ? ((s.price-s.previousClose)/s.previousClose*100).toFixed(2) : "0.00";
        const pbr = s.pbr > 0 ? s.pbr.toFixed(2) : "—";
        const nk = nikkeiMap.get(s.code);
        return (
          <div key={s.code} onClick={() => setSelected(selected===s.code?null:s.code)}
            style={{ background:C.surface, border:`1px solid`, borderColor:selected===s.code?C.accent:C.border, borderRadius:12, padding:"14px 16px", marginBottom:10, cursor:"pointer" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
              <div>
                <span style={{ color:"#60a5fa", fontWeight:700, fontFamily:"monospace", marginRight:8, fontSize:12 }}>{s.code}</span>
                <span style={{ color:C.bright, fontWeight:700, fontSize:15 }}>{s.name}</span>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{s.sector}</div>
              </div>
              <span style={{ color:rating.color, background:rating.bg, border:`1px solid ${rating.color}40`, borderRadius:6, padding:"3px 10px", fontSize:11, fontWeight:700, flexShrink:0, marginLeft:8 }}>{rating.label}</span>
            </div>

            {/* 現在株価 */}
            <div style={{ background:C.bg, borderRadius:8, padding:"8px 10px", marginBottom:8 }}>
              <div style={{ fontSize:9, color:C.muted, marginBottom:2 }}>現在株価</div>
              <div style={{ fontWeight:700, fontSize:15, color:"#22d3a0" }}>
                {s.price > 0 ? `¥${fmt(s.price)}` : loadingPrices ? "取得中…" : "¥0"}
              </div>
              <div style={{ fontSize:10, color:parseFloat(changePct)>=0?"#22d3a0":"#f87171" }}>
                {parseFloat(changePct)>=0?"+":""}{changePct}%
              </div>
            </div>

            {/* 日経マネー計算値 + 誌面参考値 横並び */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
              <div style={{ background:C.bg, borderRadius:8, padding:"8px 10px", border:`1px solid #064e3b` }}>
                <div style={{ fontSize:9, color:"#6ee7b7", marginBottom:2 }}>日経マネー計算値</div>
                <div style={{ fontWeight:700, fontSize:14, color:"#34d399" }}>¥{fmt(s.nikkeiTheoretical)}</div>
                <div style={{ fontSize:11, color:pctColor(s.nikkeiUpdownPct), fontWeight:700 }}>
                  {parseFloat(s.nikkeiUpdownPct)>=0?"+":""}{s.nikkeiUpdownPct}%
                </div>
              </div>
              <div style={{ background:C.bg, borderRadius:8, padding:"8px 10px", border:`1px solid #1e3a2e` }}>
                <div style={{ fontSize:9, color:"#86efac", marginBottom:2 }}>誌面掲載値(参考)</div>
                {nk?.theoretical ? (
                  <>
                    <div style={{ fontWeight:700, fontSize:14, color:"#86efac" }}>¥{fmt(nk.theoretical)}</div>
                    <div style={{ fontSize:11, color:nk.evaluation==="+"?"#22d3a0":"#f87171", fontWeight:700 }}>
                      {nk.divergence}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>掲載なし</div>
                )}
              </div>
            </div>

            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" as const }}>
              <span style={{ fontSize:11, color:C.muted }}>PBR: <strong style={{ color:C.text }}>{pbr}倍</strong></span>
              <span style={{ fontSize:11, color:C.muted }}>ROE: <strong style={{ color:C.text }}>{(s.roe*100).toFixed(1)}%</strong></span>
              <span onClick={e => { e.stopPropagation(); setEditRR(p => ({ ...p, [s.code]:true })); }}>
                {isEdit ? (
                  <input autoFocus type="number" min={1} max={30} step={0.5}
                    defaultValue={(s.requiredReturn*100).toFixed(1)}
                    style={{ width:56, background:"#1e3a6e", border:`1px solid ${C.accent}`, color:C.bright, borderRadius:6, padding:"2px 6px", fontSize:12 }}
                    onBlur={e => { updateRR(s.code, e.target.value); setEditRR(p => ({ ...p, [s.code]:false })); }}
                    onKeyDown={e => { if(e.key==="Enter"){ updateRR(s.code,(e.target as HTMLInputElement).value); setEditRR(p=>({...p,[s.code]:false})); }}}
                  />
                ) : (
                  <strong style={{ color:"#fbbf24", borderBottom:"1px dashed #4a5568", cursor:"pointer", fontSize:13 }}>r={( s.requiredReturn*100).toFixed(1)}%</strong>
                )}
              </span>
              <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>詳細 →</span>
            </div>
          </div>
        );
      })}
      {!loading && !searchText && sorted.length >= displayLimit && (
        <button onClick={() => { setLoadingMore(true); setDisplayLimit(d => d+50); }}
          style={{ width:"100%", padding:"12px", background:C.surface, border:`1px solid ${C.border}`, color:C.accent, borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 }}>
          {loadingMore ? "取得中…" : "さらに50件表示"}
        </button>
      )}
    </div>
  );

  const DesktopTable = (
    <div style={{ flex:1, overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:950 }}>
        <thead>
          <tr>
            {[
              { key:"code",    label:"コード / 銘柄",    align:"left" },
              { key:"price",   label:"現在株価",         align:"right" },
              { key:"nikkei",  label:"日経マネー計算値", align:"right" },
              { key:"nupdown", label:"乖離率(計算)",     align:"right" },
              { key:"ref",     label:"誌面掲載値(参考)", align:"right" },
              { key:"refpct",  label:"乖離率(誌面)",     align:"right" },
              { key:"pbr",     label:"PBR",              align:"right" },
              { key:"roe",     label:"ROE",              align:"right" },
              { key:"rr",      label:"r ✎",             align:"right" },
              { key:"rating",  label:"評価",             align:"center" },
            ].map(col => (
              <th key={col.key}
                onClick={() => !["rr","rating","pbr","ref","refpct","nupdown"].includes(col.key) && handleSort(col.key)}
                style={{ padding:"10px 10px", fontSize:9, letterSpacing:1, color:C.muted, fontWeight:700, textTransform:"uppercase" as const, cursor:!["rr","rating","pbr","ref","refpct","nupdown"].includes(col.key)?"pointer":"default", userSelect:"none" as const, borderBottom:`2px solid ${C.border}`, textAlign:col.align as "left"|"right"|"center", whiteSpace:"nowrap" as const }}
              >
                {col.label}{sortKey===col.key?(sortAsc?" ↑":" ↓"):""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={10} style={{ padding:40, textAlign:"center", color:C.muted }}>取得中…</td></tr>
          ) : sorted.map((s, i) => {
            const rating = ratingInfo(s.nikkeiUpdownPct);
            const isSel  = selected === s.code;
            const isEdit = editRR[s.code];
            const changePct = s.previousClose > 0 ? ((s.price-s.previousClose)/s.previousClose*100).toFixed(2) : "0.00";
            const pbr = s.pbr > 0 ? s.pbr.toFixed(2) : "—";
            const nk = nikkeiMap.get(s.code);
            return (
              <tr key={s.code} onClick={() => setSelected(isSel?null:s.code)}
                style={{ borderBottom:`1px solid ${C.border}`, background:isSel?"#0d2040":i%2===0?"#0a1525":C.bg, cursor:"pointer" }}
                onMouseEnter={e => { if(!isSel) e.currentTarget.style.background="#0f1e35"; }}
                onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=i%2===0?"#0a1525":C.bg; }}
              >
                <td style={{ padding:"10px 10px" }}>
                  <span style={{ color:"#60a5fa", fontWeight:700, fontFamily:"monospace", marginRight:6, fontSize:11 }}>{s.code}</span>
                  <span style={{ color:C.bright, fontWeight:600 }}>{s.name}</span>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{s.sector}</div>
                </td>
                <td style={{ padding:"10px 10px", textAlign:"right" }}>
                  <div style={{ fontWeight:700 }}>
                    {s.price > 0 ? `¥${fmt(s.price)}` : loadingPrices ? <span style={{ color:C.muted, fontSize:11 }}>取得中…</span> : "¥0"}
                  </div>
                  <div style={{ fontSize:10, color:parseFloat(changePct)>=0?"#22d3a0":"#f87171" }}>{parseFloat(changePct)>=0?"+":""}{changePct}%</div>
                </td>
                <td style={{ padding:"10px 10px", textAlign:"right", color:"#34d399", fontWeight:700 }}>¥{fmt(s.nikkeiTheoretical)}</td>
                <td style={{ padding:"10px 10px", textAlign:"right" }}>
                  <span style={{ color:pctColor(s.nikkeiUpdownPct), fontWeight:800 }}>{parseFloat(s.nikkeiUpdownPct)>=0?"+":""}{s.nikkeiUpdownPct}%</span>
                </td>
                <td style={{ padding:"10px 10px", textAlign:"right", color:"#86efac", fontWeight:700 }}>
                  {nk?.theoretical ? `¥${fmt(nk.theoretical)}` : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:"10px 10px", textAlign:"right" }}>
                  {nk?.divergence ? (
                    <span style={{ color:nk.evaluation==="+"?"#22d3a0":"#f87171", fontWeight:700 }}>{nk.divergence}</span>
                  ) : <span style={{ color:C.muted }}>—</span>}
                </td>
                <td style={{ padding:"10px 10px", textAlign:"right", color:C.muted }}>{pbr}倍</td>
                <td style={{ padding:"10px 10px", textAlign:"right", color:C.muted }}>{(s.roe*100).toFixed(1)}%</td>
                <td style={{ padding:"10px 10px", textAlign:"right" }}
                  onClick={e => { e.stopPropagation(); setEditRR(p=>({...p,[s.code]:true})); }}>
                  {isEdit ? (
                    <input autoFocus type="number" min={1} max={30} step={0.5}
                      defaultValue={(s.requiredReturn*100).toFixed(1)}
                      style={{ width:48, background:"#1e3a6e", border:`1px solid ${C.accent}`, color:C.bright, borderRadius:4, padding:"2px 4px", fontSize:11, textAlign:"right" }}
                      onBlur={e => { updateRR(s.code, e.target.value); setEditRR(p=>({...p,[s.code]:false})); }}
                      onKeyDown={e => { if(e.key==="Enter"){ updateRR(s.code,(e.target as HTMLInputElement).value); setEditRR(p=>({...p,[s.code]:false})); }}}
                    />
                  ) : (
                    <span style={{ color:"#fbbf24", fontWeight:700, borderBottom:"1px dashed #4a5568", cursor:"text" }}>{(s.requiredReturn*100).toFixed(1)}%</span>
                  )}
                </td>
                <td style={{ padding:"10px 10px", textAlign:"center" }}>
                  <span style={{ color:rating.color, background:rating.bg, border:`1px solid ${rating.color}40`, borderRadius:5, padding:"3px 8px", fontSize:11, fontWeight:700 }}>{rating.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!loading && !searchText && sorted.length >= displayLimit && (
        <div style={{ padding:"16px", textAlign:"center" }}>
          <button onClick={() => { setLoadingMore(true); setDisplayLimit(d => d+50); }}
            style={{ padding:"10px 32px", background:"transparent", border:`1px solid ${C.accent}`, color:C.accent, borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 }}>
            {loadingMore ? "取得中…" : "さらに50件表示"}
          </button>
        </div>
      )}
      <div style={{ padding:"12px 20px", borderTop:`1px solid ${C.border}`, fontSize:10, color:"#334155", lineHeight:1.8 }}>
        ※ 表示中: {sorted.length}件 / {totalCount}銘柄　
        ※ 日経マネー計算値: 当アプリが日経マネー式で計算した値　
        ※ 誌面掲載値: 日経マネー2026年7月号別冊付録（参考）　
        ※ 株価はYahoo Financeより取得
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Noto Sans JP', sans-serif", fontSize:13 }}>
      {Header}
      {SettingsPanel}
      {FilterBar}
      {isMobile ? (
        <>
          {MobileList}
          {selectedResult && (
            <DetailPanel s={selectedResult} nikkeiRef={selectedNikkei} forecastYears={forecastYears} terminalG={terminalG} isMobile={true} onClose={() => setSelected(null)} />
          )}
        </>
      ) : (
        <div style={{ display:"flex" }}>
          {DesktopTable}
          {selectedResult && (
            <DetailPanel s={selectedResult} nikkeiRef={selectedNikkei} forecastYears={forecastYears} terminalG={terminalG} isMobile={false} onClose={() => setSelected(null)} />
          )}
        </div>
      )}
    </div>
  );
}
