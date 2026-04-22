import type { ServerWebSocket } from "bun";
import type { RoomMeta, RoomState, WsData } from "../models/server-types";
import { WS_ROOM_WELCOME_REASON, WS_SERVER_MSG, WS_STATE_TYPE } from "../../../shared/ws-protocol";

type CreateTransportServiceContext = {
  clients: Map<string, ServerWebSocket<WsData>>;
  connToPlayer: Map<string, string>;
  playerToConns: Map<string, Set<string>>;
  playerToRoom: Map<string, string>;
  rooms: Map<string, RoomState>;
  maxPlayers: number;
  tickMs: number;
  ensureConnectionMaps: (playerKey: string, connId: string) => void;
  roomMeta: (room: RoomState) => RoomMeta;
  listRooms: () => RoomMeta[];
  statePayload: (room: RoomState, type: (typeof WS_STATE_TYPE)[keyof typeof WS_STATE_TYPE], reason?: string) => unknown;
};

export function createTransportService(ctx: CreateTransportServiceContext) {
  function sendTo(connId: string, data: unknown) {
    const ws = ctx.clients.get(connId);
    if (!ws) return;
    ws.send(JSON.stringify(data));
  }

  function broadcastToRoom(room: RoomState, data: unknown) {
    const text = JSON.stringify(data);
    for (const playerKey of room.players.keys()) {
      const conns = ctx.playerToConns.get(playerKey);
      if (!conns) continue;
      for (const connId of conns.values()) {
        const ws = ctx.clients.get(connId);
        if (!ws) continue;
        ws.send(text);
      }
    }
  }

  function sendLobbyState(connId: string, playerKey?: string) {
    const roomId = playerKey ? ctx.playerToRoom.get(playerKey) || "" : "";
    const room = roomId ? ctx.rooms.get(roomId) : null;
    sendTo(connId, { type: WS_SERVER_MSG.lobbyState, room: room ? ctx.roomMeta(room) : null, rooms: ctx.listRooms() });
  }

  function broadcastLobbyState() {
    const rooms = ctx.listRooms();
    for (const ws of ctx.clients.values()) {
      if (!ws.data.authed) continue;
      const playerKey = ws.data.playerKey || "";
      const roomId = playerKey ? ctx.playerToRoom.get(playerKey) || "" : "";
      const room = roomId ? ctx.rooms.get(roomId) : null;
      sendTo(ws.data.connId, { type: WS_SERVER_MSG.lobbyState, room: room ? ctx.roomMeta(room) : null, rooms });
    }
  }

  function sendWelcome(
    connId: string,
    playerKey: string,
    reason: (typeof WS_ROOM_WELCOME_REASON)[keyof typeof WS_ROOM_WELCOME_REASON]
  ) {
    const roomId = ctx.playerToRoom.get(playerKey) || "";
    const room = roomId ? ctx.rooms.get(roomId) : null;
    if (!room) {
      sendLobbyState(connId, playerKey);
      return;
    }
    sendTo(connId, {
      type: WS_SERVER_MSG.welcome,
      id: playerKey,
      connId,
      maxPlayers: ctx.maxPlayers,
      tickMs: ctx.tickMs,
      snapshot: ctx.statePayload(room, WS_STATE_TYPE.snapshot, reason)
    });
  }

  function attachAuthedConnection(ws: ServerWebSocket<WsData>, playerKey: string, playerName: string) {
    const connId = ws.data.connId;
    ws.data.playerKey = playerKey;
    ws.data.playerName = playerName;
    ws.data.authed = true;
    ws.data.manualLeave = false;

    ctx.ensureConnectionMaps(playerKey, connId);

    const roomId = ctx.playerToRoom.get(playerKey) || "";
    const room = roomId ? ctx.rooms.get(roomId) : null;
    if (room && room.players.has(playerKey)) {
      room.offlineDeadlines.delete(playerKey);
      sendWelcome(connId, playerKey, WS_ROOM_WELCOME_REASON.existingPlayerAttach);
      return;
    }

    sendLobbyState(connId, playerKey);
  }

  return {
    sendTo,
    broadcastToRoom,
    sendLobbyState,
    broadcastLobbyState,
    sendWelcome,
    attachAuthedConnection
  };
}
