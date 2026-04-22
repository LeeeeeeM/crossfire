import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { authMe, AUTH_TOKEN_STORAGE, lockstepWsUrl } from "../api";
import { useSystemAnnouncer } from "../components/SystemAnnouncer";
import {
  isWsServerMessage,
  WS_CLIENT_MSG,
  WS_ITEM_SECTION,
  WS_REJECT_REASON,
  WS_ROOM_EVENT,
  WS_ROOM_STATUS,
  WS_SERVER_MSG,
  type WsClientInputMessage,
  type WsClientMessage,
  type WsServerLobbyStateMessage,
  type WsServerMessage,
  type WsItemSection,
  type WsStateMessage
} from "../../../shared/ws-protocol";
import { ITEM, isAmmoItemType, isArmorItemType, isBootsItemType, isGunItemType } from "../../../shared/items";
import {
  DEFAULT_BULLET_SPAWN_OFFSET,
  DEFAULT_EXPLOSION_FX_FRAMES,
  DEFAULT_RELOAD_DURATION_FRAMES,
  DEFAULT_ROOM_MAX_PLAYERS,
  DEFAULT_TICK_MS,
  DEFAULT_WORLD_HEIGHT,
  DEFAULT_WORLD_WIDTH,
  ITEM_SLOT_SIZE,
  MAX_HP,
  MAX_PENDING_INPUTS,
  MOVE_PER_FRAME,
  PLAYER_R,
  VIEW_ASPECT,
  VIEW_H,
  VIEW_W,
  WEAPON_SLOT_SIZE,
  clamp,
  collisionAt,
  drawKnifeArcFx,
  drawReloadRing,
  itemLabel,
  normalizeAngle,
  parseRoom,
  parseRooms,
  type Bullet,
  type Drop,
  type Explosion,
  type KnifeArcFx,
  type NetInput,
  type Player,
  type RoomMeta,
  type World
} from "./arena/shared";

function sameRoomMeta(a: RoomMeta | null, b: RoomMeta | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.ownerKey === b.ownerKey && a.status === b.status && a.playerCount === b.playerCount && a.maxPlayers === b.maxPlayers;
}

const INPUT_MAX_SEND_HZ = 15;
const INPUT_MIN_SEND_INTERVAL_MS = Math.round(1000 / INPUT_MAX_SEND_HZ);

