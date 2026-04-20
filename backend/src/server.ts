import { getUserByToken, loginUser, registerUser, revokeSession, validatePassword, validateUsername } from "./auth";
import { initDb } from "./db";
import type { ServerWebSocket } from "bun";

const evolutions = [
  {
    id: "doom",
    title: "DOOM - Deterministic Lockstep",
    era: "1993",
    summary: "每帧同步玩家输入，所有节点必须等齐输入再推进。",
    strengths: ["输入包小", "理论一致性强"],
    weaknesses: ["一人卡全员卡", "弱网手感差"]
  },
  {
    id: "quake",
    title: "Quake - Client/Server + Prediction",
    era: "1996",
    summary: "服务器权威模拟，客户端发输入并预测显示。",
    strengths: ["不再全员等待", "支持客户端预测"],
    weaknesses: ["需要纠正跳变", "服务端成本更高"]
  },
  {
    id: "cnc",
    title: "C&C - 工程化 Lockstep",
    era: "1995",
    summary: "仍是 lockstep，但加入队列、ACK、重传、压缩。",
    strengths: ["在旧网络上更稳", "协议工程化增强"],
    weaknesses: ["本质仍锁步", "弱网等待仍明显"]
  },
  {
    id: "source",
    title: "Source - Snapshot State Sync",
    era: "2004+",
    summary: "基线+增量快照、预测、可见性裁剪。",
    strengths: ["规模化能力强", "带宽利用率高"],
    weaknesses: ["实现复杂", "调试门槛高"]
  },
  {
    id: "freefire",
    title: "Free Fire - Hybrid Sync",
    era: "2017+",
    summary: "事件即时通道 + 状态同步并存，按数据语义拆分。",
    strengths: ["适配移动弱网", "兼顾时效与成本"],
    weaknesses: ["系统设计复杂", "跨模块协作要求高"]
  }
];

const port = Number(process.env.PORT || 8787);
const TICK_MS = 50;
const MAX_PLAYERS = 5;
const INPUT_TIMEOUT_MS = 150;
const RECONNECT_GRACE_MS = 10_000;

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 1200;
const PLAYER_R = 14;
const MOVE_PER_FRAME = 5;
const BULLET_SPEED = 17;
const BULLET_TTL = 80;
const DAMAGE = 30;
const MAX_HP = 90;
const RESPAWN_FRAMES = 60;

let dbReady = true;
try {
  await initDb();
  console.log("[backend] postgres ready");
} catch (err) {
  dbReady = false;
  console.error("[backend] postgres unavailable, auth endpoints disabled", err);
}

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  aimX: number;
  aimY: number;
};

type RoomPlayer = {
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
  input: InputState;
  lastInputAt: number;
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

type RoomStatus = "idle" | "waiting" | "started";

type WsData = {
  connId: string;
  playerKey: string;
  playerName: string;
  authed: boolean;
  manualLeave: boolean;
};

function createWsData(connId: string, playerKey: string, playerName: string): WsData {
  return { connId, playerKey, playerName, authed: false, manualLeave: false };
}

function ensureWsData(ws: ServerWebSocket<WsData>) {
  ws.data ??= createWsData("", "", "");
  return ws.data;
}

const SPAWNS = [
  { x: 220, y: 180 },
  { x: 1700, y: 210 },
  { x: 1850, y: 930 },
  { x: 290, y: 980 },
  { x: 1040, y: 150 },
  { x: 980, y: 1030 }
];

const OBSTACLES: Obstacle[] = [
  { x: 420, y: 260, w: 240, h: 60 },
  { x: 740, y: 520, w: 340, h: 80 },
  { x: 1250, y: 280, w: 270, h: 70 },
  { x: 1420, y: 730, w: 280, h: 65 },
  { x: 480, y: 820, w: 240, h: 60 }
];

const COLORS = ["#2f7bd9", "#e06c4e", "#22a67a", "#ab54d1", "#c19434"];

let idSeq = 1;

type RoomMeta = {
  id: string;
  ownerKey: string;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
};

type RoomState = {
  id: string;
  ownerKey: string;
  status: RoomStatus;
  createdAt: number;
  frame: number;
  bulletSeq: number;
  players: Map<string, RoomPlayer>;
  bullets: Bullet[];
  explosions: Explosion[];
  offlineDeadlines: Map<string, number>;
};

const rooms = new Map<string, RoomState>();
const playerToRoom = new Map<string, string>();

const clients = new Map<string, ServerWebSocket<WsData>>();
const connToPlayer = new Map<string, string>();
const playerToConns = new Map<string, Set<string>>();

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    },
    ...init
  });

