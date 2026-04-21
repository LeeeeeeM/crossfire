import type { WsData } from "../models/server-types";
import { isValidPlayerKey, isValidPlayerName } from "../config/validation-config";

type HandleWsUpgradeRouteParams = {
  req: Request;
  url: URL;
  dbReady: boolean;
  json: (data: unknown, init?: ResponseInit) => Response;
  bearerToken: (req: Request, url: URL) => string;
  getUserByToken: (token: string) => Promise<{ id: string; username: string } | null>;
  nextConnId: () => string;
  createWsData: (connId: string, playerKey: string, playerName: string) => WsData;
  upgrade: (req: Request, opts: { data: WsData }) => boolean;
};

export async function handleWsUpgradeRoute(params: HandleWsUpgradeRouteParams): Promise<Response | null | undefined> {
  const { req, url, dbReady, json, bearerToken, getUserByToken, nextConnId, createWsData, upgrade } = params;
  if (url.pathname !== "/ws/lockstep") return null;

  const connId = nextConnId();
  let playerKey = "";
  let playerName = "";

  const token = bearerToken(req, url);
  if (dbReady) {
    if (!token) return json({ error: "unauthorized" }, { status: 401 });
    const user = await getUserByToken(token);
    if (!user) return json({ error: "unauthorized" }, { status: 401 });
    playerKey = `u_${user.id}`;
    playerName = user.username;
  } else {
    playerKey = (url.searchParams.get("playerKey") || "").trim();
    playerName = (url.searchParams.get("playerName") || "").trim();
  }

  if (!isValidPlayerKey(playerKey)) playerKey = "";
  if (!isValidPlayerName(playerName)) playerName = "";

  const ok = (req.headers.get("upgrade") || "").toLowerCase() === "websocket";
  if (!ok) return json({ error: "upgrade_required" }, { status: 426 });
  const upgraded = upgrade(req, { data: createWsData(connId, playerKey, playerName) });
  if (upgraded) return undefined as any;
  return json({ error: "upgrade_failed" }, { status: 400 });
}
