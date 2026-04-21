import { getUserByToken } from "./services/auth-service";
import { APP_CONFIG } from "./config/app-config";
import { initDb } from "./services/db";
import { SERVER_CONSTANTS } from "./config/game-constants";
import { COLORS, OBSTACLES, SPAWNS } from "./data/game-data";
import { startGameLoop } from "./services/game-loop";
import { bearerToken, jsonResponse } from "./utils/http";
import { handleHttpApiRoutes } from "./controllers/http-routes";
import { clearReloadState, invAdd, invApplyAmmoPickup, invCanTakeAmmoPickup, invHasSpaceFor, invRemoveAt } from "./services/inventory-service";
import { clamp, collisionAt as collisionAtInWorld, hashId } from "./utils/math-utils";
import { createRoomService } from "./services/room-service";
import type { Bullet, Drop, Explosion, InputState, KnifeArcFx, RoomPlayer, RoomState, WsData } from "./models/server-types";
import type { Obstacle } from "./models/server-types";
import { createServerStateStore, ensureConnectionMaps } from "./services/state-store";
import { createTransportService } from "./services/transport-service";
import { createWsData, ensureWsData } from "./models/ws-data";
import { makeWebSocketHandlers } from "./controllers/ws-handlers";
import { handleWsUpgradeRoute } from "./controllers/ws-upgrade";
import type { ServerWebSocket } from "bun";
import { WS_ROOM_WELCOME_REASON, WS_STATE_TYPE } from "../../shared/ws-protocol";

const port = SERVER_CONSTANTS.port;
const {
  tickMs: TICK_MS,
  maxPlayers: MAX_PLAYERS,
  inputTimeoutMs: INPUT_TIMEOUT_MS,
  reconnectGraceMs: RECONNECT_GRACE_MS,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  playerRadius: PLAYER_R,
  movePerFrame: MOVE_PER_FRAME,
  bulletSpeed: BULLET_SPEED,
  bulletTtl: BULLET_TTL,
  damage: DAMAGE,
  maxHp: MAX_HP,
  respawnFrames: RESPAWN_FRAMES,
  inventorySize: INVENTORY_SIZE,
  pickupRadius: PICKUP_RADIUS,
  maxDrops: MAX_DROPS,
  dropIntervalFrames: DROP_INTERVAL_FRAMES,
  dropJitterFrames: DROP_JITTER_FRAMES,
  dropBatchBase: DROP_BATCH_BASE,
  dropBatchCycle: DROP_BATCH_CYCLE,
  dropSpawnAttempts: DROP_SPAWN_ATTEMPTS,
  dropRandomSaltMod: DROP_RANDOM_SALT_MOD,
  magSmg9mm: MAG_SMG_9MM,
  bulletSpawnOffset: BULLET_SPAWN_OFFSET,
  dropThrowOffset: DROP_THROW_OFFSET,
  bulletHitRadiusPadding: BULLET_HIT_RADIUS_PADDING,
  explosionFxFrames: EXPLOSION_FX_FRAMES,
  defaultGunCooldownFrames: DEFAULT_GUN_COOLDOWN_FRAMES,
  reloadDurationFrames: RELOAD_DURATION_FRAMES,
  knifeCooldownFrames: KNIFE_COOLDOWN_FRAMES,
  knifeArcFxFrames: KNIFE_ARC_FX_FRAMES
} = SERVER_CONSTANTS;

let dbReady = true;
try {
  await initDb();
  console.log("[backend] postgres ready");
} catch (err) {
  dbReady = false;
  console.error("[backend] postgres unavailable, auth endpoints disabled", err);
}

let idSeq = 1;

const { rooms, playerToRoom, clients, connToPlayer, playerToConns } = createServerStateStore();

const json = jsonResponse(APP_CONFIG.corsOrigin);

function requireDb() {
  if (!dbReady) return json({ error: "db_unavailable" }, { status: 503 });
  return null;
}

function defaultInput(): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    aimX: 0,
    aimY: 0,
    slot: 0
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
    aimY: input.aimY,
    slot: input.slot
  };
}

function collisionAt(x: number, y: number) {
  return collisionAtInWorld(x, y, WORLD_WIDTH, WORLD_HEIGHT, PLAYER_R, OBSTACLES);
}

function spawnFor(player: RoomPlayer) {
  const idx = (hashId(player.id) + player.deaths * 7) % SPAWNS.length;
  return SPAWNS[idx];
}

let broadcastToRoom: (room: RoomState, data: unknown) => void = () => {};
let broadcastLobbyState: () => void = () => {};
let sendLobbyState: (connId: string, playerKey?: string) => void = () => {};
let sendWelcome: (
  connId: string,
  playerKey: string,
  reason: (typeof WS_ROOM_WELCOME_REASON)[keyof typeof WS_ROOM_WELCOME_REASON]
) => void = () => {};
let attachAuthedConnection: (ws: ServerWebSocket<WsData>, playerKey: string, playerName: string) => void = () => {};

function broadcastSnapshot(room: RoomState, reason: string) {
  broadcastToRoom(room, statePayload(room, WS_STATE_TYPE.snapshot, reason));
  broadcastLobbyState();
}

