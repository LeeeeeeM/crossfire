import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { authMe, AUTH_TOKEN_STORAGE } from "../api";

type NetInput = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  aimX: number;
  aimY: number;
};

type Player = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  hp: number;
  dir: number;
  alive: boolean;
  respawnAt: number;
  cooldown: number;
  prevShoot: boolean;
  deaths: number;
};

type Bullet = {
  id: string;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
};

type Explosion = {
  x: number;
  y: number;
  born: number;
};

type Obstacle = { x: number; y: number; w: number; h: number };

type World = {
  width: number;
  height: number;
  obstacles: Obstacle[];
};

const VIEW_W = 980;
const VIEW_H = 620;
const VIEW_ASPECT = VIEW_W / VIEW_H;
const PLAYER_R = 14;
const MAX_HP = 90;
const MOVE_PER_FRAME = 5;
const DEFAULT_TICK_MS = 50;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a: number) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function circleRectHit(cx: number, cy: number, r: number, ob: Obstacle) {
  const nx = clamp(cx, ob.x, ob.x + ob.w);
  const ny = clamp(cy, ob.y, ob.y + ob.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function collisionAt(x: number, y: number, world: World) {
  if (x < PLAYER_R || y < PLAYER_R || x > world.width - PLAYER_R || y > world.height - PLAYER_R) return true;
  return world.obstacles.some((ob) => circleRectHit(x, y, PLAYER_R, ob));
}

export default function LockstepArenaPage() {
  const arenaWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<NetInput>({ up: false, down: false, left: false, right: false, shoot: false, aimX: 0, aimY: 0 });
  const playersRef = useRef<Map<string, Player>>(new Map());
  const bulletsRef = useRef<Bullet[]>([]);
  const explosionsRef = useRef<Explosion[]>([]);
  const worldRef = useRef<World>({ width: 2000, height: 1200, obstacles: [] });
  const selfIdRef = useRef<string>("");
  const localFrameRef = useRef(0);
  const canControlRef = useRef(true);
  const viewportRef = useRef({ w: VIEW_W, h: VIEW_H });
  const fpsCounterRef = useRef({ lastTs: 0, frames: 0 });
  const tickMsRef = useRef(DEFAULT_TICK_MS);
  const predictedSelfRef = useRef<{ x: number; y: number; dir: number; lastTs: number } | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("连接中...");
  const [serverFrame, setServerFrame] = useState(0);
  const [localFrame, setLocalFrame] = useState(0);
  const [queueLen, setQueueLen] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [fps, setFps] = useState(0);
  const [authChecking, setAuthChecking] = useState(true);
  const [authToken, setAuthToken] = useState("");
  const [authUser, setAuthUser] = useState<{ id: string; username: string } | null>(null);
  const [canControl, setCanControl] = useState(true);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      const wrap = arenaWrapRef.current;
      if (!canvas || !wrap) return;

      const availableW = Math.max(320, Math.floor(wrap.clientWidth - 20));
      const cssW = Math.min(VIEW_W, availableW);
      const cssH = Math.round(cssW / VIEW_ASPECT);
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      viewportRef.current = { w: cssW, h: cssH };
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE) || "";
    if (!token) {
      setAuthChecking(false);
      setStatus("未登录，请先注册/登录");
      return;
    }

    let cancelled = false;
    setAuthChecking(true);
    authMe(token)
      .then((ret) => {
        if (cancelled) return;
        setAuthToken(token);
        setAuthUser(ret.user);
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(AUTH_TOKEN_STORAGE);
        setAuthToken("");
        setAuthUser(null);
        setStatus("登录已失效，请重新登录");
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authUser || !authToken) return;

    setStatus(`连接中，账号: ${authUser.username}`);
    const ws = new WebSocket(`ws://localhost:8787/ws/lockstep?token=${encodeURIComponent(authToken)}`);
    wsRef.current = ws;

    const applyState = (msg: any) => {
      if (!Array.isArray(msg?.players)) return;

      if (msg.world && Array.isArray(msg.world.obstacles)) {
        worldRef.current = msg.world;
      }

      const next = new Map<string, Player>();
      for (const p of msg.players) {
        next.set(p.id, {
          id: p.id,
          name: p.name,
          color: p.color,
          x: Number(p.x || 0),
          y: Number(p.y || 0),
          hp: Number(p.hp ?? MAX_HP),
          dir: Number(p.dir || 0),
          alive: !!p.alive,
          respawnAt: Number(p.respawnAt || 0),
          cooldown: Number(p.cooldown || 0),
          prevShoot: !!p.prevShoot,
          deaths: Number(p.deaths || 0)
        });
      }

      playersRef.current = next;
      bulletsRef.current = Array.isArray(msg.bullets) ? msg.bullets : [];
      explosionsRef.current = Array.isArray(msg.explosions) ? msg.explosions : [];

      const f = Number(msg.frame || 0);
      localFrameRef.current = f;
      setLocalFrame(f);
      setServerFrame(f);
      setPlayerCount(next.size);
      setQueueLen(0);
      setLatencyMs(Math.max(0, Date.now() - Number(msg.serverTime || Date.now())));

      const self = next.get(selfIdRef.current);
      if (self) {
        const now = performance.now();
        const pred = predictedSelfRef.current;
        if (!pred) {
          predictedSelfRef.current = { x: self.x, y: self.y, dir: self.dir, lastTs: now };
        } else {
          const d = Math.hypot(pred.x - self.x, pred.y - self.y);
          if (!self.alive || d > 30) {
            pred.x = self.x;
            pred.y = self.y;
          } else {
            pred.x += (self.x - pred.x) * 0.35;
            pred.y += (self.y - pred.y) * 0.35;
          }
          pred.dir += normalizeAngle(self.dir - pred.dir) * 0.35;
          pred.lastTs = now;
        }
      }
    };

    ws.onopen = () => {
      setConnected(true);
      setStatus(`已连接，账号: ${authUser.username}`);
      ws.send(JSON.stringify({ type: "auth", playerKey: `u_${authUser.id}`, playerName: authUser.username }));
      tickMsRef.current = DEFAULT_TICK_MS;
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      setConnected(false);
      setStatus("连接关闭");
    };

    ws.onerror = () => {
      setStatus("连接错误");
    };

    ws.onmessage = (ev) => {
      let msg: any = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "reject") {
        setStatus(msg.reason === "room_full" ? "房间已满（最多 5 人）" : `连接被拒绝: ${msg.reason || "unknown"}`);
        return;
      }

      if (msg.type === "need_auth") {
        ws.send(JSON.stringify({ type: "auth", playerKey: `u_${authUser.id}`, playerName: authUser.username }));
        return;
      }

      if (msg.type === "welcome") {
        selfIdRef.current = msg.id;
        tickMsRef.current = Number(msg.tickMs || DEFAULT_TICK_MS);
        applyState(msg.snapshot);
        setStatus(`已加入，ID: ${msg.id}`);
        return;
      }

      if (msg.type === "snapshot" || msg.type === "state") {
        applyState(msg);
      }
    };

    return () => ws.close();
  }, [authToken, authUser]);

  useEffect(() => {
    const iv = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!canControlRef.current) return;
      ws.send(JSON.stringify({ type: "input", ...inputRef.current }));
    }, 33);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const updateControl = () => {
      const active = document.visibilityState === "visible" && document.hasFocus();
      canControlRef.current = active;
      setCanControl(active);

      if (!active) {
        inputRef.current.up = false;
        inputRef.current.down = false;
        inputRef.current.left = false;
        inputRef.current.right = false;
        inputRef.current.shoot = false;

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", ...inputRef.current }));
        }
      }
    };

    updateControl();
    window.addEventListener("focus", updateControl);
    window.addEventListener("blur", updateControl);
    document.addEventListener("visibilitychange", updateControl);

    return () => {
      window.removeEventListener("focus", updateControl);
      window.removeEventListener("blur", updateControl);
      document.removeEventListener("visibilitychange", updateControl);
    };
  }, []);

  useEffect(() => {
    let raf = 0;

    const render = () => {
      const nowTs = performance.now();
      const f = fpsCounterRef.current;
      f.frames += 1;
      if (!f.lastTs) f.lastTs = nowTs;
      if (nowTs - f.lastTs >= 500) {
        const nextFps = Math.round((f.frames * 1000) / (nowTs - f.lastTs));
        setFps(nextFps);
        f.frames = 0;
        f.lastTs = nowTs;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(render);
        return;
      }

      const world = worldRef.current;
      const players = playersRef.current;
      const bullets = bulletsRef.current;
      const explosions = explosionsRef.current;
      const self = players.get(selfIdRef.current);
      const predSelf = predictedSelfRef.current;
      const view = viewportRef.current;
      const sx = canvas.width / Math.max(view.w, 1);
      const sy = canvas.height / Math.max(view.h, 1);
      ctx.setTransform(sx, 0, 0, sy, 0, 0);

      if (predSelf && self && self.alive && canControlRef.current) {
        const now = performance.now();
        const dt = clamp(now - predSelf.lastTs, 0, tickMsRef.current);
        predSelf.lastTs = now;

        const speed = MOVE_PER_FRAME / Math.max(tickMsRef.current, 1);
        const input = inputRef.current;
        const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const len = Math.hypot(dx, dy) || 1;
        const stepX = (dx / len) * speed * dt;
        const stepY = (dy / len) * speed * dt;

        let nx = predSelf.x + stepX;
        let ny = predSelf.y;
        if (collisionAt(nx, ny, world)) nx = predSelf.x;
        ny = predSelf.y + stepY;
        if (collisionAt(nx, ny, world)) ny = predSelf.y;
        predSelf.x = nx;
        predSelf.y = ny;

        const angle = Math.atan2(input.aimY - predSelf.y, input.aimX - predSelf.x);
        if (Number.isFinite(angle)) predSelf.dir = angle;
      }

      const camCenterX = predSelf && self ? predSelf.x : self ? self.x : 0;
      const camCenterY = predSelf && self ? predSelf.y : self ? self.y : 0;
      const camX = self ? clamp(camCenterX - view.w / 2, 0, Math.max(0, world.width - view.w)) : 0;
      const camY = self ? clamp(camCenterY - view.h / 2, 0, Math.max(0, world.height - view.h)) : 0;

      const grad = ctx.createLinearGradient(0, 0, 0, view.h);
      grad.addColorStop(0, "#111b2d");
      grad.addColorStop(1, "#0a1322");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, view.w, view.h);

      ctx.save();
      ctx.translate(-camX, -camY);

      ctx.fillStyle = "#162238";
      ctx.fillRect(0, 0, world.width, world.height);

      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      for (let x = 0; x <= world.width; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, world.height);
        ctx.stroke();
      }
      for (let y = 0; y <= world.height; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(world.width, y);
        ctx.stroke();
      }

      for (const ob of world.obstacles) {
        ctx.fillStyle = "#2a3c57";
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.strokeStyle = "#486a99";
        ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
      }

      for (const b of bullets) {
        ctx.strokeStyle = "rgba(255,220,130,0.35)";
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 0.35, b.y - b.vy * 0.35);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        ctx.fillStyle = "#ffd56a";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const p of players.values()) {
        const isSelf = p.id === selfIdRef.current;
        const drawX = isSelf && predSelf ? predSelf.x : p.x;
        const drawY = isSelf && predSelf ? predSelf.y : p.y;
        const drawDir = isSelf && predSelf ? predSelf.dir : p.dir;
        const alpha = p.alive ? 1 : 0.3;
        ctx.globalAlpha = alpha;

        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(drawX, drawY + 10, 14, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(drawX, drawY, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(drawX, drawY);
        ctx.lineTo(drawX + Math.cos(drawDir) * 20, drawY + Math.sin(drawDir) * 20);
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.fillStyle = "#e7f0ff";
        ctx.font = "12px Menlo";
        ctx.fillText(p.name, drawX - 12, drawY - 20);

        if (p.alive) {
          const hpW = 28;
          ctx.fillStyle = "#4b1d1d";
          ctx.fillRect(drawX - hpW / 2, drawY - 28, hpW, 4);
          ctx.fillStyle = "#62d266";
          ctx.fillRect(drawX - hpW / 2, drawY - 28, (hpW * p.hp) / MAX_HP, 4);
        } else {
          const remain = Math.max(0, p.respawnAt - localFrameRef.current);
          ctx.fillStyle = "#ffd28f";
          ctx.fillText(`Respawn ${(remain / 20).toFixed(1)}s`, drawX - 34, drawY - 28);
        }
      }

      for (const e of explosions) {
        const age = localFrameRef.current - e.born;
        const t = clamp(age / 15, 0, 1);
        const r = 6 + 22 * t;
        ctx.strokeStyle = `rgba(255, 166, 95, ${1 - t})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "w" || e.key === "W") inputRef.current.up = true;
      if (e.key === "s" || e.key === "S") inputRef.current.down = true;
      if (e.key === "a" || e.key === "A") inputRef.current.left = true;
      if (e.key === "d" || e.key === "D") inputRef.current.right = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "w" || e.key === "W") inputRef.current.up = false;
      if (e.key === "s" || e.key === "S") inputRef.current.down = false;
      if (e.key === "a" || e.key === "A") inputRef.current.left = false;
      if (e.key === "d" || e.key === "D") inputRef.current.right = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const onMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const view = viewportRef.current;
    const scaleX = view.w / Math.max(rect.width, 1);
    const scaleY = view.h / Math.max(rect.height, 1);
    const sx = (e.clientX - rect.left) * scaleX;
    const sy = (e.clientY - rect.top) * scaleY;

    const self = playersRef.current.get(selfIdRef.current);
    const predSelf = predictedSelfRef.current;
    const world = worldRef.current;
    const centerX = predSelf && self ? predSelf.x : self ? self.x : 0;
    const centerY = predSelf && self ? predSelf.y : self ? self.y : 0;
    const camX = self ? clamp(centerX - view.w / 2, 0, Math.max(0, world.width - view.w)) : 0;
    const camY = self ? clamp(centerY - view.h / 2, 0, Math.max(0, world.height - view.h)) : 0;

    inputRef.current.aimX = sx + camX;
    inputRef.current.aimY = sy + camY;
  };

  const kd = playersRef.current.get(selfIdRef.current);
  const logout = () => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE);
    setAuthToken("");
    setAuthUser(null);
    setConnected(false);
    setStatus("已退出登录");
  };

  const statRows = useMemo(() => {
    return Array.from(playersRef.current.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => ({
        id: p.id,
        hp: p.hp,
        alive: p.alive,
        deaths: p.deaths,
        me: p.id === selfIdRef.current
      }));
  }, [playerCount, localFrame]);

  return (
    <section>
      <h1>WebSocket 帧同步实验场（最多 5 人）</h1>
      <p className="muted">已切换为账号身份模式。现在由服务端权威模拟位置/子弹/血量，刷新页面会立刻追上同一份状态。WASD 移动，鼠标瞄准，按住左键发射飞行弹丸。</p>

      <div className="card identity-controls">
        <div className="identity-meta">
          <span className="muted">当前账号</span>
          <code>{authUser ? `${authUser.username} (u_${authUser.id})` : "未登录"}</code>
        </div>
        <div className="identity-actions">
          {authUser ? (
            <button type="button" onClick={logout}>退出登录</button>
          ) : (
            <Link className="auth-link-btn" to="/auth">去登录 / 注册</Link>
          )}
        </div>
      </div>

      {!authUser && !authChecking && (
        <div className="card">
          <p className="error">当前未登录，无法加入对战房间。请先到账号页登录。</p>
        </div>
      )}

      <div ref={arenaWrapRef} className="card arena-wrap">
        <canvas
          ref={canvasRef}
          width={VIEW_W}
          height={VIEW_H}
          className="arena-canvas"
          onMouseMove={onMouseMove}
          onMouseDown={() => { inputRef.current.shoot = true; }}
          onMouseUp={() => { inputRef.current.shoot = false; }}
          onMouseLeave={() => { inputRef.current.shoot = false; }}
        />
      </div>

      <div className="card">
        <h3>调试面板</h3>
        <div className="grid2">
          <div className="kpi"><span>连接状态</span><strong>{status}</strong></div>
          <div className="kpi"><span>玩家数量</span><strong>{playerCount}/5</strong></div>
          <div className="kpi"><span>本地帧</span><strong>{localFrame}</strong></div>
          <div className="kpi"><span>服务端帧</span><strong>{serverFrame}</strong></div>
          <div className="kpi"><span>帧队列长度</span><strong>{queueLen}</strong></div>
          <div className="kpi"><span>估算网络延迟</span><strong>{latencyMs}ms</strong></div>
          <div className="kpi"><span>渲染 FPS</span><strong>{fps}</strong></div>
          <div className="kpi"><span>输入控制权</span><strong>{canControl ? "激活页面（可操作）" : "非激活页面（观战）"}</strong></div>
        </div>

        <table className="score-table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>状态</th>
              <th>HP</th>
              <th>死亡</th>
            </tr>
          </thead>
          <tbody>
            {statRows.map((r) => (
              <tr key={r.id} className={r.me ? "me" : ""}>
                <td>{r.id}</td>
                <td>{r.alive ? "Alive" : "Respawn"}</td>
                <td>{r.hp}</td>
                <td>{r.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!connected && authUser && <p className="error">WebSocket 未连接，请确认后端已运行。</p>}
        {connected && playerCount >= 5 && !kd && <p className="error">房间已满，当前窗口是观战状态。</p>}
      </div>
    </section>
  );
}