async function readBody(req: Request): Promise<any> {
  try {
    return (await req.json()) as any;
  } catch {
    return null;
  }
}

function requireDb() {
  if (!dbReady) return json({ error: "db_unavailable" }, { status: 503 });
  return null;
}

function bearerToken(req: Request, url: URL) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();

  const qsToken = (url.searchParams.get("token") || "").trim();
  if (qsToken) return qsToken;

  return "";
}

function defaultInput(): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    aimX: 0,
    aimY: 0
  };
}

function clearActionInputKeepAim(input: InputState): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    aimX: input.aimX,
    aimY: input.aimY
  };
}

function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = (h ^ id.charCodeAt(i)) * 16777619;
  return Math.abs(h | 0);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function circleRectHit(cx: number, cy: number, r: number, ob: Obstacle) {
  const nx = clamp(cx, ob.x, ob.x + ob.w);
  const ny = clamp(cy, ob.y, ob.y + ob.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function collisionAt(x: number, y: number) {
  if (x < PLAYER_R || y < PLAYER_R || x > WORLD_WIDTH - PLAYER_R || y > WORLD_HEIGHT - PLAYER_R) return true;
  return OBSTACLES.some((ob) => circleRectHit(x, y, PLAYER_R, ob));
}

function spawnFor(player: RoomPlayer) {
  const idx = (hashId(player.id) + player.deaths * 7) % SPAWNS.length;
  return SPAWNS[idx];
}

function roomMeta(room: RoomState): RoomMeta {
  return {
    id: room.id,
    ownerKey: room.ownerKey,
    status: room.status,
    playerCount: room.players.size,
    maxPlayers: MAX_PLAYERS
  };
}

function listRooms(): RoomMeta[] {
  return Array.from(rooms.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => roomMeta(r));
}

function playersPayload(room: RoomState) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    hp: p.hp,
    dir: p.dir,
    alive: p.alive,
    respawnAt: p.respawnAt,
    cooldown: p.cooldown,
    prevShoot: p.prevShoot,
    deaths: p.deaths,
    lastProcessedInputSeq: p.lastProcessedInputSeq
  }));
}

function statePayload(room: RoomState, type: "state" | "snapshot", reason?: string) {
  return {
    type,
    reason,
    frame: room.frame,
    serverTime: Date.now(),
    room: roomMeta(room),
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, obstacles: OBSTACLES },
    players: playersPayload(room),
    bullets: room.bullets,
    explosions: room.explosions
  };
}

function sendTo(connId: string, data: unknown) {
  const ws = clients.get(connId);
  if (!ws) return;
  ws.send(JSON.stringify(data));
}

function broadcastToRoom(room: RoomState, data: unknown) {
  const text = JSON.stringify(data);
  for (const playerKey of room.players.keys()) {
    const conns = playerToConns.get(playerKey);
    if (!conns) continue;
    for (const connId of conns.values()) {
      const ws = clients.get(connId);
      if (!ws) continue;
      ws.send(text);
    }
  }
}

function sendLobbyState(connId: string, playerKey?: string) {
  const roomId = playerKey ? playerToRoom.get(playerKey) || "" : "";
  const room = roomId ? rooms.get(roomId) : null;
  sendTo(connId, { type: "lobby_state", room: room ? roomMeta(room) : null, rooms: listRooms() });
}

function broadcastLobbyState() {
  for (const ws of clients.values()) {
    if (!ws.data.authed) continue;
    sendLobbyState(ws.data.connId, ws.data.playerKey);
  }
}

function broadcastSnapshot(room: RoomState, reason: string) {
  broadcastToRoom(room, statePayload(room, "snapshot", reason));
  broadcastLobbyState();
}

function pickAvailableColor(room: RoomState) {
  const used = new Set(Array.from(room.players.values()).map((p) => p.color));
  for (const color of COLORS) {
    if (!used.has(color)) return color;
  }
  return COLORS[room.players.size % COLORS.length];
}

