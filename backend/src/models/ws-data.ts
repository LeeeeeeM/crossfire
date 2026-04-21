import type { ServerWebSocket } from "bun";
import type { WsData } from "./server-types";

export function createWsData(connId: string, playerKey: string, playerName: string): WsData {
  return { connId, playerKey, playerName, authed: false, manualLeave: false };
}

export function ensureWsData(ws: ServerWebSocket<WsData>) {
  ws.data ??= createWsData("", "", "");
  return ws.data;
}
