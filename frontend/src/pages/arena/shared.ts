export type NetInput = {
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

export type Player = {
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
  weapons?: Array<{ t: string; q: number } | null>;
  items?: Array<{ t: string; q: number } | null>;
  inv?: Array<{ t: string; q: number } | null>;
  reloadEndFrame?: number;
  reloadStartFrame?: number;
  reloadSlotIdx?: number;
};

export type Drop = {
  id: string;
  t: string;
  x: number;
  y: number;
  q: number;
};

export type Bullet = {
  id: string;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
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

export type Obstacle = { x: number; y: number; w: number; h: number };

export type World = {
  width: number;
  height: number;
  obstacles: Obstacle[];
  reloadDurationFrames?: number;
  explosionFxFrames?: number;
  bulletSpawnOffset?: number;
};

export type RoomMeta = {
  id: string;
  ownerKey: string;
  status: "idle" | "waiting" | "started";
  playerCount: number;
  maxPlayers: number;
};

export const VIEW_W = 980;
export const VIEW_H = 620;
export const VIEW_ASPECT = VIEW_W / VIEW_H;
export const DEFAULT_WORLD_WIDTH = 2000;
export const DEFAULT_WORLD_HEIGHT = 1200;
export const PLAYER_R = 14;
export const MAX_HP = 90;
export const MOVE_PER_FRAME = 5;
export const DEFAULT_TICK_MS = 50;
export const DEFAULT_ROOM_MAX_PLAYERS = 5;
export const WEAPON_SLOT_SIZE = 3;
export const ITEM_SLOT_SIZE = 5;
export const INVENTORY_SIZE = WEAPON_SLOT_SIZE + ITEM_SLOT_SIZE;
export const MAX_PENDING_INPUTS = 200;
export const KNIFE_ARC_HALF_RAD = Math.PI / 3;
export const KNIFE_MELEE_RANGE = 52;
export const KNIFE_ARC_FX_FRAMES = 18;
export const DEFAULT_EXPLOSION_FX_FRAMES = 15;
export const DEFAULT_BULLET_SPAWN_OFFSET = 20;
export const DEFAULT_RELOAD_DURATION_FRAMES = 45;

export const ITEM_LABELS: Record<string, string> = {
  knife: "匕首",
  bandage: "绷带",
  ammo_9mm: "9mm",
  ammo_762: "7.62",
  armor_light: "轻甲",
  armor_mid: "中甲",
  armor_heavy: "重甲",
  boots_light: "轻鞋",
  boots_mid: "中鞋",
  boots_heavy: "重鞋",
  gun_smg_9mm: "SMG(9)",
  gun_ar_762: "AR(7.62)",
  gun_ak_762: "AK(7.62)",
  gun_sniper_762: "Sniper(7.62)",
  gun_m9_9mm: "M9(9)"
};

export function itemLabel(t: string) {
  return ITEM_LABELS[t] || t;
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function normalizeAngle(a: number) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function circleRectHit(cx: number, cy: number, r: number, ob: Obstacle) {
  const nx = clamp(cx, ob.x, ob.x + ob.w);
  const ny = clamp(cy, ob.y, ob.y + ob.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export function collisionAt(x: number, y: number, world: World) {
  if (x < PLAYER_R || y < PLAYER_R || x > world.width - PLAYER_R || y > world.height - PLAYER_R) return true;
  return world.obstacles.some((ob) => circleRectHit(x, y, PLAYER_R, ob));
}

export function parseRoom(raw: any): RoomMeta | null {
  if (!raw?.room || !raw.room.id) return null;
  return {
    id: String(raw.room.id),
    ownerKey: String(raw.room.ownerKey || ""),
    status: raw.room.status === "started" ? "started" : raw.room.status === "waiting" ? "waiting" : "idle",
    playerCount: Number(raw.room.playerCount || 0),
    maxPlayers: Number(raw.room.maxPlayers || DEFAULT_ROOM_MAX_PLAYERS)
  };
}

export function parseRooms(raw: any): RoomMeta[] {
  if (Array.isArray(raw?.rooms)) {
    return raw.rooms
      .filter((x: any) => x && x.id)
      .map((x: any) => ({
        id: String(x.id),
        ownerKey: String(x.ownerKey || ""),
        status: x.status === "started" ? "started" : x.status === "waiting" ? "waiting" : "idle",
        playerCount: Number(x.playerCount || 0),
        maxPlayers: Number(x.maxPlayers || DEFAULT_ROOM_MAX_PLAYERS)
      }));
  }
  const single = parseRoom(raw);
  return single ? [single] : [];
}

export function drawReloadRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, progress: number) {
  const r = 11;
  const prog = clamp(progress, 0, 1);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (prog > 0.001) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

export function drawKnifeArcFx(ctx: CanvasRenderingContext2D, arc: KnifeArcFx, frame: number) {
  const age = frame - arc.born;
  if (age < 0 || age > KNIFE_ARC_FX_FRAMES) return;
  const t = clamp(age / KNIFE_ARC_FX_FRAMES, 0, 1);
  const fade = 1 - t;
  const { x: cx, y: cy, dir } = arc;
  const a0 = dir - KNIFE_ARC_HALF_RAD;
  const a1 = dir + KNIFE_ARC_HALF_RAD;
  const r = KNIFE_MELEE_RANGE;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a0, a1, false);
  ctx.closePath();
  const fillAlpha = 0.42 * fade;
  const grad = ctx.createRadialGradient(cx, cy, PLAYER_R * 0.4, cx, cy, r);
  grad.addColorStop(0, `rgba(255, 252, 235, ${fillAlpha * 0.35})`);
  grad.addColorStop(0.45, `rgba(255, 185, 95, ${fillAlpha * 0.72})`);
  grad.addColorStop(1, `rgba(255, 95, 45, ${fillAlpha * 0.22})`);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1, false);
  ctx.strokeStyle = `rgba(255, 238, 210, ${0.82 * fade})`;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 210, 140, 0.85)";
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, a0 + 0.05, a1 - 0.05, false);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 * fade})`;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
}
