import type { InputState, InventorySlot, RoomMeta, RoomPlayer, RoomState } from "../models/server-types";
import { WS_REJECT_REASON, WS_ROOM_EVENT, WS_ROOM_STATUS, WS_STATE_TYPE } from "../../../shared/ws-protocol";

type CreateRoomServiceContext = {
  rooms: Map<string, RoomState>;
  playerToRoom: Map<string, string>;
  colors: string[];
  spawns: Array<{ x: number; y: number }>;
  worldWidth: number;
  worldHeight: number;
  obstacles: Array<{ x: number; y: number; w: number; h: number }>;
  maxPlayers: number;
  maxHp: number;
  weaponSlotSize: number;
  itemSlotSize: number;
  dropIntervalFrames: number;
  reloadDurationFrames: number;
  explosionFxFrames: number;
  bulletSpawnOffset: number;
  defaultInput: () => InputState;
  spawnFor: (player: RoomPlayer) => { x: number; y: number };
  clearReloadState: (p: RoomPlayer) => void;
  initialWeapons: () => Array<InventorySlot | null>;
  initialItems: () => Array<InventorySlot | null>;
  broadcastSnapshot: (room: RoomState, reason: string) => void;
  broadcastLobbyState: () => void;
  collisionAt: (x: number, y: number) => boolean;
};

type StartRoomResult = {
  ok: boolean;
  reason?: (typeof WS_REJECT_REASON)[keyof typeof WS_REJECT_REASON];
};

export function createRoomService(ctx: CreateRoomServiceContext) {
  function roomMeta(room: RoomState): RoomMeta {
    return {
      id: room.id,
      ownerKey: room.ownerKey,
      status: room.status,
      playerCount: room.players.size,
      maxPlayers: ctx.maxPlayers
    };
  }

  function listRooms(): RoomMeta[] {
    return Array.from(ctx.rooms.values())
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
      prevReload: p.prevReload,
      deaths: p.deaths,
      lastProcessedInputSeq: p.lastProcessedInputSeq,
      weapons: p.weapons,
      items: p.items,
      reloadEndFrame: p.reloadEndFrame || 0,
      reloadStartFrame: p.reloadStartFrame || 0,
      reloadSlotIdx: p.reloadSlotIdx ?? -1
    }));
  }

  function statePayload(room: RoomState, type: (typeof WS_STATE_TYPE)[keyof typeof WS_STATE_TYPE], reason?: string) {
    const payload = {
      type,
      reason,
      frame: room.frame,
      serverTime: Date.now(),
      room: roomMeta(room),
      players: playersPayload(room),
      bullets: room.bullets,
      explosions: room.explosions,
      knifeArcs: room.knifeArcs,
      drops: room.drops
    };
    if (type === WS_STATE_TYPE.snapshot) {
      return {
        ...payload,
        world: {
          width: ctx.worldWidth,
          height: ctx.worldHeight,
          obstacles: ctx.obstacles,
          reloadDurationFrames: ctx.reloadDurationFrames,
          explosionFxFrames: ctx.explosionFxFrames,
          bulletSpawnOffset: ctx.bulletSpawnOffset
        }
      };
    }
    return payload;
  }

  function pickAvailableColor(room: RoomState) {
    const used = new Set(Array.from(room.players.values()).map((p) => p.color));
    for (const color of ctx.colors) {
      if (!used.has(color)) return color;
    }
    return ctx.colors[room.players.size % ctx.colors.length];
  }

  function createPlayer(room: RoomState, playerKey: string, playerName: string) {
    const spawn = ctx.spawns[room.players.size % ctx.spawns.length];
    return {
      id: playerKey,
      name: playerName,
      color: pickAvailableColor(room),
      x: spawn.x,
      y: spawn.y,
      hp: ctx.maxHp,
      dir: 0,
      alive: true,
      respawnAt: 0,
      cooldown: 0,
      prevShoot: false,
      prevReload: false,
      deaths: 0,
      weapons: ctx.initialWeapons(),
      items: ctx.initialItems(),
      input: ctx.defaultInput(),
      lastInputAt: Date.now(),
      lastProcessedInputSeq: 0,
      reloadEndFrame: 0,
      reloadStartFrame: 0,
      reloadSlotIdx: -1
    } as RoomPlayer;
  }

  function createRoom(ownerKey: string) {
    let id = "";
    do {
      id = Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (ctx.rooms.has(id));
    const room: RoomState = {
      id,
      ownerKey,
      status: WS_ROOM_STATUS.waiting,
      createdAt: Date.now(),
      frame: 0,
      bulletSeq: 1,
      dropSeq: 1,
      nextDropAt: ctx.dropIntervalFrames,
      players: new Map(),
      bullets: [],
      explosions: [],
      knifeArcs: [],
      offlineDeadlines: new Map(),
      drops: []
    };
    ctx.rooms.set(id, room);
    return room;
  }

  function addPlayerToRoom(room: RoomState, playerKey: string, playerName: string) {
    const existing = room.players.get(playerKey);
    if (existing) return existing;
    if (room.players.size >= ctx.maxPlayers) return null;

    const p = createPlayer(room, playerKey, playerName);
    room.players.set(playerKey, p);
    ctx.playerToRoom.set(playerKey, room.id);
    room.offlineDeadlines.delete(playerKey);
    return p;
  }

  function startRoomBy(room: RoomState, ownerKey: string): StartRoomResult {
    if (room.status !== WS_ROOM_STATUS.waiting) return { ok: false, reason: WS_REJECT_REASON.alreadyStarted };
    if (room.ownerKey !== ownerKey) return { ok: false, reason: WS_REJECT_REASON.notOwner };
    if (room.players.size < 1) return { ok: false, reason: WS_REJECT_REASON.emptyRoom };

    room.status = WS_ROOM_STATUS.started;
    room.frame = 0;
    room.bullets = [];
    room.explosions = [];
    room.knifeArcs = [];
    room.drops = [];
    room.dropSeq = 1;
    room.nextDropAt = ctx.dropIntervalFrames;

    for (const p of room.players.values()) {
      p.hp = ctx.maxHp;
      p.alive = true;
      p.respawnAt = 0;
      p.cooldown = 0;
      p.prevShoot = false;
      p.prevReload = false;
      p.deaths = 0;
      p.input = ctx.defaultInput();
      p.lastInputAt = Date.now();
      ctx.clearReloadState(p);
      p.weapons = ctx.initialWeapons();
      p.items = ctx.initialItems();
      const s = ctx.spawnFor(p);
      p.x = s.x;
      p.y = s.y;
    }

    ctx.broadcastSnapshot(room, WS_ROOM_EVENT.gameStarted);
    return { ok: true };
  }

  function removePlayerFromRoom(room: RoomState, playerKey: string, reason: string) {
    const existed = room.players.delete(playerKey);
    room.offlineDeadlines.delete(playerKey);
    ctx.playerToRoom.delete(playerKey);
    if (!existed) return;

    room.bullets = room.bullets.filter((b) => b.owner !== playerKey);

    if (room.ownerKey === playerKey) {
      const nextOwner = Array.from(room.players.keys()).sort()[0] || "";
      room.ownerKey = nextOwner;
    }

    if (room.players.size === 0) {
      ctx.rooms.delete(room.id);
      ctx.broadcastLobbyState();
      return;
    }

    ctx.broadcastSnapshot(room, reason);
  }

  return {
    roomMeta,
    listRooms,
    statePayload,
    createRoom,
    addPlayerToRoom,
    startRoomBy,
    removePlayerFromRoom
  };
}
