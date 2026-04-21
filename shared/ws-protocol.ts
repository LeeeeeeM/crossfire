export const WS_STATE_TYPE = {
  state: "state",
  snapshot: "snapshot"
} as const;

export const WS_SERVER_MSG = {
  reject: "reject",
  needAuth: "need_auth",
  welcome: "welcome",
  lobbyState: "lobby_state",
  state: WS_STATE_TYPE.state,
  snapshot: WS_STATE_TYPE.snapshot
} as const;

export const WS_CLIENT_MSG = {
  auth: "auth",
  createRoom: "create_room",
  joinRoom: "join_room",
  startGame: "start_game",
  listRooms: "list_rooms",
  leave: "leave",
  input: "input",
  pickup: "pickup",
  dropItem: "drop_item"
} as const;

export const WS_REJECT_REASON = {
  unauthorized: "unauthorized",
  badPlayerKey: "bad_player_key",
  alreadyInRoom: "already_in_room",
  roomJoinFailed: "room_join_failed",
  roomNotFound: "room_not_found",
  roomFull: "room_full",
  roomExists: "room_exists",
  notInRoom: "not_in_room",
  notOwner: "not_owner",
  alreadyStarted: "already_started",
  invFull: "inv_full",
  itemLocked: "item_locked",
  emptyRoom: "empty_room",
  startFailed: "start_failed"
} as const;

export const WS_ROOM_EVENT = {
  playerJoin: "player_join",
  playerLeave: "player_leave",
  pickup: "pickup",
  drop: "drop",
  playerOffline: "player_offline",
  playerTimeout: "player_timeout",
  dropWave: "drop_wave",
  gameStarted: "game_started"
} as const;

export const WS_ROOM_WELCOME_REASON = {
  roomCreated: "room_created",
  existingPlayerAttach: "existing_player_attach",
  newPlayerJoin: "new_player_join"
} as const;

export function wsRoomReason(prefix: string, playerKey: string) {
  return `${prefix}_${playerKey}`;
}

export type WsRoomStatus = "idle" | "waiting" | "started";

export type WsRoomMetaPayload = {
  id: string;
  ownerKey: string;
  status: WsRoomStatus;
  playerCount: number;
  maxPlayers: number;
};

export type WsInventorySlotPayload = { t: string; q: number } | null;

export type WsPlayerPayload = {
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
  inv?: WsInventorySlotPayload[];
  reloadEndFrame?: number;
  reloadStartFrame?: number;
  reloadSlotIdx?: number;
};

export type WsWorldPayload = {
  width: number;
  height: number;
  obstacles: Array<{ x: number; y: number; w: number; h: number }>;
  reloadDurationFrames?: number;
  explosionFxFrames?: number;
  bulletSpawnOffset?: number;
};

export type WsBulletPayload = { id: string; owner: string; x: number; y: number; vx: number; vy: number; ttl: number };
export type WsExplosionPayload = { x: number; y: number; born: number };
export type WsKnifeArcPayload = { x: number; y: number; dir: number; born: number };
export type WsDropPayload = { id: string; t: string; x: number; y: number; q: number; born: number };

export type WsStateMessage = {
  type: (typeof WS_STATE_TYPE)[keyof typeof WS_STATE_TYPE];
  reason?: string;
  frame: number;
  serverTime: number;
  room: WsRoomMetaPayload;
  world: WsWorldPayload;
  players: WsPlayerPayload[];
  bullets: WsBulletPayload[];
  explosions: WsExplosionPayload[];
  knifeArcs: WsKnifeArcPayload[];
  drops: WsDropPayload[];
};

export type WsServerRejectMessage = {
  type: (typeof WS_SERVER_MSG)["reject"];
  reason: string;
  maxPlayers?: number;
};

export type WsServerNeedAuthMessage = {
  type: (typeof WS_SERVER_MSG)["needAuth"];
};

export type WsServerLobbyStateMessage = {
  type: (typeof WS_SERVER_MSG)["lobbyState"];
  room: WsRoomMetaPayload | null;
  rooms: WsRoomMetaPayload[];
};

export type WsServerWelcomeMessage = {
  type: (typeof WS_SERVER_MSG)["welcome"];
  id: string;
  connId: string;
  maxPlayers: number;
  tickMs: number;
  snapshot: WsStateMessage;
};

export type WsServerMessage =
  | WsServerRejectMessage
  | WsServerNeedAuthMessage
  | WsServerLobbyStateMessage
  | WsServerWelcomeMessage
  | WsStateMessage;

export type WsClientAuthMessage = { type: (typeof WS_CLIENT_MSG)["auth"]; playerKey: string; playerName: string };
export type WsClientCreateRoomMessage = { type: (typeof WS_CLIENT_MSG)["createRoom"] };
export type WsClientJoinRoomMessage = { type: (typeof WS_CLIENT_MSG)["joinRoom"]; roomId: string };
export type WsClientStartGameMessage = { type: (typeof WS_CLIENT_MSG)["startGame"] };
export type WsClientListRoomsMessage = { type: (typeof WS_CLIENT_MSG)["listRooms"] };
export type WsClientLeaveMessage = { type: (typeof WS_CLIENT_MSG)["leave"] };
export type WsClientInputMessage = {
  type: (typeof WS_CLIENT_MSG)["input"];
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  aimX: number;
  aimY: number;
  slot: number;
};
export type WsClientPickupMessage = { type: (typeof WS_CLIENT_MSG)["pickup"]; dropId: string };
export type WsClientDropItemMessage = { type: (typeof WS_CLIENT_MSG)["dropItem"]; slotIdx: number; qty?: number };

export type WsClientMessage =
  | WsClientAuthMessage
  | WsClientCreateRoomMessage
  | WsClientJoinRoomMessage
  | WsClientStartGameMessage
  | WsClientListRoomsMessage
  | WsClientLeaveMessage
  | WsClientInputMessage
  | WsClientPickupMessage
  | WsClientDropItemMessage;

const WS_SERVER_TYPE_SET = new Set<string>(Object.values(WS_SERVER_MSG));
const WS_CLIENT_TYPE_SET = new Set<string>(Object.values(WS_CLIENT_MSG));

export function isWsServerMessage(value: unknown): value is WsServerMessage {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return typeof t === "string" && WS_SERVER_TYPE_SET.has(t);
}

export function isWsClientMessage(value: unknown): value is WsClientMessage {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return typeof t === "string" && WS_CLIENT_TYPE_SET.has(t);
}
