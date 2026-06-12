// src/app/batch-runner/page.tsx
"use client";
import { useState, useRef } from "react";

export default function BatchRunner() {
  const [log, setLog] = useState<{msg:string;type:string}[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("待機中");
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string, type = "") => {
    setLog(prev => [...prev, {msg, type}]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const startBatch = async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    addLog("バッチ開始...", "info");

    let from = 0;
    let total = 0;
    let totalSuccess = 0;

    while (true) {
      try {
        addLog(`処理中: ${from}〜${from + 19}件目...`, "info");
        const res = await fetch(`/api/batch?from=${from}&size=20`);
        const data = await res.json();

        total = data.total ?? total;
        totalSuccess += data.success ?? 0;

        addLog(`✅ ${from}〜: 成功${data.success} / エラー${data.errors}`, "ok");
        setProgress(Math.round((from + 20) / total * 100));
        setStatus(`${from + 20} / ${total} 件 (${Math.round((from+50)/total*100)}%)`);

        if (!data.nextUrl) {
          addLog(`🎉 完了！ 合計${totalSuccess}件保存`, "ok");
          setStatus(`完了！ ${totalSuccess}件をDBに保存しました`);
          break;
        }
        from = data.nextFrom;
        await sleep(2100);
      } catch (e) {
        addLog(`❌ エラー: ${e}`, "err");
        await sleep(5000);
      }
    }
    setRunning(false);
  };

  const C = { bg:"#0a0f1e", surface:"#0d1b30", border:"#162133", accent:"#3b82f6" };

  return (
    <div style={{minHeight:"100vh", background:C.bg, color:"#e2e8f0", padding:20, maxWidth:600, margin:"0 auto", fontFamily:"sans-serif"}}>
      <h1 style={{color:"#93c5fd", fontSize:18}}>🔄 バッチ自動実行</h1>
      <p style={{color:"#64748b", fontSize:13}}>ボタンを押すと全銘柄データを自動取得してDBに保存します。途中でページを閉じないでください。</p>

      <div style={{background:C.border, borderRadius:8, height:12, margin:"10px 0"}}>
        <div style={{background:C.accent, height:"100%", borderRadius:8, width:`${progress}%`, transition:"width 0.3s"}} />
      </div>
      <div style={{textAlign:"center", fontSize:13, color:"#64748b", marginBottom:16}}>{status}</div>

      <button onClick={startBatch} disabled={running} style={{
        background:running?"#334155":C.accent, color:"white", border:"none",
        padding:"12px 24px", borderRadius:8, fontSize:16, cursor:running?"not-allowed":"pointer",
        width:"100%", marginBottom:10,
      }}>
        {running ? "⏳ 処理中..." : "▶ 全件バッチ開始"}
      </button>

      <div ref={logRef} style={{background:C.surface, borderRadius:8, padding:16, fontSize:13, lineHeight:2, maxHeight:400, overflowY:"auto"}}>
        {log.map((l, i) => (
          <div key={i} style={{color: l.type==="ok"?"#22d3a0": l.type==="err"?"#f87171":"#93c5fd"}}>{l.msg}</div>
        ))}
      </div>
    </div>
  );
}