function createPlayer(room: RoomState, playerKey: string, playerName: string) {
  const spawn = SPAWNS[room.players.size % SPAWNS.length];
  return {
    id: playerKey,
    name: playerName,
    color: pickAvailableColor(room),
    x: spawn.x,
    y: spawn.y,
    hp: MAX_HP,
    dir: 0,
    alive: true,
    respawnAt: 0,
    cooldown: 0,
    prevShoot: false,
    deaths: 0,
    input: defaultInput(),
    lastInputAt: Date.now(),
    lastProcessedInputSeq: 0
  } as RoomPlayer;
}

function removePlayerFromRoom(room: RoomState, playerKey: string, reason: string) {
  const existed = room.players.delete(playerKey);
  room.offlineDeadlines.delete(playerKey);
  playerToRoom.delete(playerKey);
  if (!existed) return;

  room.bullets = room.bullets.filter((b) => b.owner !== playerKey);

  if (room.ownerKey === playerKey) {
    const nextOwner = Array.from(room.players.keys()).sort()[0] || "";
    room.ownerKey = nextOwner;
  }

  if (room.players.size === 0) {
    rooms.delete(room.id);
    broadcastLobbyState();
    return;
  }

  broadcastSnapshot(room, reason);
}

function ensureConnectionMaps(playerKey: string, connId: string) {
  connToPlayer.set(connId, playerKey);
  let connSet = playerToConns.get(playerKey);
  if (!connSet) {
    connSet = new Set<string>();
    playerToConns.set(playerKey, connSet);
  }
  connSet.add(connId);
}

function sendWelcome(connId: string, playerKey: string, reason: string) {
  const roomId = playerToRoom.get(playerKey) || "";
  const room = roomId ? rooms.get(roomId) : null;
  if (!room) {
    sendLobbyState(connId, playerKey);
    return;
  }
  sendTo(connId, {
    type: "welcome",
    id: playerKey,
    connId,
    maxPlayers: MAX_PLAYERS,
    tickMs: TICK_MS,
    snapshot: statePayload(room, "snapshot", reason)
  });
}

function attachAuthedConnection(ws: ServerWebSocket<WsData>, playerKey: string, playerName: string) {
  const connId = ws.data.connId;
  ws.data.playerKey = playerKey;
  ws.data.playerName = playerName;
  ws.data.authed = true;
  ws.data.manualLeave = false;

  ensureConnectionMaps(playerKey, connId);

  const roomId = playerToRoom.get(playerKey) || "";
  const room = roomId ? rooms.get(roomId) : null;
  if (room && room.players.has(playerKey)) {
    room.offlineDeadlines.delete(playerKey);
    sendWelcome(connId, playerKey, "existing_player_attach");
    return;
  }

  sendLobbyState(connId, playerKey);
}

function createRoom(ownerKey: string) {
  let id = "";
  for (let i = 0; i < 10; i += 1) {
    id = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!rooms.has(id)) break;
  }
  const room: RoomState = {
    id,
    ownerKey,
    status: "waiting",
    createdAt: Date.now(),
    frame: 0,
    bulletSeq: 1,
    players: new Map(),
    bullets: [],
    explosions: [],
    offlineDeadlines: new Map()
  };
  rooms.set(id, room);
  return room;
}

function addPlayerToRoom(room: RoomState, playerKey: string, playerName: string) {
  const existing = room.players.get(playerKey);
  if (existing) return existing;
  if (room.players.size >= MAX_PLAYERS) return null;

  const p = createPlayer(room, playerKey, playerName);
  room.players.set(playerKey, p);
  playerToRoom.set(playerKey, room.id);
  room.offlineDeadlines.delete(playerKey);
  return p;
}