export default function LockstepArenaPage() {
  const navigate = useNavigate();
  const { announce, registerAnnounceAnchor } = useSystemAnnouncer();

  const arenaWrapRef = useRef<HTMLDivElement | null>(null);
  const announceAnchorRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<NetInput>({
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    reload: false,
    aimX: 0,
    aimY: 0,
    slot: 0
  });
  // 存储鼠标在视口上的位置(0-1范围)，用于在玩家移动时重新计算aimX/aimY
  const mouseViewportRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const playersRef = useRef<Map<string, Player>>(new Map());
  const bulletsRef = useRef<Bullet[]>([]);
  const explosionsRef = useRef<Explosion[]>([]);
  const knifeArcsRef = useRef<KnifeArcFx[]>([]);
  const dropsRef = useRef<Drop[]>([]);
  const worldRef = useRef<World>({
    width: DEFAULT_WORLD_WIDTH,
    height: DEFAULT_WORLD_HEIGHT,
    obstacles: [],
    reloadDurationFrames: DEFAULT_RELOAD_DURATION_FRAMES,
    explosionFxFrames: DEFAULT_EXPLOSION_FX_FRAMES,
    bulletSpawnOffset: DEFAULT_BULLET_SPAWN_OFFSET
  });
  const selfIdRef = useRef<string>("");
  const localFrameRef = useRef(0);
  const canControlRef = useRef(true);
  const viewportRef = useRef({ w: VIEW_W, h: VIEW_H });
  const fpsCounterRef = useRef({ lastTs: 0, frames: 0 });
  const tickMsRef = useRef(DEFAULT_TICK_MS);
  const predictedSelfRef = useRef<{ x: number; y: number; dir: number; lastTs: number } | null>(null);
  const inputSeqRef = useRef(0);
  const pendingInputsRef = useRef<Array<{ seq: number; input: NetInput }>>([]);
  const lastSentInputSigRef = useRef("");
  const lastSentInputAtRef = useRef(0);
  const pendingInputRef = useRef<NetInput | null>(null);
  const pendingInputSigRef = useRef("");
  const pendingInputTimerRef = useRef(0);
  const aimInitializedRef = useRef(false);
  const roomMetaRef = useRef<RoomMeta | null>(null);
  const selfInvSigRef = useRef("");
  const lastLatencyUpdateAtRef = useRef(0);

  /** 递增以在「同一帧人数不变」时仍能刷新背包 UI（playersRef 变了但 playerCount 可能不变） */
  const [invTick, setInvTick] = useState(0);

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
  const [selectedWeaponIdx, setSelectedWeaponIdx] = useState<number>(0);
  const selectedWeaponIdxRef = useRef(0);
  const [selectedItemIdx, setSelectedItemIdx] = useState<number>(0);
  const [activeSection, setActiveSection] = useState<WsItemSection>(WS_ITEM_SECTION.weapon);
  useEffect(() => {
    selectedWeaponIdxRef.current = selectedWeaponIdx;
    inputRef.current.slot = selectedWeaponIdx;
  }, [selectedWeaponIdx]);

  const lastNoAmmoHintAtRef = useRef(0);

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
    knifeArcsRef.current = [];
    selfIdRef.current = "";
    predictedSelfRef.current = null;
    pendingInputsRef.current = [];
    inputSeqRef.current = 0;
    lastSentInputSigRef.current = "";
    lastSentInputAtRef.current = 0;
    pendingInputRef.current = null;
    pendingInputSigRef.current = "";
    if (pendingInputTimerRef.current) {
      window.clearTimeout(pendingInputTimerRef.current);
      pendingInputTimerRef.current = 0;
    }
    aimInitializedRef.current = false;
    selfInvSigRef.current = "";
    lastLatencyUpdateAtRef.current = 0;
    inputRef.current = { up: false, down: false, left: false, right: false, shoot: false, reload: false, aimX: 0, aimY: 0, slot: 0 };
    setPlayerCount(0);
    setQueueLen(0);
    setLatencyMs(0);
    setServerFrame(0);
    setLocalFrame(0);
    setInvTick((t) => t + 1);
    setSelectedWeaponIdx(0);
    setSelectedItemIdx(0);
    setActiveSection(WS_ITEM_SECTION.weapon);
  };

  const inRoom = !!selfIdRef.current && playersRef.current.has(selfIdRef.current);
  const inWaitingRoom = inRoom && roomMeta?.status === WS_ROOM_STATUS.waiting;
  const inStartedRoom = inRoom && roomMeta?.status === WS_ROOM_STATUS.started;
  const isOwner = !!roomMeta && roomMeta.ownerKey === selfIdRef.current;
  const canStartGame = !!roomMeta && roomMeta.status === WS_ROOM_STATUS.waiting && isOwner && roomMeta.playerCount >= 1;
  const showGame = inStartedRoom;

  useLayoutEffect(() => {
    if (!showGame) {
      registerAnnounceAnchor(null);
      return;
    }
    registerAnnounceAnchor(announceAnchorRef.current);
    return () => registerAnnounceAnchor(null);
  }, [showGame, registerAnnounceAnchor]);

  const sendWs = (payload: WsClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  const queueAndSendInput = useCallback(
    (immediate = false) => {
      if (!showGame || countdown > 0) return;
      if (!selfIdRef.current || !playersRef.current.has(selfIdRef.current)) return;

      const liveWs = wsRef.current;
      if (!liveWs || liveWs.readyState !== WebSocket.OPEN) return;

      // 根据当前相机位置和鼠标视口位置重新计算 aimX/aimY
      const self = playersRef.current.get(selfIdRef.current);
      const predSelf = predictedSelfRef.current;
      const world = worldRef.current;
      const view = viewportRef.current;
      const centerX = predSelf && self ? predSelf.x : self ? self.x : 0;
      const centerY = predSelf && self ? predSelf.y : self ? self.y : 0;
      const camX = self ? clamp(centerX - view.w / 2, 0, Math.max(0, world.width - view.w)) : 0;
      const camY = self ? clamp(centerY - view.h / 2, 0, Math.max(0, world.height - view.h)) : 0;
      const mouseVp = mouseViewportRef.current;
      inputRef.current.aimX = camX + mouseVp.x * view.w;
      inputRef.current.aimY = camY + mouseVp.y * view.h;

      const input: NetInput = { ...inputRef.current, slot: selectedWeaponIdxRef.current };
      const sig = JSON.stringify(input);
      const now = performance.now();
      const elapsed = now - lastSentInputAtRef.current;

      const flush = (next: NetInput, nextSig: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const seq = ++inputSeqRef.current;
        pendingInputsRef.current.push({ seq, input: next });
        if (pendingInputsRef.current.length > MAX_PENDING_INPUTS) {
          pendingInputsRef.current.splice(0, pendingInputsRef.current.length - MAX_PENDING_INPUTS);
        }
        setQueueLen(pendingInputsRef.current.length);
        const payload: WsClientInputMessage = { type: WS_CLIENT_MSG.input, seq, ...next };
        ws.send(JSON.stringify(payload));
        lastSentInputAtRef.current = performance.now();
        lastSentInputSigRef.current = nextSig;
      };

      const schedulePending = (delayMs: number) => {
        if (pendingInputTimerRef.current) window.clearTimeout(pendingInputTimerRef.current);
        pendingInputTimerRef.current = window.setTimeout(() => {
          pendingInputTimerRef.current = 0;
          const queued = pendingInputRef.current;
          const queuedSig = pendingInputSigRef.current;
          if (!queued || !queuedSig) return;
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const waited = performance.now() - lastSentInputAtRef.current;
          if (waited < INPUT_MIN_SEND_INTERVAL_MS) {
            schedulePending(INPUT_MIN_SEND_INTERVAL_MS - waited);
            return;
          }
          pendingInputRef.current = null;
          pendingInputSigRef.current = "";
          flush(queued, queuedSig);
        }, Math.max(0, delayMs));
      };

      if (sig === lastSentInputSigRef.current) return;
      if (elapsed >= INPUT_MIN_SEND_INTERVAL_MS && immediate) {
        pendingInputRef.current = null;
        pendingInputSigRef.current = "";
        if (pendingInputTimerRef.current) {
          window.clearTimeout(pendingInputTimerRef.current);
          pendingInputTimerRef.current = 0;
        }
        flush(input, sig);
        return;
      }

      if (elapsed >= INPUT_MIN_SEND_INTERVAL_MS && !immediate) {
        flush(input, sig);
        return;
      }

      pendingInputRef.current = input;
      pendingInputSigRef.current = sig;
      schedulePending(INPUT_MIN_SEND_INTERVAL_MS - elapsed);
    },
    [showGame, countdown]
  );

  /** 枪械使用格内备弹数；弹尽时提示（节流） */
  const warnIfGunDryFire = useCallback(() => {
    const now = Date.now();
    if (now - lastNoAmmoHintAtRef.current < 1800) return;
    const me = playersRef.current.get(selfIdRef.current);
    if (!me?.weapons) return;
    const slot = me.weapons[selectedWeaponIdxRef.current];
    const t = slot?.t;
    if (!t || !isGunItemType(t)) return;
    const rounds = slot?.q ?? 0;
    if (rounds > 0) return;
    lastNoAmmoHintAtRef.current = now;
    announce({
      title: "无法开火",
      subtitle: "弹匣已空，按 R 换弹或拾取对应弹药",
      tone: "bad",
      durationMs: 2200
    });
  }, [announce]);

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

    const ws = new WebSocket(lockstepWsUrl(authToken));
    wsRef.current = ws;
    setStatus(`连接中，账号: ${authUser.username}`);

    const updateLobby = (msg: WsServerLobbyStateMessage) => {
      const rooms = parseRooms(msg);
      setRoomList(rooms);

      const nextRoom = parseRoom(msg);
      if (!sameRoomMeta(roomMetaRef.current, nextRoom)) {
        roomMetaRef.current = nextRoom;
        setRoomMeta(nextRoom);
      }

      return { rooms, nextRoom };
    };

    const applyState = (msg: WsStateMessage) => {

      const nextRoom = parseRoom(msg);
      if (!sameRoomMeta(roomMetaRef.current, nextRoom)) {
        roomMetaRef.current = nextRoom;
        setRoomMeta(nextRoom);
      }

      if (msg.world && Array.isArray(msg.world.obstacles)) {
        const w = msg.world as World;
        worldRef.current = {
          width: Number(w.width || 0),
          height: Number(w.height || 0),
          obstacles: w.obstacles,
          reloadDurationFrames: Number(w.reloadDurationFrames ?? DEFAULT_RELOAD_DURATION_FRAMES),
          explosionFxFrames: Number(w.explosionFxFrames ?? DEFAULT_EXPLOSION_FX_FRAMES),
          bulletSpawnOffset: Number(w.bulletSpawnOffset ?? DEFAULT_BULLET_SPAWN_OFFSET)
        };
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
          lastProcessedInputSeq: Number(p.lastProcessedInputSeq || 0),
          weapons: Array.isArray(p.weapons)
            ? (p.weapons as Array<{ t?: string; q?: number } | null>).map((slot) =>
                slot && slot.t ? { t: String(slot.t), q: Number(slot.q ?? 1) } : null
              )
            : undefined,
          items: Array.isArray(p.items)
            ? (p.items as Array<{ t?: string; q?: number } | null>).map((slot) =>
                slot && slot.t ? { t: String(slot.t), q: Number(slot.q ?? 1) } : null
              )
            : undefined,
          reloadEndFrame: Number(p.reloadEndFrame || 0),
          reloadStartFrame: Number(p.reloadStartFrame || 0),
          reloadSlotIdx: Number(p.reloadSlotIdx ?? -1)
        });
      }

      playersRef.current = next;
      bulletsRef.current = Array.isArray(msg.bullets) ? msg.bullets : [];
      explosionsRef.current = Array.isArray(msg.explosions) ? msg.explosions : [];
      knifeArcsRef.current = Array.isArray(msg.knifeArcs)
        ? (msg.knifeArcs as KnifeArcFx[]).map((k) => ({
            x: Number(k.x || 0),
            y: Number(k.y || 0),
            dir: Number(k.dir || 0),
            born: Number(k.born || 0)
          }))
        : [];
      dropsRef.current = Array.isArray(msg.drops) ? msg.drops : [];

      const f = Number(msg.frame || 0);
      localFrameRef.current = f;
      setLocalFrame(f);
      setServerFrame(f);
      setPlayerCount(next.size);
      const nowMs = Date.now();
      const latency = Math.max(0, nowMs - Number(msg.serverTime || nowMs));
      if (nowMs - lastLatencyUpdateAtRef.current >= 200) {
        setLatencyMs(latency);
        lastLatencyUpdateAtRef.current = nowMs;
      }

      const self = next.get(selfIdRef.current);
      if (self) {
        const invSig = JSON.stringify(self.weapons || []) + "|" + JSON.stringify(self.items || []);
        if (invSig !== selfInvSigRef.current) {
          selfInvSigRef.current = invSig;
          setInvTick((t) => t + 1);
        }
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
        selfInvSigRef.current = "";
        setQueueLen(0);
      }

      if (msg.reason === WS_ROOM_EVENT.gameStarted) {
        setCountdown(3);
      }

      if (msg.reason === WS_ROOM_EVENT.dropWave) {
        announce({ title: "空投已抵达", subtitle: "附近有新物资", tone: "info", durationMs: 1400 });
      }
    };

    ws.onopen = () => {
      setConnected(true);
      const authPayload: WsClientMessage = {
        type: WS_CLIENT_MSG.auth,
        playerKey: `u_${authUser.id}`,
        playerName: authUser.username
      };
      ws.send(JSON.stringify(authPayload));
      tickMsRef.current = DEFAULT_TICK_MS;
      inputSeqRef.current = 0;
      pendingInputsRef.current = [];
      lastSentInputSigRef.current = "";
      lastSentInputAtRef.current = 0;
      pendingInputRef.current = null;
      pendingInputSigRef.current = "";
      if (pendingInputTimerRef.current) {
        window.clearTimeout(pendingInputTimerRef.current);
        pendingInputTimerRef.current = 0;
      }
      predictedSelfRef.current = null;
      selfInvSigRef.current = "";
      lastLatencyUpdateAtRef.current = 0;
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
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!isWsServerMessage(parsed)) return;
      const msg: WsServerMessage = parsed;

      if (msg.type === WS_SERVER_MSG.reject) {
        const roomCap = Number(msg.maxPlayers || DEFAULT_ROOM_MAX_PLAYERS);
        const reasonMap: Record<string, string> = {
          [WS_REJECT_REASON.roomFull]: `房间已满（最多 ${roomCap} 人）`,
          [WS_REJECT_REASON.roomExists]: "已有房间，请加入当前房间",
          [WS_REJECT_REASON.roomNotFound]: "房间不存在",
          [WS_REJECT_REASON.notOwner]: "只有房主可以开始",
          [WS_REJECT_REASON.alreadyStarted]: "游戏已开始",
          [WS_REJECT_REASON.alreadyInRoom]: "你已在房间中",
          [WS_REJECT_REASON.invFull]: "物品栏已满",
          [WS_REJECT_REASON.itemLocked]: "无法丢弃该物品",
          [WS_REJECT_REASON.notInRoom]: "未在房间内",
          [WS_REJECT_REASON.unauthorized]: "登录已失效，请重新登录"
        };
        const text = reasonMap[msg.reason] || `请求被拒绝: ${msg.reason || "unknown"}`;
        setStatus(text);
        announce({ title: "系统提示", subtitle: text, tone: "bad", durationMs: 1600 });
        return;
      }

      if (msg.type === WS_SERVER_MSG.needAuth) {
        const authPayload: WsClientMessage = {
          type: WS_CLIENT_MSG.auth,
          playerKey: `u_${authUser.id}`,
          playerName: authUser.username
        };
        ws.send(JSON.stringify(authPayload));
        return;
      }

      if (msg.type === WS_SERVER_MSG.welcome) {
        selfIdRef.current = msg.id;
        tickMsRef.current = Number(msg.tickMs || DEFAULT_TICK_MS);
        applyState(msg.snapshot);
        const started = msg?.snapshot?.room?.status === WS_ROOM_STATUS.started;
        setStatus(started ? "游戏开始" : "已加入房间，等待开始");
        announce({ title: started ? "战局开始" : "已加入房间", subtitle: started ? "祝你好运" : "等待房主开局", tone: "info", durationMs: 1200 });
        return;
      }

      if (msg.type === WS_SERVER_MSG.lobbyState) {
        const { rooms, nextRoom } = updateLobby(msg);
        const currentlyInRoom = !!selfIdRef.current && playersRef.current.has(selfIdRef.current);
        const sameRoom = !!nextRoom && !!roomMetaRef.current && nextRoom.id === roomMetaRef.current.id;
        if (!currentlyInRoom || !sameRoom) {
          clearLocalRoomState();
          setStatus(rooms.length > 0 ? `大厅：${rooms.length} 个房间在线` : "大厅：暂无房间");
        }
        return;
      }

      if (msg.type === WS_SERVER_MSG.snapshot || msg.type === WS_SERVER_MSG.state) {
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
    let timer = 0;
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      if (canControlRef.current) queueAndSendInput();
      const delay = Math.max(8, Number(tickMsRef.current || DEFAULT_TICK_MS));
      timer = window.setTimeout(loop, delay);
    };
    const delay = Math.max(8, Number(tickMsRef.current || DEFAULT_TICK_MS));
    timer = window.setTimeout(loop, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queueAndSendInput]);

  useEffect(() => {
    return () => {
      if (pendingInputTimerRef.current) {
        window.clearTimeout(pendingInputTimerRef.current);
        pendingInputTimerRef.current = 0;
      }
    };
  }, []);

  const nearestDrop = useMemo(() => {
    return () => {
      const me = playersRef.current.get(selfIdRef.current);
      if (!me) return null;
      let best: Drop | null = null;
      let bestD2 = Infinity;
      for (const d of dropsRef.current) {
        const d2 = (me.x - d.x) * (me.x - d.x) + (me.y - d.y) * (me.y - d.y);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = d;
        }
      }
      return best;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!showGame) return;
      if (e.repeat) return;
      const digit = e.key;
      if (digit >= "1" && digit <= "3" && digit.length === 1) {
        setSelectedWeaponIdx(Number(digit) - 1);
        setActiveSection(WS_ITEM_SECTION.weapon);
        e.preventDefault();
        return;
      }
      if (digit >= "4" && digit <= "8" && digit.length === 1) {
        setSelectedItemIdx(Number(digit) - 4);
        setActiveSection(WS_ITEM_SECTION.item);
        e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "q") {
        setSelectedWeaponIdx((x) => (x + 1) % WEAPON_SLOT_SIZE);
        setActiveSection(WS_ITEM_SECTION.weapon);
        e.preventDefault();
        return;
      }
      if (key === "r") {
        inputRef.current.reload = true;
        queueAndSendInput(true);
        // 保持一个发送周期内的脉冲，避免同帧 true/false 被服务端最后一条覆盖
        window.setTimeout(() => {
          inputRef.current.reload = false;
          queueAndSendInput();
        }, 0);
        e.preventDefault();
        return;
      }
      if (key === "e") {
        const d = nearestDrop();
        if (!d) return;
        sendWs({ type: WS_CLIENT_MSG.pickup, dropId: d.id });
      }
      if (key === "g") {
        const me = playersRef.current.get(selfIdRef.current);
        const slot = activeSection === WS_ITEM_SECTION.weapon ? me?.weapons?.[selectedWeaponIdx] : me?.items?.[selectedItemIdx];
        if (!slot) return;
        if (slot.t === ITEM.knife) {
          announce({ title: "无法丢弃", subtitle: "匕首为默认物品", tone: "bad", durationMs: 1200 });
          return;
        }
        sendWs({
          type: WS_CLIENT_MSG.dropItem,
          section: activeSection,
          slotIdx: activeSection === WS_ITEM_SECTION.weapon ? selectedWeaponIdx : selectedItemIdx
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSection, announce, nearestDrop, selectedItemIdx, selectedWeaponIdx, showGame, queueAndSendInput]);

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
        if (showGame) queueAndSendInput(true);
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
  }, [showGame, queueAndSendInput]);

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
      const knifeArcs = knifeArcsRef.current;
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

      // drops (world space)
      for (const d of dropsRef.current) {
        const tone = isGunItemType(d.t)
          ? "#fbbf24"
          : isArmorItemType(d.t)
            ? "#60a5fa"
            : isBootsItemType(d.t)
              ? "#a78bfa"
              : isAmmoItemType(d.t)
                ? "#34d399"
                : "#19d3ff";
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "11px Menlo";
        const label = `${itemLabel(d.t)}${d.q > 1 ? ` x${d.q}` : ""}`;
        ctx.fillText(label, d.x + 10, d.y + 4);
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
        const muzzleLen = Number(world.bulletSpawnOffset || DEFAULT_BULLET_SPAWN_OFFSET);
        ctx.lineTo(drawX + Math.cos(normalizeAngle(drawDir)) * muzzleLen, drawY + Math.sin(normalizeAngle(drawDir)) * muzzleLen);
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

          const rf = localFrameRef.current;
          const rEnd = p.reloadEndFrame ?? 0;
          const rStart = p.reloadStartFrame ?? 0;
          if (rEnd > 0 && rStart >= 0 && rf < rEnd && rEnd > rStart) {
            const prog = (rf - rStart) / (rEnd - rStart);
            drawReloadRing(ctx, drawX + PLAYER_R + 10, drawY - PLAYER_R - 8, prog);
          }
        } else {
          const remain = Math.max(0, p.respawnAt - localFrameRef.current);
          const remainSeconds = (remain * Math.max(1, tickMsRef.current)) / 1000;
          ctx.fillStyle = "#ffd28f";
          ctx.fillText(`Respawn ${remainSeconds.toFixed(1)}s`, drawX - 34, drawY - 28);
        }
      }

      for (const ka of knifeArcs) {
        drawKnifeArcFx(ctx, ka, localFrameRef.current);
      }

      for (const e of explosions) {
        const age = localFrameRef.current - e.born;
        const explosionFxFrames = Number(world.explosionFxFrames || DEFAULT_EXPLOSION_FX_FRAMES);
        const t = clamp(age / explosionFxFrames, 0, 1);
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
      if (e.code === "Space") {
        e.preventDefault();
        inputRef.current.shoot = true;
        warnIfGunDryFire();
        queueAndSendInput(true);
        return;
      }
      if (e.key === "w" || e.key === "W") {
        inputRef.current.up = true;
        queueAndSendInput(true);
      }
      if (e.key === "s" || e.key === "S") {
        inputRef.current.down = true;
        queueAndSendInput(true);
      }
      if (e.key === "a" || e.key === "A") {
        inputRef.current.left = true;
        queueAndSendInput(true);
      }
      if (e.key === "d" || e.key === "D") {
        inputRef.current.right = true;
        queueAndSendInput(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!authUser || !showGame) return;
      if (e.code === "Space") {
        e.preventDefault();
        inputRef.current.shoot = false;
        queueAndSendInput(true);
        return;
      }
      if (e.key === "w" || e.key === "W") {
        inputRef.current.up = false;
        queueAndSendInput(true);
      }
      if (e.key === "s" || e.key === "S") {
        inputRef.current.down = false;
        queueAndSendInput(true);
      }
      if (e.key === "a" || e.key === "A") {
        inputRef.current.left = false;
        queueAndSendInput(true);
      }
      if (e.key === "d" || e.key === "D") {
        inputRef.current.right = false;
        queueAndSendInput(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [authUser, countdown, showGame, queueAndSendInput, warnIfGunDryFire]);

  const onMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (!showGame || !authUser || !selfIdRef.current || !playersRef.current.has(selfIdRef.current)) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const view = viewportRef.current;
    const scaleX = view.w / Math.max(rect.width, 1);
    const scaleY = view.h / Math.max(rect.height, 1);
    // 存储鼠标在视口上的相对位置(0-1范围)
    mouseViewportRef.current.x = Math.max(0, Math.min(1, ((e.clientX - rect.left) * scaleX) / view.w));
    mouseViewportRef.current.y = Math.max(0, Math.min(1, ((e.clientY - rect.top) * scaleY) / view.h));
  };

  const createRoom = () => {
    if (!sendWs({ type: WS_CLIENT_MSG.createRoom })) return;
    setStatus("正在创建房间...");
  };

  const joinRoom = (id: string) => {
    if (!sendWs({ type: WS_CLIENT_MSG.joinRoom, roomId: id })) return;
    setStatus(`正在加入房间 ${id}...`);
  };

  const startGame = () => {
    if (!sendWs({ type: WS_CLIENT_MSG.startGame })) return;
    setStatus("房主正在开始游戏...");
  };

  const leaveRoom = () => {
    if (!sendWs({ type: WS_CLIENT_MSG.leave })) return;
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

  const weaponSlots = useMemo(() => {
    const me = playersRef.current.get(selfIdRef.current);
    const inv = me?.weapons || [];
    const out: Array<{ t: string; q: number } | null> = [];
    for (let i = 0; i < WEAPON_SLOT_SIZE; i += 1) out.push(inv[i] || null);
    return out;
  }, [playerCount, localFrame, invTick]);

  const itemSlots = useMemo(() => {
    const me = playersRef.current.get(selfIdRef.current);
    const inv = me?.items || [];
    const out: Array<{ t: string; q: number } | null> = [];
    for (let i = 0; i < ITEM_SLOT_SIZE; i += 1) out.push(inv[i] || null);
    return out;
  }, [playerCount, localFrame, invTick]);

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
                aria-label="对战画布（WASD 移动，空格或鼠标攻击，鼠标瞄准）"
                onMouseMove={onMouseMove}
                onPointerDown={(e) => {
                  if (countdown !== 0) return;
                  e.preventDefault();
                  (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
                  inputRef.current.shoot = true;
                  warnIfGunDryFire();
                  queueAndSendInput(true);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  inputRef.current.shoot = false;
                  queueAndSendInput(true);
                }}
                onPointerCancel={(e) => {
                  inputRef.current.shoot = false;
                  queueAndSendInput(true);
                }}
                onPointerLeave={() => {
                  inputRef.current.shoot = false;
                  queueAndSendInput(true);
                }}
              />
              <div ref={announceAnchorRef} className="arena-announce-mount" aria-hidden />
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

              <div className="inventory-panel" aria-label="物品栏">
                <div className="inventory-head">
                  <h3>背包</h3>
                  <div className="inventory-hints muted" aria-label="物品栏操作说明">
                    <span>E 拾取</span>
                    <span>1–3 武器</span>
                    <span>4–8 物品</span>
                    <span>Q 切枪</span>
                    <span>R 换弹</span>
                    <span>G 丢弃</span>
                    <span>空格 / 鼠标攻击</span>
                    <span>枪械数字为剩余弹量</span>
                  </div>
                </div>
                <div className="muted">武器栏</div>
                <div className="inv-grid">
                  {weaponSlots.map((s, idx) => {
                    const active = activeSection === WS_ITEM_SECTION.weapon && idx === selectedWeaponIdx;
                    const cls = active ? "inv-slot active" : "inv-slot";
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={cls}
                        onClick={() => {
                          setSelectedWeaponIdx(idx);
                          setActiveSection(WS_ITEM_SECTION.weapon);
                        }}
                        aria-pressed={active}
                      >
                        <div className="inv-name">{s ? itemLabel(s.t) : "空"}</div>
                        {s && s.q > 1 ? <div className="inv-qty">x{s.q}</div> : <div className="inv-qty muted">{idx + 1}</div>}
                      </button>
                    );
                  })}
                </div>
                <div className="muted" style={{ marginTop: 8 }}>物品栏</div>
                <div className="inv-grid">
                  {itemSlots.map((s, idx) => {
                    const active = activeSection === WS_ITEM_SECTION.item && idx === selectedItemIdx;
                    const cls = active ? "inv-slot active" : "inv-slot";
                    return (
                      <button
                        key={`item_${idx}`}
                        type="button"
                        className={cls}
                        onClick={() => {
                          setSelectedItemIdx(idx);
                          setActiveSection(WS_ITEM_SECTION.item);
                        }}
                        aria-pressed={active}
                      >
                        <div className="inv-name">{s ? itemLabel(s.t) : "空"}</div>
                        {s && s.q > 1 ? <div className="inv-qty">x{s.q}</div> : <div className="inv-qty muted">{idx + 4}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
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
