import { useEffect, useRef, useState } from "react";

type QuakeSim = {
  now: number;
  predictedPos: number;
  serverPos: number;
  correctionCount: number;
  correctionSum: number;
  flash: number;
};

const STEP_MS = 80;

export default function QuakePage() {
  const [rtt, setRtt] = useState(140);
  const [serverHz, setServerHz] = useState(20);
  const [moveSpeed, setMoveSpeed] = useState(6);
  const [running, setRunning] = useState(true);
  const highDiffRef = useRef(false);

  const [sim, setSim] = useState<QuakeSim>({
    now: 0,
    predictedPos: 0,
    serverPos: 0,
    correctionCount: 0,
    correctionSum: 0,
    flash: 0
  });

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setSim((prev) => {
        const now = prev.now + STEP_MS;
        const freq = 700;
        const amp = 42;
        const pred = Math.sin(now / freq) * amp * (moveSpeed / 6);
        const server = Math.sin((now - rtt / 2) / freq) * amp * (moveSpeed / 6);
        const diff = Math.abs(pred - server);
        const high = diff > 6;

        let correctionCount = prev.correctionCount;
        let correctionSum = prev.correctionSum;
        let flash = Math.max(0, prev.flash * 0.86);

        if (high && !highDiffRef.current) {
          correctionCount += 1;
          correctionSum += diff;
          flash = 1;
        }
        highDiffRef.current = high;

        return {
          now,
          predictedPos: pred,
          serverPos: server,
          correctionCount,
          correctionSum,
          flash
        };
      });
    }, STEP_MS);

    return () => clearInterval(timer);
  }, [moveSpeed, rtt, running, serverHz]);

  const diff = Math.abs(sim.predictedPos - sim.serverPos);
  const avgCorrection = sim.correctionCount > 0 ? sim.correctionSum / sim.correctionCount : 0;
  const perceivedDelay = Math.max(0, rtt / 2 - (1000 / serverHz) * 0.35);

  const toPct = (v: number) => ((v + 50) / 100) * 100;

  return (
    <section>
      <h1>Quake: Server Authority + Prediction</h1>
      <p className="muted">实时演示：客户端先预测移动，服务端权威状态回包后纠正偏差。</p>
      <div className="panel">
        <label>RTT {rtt}ms<input type="range" min={20} max={280} value={rtt} onChange={(e) => setRtt(Number(e.target.value))} /></label>
        <label>Server Tick {serverHz}Hz<input type="range" min={10} max={60} value={serverHz} onChange={(e) => setServerHz(Number(e.target.value))} /></label>
        <label>移动速度 {moveSpeed}<input type="range" min={2} max={12} value={moveSpeed} onChange={(e) => setMoveSpeed(Number(e.target.value))} /></label>
      </div>
      <div className="card">
        <div className="sim-toolbar">
          <button type="button" onClick={() => setRunning((x) => !x)}>{running ? "暂停" : "继续"}</button>
          <button type="button" onClick={() => {
            highDiffRef.current = false;
            setSim({ now: 0, predictedPos: 0, serverPos: 0, correctionCount: 0, correctionSum: 0, flash: 0 });
          }}>重置</button>
        </div>
        <div className="grid2">
          <div className="kpi"><span>体感输入迟滞</span><strong>{perceivedDelay.toFixed(1)}ms</strong></div>
          <div className="kpi"><span>当前偏差</span><strong>{diff.toFixed(2)}</strong></div>
          <div className="kpi"><span>纠正次数</span><strong>{sim.correctionCount}</strong></div>
          <div className="kpi"><span>平均纠正幅度</span><strong>{avgCorrection.toFixed(2)}</strong></div>
        </div>

        <div className="marker-wrap">
          <div className="marker-label">本地预测</div>
          <div className="marker-track">
            <div className="marker pred" style={{ left: `${toPct(sim.predictedPos)}%` }} />
          </div>
        </div>

        <div className="marker-wrap">
          <div className="marker-label">服务端权威</div>
          <div className="marker-track">
            <div className="marker auth" style={{ left: `${toPct(sim.serverPos)}%` }} />
          </div>
        </div>

        {sim.flash > 0.01 && (
          <div className="flash" style={{ opacity: sim.flash }}>
            CORRECTION
          </div>
        )}
      </div>
    </section>
  );
}
