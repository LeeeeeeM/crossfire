import { useEffect, useMemo, useState } from "react";

const STEP_MS = 160;

export default function SourcePage() {
  const [entities, setEntities] = useState(200);
  const [visiblePct, setVisiblePct] = useState(30);
  const [deltaPct, setDeltaPct] = useState(18);
  const [running, setRunning] = useState(true);
  const [wave, setWave] = useState(0);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setWave((x) => x + 1);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [running]);

  const calc = useMemo(() => {
    const entityBytes = 28;
    const full = entities * entityBytes;
    const visible = Math.round((entities * visiblePct) / 100);
    const wobble = Math.sin(wave / 4) * 8 + (Math.random() * 2 - 1) * 2;
    const effectiveDeltaPct = Math.max(3, Math.min(85, deltaPct + wobble));
    const delta = Math.round((visible * entityBytes * effectiveDeltaPct) / 100);
    const saving = 100 - (delta / full) * 100;
    return { full, delta, visible, saving, effectiveDeltaPct };
  }, [deltaPct, entities, visiblePct, wave]);

  useEffect(() => {
    setHistory((prev) => {
      const next = [...prev, calc.saving];
      return next.slice(-36);
    });
  }, [calc.saving]);

  const avgSaving = history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : calc.saving;

  return (
    <section>
      <h1>Source: Baseline + Delta Snapshot</h1>
      <p className="muted">实时演示：可见性裁剪 + 增量变化，使快照体积随场景负载波动。</p>
      <div className="panel">
        <label>实体数 {entities}<input type="range" min={50} max={600} value={entities} onChange={(e) => setEntities(Number(e.target.value))} /></label>
        <label>可见比例 {visiblePct}%<input type="range" min={10} max={100} value={visiblePct} onChange={(e) => setVisiblePct(Number(e.target.value))} /></label>
        <label>基础变化比例 {deltaPct}%<input type="range" min={5} max={60} value={deltaPct} onChange={(e) => setDeltaPct(Number(e.target.value))} /></label>
      </div>
      <div className="card">
        <div className="sim-toolbar">
          <button type="button" onClick={() => setRunning((x) => !x)}>{running ? "暂停" : "继续"}</button>
          <button type="button" onClick={() => { setHistory([]); setWave(0); }}>重置</button>
        </div>
        <div className="bar-row"><span>全量快照</span><div className="bar-bg"><div className="bar bad" style={{ width: "100%" }} /></div><strong>{calc.full} B</strong></div>
        <div className="bar-row"><span>增量快照</span><div className="bar-bg"><div className="bar" style={{ width: `${Math.max(4, (calc.delta / calc.full) * 100)}%` }} /></div><strong>{calc.delta} B</strong></div>
        <div className="grid2">
          <div className="kpi"><span>可见实体</span><strong>{calc.visible}</strong></div>
          <div className="kpi"><span>当前有效变化率</span><strong>{calc.effectiveDeltaPct.toFixed(1)}%</strong></div>
          <div className="kpi"><span>当前节省</span><strong>{calc.saving.toFixed(1)}%</strong></div>
          <div className="kpi"><span>滑动平均节省</span><strong>{avgSaving.toFixed(1)}%</strong></div>
        </div>
        <div className="sparkline">
          {history.map((v, i) => (
            <div key={i} className="spark-bar" style={{ height: `${Math.max(8, Math.min(100, v))}%` }} title={`${v.toFixed(1)}%`} />
          ))}
        </div>
      </div>
    </section>
  );
}
