// src/app/page.tsx - 全銘柄対応・セクターフィルター版
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { StockData, ValuationResult, calcValuation } from "@/lib/stocks";

// ── フォールバック（API失敗時）────────────────────────────────────────
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

// ── 詳細パネル ────────────────────────────────────────────────────────
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
        {/* 株価バー */}
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
        {/* 構成内訳 */}
        <div style={{ fontSize:10, color:C.accent, letterSpacing:2, marginBottom:10 }}>理論株価の構成（円/株）</div>
        {[
          { label:"① 正味営業資産", val:s.netOperatingAssetsPS, color:"#818cf8" },
          { label:"② 正味金融資産", val:s.netFinancialAssetsPS, color:"#34d399" },
          { label:"③ 残余事業利益PV", val:s.pvREI, color:"#fbbf24" },
        ].map(item => (
          <div key={item.label} style={{ marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:13 }}>
              <span style={{ color:C.muted }}>{item.label}</span>
              <span style={{ color:item.color, fontWeight:700 }}>{item.val>=0?"+":""}{fmt(item.val)}</span>
            </div>
            <div style={{ height:5, background:C.border, borderRadius:3 }}>
              <div style={{ height:"100%", width:`${total>0?Math.abs(item.val)/total*100:0}%`, background:item.color, borderRadius:3, opacity:0.75 }} />
            </div>
          </div>
        ))}
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:4, marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:800 }}>
            <span style={{ color:C.muted }}>理論株価</span>
            <span style={{ color:"#93c5fd" }}>¥{fmt(s.theoretical)}</span>
          </div>
          <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>終端価値PV: ¥{fmt(s.terminalPV)}（③のうち）</div>
        </div>
        {/* 年次明細 */}
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
          終端成長率: <strong style={{ color:C.text }}>{(terminalG*100).toFixed(1)}%</strong><br/>
          予測期間: <strong style={{ color:C.text }}>{forecastYears}年</strong>　
          データ基準日: <strong style={{ color:C.text }}>{s.priceDate ?? "—"}</strong>
        </div>
      </div>
    </div>
  );
}

