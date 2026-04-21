import type { ServerWebSocket } from "bun";
import type { InventorySlot, ItemType, RoomPlayer, RoomState, WsData } from "../models/server-types";
import { fallbackPlayerName, isValidPlayerKey, isValidPlayerName } from "../config/validation-config";
import {
  isWsClientMessage,
  WS_CLIENT_MSG,
  WS_REJECT_REASON,
  WS_ROOM_EVENT,
  WS_ROOM_WELCOME_REASON,
  WS_SERVER_MSG,
  wsRoomReason,
  type WsClientMessage
} from "../../../shared/ws-protocol";

type WsHandlerContext = {
  clients: Map<string, ServerWebSocket<WsData>>;
  connToPlayer: Map<string, string>;
  playerToConns: Map<string, Set<string>>;
  playerToRoom: Map<string, string>;
  rooms: Map<string, RoomState>;
  maxPlayers: number;
  weaponSlotSize: number;
  itemSlotSize: number;
  pickupRadius: number;
  reconnectGraceMs: number;
  dropThrowOffset: number;
  isDbReady: () => boolean;
  ensureWsData: (ws: ServerWebSocket<WsData>) => WsData;
  attachAuthedConnection: (ws: ServerWebSocket<WsData>, playerKey: string, playerName: string) => void;
  createRoom: (ownerKey: string) => RoomState;
  addPlayerToRoom: (room: RoomState, playerKey: string, playerName: string) => RoomPlayer | null;
  sendWelcome: (
    connId: string,
    playerKey: string,
    reason: (typeof WS_ROOM_WELCOME_REASON)[keyof typeof WS_ROOM_WELCOME_REASON]
  ) => void;
  broadcastSnapshot: (room: RoomState, reason: string) => void;
  sendLobbyState: (connId: string, playerKey?: string) => void;
  startRoomBy: (
    room: RoomState,
    ownerKey: string
  ) => { ok: boolean; reason?: (typeof WS_REJECT_REASON)[keyof typeof WS_REJECT_REASON] };
  removePlayerFromRoom: (room: RoomState, playerKey: string, reason: string) => void;
  clamp: (v: number, min: number, max: number) => number;
  collisionAt: (x: number, y: number) => boolean;
  canTakeAmmoPickup: (weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, ammoType: ItemType) => boolean;
  hasSpaceForPickup: (weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, itemType: ItemType) => boolean;
  applyAmmoPickup: (weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, ammoType: ItemType, qty: number) => number;
  addPickup: (weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, itemType: ItemType, qty: number) => number;
  removeWeaponAt: (weapons: Array<InventorySlot | null>, idx: number, qty?: number) => InventorySlot | null;
  removeItemAt: (items: Array<InventorySlot | null>, idx: number, qty?: number) => InventorySlot | null;
};

const AMMO_PICKUP_TYPES = new Set<ItemType>(["ammo_9mm", "ammo_762"]);

function sendJson(ws: ServerWebSocket<WsData>, data: unknown) {
  ws.send(JSON.stringify(data));
}

function sendReject(
  ws: ServerWebSocket<WsData>,
  reason: (typeof WS_REJECT_REASON)[keyof typeof WS_REJECT_REASON] | string,
  extra?: Record<string, unknown>
) {
  sendJson(ws, { type: WS_SERVER_MSG.reject, reason, ...(extra || {}) });
}

function isAmmoPickupType(itemType: ItemType) {
  return AMMO_PICKUP_TYPES.has(itemType);
}

