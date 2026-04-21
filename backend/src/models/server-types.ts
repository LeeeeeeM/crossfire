import type { Obstacle } from "../data/game-data";

export type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  reload: boolean;
  aimX: number;
  aimY: number;
  slot: number;
};

export type ItemType =
  | "knife"
  | "bandage"
  | "ammo_9mm"
  | "ammo_762"
  | "armor_light"
  | "armor_mid"
  | "armor_heavy"
  | "boots_light"
  | "boots_mid"
  | "boots_heavy"
  | "gun_smg_9mm"
  | "gun_ar_762"
  | "gun_ak_762"
  | "gun_sniper_762"
  | "gun_m9_9mm";

export type InventorySlot = {
  t: ItemType;
  q: number;
};

export type Drop = {
  id: string;
  t: ItemType;
  x: number;
  y: number;
  q: number;
  born: number;
};

export type RoomPlayer = {
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
  prevReload: boolean;
  deaths: number;
  weapons: Array<InventorySlot | null>;
  items: Array<InventorySlot | null>;
  input: InputState;
  lastInputAt: number;
  lastProcessedInputSeq: number;
  reloadEndFrame: number;
  reloadStartFrame: number;
  reloadSlotIdx: number;
};

export type Bullet = {
  id: string;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  damage: number;
};

export type Explosion = {
  x: number;
  y: number;
  born: number;
};

export type KnifeArcFx = {
  x: number;
  y: number;
  dir: number;
  born: number;
};

export type RoomStatus = "idle" | "waiting" | "started";

export type WsData = {
  connId: string;
  playerKey: string;
  playerName: string;
  authed: boolean;
  manualLeave: boolean;
};

export type RoomMeta = {
  id: string;
  ownerKey: string;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
};

export type RoomState = {
  id: string;
  ownerKey: string;
  status: RoomStatus;
  createdAt: number;
  frame: number;
  bulletSeq: number;
  dropSeq: number;
  nextDropAt: number;
  players: Map<string, RoomPlayer>;
  bullets: Bullet[];
  explosions: Explosion[];
  knifeArcs: KnifeArcFx[];
  offlineDeadlines: Map<string, number>;
  drops: Drop[];
};

export type { Obstacle };