// ── メイン ────────────────────────────────────────────────────────────
export default function Home() {
  const [stocks, setStocks]             = useState<StockData[]>(FALLBACK);
  const [allSectors, setAllSectors]     = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>("すべて");
  const [searchText, setSearchText]     = useState("");
  const [loading, setLoading]           = useState(false);
  const [loadingMore, setLoadingMore]   = useState(false);
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

  // 銘柄マスターからセクター一覧を取得
  useEffect(() => {
    fetch("/api/master")
      .then(r => r.json())
      .then(data => {
        const sectorSet = new Set<string>((data.stocks ?? []).map((s: { sector: string }) => s.sector));
        const sectors = Array.from(sectorSet).sort();
        setAllSectors(sectors);
        setTotalCount(data.total ?? 0);
      })
      .catch(() => {});
  }, []);

  // データ取得
  const fetchData = useCallback(async (sector: string, limit: number) => {
    setLoading(true);
    setApiError(false);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (sector !== "すべて") params.set("sector", sector);
      const res  = await fetch(`/api/financials?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const merged: StockData[] = (data.stocks ?? [])
        .filter((s: StockData & { error?: string }) => !s.error)
        .map((s: StockData) => ({ ...s, requiredReturn: s.requiredReturn ?? 0.05 }));
      if (merged.length === 0) { setApiError(true); setStocks(FALLBACK); }
      else { setStocks(merged); setFetchedAt(data.fetchedAt); }
    } catch {
      setApiError(true); setStocks(FALLBACK);
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchData(selectedSector, displayLimit); }, [selectedSector, fetchData, displayLimit]);

  const handleSectorChange = (sector: string) => {
    setSelectedSector(sector);
    setDisplayLimit(50);
    setSelected(null);
  };

  // 計算
  const results: ValuationResult[] = useMemo(
    () => stocks.map(s => calcValuation(s, forecastYears, terminalG)),
    [stocks, forecastYears, terminalG]
  );

  // 検索フィルター
  const filtered = useMemo(() => {
    if (!searchText) return results;
    const q = searchText.toLowerCase();
    return results.filter(s =>
      s.name.toLowerCase().includes(q) || s.code.includes(q)
    );
  }, [results, searchText]);

  // ソート
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let va: number, vb: number;
    if (sortKey === "updown")      { va = parseFloat(a.updownPct); vb = parseFloat(b.updownPct); }
    else if (sortKey === "price")  { va = a.price; vb = b.price; }
    else if (sortKey === "theory") { va = a.theoretical; vb = b.theoretical; }
    else if (sortKey === "roe")    { va = a.roe; vb = b.roe; }
    else                           { va = parseInt(a.code); vb = parseInt(b.code); }
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

  // ── ヘッダー ──────────────────────────────────────────────────────
  const Header = (
    <div style={{ position:"sticky", top:0, zIndex:50, borderBottom:`1px solid ${C.border}`, background:C.surface, padding:isMobile?"12px 16px":"16px 24px", display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:9, letterSpacing:3, color:C.accent }}>TOKYO PRIME · RIM</div>
        <h1 style={{ margin:"2px 0 0", fontSize:isMobile?16:19, fontWeight:800, color:C.bright }}>理論株価アナリシス</h1>
        <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
          {loading ? "取得中…" : apiError ? "⚠ デモデータ" : `${totalCount}銘柄 · ${fetchedAt ? new Date(fetchedAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})+"更新" : ""}`}
        </div>
      </div>
      <button onClick={() => setShowSettings(!showSettings)} style={{ background:showSettings?C.accent:C.border, border:"none", color:C.bright, cursor:"pointer", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:600 }}>⚙ 設定</button>
      <button onClick={() => fetchData(selectedSector, displayLimit)} disabled={loading} style={{ background:"transparent", border:`1px solid ${C.accent}`, color:C.accent, cursor:"pointer", borderRadius:8, padding:"6px 10px", fontSize:12 }}>↻</button>
    </div>
  );

  // ── 設定パネル ────────────────────────────────────────────────────
  const SettingsPanel = showSettings && (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:isMobile?"14px 16px":"14px 24px", display:"flex", flexWrap:"wrap", gap:20, alignItems:"center" }}>
      <div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:6, letterSpacing:2 }}>予測期間</div>
        <div style={{ display:"flex", gap:5 }}>
          {[1,2,3,4,5].map(y => (
            <button key={y} onClick={() => setForecastYears(y)} style={{
              width:isMobile?36:32, height:isMobile?36:30, borderRadius:6, border:"1px solid",
              borderColor:forecastYears===y?C.accent:C.border,
              background:forecastYears===y?"#1e3a6e":"transparent",
              color:forecastYears===y?"#93c5fd":C.muted,
              cursor:"pointer", fontSize:13, fontWeight:700,
            }}>{y}</button>
          ))}
          <span style={{ lineHeight:isMobile?"36px":"30px", fontSize:12, color:C.muted }}>年</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize:10, color:C.muted, marginBottom:6, letterSpacing:2 }}>
          終端成長率: <strong style={{ color:"#93c5fd" }}>{(terminalG*100).toFixed(1)}%</strong>
        </div>
        <input type="range" min={0} max={5} step={0.5}
          value={(terminalG*100).toFixed(1)}
          onChange={e => setTerminalG(parseFloat(e.target.value)/100)}
          style={{ width:isMobile?140:110, accentColor:C.accent }} />
      </div>
    </div>
  );

  // ── セクター・検索バー ─────────────────────────────────────────────
  const FilterBar = (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:isMobile?"10px 12px":"10px 24px" }}>
      {/* 検索 */}
      <input
        type="text" placeholder="銘柄名・コードで検索..."
        value={searchText} onChange={e => setSearchText(e.target.value)}
        style={{ width:"100%", marginBottom:10, padding:"8px 12px", background:C.bg, border:`1px solid ${C.border}`, borderRadius:6, color:C.bright, fontSize:13, boxSizing:"border-box" as const }}
      />
      {/* セクターフィルター */}
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

  // ── スマホカード ──────────────────────────────────────────────────
  const MobileList = (
    <div style={{ padding:"12px 12px 100px" }}>
      <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto" }}>
        {[{key:"updown",label:"乖離率"},{key:"theory",label:"理論株価"},{key:"price",label:"株価"},{key:"roe",label:"ROE"}].map(s => (
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
        const rating = ratingInfo(s.updownPct);
        const isEdit = editRR[s.code];
        const changePct = s.previousClose > 0 ? ((s.price-s.previousClose)/s.previousClose*100).toFixed(2) : "0.00";
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
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
              {[
                { label:"現在株価", value:`¥${fmt(s.price)}`, sub:`${parseFloat(changePct)>=0?"+":""}${changePct}%`, subColor:parseFloat(changePct)>=0?"#22d3a0":"#f87171" },
                { label:"理論株価", value:`¥${fmt(s.theoretical)}`, sub:"", subColor:"#93c5fd" },
                { label:"乖離率", value:`${parseFloat(s.updownPct)>=0?"+":""}${s.updownPct}%`, sub:"", subColor:pctColor(s.updownPct) },
              ].map(item => (
                <div key={item.label} style={{ background:C.bg, borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{item.label}</div>
                  <div style={{ fontWeight:700, fontSize:13, color:item.subColor }}>{item.value}</div>
                  {item.sub && <div style={{ fontSize:10, color:item.subColor, marginTop:2 }}>{item.sub}</div>}
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" as const }}>
              <span style={{ fontSize:11, color:C.muted }}>ROE: <strong style={{ color:C.text }}>{(s.roe*100).toFixed(1)}%</strong></span>
              <span style={{ fontSize:11, color:C.muted }}>要求利回り: </span>
              <span onClick={e => { e.stopPropagation(); setEditRR(p => ({ ...p, [s.code]:true })); }}>
                {isEdit ? (
                  <input autoFocus type="number" min={1} max={30} step={0.5}
                    defaultValue={(s.requiredReturn*100).toFixed(1)}
                    style={{ width:56, background:"#1e3a6e", border:`1px solid ${C.accent}`, color:C.bright, borderRadius:6, padding:"2px 6px", fontSize:12 }}
                    onBlur={e => { updateRR(s.code, e.target.value); setEditRR(p => ({ ...p, [s.code]:false })); }}
                    onKeyDown={e => { if(e.key==="Enter"){ updateRR(s.code,(e.target as HTMLInputElement).value); setEditRR(p=>({...p,[s.code]:false})); }}}
                  />
                ) : (
                  <strong style={{ color:"#fbbf24", borderBottom:"1px dashed #4a5568", cursor:"pointer", fontSize:13 }}>{(s.requiredReturn*100).toFixed(1)}%</strong>
                )}
              </span>
              <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>詳細 →</span>
            </div>
          </div>
        );
      })}
      {/* もっと見る */}
      {!loading && sorted.length >= displayLimit && (
        <button onClick={() => { setLoadingMore(true); setDisplayLimit(d => d+50); }}
          style={{ width:"100%", padding:"12px", background:C.surface, border:`1px solid ${C.border}`, color:C.accent, borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 }}>
          {loadingMore ? "取得中…" : "さらに50件表示"}
        </button>
      )}
    </div>
  );

  // ── PCテーブル ────────────────────────────────────────────────────
  const DesktopTable = (
    <div style={{ flex:1, overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:750 }}>
        <thead>
          <tr>
            {[
              { key:"code",   label:"コード / 銘柄", align:"left" },
              { key:"price",  label:"現在株価",      align:"right" },
              { key:"theory", label:"理論株価",      align:"right" },
              { key:"updown", label:"乖離率",        align:"right" },
              { key:"roe",    label:"予想ROE",       align:"right" },
              { key:"rr",     label:"要求利回り ✎", align:"right" },
              { key:"rating", label:"評価",          align:"center" },
            ].map(col => (
              <th key={col.key}
                onClick={() => !["rr","rating"].includes(col.key) && handleSort(col.key)}
                style={{ padding:"10px 14px", fontSize:10, letterSpacing:2, color:C.muted, fontWeight:700, textTransform:"uppercase" as const, cursor:!["rr","rating"].includes(col.key)?"pointer":"default", userSelect:"none" as const, borderBottom:`2px solid ${C.border}`, textAlign:col.align as "left"|"right"|"center", whiteSpace:"nowrap" as const }}
              >
                {col.label}{sortKey===col.key?(sortAsc?" ↑":" ↓"):""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} style={{ padding:40, textAlign:"center", color:C.muted }}>取得中…</td></tr>
          ) : sorted.map((s, i) => {
            const rating = ratingInfo(s.updownPct);
            const isSel  = selected === s.code;
            const isEdit = editRR[s.code];
            const changePct = s.previousClose > 0 ? ((s.price-s.previousClose)/s.previousClose*100).toFixed(2) : "0.00";
            return (
              <tr key={s.code} onClick={() => setSelected(isSel?null:s.code)}
                style={{ borderBottom:`1px solid ${C.border}`, background:isSel?"#0d2040":i%2===0?"#0a1525":C.bg, cursor:"pointer" }}
                onMouseEnter={e => { if(!isSel) e.currentTarget.style.background="#0f1e35"; }}
                onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=i%2===0?"#0a1525":C.bg; }}
              >
                <td style={{ padding:"10px 14px" }}>
                  <span style={{ color:"#60a5fa", fontWeight:700, fontFamily:"monospace", marginRight:8, fontSize:12 }}>{s.code}</span>
                  <span style={{ color:C.bright, fontWeight:600 }}>{s.name}</span>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{s.sector}</div>
                </td>
                <td style={{ padding:"10px 14px", textAlign:"right" }}>
                  <div style={{ fontWeight:700 }}>¥{fmt(s.price)}</div>
                  <div style={{ fontSize:10, color:parseFloat(changePct)>=0?"#22d3a0":"#f87171" }}>{parseFloat(changePct)>=0?"+":""}{changePct}%</div>
                </td>
                <td style={{ padding:"10px 14px", textAlign:"right", color:"#93c5fd", fontWeight:700 }}>¥{fmt(s.theoretical)}</td>
                <td style={{ padding:"10px 14px", textAlign:"right" }}>
                  <span style={{ color:pctColor(s.updownPct), fontWeight:800, fontSize:15 }}>{parseFloat(s.updownPct)>=0?"+":""}{s.updownPct}%</span>
                </td>
                <td style={{ padding:"10px 14px", textAlign:"right", color:C.muted }}>{(s.roe*100).toFixed(1)}%</td>
                <td style={{ padding:"10px 14px", textAlign:"right" }}
                  onClick={e => { e.stopPropagation(); setEditRR(p=>({...p,[s.code]:true})); }}>
                  {isEdit ? (
                    <input autoFocus type="number" min={1} max={30} step={0.5}
                      defaultValue={(s.requiredReturn*100).toFixed(1)}
                      style={{ width:56, background:"#1e3a6e", border:`1px solid ${C.accent}`, color:C.bright, borderRadius:4, padding:"2px 6px", fontSize:12, textAlign:"right" }}
                      onBlur={e => { updateRR(s.code, e.target.value); setEditRR(p=>({...p,[s.code]:false})); }}
                      onKeyDown={e => { if(e.key==="Enter"){ updateRR(s.code,(e.target as HTMLInputElement).value); setEditRR(p=>({...p,[s.code]:false})); }}}
                    />
                  ) : (
                    <span style={{ color:"#fbbf24", fontWeight:700, borderBottom:"1px dashed #4a5568", cursor:"text" }}>{(s.requiredReturn*100).toFixed(1)}%</span>
                  )}
                </td>
                <td style={{ padding:"10px 14px", textAlign:"center" }}>
                  <span style={{ color:rating.color, background:rating.bg, border:`1px solid ${rating.color}40`, borderRadius:5, padding:"3px 10px", fontSize:11, fontWeight:700 }}>{rating.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* もっと見る */}
      {!loading && sorted.length >= displayLimit && (
        <div style={{ padding:"16px", textAlign:"center" }}>
          <button onClick={() => { setLoadingMore(true); setDisplayLimit(d => d+50); }}
            style={{ padding:"10px 32px", background:"transparent", border:`1px solid ${C.accent}`, color:C.accent, borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 }}>
            {loadingMore ? "取得中…" : "さらに50件表示"}
          </button>
        </div>
      )}
      <div style={{ padding:"12px 20px", borderTop:`1px solid ${C.border}`, fontSize:10, color:"#334155", lineHeight:1.8 }}>
        ※ 表示中: {sorted.length}件 / {totalCount}銘柄（東証プライム）　
        ※ 理論株価 = ①正味営業資産 + ②正味金融資産 + ③残余事業利益PV　
        ※ 要求利回りは黄色の数字をクリックして変更可能
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
          {selectedResult && <DetailPanel s={selectedResult} forecastYears={forecastYears} terminalG={terminalG} isMobile={true} onClose={() => setSelected(null)} />}
        </>
      ) : (
        <div style={{ display:"flex" }}>
          {DesktopTable}
          {selectedResult && <DetailPanel s={selectedResult} forecastYears={forecastYears} terminalG={terminalG} isMobile={false} onClose={() => setSelected(null)} />}
        </div>
      )}
    </div>
  );
}
