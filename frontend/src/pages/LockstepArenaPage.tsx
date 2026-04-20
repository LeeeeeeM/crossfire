import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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
  lastProcessedInputSeq: number;
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

type RoomMeta = {
  id: string;
  ownerKey: string;
  status: "idle" | "waiting" | "started";
  playerCount: number;
  maxPlayers: number;
};

const VIEW_W = 980;
const VIEW_H = 620;
const VIEW_ASPECT = VIEW_W / VIEW_H;
const PLAYER_R = 14;
const MAX_HP = 90;
const MOVE_PER_FRAME = 5;
const DEFAULT_TICK_MS = 50;
const MAX_PENDING_INPUTS = 200;

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

function parseRoom(raw: any): RoomMeta | null {
  if (!raw?.room || !raw.room.id) return null;
  return {
    id: String(raw.room.id),
    ownerKey: String(raw.room.ownerKey || ""),
    status: raw.room.status === "started" ? "started" : raw.room.status === "waiting" ? "waiting" : "idle",
    playerCount: Number(raw.room.playerCount || 0),
    maxPlayers: Number(raw.room.maxPlayers || 5)
  };
}

export default function LockstepArenaPage() {
  const navigate = useNavigate();

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
  const inputSeqRef = useRef(0);
  const pendingInputsRef = useRef<Array<{ seq: number; input: NetInput }>>([]);
  const aimInitializedRef = useRef(false);
  const roomMetaRef = useRef<RoomMeta | null>(null);

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
  const [roomList, setRoomList] = useState<RoomMeta[]>([]);
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const [countdown, setCountdown] = useState<number>(0);

  const debugEnabled = useMemo(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("debug");
      if (!v) return false;
      return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "on";
    } catch {
      return false;
    }
  }, []);

  const clearLocalRoomState = () => {
    playersRef.current = new Map();
    bulletsRef.current = [];
    explosionsRef.current = [];
    selfIdRef.current = "";
    predictedSelfRef.current = null;
    pendingInputsRef.current = [];
    inputSeqRef.current = 0;
    aimInitializedRef.current = false;
    inputRef.current = { up: false, down: false, left: false, right: false, shoot: false, aimX: 0, aimY: 0 };
    setPlayerCount(0);
    setQueueLen(0);
    setLatencyMs(0);
    setServerFrame(0);
    setLocalFrame(0);
  };

  const inRoom = !!selfIdRef.current && playersRef.current.has(selfIdRef.current);
  const inWaitingRoom = inRoom && roomMeta?.status === "waiting";
  const inStartedRoom = inRoom && roomMeta?.status === "started";
  const isOwner = !!roomMeta && roomMeta.ownerKey === selfIdRef.current;
  const canStartGame = !!roomMeta && roomMeta.status === "waiting" && isOwner && roomMeta.playerCount >= 1;
  const showGame = inStartedRoom;

  const sendWs = (payload: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  const queueAndSendInput = () => {
    if (!showGame || countdown > 0) return;
    if (!selfIdRef.current || !playersRef.current.has(selfIdRef.current)) return;

    const liveWs = wsRef.current;
    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) return;

    const seq = ++inputSeqRef.current;
    const input: NetInput = { ...inputRef.current };
    pendingInputsRef.current.push({ seq, input });
    if (pendingInputsRef.current.length > MAX_PENDING_INPUTS) {
      pendingInputsRef.current.splice(0, pendingInputsRef.current.length - MAX_PENDING_INPUTS);
    }
    setQueueLen(pendingInputsRef.current.length);
    liveWs.send(JSON.stringify({ type: "input", seq, ...input }));
  };

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
      setAuthToken("");
      setAuthUser(null);
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

    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${wsProto}://${window.location.host}/ws/lockstep?token=${encodeURIComponent(authToken)}`);
    wsRef.current = ws;
    setStatus(`连接中，账号: ${authUser.username}`);

    const updateRoomMeta = (next: RoomMeta | null) => {
      roomMetaRef.current = next;
      setRoomMeta(next);
      setRoomList(next ? [next] : []);
    };

    const applyState = (msg: any) => {
      if (!Array.isArray(msg?.players)) return;

      const nextRoom = parseRoom(msg);
      updateRoomMeta(nextRoom);

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
          deaths: Number(p.deaths || 0),
          lastProcessedInputSeq: Number(p.lastProcessedInputSeq || 0)
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
      setLatencyMs(Math.max(0, Date.now() - Number(msg.serverTime || Date.now())));

      const self = next.get(selfIdRef.current);
      if (self) {
        if (!aimInitializedRef.current) {
          inputRef.current.aimX = self.x + Math.cos(self.dir) * 120;
          inputRef.current.aimY = self.y + Math.sin(self.dir) * 120;
          aimInitializedRef.current = true;
        }

        const ackSeq = self.lastProcessedInputSeq || 0;
        inputSeqRef.current = Math.max(inputSeqRef.current, ackSeq);
        pendingInputsRef.current = pendingInputsRef.current.filter((item) => item.seq > ackSeq);

        const now = performance.now();
        const pred = predictedSelfRef.current;
        if (!pred) {
          predictedSelfRef.current = { x: self.x, y: self.y, dir: self.dir, lastTs: now };
        } else {
          const d = Math.hypot(pred.x - self.x, pred.y - self.y);
          if (!self.alive || d > 80) {
            pred.x = self.x;
            pred.y = self.y;
          } else {
            pred.x += (self.x - pred.x) * 0.2;
            pred.y += (self.y - pred.y) * 0.2;
          }
          pred.dir += normalizeAngle(self.dir - pred.dir) * 0.25;
          pred.lastTs = now;
        }

        setQueueLen(pendingInputsRef.current.length);
      } else {
        pendingInputsRef.current = [];
        predictedSelfRef.current = null;
        aimInitializedRef.current = false;
        setQueueLen(0);
      }

      if (msg.reason === "game_started") {
        setCountdown(3);
      }
    };

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "auth", playerKey: `u_${authUser.id}`, playerName: authUser.username }));
      tickMsRef.current = DEFAULT_TICK_MS;
      inputSeqRef.current = 0;
      pendingInputsRef.current = [];
      predictedSelfRef.current = null;
      setQueueLen(0);
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
        const reasonMap: Record<string, string> = {
          room_full: "房间已满（最多 5 人）",
          room_exists: "已有房间，请加入当前房间",
          room_not_found: "房间不存在",
          not_owner: "只有房主可以开始",
          already_started: "游戏已开始",
          already_in_room: "你已在房间中"
        };
        setStatus(reasonMap[msg.reason] || `请求被拒绝: ${msg.reason || "unknown"}`);
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
        const started = msg?.snapshot?.room?.status === "started";
        setStatus(started ? "游戏开始" : "已加入房间，等待开始");
        return;
      }

      if (msg.type === "lobby_state") {
        const nextRoom = parseRoom(msg);
        updateRoomMeta(nextRoom);
        const currentlyInRoom = !!selfIdRef.current && playersRef.current.has(selfIdRef.current);
        const sameRoom = !!nextRoom && !!roomMetaRef.current && nextRoom.id === roomMetaRef.current.id;
        if (!currentlyInRoom || !sameRoom) {
          clearLocalRoomState();
          setStatus(nextRoom ? `大厅：房间 ${nextRoom.id} (${nextRoom.playerCount}/${nextRoom.maxPlayers})` : "大厅：暂无房间");
        }
        return;
      }

      if (msg.type === "snapshot" || msg.type === "state") {
        applyState(msg);
      }
    };

    return () => ws.close();
  }, [authToken, authUser]);

  useEffect(() => {
    if (countdown <= 0) return;
    const iv = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [countdown]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (!canControlRef.current) return;
      queueAndSendInput();
    }, 50);
    return () => clearInterval(iv);
  }, [countdown, showGame]);

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
        if (showGame) queueAndSendInput();
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
  }, [showGame]);

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

      if (predSelf && self && self.alive && canControlRef.current && showGame && countdown === 0) {
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
        const isSelfPlayer = p.id === selfIdRef.current;
        const drawX = isSelfPlayer && predSelf ? predSelf.x : p.x;
        const drawY = isSelfPlayer && predSelf ? predSelf.y : p.y;
        const drawDir = isSelfPlayer && predSelf ? predSelf.dir : p.dir;
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
        ctx.lineTo(drawX + Math.cos(normalizeAngle(drawDir)) * 20, drawY + Math.sin(normalizeAngle(drawDir)) * 20);
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
  }, [countdown, showGame]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!authUser || !showGame || countdown > 0) return;
      if (e.key === "w" || e.key === "W") inputRef.current.up = true;
      if (e.key === "s" || e.key === "S") inputRef.current.down = true;
      if (e.key === "a" || e.key === "A") inputRef.current.left = true;
      if (e.key === "d" || e.key === "D") inputRef.current.right = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!authUser || !showGame) return;
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
  }, [authUser, countdown, showGame]);

  const onMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (!showGame || !authUser || !selfIdRef.current || !playersRef.current.has(selfIdRef.current)) return;

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

  const createRoom = () => {
    if (!sendWs({ type: "create_room" })) return;
    setStatus("正在创建房间...");
  };

  const joinRoom = (id: string) => {
    if (!sendWs({ type: "join_room", roomId: id })) return;
    setStatus(`正在加入房间 ${id}...`);
  };

  const startGame = () => {
    if (!sendWs({ type: "start_game" })) return;
    setStatus("房主正在开始游戏...");
  };

  const leaveRoom = () => {
    if (!sendWs({ type: "leave" })) return;
    clearLocalRoomState();
    setStatus("已退出游戏，回到大厅");
  };

  const logout = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    wsRef.current = null;
    localStorage.removeItem(AUTH_TOKEN_STORAGE);
    setAuthToken("");
    setAuthUser(null);
    setConnected(false);
    setRoomList([]);
    roomMetaRef.current = null;
    setRoomMeta(null);
    clearLocalRoomState();
    navigate("/auth", { replace: true });
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

  if (authChecking) {
    return (
      <section className="shooter-page">
        <h1>WS Arena</h1>
        <p className="muted">身份校验中…准备进入战区。</p>
      </section>
    );
  }

  if (!authUser) return <Navigate to="/auth" replace />;

  return (
    <section className={`shooter-page ${showGame ? "mode-game" : inWaitingRoom ? "mode-room" : "mode-lobby"}`}>
      {!showGame && !inWaitingRoom && (
        <>
          <div className="page-hero">
            <h1>战区大厅</h1>
            <p className="muted">挑个房间落地。房主一键开局，所有人同步起跑。</p>
          </div>

          <div className="card identity-controls">
            <div className="identity-meta">
              <span className="muted">当前账号</span>
              <code>{`${authUser.username} (u_${authUser.id})`}</code>
            </div>
            <div className="identity-actions">
              <button type="button" onClick={logout} className="btn-danger">撤离</button>
            </div>
          </div>

          <div className="card room-list-card">
            <div className="identity-controls">
              <h3>房间列表</h3>
              {!roomMeta && <button type="button" onClick={createRoom} className="btn-secondary">创建战局</button>}
            </div>

            {roomList.length === 0 && <p className="muted">战区空闲。创建一局，把他们拉进来。</p>}

            {roomList.map((r) => {
              const joined = inRoom && roomMeta?.id === r.id;
              const canJoin = !joined && r.playerCount < r.maxPlayers;
              return (
                <div key={r.id} className="room-row">
                  <div>
                    <strong>房间 {r.id}</strong>
                    <div className="muted">状态 {r.status} · 人数 {r.playerCount}/{r.maxPlayers}</div>
                  </div>
                  <div className="identity-actions">
                    {canJoin && <button type="button" onClick={() => joinRoom(r.id)} className="btn-secondary">加入</button>}
                    {joined && <button type="button" onClick={leaveRoom} className="btn-danger">撤离</button>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="kpi"><span>连接状态</span><strong>{connected ? "已连接" : "未连接"}</strong></div>
            <p className="muted">{status}</p>
          </div>
        </>
      )}

      {!showGame && inWaitingRoom && (
        <>
          <div className="page-hero">
            <h1>战局准备</h1>
            <p className="muted">队友入场中。房主确认后开局。</p>
          </div>

          <div className="card identity-controls">
            <div className="identity-meta">
              <span className="muted">房间号</span>
              <code>{roomMeta?.id}</code>
            </div>
            <div className="identity-actions">
              {isOwner && <button type="button" onClick={startGame} disabled={!canStartGame} className="btn-secondary">开局</button>}
              <button type="button" onClick={leaveRoom} className="btn-danger">撤离</button>
            </div>
          </div>

          {!isOwner && <div className="card waiting-card"><p className="muted">等待房主开局…保持警惕。</p></div>}

          <div className="card">
            <h3>小队成员</h3>
            <table className="score-table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>身份</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((r) => (
                  <tr key={r.id} className={r.me ? "me" : ""}>
                    <td>{r.id}</td>
                    <td>{roomMeta?.ownerKey === r.id ? "房主" : "队员"}</td>
                    <td>待命</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showGame && (
        <>
          <div className="hud-row">
            <div className="hud-pills" aria-label="实时状态">
              <span className="pill"><span className="muted">房间</span><strong>{roomMeta?.id || "-"}</strong></span>
              <span className="pill"><span className="muted">玩家</span><strong>{playerCount}/{roomMeta?.maxPlayers || 5}</strong></span>
              <span className="pill"><span className="muted">延迟</span><strong>{latencyMs}ms</strong></span>
              <span className="pill"><span className="muted">FPS</span><strong>{fps}</strong></span>
            </div>
            <div>
              <button type="button" onClick={leaveRoom} className="btn-danger">撤离</button>
            </div>
          </div>

          <div className="game-stage">
            <div ref={arenaWrapRef} className="card arena-wrap game-canvas-wrap">
              <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                className="arena-canvas"
                tabIndex={0}
                aria-label="对战画布（WASD 移动，鼠标瞄准/射击）"
                onMouseMove={onMouseMove}
                onMouseDown={() => {
                  if (countdown === 0) inputRef.current.shoot = true;
                }}
                onMouseUp={() => {
                  inputRef.current.shoot = false;
                }}
                onMouseLeave={() => {
                  inputRef.current.shoot = false;
                }}
              />
              {countdown > 0 && <div className="countdown-overlay">{countdown}</div>}
            </div>

            <aside className="card scoreboard-card" aria-label="计分板">
              <h3>计分板</h3>
              <table className="score-table compact">
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
            </aside>
          </div>

          {debugEnabled && (
            <div className="card">
              <h3>战术面板</h3>
              <div className="grid2">
                <div className="kpi"><span>链路</span><strong>{status}</strong></div>
                <div className="kpi"><span>在场</span><strong>{playerCount}/{roomMeta?.maxPlayers || 5}</strong></div>
                <div className="kpi"><span>本地帧</span><strong>{localFrame}</strong></div>
                <div className="kpi"><span>服务端帧</span><strong>{serverFrame}</strong></div>
                <div className="kpi"><span>输入队列</span><strong>{queueLen}</strong></div>
                <div className="kpi"><span>延迟估算</span><strong>{latencyMs}ms</strong></div>
                <div className="kpi"><span>渲染</span><strong>{fps} FPS</strong></div>
                <div className="kpi"><span>控制权</span><strong>{canControl ? "在线" : "挂起"}</strong></div>
              </div>

              <p className="muted">提示：计分板已常驻在右侧。此处保留给帧与输入调试。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