const roomService = createRoomService({
  rooms,
  playerToRoom,
  colors: COLORS,
  spawns: SPAWNS,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  obstacles: OBSTACLES,
  maxPlayers: MAX_PLAYERS,
  maxHp: MAX_HP,
  inventorySize: INVENTORY_SIZE,
  dropIntervalFrames: DROP_INTERVAL_FRAMES,
  reloadDurationFrames: RELOAD_DURATION_FRAMES,
  explosionFxFrames: EXPLOSION_FX_FRAMES,
  bulletSpawnOffset: BULLET_SPAWN_OFFSET,
  defaultInput,
  spawnFor,
  clearReloadState,
  broadcastSnapshot,
  broadcastLobbyState,
  collisionAt
});
const { roomMeta, listRooms, statePayload, createRoom, addPlayerToRoom, startRoomBy, removePlayerFromRoom } = roomService;

const transport = createTransportService({
  clients,
  connToPlayer,
  playerToConns,
  playerToRoom,
  rooms,
  maxPlayers: MAX_PLAYERS,
  tickMs: TICK_MS,
  ensureConnectionMaps: (playerKey, connId) => ensureConnectionMaps(connToPlayer, playerToConns, playerKey, connId),
  roomMeta,
  listRooms,
  statePayload
});
broadcastToRoom = transport.broadcastToRoom;
broadcastLobbyState = transport.broadcastLobbyState;
sendLobbyState = transport.sendLobbyState;
sendWelcome = transport.sendWelcome;
attachAuthedConnection = transport.attachAuthedConnection;

startGameLoop({
  tickMs: TICK_MS,
  rooms,
  obstacles: OBSTACLES,
  maxDrops: MAX_DROPS,
  dropIntervalFrames: DROP_INTERVAL_FRAMES,
  dropJitterFrames: DROP_JITTER_FRAMES,
  dropBatchBase: DROP_BATCH_BASE,
  dropBatchCycle: DROP_BATCH_CYCLE,
  dropSpawnAttempts: DROP_SPAWN_ATTEMPTS,
  dropRandomSaltMod: DROP_RANDOM_SALT_MOD,
  magSmg9mm: MAG_SMG_9MM,
  playerRadius: PLAYER_R,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  inputTimeoutMs: INPUT_TIMEOUT_MS,
  movePerFrame: MOVE_PER_FRAME,
  maxHp: MAX_HP,
  knifeCooldownFrames: KNIFE_COOLDOWN_FRAMES,
  bulletSpeed: BULLET_SPEED,
  bulletTtl: BULLET_TTL,
  bulletSpawnOffset: BULLET_SPAWN_OFFSET,
  bulletHitRadiusPadding: BULLET_HIT_RADIUS_PADDING,
  explosionFxFrames: EXPLOSION_FX_FRAMES,
  defaultGunCooldownFrames: DEFAULT_GUN_COOLDOWN_FRAMES,
  damage: DAMAGE,
  respawnFrames: RESPAWN_FRAMES,
  inventorySize: INVENTORY_SIZE,
  knifeArcFxFrames: KNIFE_ARC_FX_FRAMES,
  collisionAt,
  clearActionInputKeepAim,
  removePlayerFromRoom,
  spawnFor,
  clamp,
  broadcastSnapshot,
  statePayload,
  broadcastToRoom
});

const websocketHandlers = makeWebSocketHandlers({
  clients,
  connToPlayer,
  playerToConns,
  playerToRoom,
  rooms,
  maxPlayers: MAX_PLAYERS,
  inventorySize: INVENTORY_SIZE,
  pickupRadius: PICKUP_RADIUS,
  reconnectGraceMs: RECONNECT_GRACE_MS,
  dropThrowOffset: DROP_THROW_OFFSET,
  isDbReady: () => dbReady,
  ensureWsData,
  attachAuthedConnection,
  createRoom,
  addPlayerToRoom,
  sendWelcome,
  broadcastSnapshot,
  sendLobbyState,
  startRoomBy,
  removePlayerFromRoom,
  clamp,
  collisionAt,
  invCanTakeAmmoPickup,
  invHasSpaceFor,
  invApplyAmmoPickup,
  invAdd,
  invRemoveAt
});

const server = Bun.serve<WsData>({
  port,
  websocket: websocketHandlers,
  async fetch(req) {
    const url = new URL(req.url);

    const apiRes = await handleHttpApiRoutes({ req, url, json, dbReady, requireDb });
    if (apiRes) return apiRes;

    const wsUpgradeRes = await handleWsUpgradeRoute({
      req,
      url,
      dbReady,
      json,
      bearerToken,
      getUserByToken,
      nextConnId: () => String(idSeq++),
      createWsData,
      upgrade: (upgradeReq, opts) => server.upgrade(upgradeReq, opts)
    });
    if (wsUpgradeRes !== null) return wsUpgradeRes;

    return json({ error: "not_found" }, { status: 404 });
  }
});

console.log(`[backend] listening on http://localhost:${port}`);