function startRoomBy(room: RoomState, ownerKey: string) {
  if (room.status !== "waiting") return { ok: false, reason: "already_started" };
  if (room.ownerKey !== ownerKey) return { ok: false, reason: "not_owner" };
  if (room.players.size < 1) return { ok: false, reason: "empty_room" };

  room.status = "started";
  room.frame = 0;
  room.bullets = [];
  room.explosions = [];

  for (const p of room.players.values()) {
    p.hp = MAX_HP;
    p.alive = true;
    p.respawnAt = 0;
    p.cooldown = 0;
    p.prevShoot = false;
    p.deaths = 0;
    p.input = defaultInput();
    p.lastInputAt = Date.now();
    const s = spawnFor(p);
    p.x = s.x;
    p.y = s.y;
  }

  broadcastSnapshot(room, "game_started");
  return { ok: true };
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== "started") continue;

    room.frame += 1;

    for (const [playerKey, deadline] of room.offlineDeadlines.entries()) {
      if (now >= deadline) {
        removePlayerFromRoom(room, playerKey, `player_timeout_${playerKey}`);
      }
    }

    const ids = Array.from(room.players.keys()).sort();

    for (const id of ids) {
      const p = room.players.get(id);
      if (!p) continue;

      if (now - p.lastInputAt > INPUT_TIMEOUT_MS) {
        p.input = clearActionInputKeepAim(p.input);
      }

      const input = p.input;

      if (!p.alive) {
        if (room.frame >= p.respawnAt) {
          const s = spawnFor(p);
          p.x = s.x;
          p.y = s.y;
          p.hp = MAX_HP;
          p.alive = true;
          p.cooldown = 0;
          p.prevShoot = false;
        }
        continue;
      }

      const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      const vx = (dx / len) * MOVE_PER_FRAME;
      const vy = (dy / len) * MOVE_PER_FRAME;

      let nx = p.x + vx;
      let ny = p.y;
      if (collisionAt(nx, ny)) nx = p.x;
      ny = p.y + vy;
      if (collisionAt(nx, ny)) ny = p.y;
      p.x = nx;
      p.y = ny;

      const angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
      if (Number.isFinite(angle)) p.dir = angle;

      if (p.cooldown > 0) p.cooldown -= 1;
      const shootEdge = input.shoot && !p.prevShoot;
      if (shootEdge && p.cooldown <= 0) {
        room.bullets.push({
          id: `${room.frame}-${room.bulletSeq++}`,
          owner: p.id,
          x: p.x + Math.cos(p.dir) * 20,
          y: p.y + Math.sin(p.dir) * 20,
          vx: Math.cos(p.dir) * BULLET_SPEED,
          vy: Math.sin(p.dir) * BULLET_SPEED,
          ttl: BULLET_TTL
        });
        p.cooldown = 6;
      }
      p.prevShoot = input.shoot;
    }

    for (let i = room.bullets.length - 1; i >= 0; i -= 1) {
      const b = room.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.ttl -= 1;

      let remove = b.ttl <= 0;
      if (!remove && (b.x < 0 || b.y < 0 || b.x > WORLD_WIDTH || b.y > WORLD_HEIGHT)) {
        remove = true;
      }

      if (!remove) {
        for (const ob of OBSTACLES) {
          if (b.x >= ob.x && b.x <= ob.x + ob.w && b.y >= ob.y && b.y <= ob.y + ob.h) {
            remove = true;
            room.explosions.push({ x: b.x, y: b.y, born: room.frame });
            break;
          }
        }
      }

      if (!remove) {
        for (const id of ids) {
          if (id === b.owner) continue;
          const p = room.players.get(id);
          if (!p || !p.alive) continue;

          const d2 = (p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y);
          if (d2 <= (PLAYER_R + 2) * (PLAYER_R + 2)) {
            p.hp -= DAMAGE;
            room.explosions.push({ x: b.x, y: b.y, born: room.frame });
            if (p.hp <= 0) {
              p.alive = false;
              p.deaths += 1;
              p.respawnAt = room.frame + RESPAWN_FRAMES;
            }
            remove = true;
            break;
          }
        }
      }

      if (remove) room.bullets.splice(i, 1);
    }

    room.explosions = room.explosions.filter((e) => room.frame - e.born <= 15);

    broadcastToRoom(room, statePayload(room, "state"));
  }
}, TICK_MS);

