import { useEffect, useState } from "react";

type CncSim = {
  tick: number;
  buffered: number;
  delivered: number;
  resend: number;
  packets: number;
  waits: number;
};

const STEP_MS = 120;

export default function CnCPage() {
  const [eventsPerFrame, setEventsPerFrame] = useState(2);
  const [bundleFrames, setBundleFrames] = useState(3);
  const [lossRate, setLossRate] = useState(8);
  const [running, setRunning] = useState(true);

  const [sim, setSim] = useState<CncSim>({
    tick: 0,
    buffered: 0,
    delivered: 0,
    resend: 0,
    packets: 0,
    waits: 0
  });

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setSim((prev) => {
        const tick = prev.tick + 1;
        let buffered = prev.buffered + eventsPerFrame;
        let delivered = prev.delivered;
        let resend = prev.resend;
        let packets = prev.packets;
        let waits = prev.waits;

        if (tick % bundleFrames === 0) {
          packets += 1;
          const dropped = Math.random() * 100 < lossRate;
          if (dropped) {
            resend += Math.max(1, Math.round(buffered * 0.5));
            waits += 1;
          } else {
            delivered += buffered;
            buffered = 0;
          }
        }

        return { tick, buffered, delivered, resend, packets, waits };
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [eventsPerFrame, bundleFrames, lossRate, running]);

  const sendInterval = bundleFrames * 33;

  return (
    <section>
      <h1>C&C: 工程化 Lockstep</h1>
      <p className="muted">实时演示：事件先积攒再打包发送，遇到丢包会重传并增加等待。</p>
      <div className="panel">
        <label>每帧事件数 {eventsPerFrame}<input type="range" min={1} max={8} value={eventsPerFrame} onChange={(e) => setEventsPerFrame(Number(e.target.value))} /></label>
        <label>打包帧数 {bundleFrames}<input type="range" min={1} max={6} value={bundleFrames} onChange={(e) => setBundleFrames(Number(e.target.value))} /></label>
        <label>丢包率 {lossRate}%<input type="range" min={0} max={30} value={lossRate} onChange={(e) => setLossRate(Number(e.target.value))} /></label>
      </div>
      <div className="card">
        <div className="sim-toolbar">
          <button type="button" onClick={() => setRunning((x) => !x)}>{running ? "暂停" : "继续"}</button>
          <button type="button" onClick={() => setSim({ tick: 0, buffered: 0, delivered: 0, resend: 0, packets: 0, waits: 0 })}>重置</button>
        </div>
        <div className="grid2">
          <div className="kpi"><span>打包周期</span><strong>{sendInterval}ms</strong></div>
          <div className="kpi"><span>缓冲事件</span><strong>{sim.buffered}</strong></div>
          <div className="kpi"><span>累计已送达</span><strong>{sim.delivered}</strong></div>
          <div className="kpi"><span>累计重传</span><strong>{sim.resend}</strong></div>
          <div className="kpi"><span>累计发包</span><strong>{sim.packets}</strong></div>
          <div className="kpi"><span>锁步等待触发</span><strong>{sim.waits}</strong></div>
        </div>
        <p>观察：打包帧数越大或丢包率越高，缓冲与等待更明显，手感延迟上升。</p>
      </div>
    </section>
  );
}
