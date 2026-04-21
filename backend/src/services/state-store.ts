import type { ServerWebSocket } from "bun";
import type { RoomState, WsData } from "../models/server-types";

export function createServerStateStore() {
  const rooms = new Map<string, RoomState>();
  const playerToRoom = new Map<string, string>();
  const clients = new Map<string, ServerWebSocket<WsData>>();
  const connToPlayer = new Map<string, string>();
  const playerToConns = new Map<string, Set<string>>();
  return {
    rooms,
    playerToRoom,
    clients,
    connToPlayer,
    playerToConns
  };
}

export function ensureConnectionMaps(
  connToPlayer: Map<string, string>,
  playerToConns: Map<string, Set<string>>,
  playerKey: string,
  connId: string
) {
  connToPlayer.set(connId, playerKey);
  let connSet = playerToConns.get(playerKey);
  if (!connSet) {
    connSet = new Set<string>();
    playerToConns.set(playerKey, connSet);
  }
  connSet.add(connId);
}