const server = Bun.serve<WsData>({
  port,
  websocket: {
    open(ws) {
      const { connId, playerKey, playerName } = ensureWsData(ws);
      clients.set(connId, ws);
      if (/^[a-zA-Z0-9_-]{2,64}$/.test(playerKey) && /^[a-zA-Z0-9_]{1,24}$/.test(playerName)) {
        attachAuthedConnection(ws, playerKey, playerName);
        return;
      }
      ws.send(JSON.stringify({ type: "need_auth" }));
    },
    message(ws, message) {
      const wsData = ensureWsData(ws);
      let msg: any = null;
      try {
        msg = JSON.parse(String(message));
      } catch {
        return;
      }

      if (!wsData.authed) {
        if (msg?.type !== "auth") return;
        const playerKey = String(msg.playerKey || "").trim();
        let playerName = String(msg.playerName || "").trim();
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(playerKey)) {
          ws.send(JSON.stringify({ type: "reject", reason: "bad_player_key" }));
          ws.close();
          return;
        }
        if (!/^[a-zA-Z0-9_]{1,24}$/.test(playerName)) {
          playerName = `P${playerKey.slice(0, 8)}`;
        }
        attachAuthedConnection(ws, playerKey, playerName);
        return;
      }

      const playerKey = wsData.playerKey;
      const playerName = wsData.playerName;
      if (!playerKey) return;

      if (msg?.type === "create_room") {
        const existingRoomId = playerToRoom.get(playerKey) || "";
        if (existingRoomId) {
          ws.send(JSON.stringify({ type: "reject", reason: "already_in_room" }));
          return;
        }
        const room = createRoom(playerKey);
        const p = addPlayerToRoom(room, playerKey, playerName);
        if (!p) {
          ws.send(JSON.stringify({ type: "reject", reason: "room_join_failed" }));
          return;
        }

        sendWelcome(wsData.connId, playerKey, "room_created");
        broadcastSnapshot(room, `player_join_${playerKey}`);
        return;
      }

      if (msg?.type === "join_room") {
        const reqRoomId = String(msg.roomId || "").trim();
        const room = rooms.get(reqRoomId);
        if (!room) {
          ws.send(JSON.stringify({ type: "reject", reason: "room_not_found" }));
          sendLobbyState(wsData.connId, playerKey);
          return;
        }

        const existingRoomId = playerToRoom.get(playerKey) || "";
        if (existingRoomId) {
          if (existingRoomId === room.id) {
            sendWelcome(wsData.connId, playerKey, "existing_player_attach");
            return;
          }
          ws.send(JSON.stringify({ type: "reject", reason: "already_in_room" }));
          return;
        }

        if (room.players.size >= MAX_PLAYERS) {
          ws.send(JSON.stringify({ type: "reject", reason: "room_full", maxPlayers: MAX_PLAYERS }));
          return;
        }

        const p = addPlayerToRoom(room, playerKey, playerName);
        if (!p) {
          ws.send(JSON.stringify({ type: "reject", reason: "room_join_failed" }));
          return;
        }

        sendWelcome(wsData.connId, playerKey, "new_player_join");
        broadcastSnapshot(room, `player_join_${playerKey}`);
        return;
      }

      if (msg?.type === "start_game") {
        const roomId = playerToRoom.get(playerKey) || "";
        const room = roomId ? rooms.get(roomId) : null;
        if (!room) {
          ws.send(JSON.stringify({ type: "reject", reason: "not_in_room" }));
          return;
        }
        const ret = startRoomBy(room, playerKey);
        if (!ret.ok) ws.send(JSON.stringify({ type: "reject", reason: ret.reason }));
        return;
      }

      const roomId = playerToRoom.get(playerKey) || "";
      const room = roomId ? rooms.get(roomId) : null;
      const p = room ? room.players.get(playerKey) : null;
      if (!p) {
        if (msg?.type === "list_rooms") sendLobbyState(wsData.connId, playerKey);
        return;
      }

      if (msg?.type === "leave") {
        removePlayerFromRoom(room!, playerKey, `player_leave_${playerKey}`);
        sendLobbyState(wsData.connId, playerKey);
        return;
      }

      if (msg?.type === "input") {
        if (!room || room.status !== "started") return;

        const seq = Number(msg.seq || 0);
        if (!Number.isFinite(seq) || seq <= p.lastProcessedInputSeq) return;

        p.input = {
          up: !!msg.up,
          down: !!msg.down,
          left: !!msg.left,
          right: !!msg.right,
          shoot: !!msg.shoot,
          aimX: Number(msg.aimX || 0),
          aimY: Number(msg.aimY || 0)
        };
        p.lastInputAt = Date.now();
        p.lastProcessedInputSeq = seq;
      }
    },
    close(ws) {
      const { connId, playerKey, authed } = ensureWsData(ws);
      clients.delete(connId);
      if (!authed) return;

      connToPlayer.delete(connId);

      const connSet = playerToConns.get(playerKey);
      if (!connSet) return;
      connSet.delete(connId);
      if (connSet.size > 0) return;
      playerToConns.delete(playerKey);

      const roomId = playerToRoom.get(playerKey) || "";
      const room = roomId ? rooms.get(roomId) : null;
      if (room && room.players.has(playerKey)) {
        room.offlineDeadlines.set(playerKey, Date.now() + RECONNECT_GRACE_MS);
        broadcastSnapshot(room, `player_offline_${playerKey}`);
      }
    }
  },
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return json({ ok: true });
    }

    if (url.pathname === "/health") {
      return json({ status: "ok", runtime: "bun", dbReady });
    }

    if (url.pathname === "/api/auth/register" && req.method === "POST") {
      const dbErr = requireDb();
      if (dbErr) return dbErr;

      const body = await readBody(req);
      const username = String(body?.username || "").trim().toLowerCase();
      const password = String(body?.password || "");

      if (!validateUsername(username)) {
        return json({ error: "invalid_username", message: "用户名需为 3-24 位字母/数字/下划线" }, { status: 400 });
      }
      if (!validatePassword(password)) {
        return json({ error: "invalid_password", message: "密码长度需为 6-128" }, { status: 400 });
      }

      const ret = await registerUser(username, password);
      if (!ret) {
        return json({ error: "username_exists", message: "用户名已存在" }, { status: 409 });
      }

      return json({ token: ret.token, user: ret.user }, { status: 201 });
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const dbErr = requireDb();
      if (dbErr) return dbErr;

      const body = await readBody(req);
      const username = String(body?.username || "").trim().toLowerCase();
      const password = String(body?.password || "");

      const ret = await loginUser(username, password);
      if (!ret) {
        return json({ error: "invalid_credentials", message: "用户名或密码错误" }, { status: 401 });
      }

      return json({ token: ret.token, user: ret.user });
    }

    if (url.pathname === "/api/auth/me" && req.method === "GET") {
      const dbErr = requireDb();
      if (dbErr) return dbErr;

      const token = bearerToken(req, url);
      if (!token) return json({ error: "unauthorized" }, { status: 401 });

      const user = await getUserByToken(token);
      if (!user) return json({ error: "unauthorized" }, { status: 401 });
      return json({ user });
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const dbErr = requireDb();
      if (dbErr) return dbErr;

      const token = bearerToken(req, url);
      if (token) await revokeSession(token);
      return json({ ok: true });
    }

    if (url.pathname === "/api/evolutions") {
      return json({ items: evolutions });
    }

    if (url.pathname === "/ws/lockstep") {
      const connId = String(idSeq++);
      let playerKey = (url.searchParams.get("playerKey") || "").trim();
      let playerName = (url.searchParams.get("playerName") || "").trim();

      const token = bearerToken(req, url);
      if (dbReady && token) {
        try {
          const user = await getUserByToken(token);
          if (user) {
            playerKey = `u_${user.id}`;
            playerName = user.username;
          }
        } catch {
          // noop
        }
      }

      if (!/^[a-zA-Z0-9_-]{2,64}$/.test(playerKey)) playerKey = "";
      if (!/^[a-zA-Z0-9_]{1,24}$/.test(playerName)) playerName = "";

      const ok = (req.headers.get("upgrade") || "").toLowerCase() === "websocket";
      if (!ok) return json({ error: "upgrade_required" }, { status: 426 });
      const upgraded = server.upgrade(req, { data: createWsData(connId, playerKey, playerName) });
      if (upgraded) return undefined as any;
      return json({ error: "upgrade_failed" }, { status: 400 });
    }

    if (url.pathname.startsWith("/api/evolutions/")) {
      const id = url.pathname.split("/").pop();
      const item = evolutions.find((x) => x.id === id);
      if (!item) return json({ error: "not_found" }, { status: 404 });
      return json(item);
    }

    return json({ error: "not_found" }, { status: 404 });
  }
});

console.log(`[backend] listening on http://localhost:${port}`);
