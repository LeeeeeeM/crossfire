import { useEffect, useMemo, useState } from "react";

type SimState = {
  now: number;
  frame: number;
  frameStart: number;
  arrivals: number[];
  waitEvents: number;
  totalWaitMs: number;
};

const TICK_MS = 80;

function buildArrivals(frameStart: number, latencies: number[]) {
  return latencies.map((l) => frameStart + l + (Math.random() * 24 - 12));
}

function initSim(latencies: number[]): SimState {
  return {
    now: 0,
    frame: 0,
    frameStart: 0,
    arrivals: buildArrivals(0, latencies),
    waitEvents: 0,
    totalWaitMs: 0
  };
}

export default function DoomPage() {
  const [players, setPlayers] = useState(4);
  const [baseLatency, setBaseLatency] = useState(60);
  const [slowPenalty, setSlowPenalty] = useState(120);
  const [running, setRunning] = useState(true);

  const latencies = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < players; i += 1) arr.push(baseLatency + i * 8);
    arr[players - 1] += slowPenalty;
    return arr;
  }, [players, baseLatency, slowPenalty]);

  const [sim, setSim] = useState<SimState>(() => initSim(latencies));

  useEffect(() => {
    setSim(initSim(latencies));
  }, [latencies]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setSim((prev) => {
        const nextNow = prev.now + TICK_MS;
        const frameReadyAt = Math.max(...prev.arrivals);
        if (nextNow >= frameReadyAt) {
          const nextFrameStart = frameReadyAt;
          return {
            now: nextNow,
            frame: prev.frame + 1,
            frameStart: nextFrameStart,
            arrivals: buildArrivals(nextFrameStart, latencies),
            waitEvents: prev.waitEvents + 1,
            totalWaitMs: prev.totalWaitMs + (frameReadyAt - prev.frameStart)
          };
        }
        return { ...prev, now: nextNow };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [latencies, running]);

  const frameReadyAt = Math.max(...sim.arrivals);
  const slowestIndex = sim.arrivals.indexOf(frameReadyAt);
  const remaining = Math.max(0, frameReadyAt - sim.now);
  const averageWait = sim.waitEvents > 0 ? sim.totalWaitMs / sim.waitEvents : frameReadyAt;

  return (
    <section>
      <h1>DOOM: Deterministic Lockstep</h1>
      <p className="muted">实时仿真：每一帧都要等所有玩家输入，最慢玩家决定全局推进速度。</p>
      <div className="panel">
        <label>玩家数 {players}<input type="range" min={2} max={8} value={players} onChange={(e) => setPlayers(Number(e.target.value))} /></label>
        <label>基础延迟 {baseLatency}ms<input type="range" min={20} max={140} value={baseLatency} onChange={(e) => setBaseLatency(Number(e.target.value))} /></label>
        <label>最慢玩家额外惩罚 {slowPenalty}ms<input type="range" min={0} max={300} value={slowPenalty} onChange={(e) => setSlowPenalty(Number(e.target.value))} /></label>
      </div>
      <div className="card">
        <div className="sim-toolbar">
          <button type="button" onClick={() => setRunning((x) => !x)}>{running ? "暂停" : "继续"}</button>
          <button type="button" onClick={() => setSim(initSim(latencies))}>重置</button>
        </div>
        <div className="grid2">
          <div className="kpi"><span>当前逻辑帧</span><strong>{sim.frame}</strong></div>
          <div className="kpi"><span>该帧剩余等待</span><strong>{remaining.toFixed(0)}ms</strong></div>
          <div className="kpi"><span>当前最慢玩家</span><strong>P{slowestIndex + 1}</strong></div>
          <div className="kpi"><span>平均单帧等待</span><strong>{averageWait.toFixed(1)}ms</strong></div>
        </div>
      </div>
      <div className="viz card">
        {latencies.map((v, i) => {
          const arrival = sim.arrivals[i];
          const progressRaw = (sim.now - sim.frameStart) / (arrival - sim.frameStart);
          const progress = Math.max(0, Math.min(1, progressRaw));
          return (
          <div className="bar-row" key={i}>
            <span>P{i + 1}</span>
            <div className="bar-bg">
              <div
                className={i === slowestIndex ? "bar bad" : "bar"}
                style={{ width: `${Math.max(2, progress * 100)}%` }}
              />
            </div>
            <strong>{Math.max(0, arrival - sim.frameStart).toFixed(0)}ms</strong>
          </div>
          );
        })}
        <p>
          结果：只有当 <strong>所有进度条</strong> 到头后，逻辑帧才会 +1。当前这帧由 <strong>P{slowestIndex + 1}</strong> 拖住。
        </p>
      </div>
    </section>
  );
}
