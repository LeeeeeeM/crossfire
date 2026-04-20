import { useEffect, useMemo, useState } from "react";

type HybridSim = {
  eventQueue: number;
  stateQueue: number;
  eventProcessed: number;
  stateProcessed: number;
  now: number;
};

const STEP_MS = 100;

export default function FreeFirePage() {
  const [players, setPlayers] = useState(50);
  const [eventRate, setEventRate] = useState(6);
  const [stateRate, setStateRate] = useState(15);
  const [loss, setLoss] = useState(10);
  const [running, setRunning] = useState(true);

  const [sim, setSim] = useState<HybridSim>({
    eventQueue: 0,
    stateQueue: 0,
    eventProcessed: 0,
    stateProcessed: 0,
    now: 0
  });

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setSim((prev) => {
        const now = prev.now + STEP_MS;
        const eventIn = (players * eventRate) / 10;
        const stateIn = (players * stateRate) / 10;

        const eventCapacity = 48 - loss * 0.8;
        const stateCapacity = 66 - loss * 1.1;

        let eventQueue = prev.eventQueue + eventIn;
        let stateQueue = prev.stateQueue + stateIn;

        const eventOut = Math.max(0, Math.min(eventQueue, eventCapacity));
        const stateOut = Math.max(0, Math.min(stateQueue, stateCapacity));

        eventQueue -= eventOut;
        stateQueue -= stateOut;

        return {
          now,
          eventQueue,
          stateQueue,
          eventProcessed: prev.eventProcessed + eventOut,
          stateProcessed: prev.stateProcessed + stateOut
        };
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [eventRate, loss, players, running, stateRate]);

  const metrics = useMemo(() => {
    const eventDelay = 35 + loss * 1.1 + sim.eventQueue * 0.6;
    const stateDelay = 70 + loss * 1.8 + sim.stateQueue * 0.9;
    const eventUtil = Math.min(100, ((players * eventRate) / 10 / (48 - loss * 0.8)) * 100);
    const stateUtil = Math.min(100, ((players * stateRate) / 10 / (66 - loss * 1.1)) * 100);
    return { eventDelay, stateDelay, eventUtil, stateUtil };
  }, [eventRate, loss, players, sim.eventQueue, sim.stateQueue, stateRate]);

  return (
    <section>
      <h1>Free Fire: Hybrid Sync</h1>
      <p className="muted">实时演示：事件通道和状态通道分开处理，负载与延迟各自变化。</p>
      <div className="panel">
        <label>玩家数 {players}<input type="range" min={10} max={80} value={players} onChange={(e) => setPlayers(Number(e.target.value))} /></label>
        <label>事件频率 {eventRate}/s<input type="range" min={1} max={12} value={eventRate} onChange={(e) => setEventRate(Number(e.target.value))} /></label>
        <label>状态频率 {stateRate}/s<input type="range" min={5} max={30} value={stateRate} onChange={(e) => setStateRate(Number(e.target.value))} /></label>
        <label>丢包率 {loss}%<input type="range" min={0} max={25} value={loss} onChange={(e) => setLoss(Number(e.target.value))} /></label>
      </div>
      <div className="card">
        <div className="sim-toolbar">
          <button type="button" onClick={() => setRunning((x) => !x)}>{running ? "暂停" : "继续"}</button>
          <button type="button" onClick={() => setSim({ eventQueue: 0, stateQueue: 0, eventProcessed: 0, stateProcessed: 0, now: 0 })}>重置</button>
        </div>
        <div className="grid2">
          <div>
            <h4>事件通道（开火/技能）</h4>
            <p>当前队列: {sim.eventQueue.toFixed(1)}</p>
            <p>估算延迟: {metrics.eventDelay.toFixed(0)}ms</p>
            <div className="meter"><div className="meter-fill" style={{ width: `${metrics.eventUtil}%` }} /></div>
          </div>
          <div>
            <h4>状态通道（位置/朝向）</h4>
            <p>当前队列: {sim.stateQueue.toFixed(1)}</p>
            <p>估算延迟: {metrics.stateDelay.toFixed(0)}ms</p>
            <div className="meter"><div className="meter-fill bad" style={{ width: `${metrics.stateUtil}%` }} /></div>
          </div>
        </div>
        <p>累计处理：事件 {sim.eventProcessed.toFixed(0)}，状态 {sim.stateProcessed.toFixed(0)}。</p>
      </div>
    </section>
  );
}