export function makeWebSocketHandlers(ctx: WsHandlerContext) {
  return {
    open(ws: ServerWebSocket<WsData>) {
      const { connId, playerKey, playerName } = ctx.ensureWsData(ws);
      ctx.clients.set(connId, ws);
      if (isValidPlayerKey(playerKey) && isValidPlayerName(playerName)) {
        ctx.attachAuthedConnection(ws, playerKey, playerName);
        return;
      }
      if (ctx.isDbReady()) {
        sendReject(ws, WS_REJECT_REASON.unauthorized);
        ws.close();
        return;
      }
      sendJson(ws, { type: WS_SERVER_MSG.needAuth });
    },

    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      const wsData = ctx.ensureWsData(ws);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(String(message));
      } catch {
        return;
      }
      if (!isWsClientMessage(parsed)) return;
      const msg: WsClientMessage = parsed;

      if (!wsData.authed) {
        if (ctx.isDbReady()) {
          sendReject(ws, WS_REJECT_REASON.unauthorized);
          ws.close();
          return;
        }
        if (msg.type !== WS_CLIENT_MSG.auth) return;
        const playerKey = String(msg.playerKey).trim();
        let playerName = String(msg.playerName).trim();
        if (!isValidPlayerKey(playerKey)) {
          sendReject(ws, WS_REJECT_REASON.badPlayerKey);
          ws.close();
          return;
        }
        if (!isValidPlayerName(playerName)) {
          playerName = fallbackPlayerName(playerKey);
        }
        ctx.attachAuthedConnection(ws, playerKey, playerName);
        return;
      }

      const playerKey = wsData.playerKey;
      const playerName = wsData.playerName;
      if (!playerKey) return;

      if (msg.type === WS_CLIENT_MSG.createRoom) {
        const existingRoomId = ctx.playerToRoom.get(playerKey) || "";
        if (existingRoomId) {
          sendReject(ws, WS_REJECT_REASON.alreadyInRoom);
          return;
        }
        const room = ctx.createRoom(playerKey);
        const p = ctx.addPlayerToRoom(room, playerKey, playerName);
        if (!p) {
          sendReject(ws, WS_REJECT_REASON.roomJoinFailed);
          return;
        }

        ctx.sendWelcome(wsData.connId, playerKey, WS_ROOM_WELCOME_REASON.roomCreated);
        ctx.broadcastSnapshot(room, wsRoomReason(WS_ROOM_EVENT.playerJoin, playerKey));
        return;
      }

      if (msg.type === WS_CLIENT_MSG.joinRoom) {
        const reqRoomId = String(msg.roomId).trim();
        const room = ctx.rooms.get(reqRoomId);
        if (!room) {
          sendReject(ws, WS_REJECT_REASON.roomNotFound);
          ctx.sendLobbyState(wsData.connId, playerKey);
          return;
        }

        const existingRoomId = ctx.playerToRoom.get(playerKey) || "";
        if (existingRoomId) {
          if (existingRoomId === room.id) {
            ctx.sendWelcome(wsData.connId, playerKey, WS_ROOM_WELCOME_REASON.existingPlayerAttach);
            return;
          }
          sendReject(ws, WS_REJECT_REASON.alreadyInRoom);
          return;
        }

        if (room.players.size >= ctx.maxPlayers) {
          sendReject(ws, WS_REJECT_REASON.roomFull, { maxPlayers: ctx.maxPlayers });
          return;
        }

        const p = ctx.addPlayerToRoom(room, playerKey, playerName);
        if (!p) {
          sendReject(ws, WS_REJECT_REASON.roomJoinFailed);
          return;
        }

        ctx.sendWelcome(wsData.connId, playerKey, WS_ROOM_WELCOME_REASON.newPlayerJoin);
        ctx.broadcastSnapshot(room, wsRoomReason(WS_ROOM_EVENT.playerJoin, playerKey));
        return;
      }

      if (msg.type === WS_CLIENT_MSG.startGame) {
        const roomId = ctx.playerToRoom.get(playerKey) || "";
        const room = roomId ? ctx.rooms.get(roomId) : null;
        if (!room) {
          sendReject(ws, WS_REJECT_REASON.notInRoom);
          return;
        }
        const ret = ctx.startRoomBy(room, playerKey);
        if (!ret.ok) sendReject(ws, ret.reason || WS_REJECT_REASON.startFailed);
        return;
      }

      const roomId = ctx.playerToRoom.get(playerKey) || "";
      const room = roomId ? ctx.rooms.get(roomId) : null;
      const p = room ? room.players.get(playerKey) : null;
      if (!room || !p) {
        if (msg.type === WS_CLIENT_MSG.listRooms) ctx.sendLobbyState(wsData.connId, playerKey);
        return;
      }

      if (msg.type === WS_CLIENT_MSG.leave) {
        ctx.removePlayerFromRoom(room, playerKey, wsRoomReason(WS_ROOM_EVENT.playerLeave, playerKey));
        ctx.sendLobbyState(wsData.connId, playerKey);
        return;
      }

      if (msg.type === WS_CLIENT_MSG.input) {
        if (!room || room.status !== "started") return;

        const seq = Number(msg.seq);
        if (!Number.isFinite(seq) || seq <= p.lastProcessedInputSeq) return;

        p.input = {
          up: !!msg.up,
          down: !!msg.down,
          left: !!msg.left,
          right: !!msg.right,
          shoot: !!msg.shoot,
          reload: !!msg.reload,
          aimX: Number(msg.aimX),
          aimY: Number(msg.aimY),
          slot: ctx.clamp(Math.floor(Number(msg.slot)), 0, ctx.weaponSlotSize - 1)
        };
        p.lastInputAt = Date.now();
        p.lastProcessedInputSeq = seq;
      }

      if (msg.type === WS_CLIENT_MSG.pickup) {
        if (!room || room.status !== "started") return;
        const dropId = String(msg.dropId).trim();
        const dropIdx = room.drops.findIndex((d) => d.id === dropId);
        if (dropIdx < 0) return;
        const d = room.drops[dropIdx];
        const dist2 = (p.x - d.x) * (p.x - d.x) + (p.y - d.y) * (p.y - d.y);
        if (dist2 > ctx.pickupRadius * ctx.pickupRadius) return;
        if (isAmmoPickupType(d.t)) {
          if (!ctx.canTakeAmmoPickup(p.weapons, p.items, d.t)) {
            sendReject(ws, WS_REJECT_REASON.invFull);
            return;
          }
        } else if (!ctx.hasSpaceForPickup(p.weapons, p.items, d.t)) {
          sendReject(ws, WS_REJECT_REASON.invFull);
          return;
        }

        const rem = isAmmoPickupType(d.t)
          ? ctx.applyAmmoPickup(p.weapons, p.items, d.t, d.q)
          : ctx.addPickup(p.weapons, p.items, d.t, d.q);
        if (rem > 0) {
          d.q = rem;
        } else {
          room.drops.splice(dropIdx, 1);
        }
        ctx.broadcastSnapshot(room, wsRoomReason(WS_ROOM_EVENT.pickup, playerKey));
        return;
      }

      if (msg.type === WS_CLIENT_MSG.dropItem) {
        if (!room || room.status !== "started") return;
        const idx = Number(msg.slotIdx);
        const section = msg.section === "item" ? "item" : "weapon";
        const slotCap = section === "weapon" ? ctx.weaponSlotSize : ctx.itemSlotSize;
        if (!Number.isFinite(idx) || idx < 0 || idx >= slotCap) return;
        const removed =
          section === "weapon"
            ? ctx.removeWeaponAt(p.weapons, idx, Number(msg.qty || 0) || undefined)
            : ctx.removeItemAt(p.items, idx, Number(msg.qty || 0) || undefined);
        if (!removed) {
          sendReject(ws, WS_REJECT_REASON.itemLocked);
          return;
        }

        let x = p.x + Math.cos(p.dir) * ctx.dropThrowOffset;
        let y = p.y + Math.sin(p.dir) * ctx.dropThrowOffset;
        if (ctx.collisionAt(x, y)) {
          x = p.x;
          y = p.y;
        }
        room.drops.push({ id: `d_${room.id}_${room.dropSeq++}`, t: removed.t, x, y, q: removed.q, born: room.frame });
        ctx.broadcastSnapshot(room, wsRoomReason(WS_ROOM_EVENT.drop, playerKey));
        return;
      }
    },

    close(ws: ServerWebSocket<WsData>) {
      const { connId, playerKey, authed } = ctx.ensureWsData(ws);
      ctx.clients.delete(connId);
      if (!authed) return;

      ctx.connToPlayer.delete(connId);

      const connSet = ctx.playerToConns.get(playerKey);
      if (!connSet) return;
      connSet.delete(connId);
      if (connSet.size > 0) return;
      ctx.playerToConns.delete(playerKey);

      const roomId = ctx.playerToRoom.get(playerKey) || "";
      const room = roomId ? ctx.rooms.get(roomId) : null;
      if (room && room.players.has(playerKey)) {
        room.offlineDeadlines.set(playerKey, Date.now() + ctx.reconnectGraceMs);
        ctx.broadcastSnapshot(room, wsRoomReason(WS_ROOM_EVENT.playerOffline, playerKey));
      }
    }
  };
}
