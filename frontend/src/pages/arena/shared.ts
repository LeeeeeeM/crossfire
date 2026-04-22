import type {
  WsBulletPayload,
  WsDropPayload,
  WsExplosionPayload,
  WsKnifeArcPayload,
  WsPlayerPayload,
  WsRoomMetaPayload,
  WsWorldPayload
} from "../../../../shared/ws-protocol";
import { WS_ROOM_STATUS } from "../../../../shared/ws-protocol";
import { ITEM, type ItemType } from "../../../../shared/items";

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

export type Player = WsPlayerPayload;

export type Drop = WsDropPayload;

export type Bullet = WsBulletPayload;

export type Explosion = WsExplosionPayload;

export type KnifeArcFx = WsKnifeArcPayload;

export type Obstacle = WsWorldPayload["obstacles"][number];

export type World = WsWorldPayload;

export type RoomMeta = WsRoomMetaPayload;

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
export const KNIFE_ARC_FX_FRAMES = 11;
export const DEFAULT_EXPLOSION_FX_FRAMES = 15;
export const DEFAULT_BULLET_SPAWN_OFFSET = 20;
export const DEFAULT_RELOAD_DURATION_FRAMES = 45;

export const ITEM_LABELS: Record<ItemType, string> = {
  [ITEM.knife]: "匕首",
  [ITEM.bandage]: "绷带",
  [ITEM.ammo9mm]: "9mm",
  [ITEM.ammo762]: "7.62",
  [ITEM.armorLight]: "轻甲",
  [ITEM.armorMid]: "中甲",
  [ITEM.armorHeavy]: "重甲",
  [ITEM.bootsLight]: "轻鞋",
  [ITEM.bootsMid]: "中鞋",
  [ITEM.bootsHeavy]: "重鞋",
  [ITEM.gunSmg9mm]: "SMG(9)",
  [ITEM.gunAr762]: "AR(7.62)",
  [ITEM.gunAk762]: "AK(7.62)",
  [ITEM.gunSniper762]: "Sniper(7.62)",
  [ITEM.gunM99mm]: "M9(9)"
};

export function itemLabel(t: string) {
  return (ITEM_LABELS as Record<string, string>)[t] || t;
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
    status:
      raw.room.status === WS_ROOM_STATUS.started
        ? WS_ROOM_STATUS.started
        : raw.room.status === WS_ROOM_STATUS.waiting
          ? WS_ROOM_STATUS.waiting
          : WS_ROOM_STATUS.idle,
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
        status:
          x.status === WS_ROOM_STATUS.started
            ? WS_ROOM_STATUS.started
            : x.status === WS_ROOM_STATUS.waiting
              ? WS_ROOM_STATUS.waiting
              : WS_ROOM_STATUS.idle,
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
  const fade = Math.pow(1 - t, 0.95);
  const { x: cx, y: cy, dir } = arc;
  const a0 = dir - KNIFE_ARC_HALF_RAD;
  const a1 = dir + KNIFE_ARC_HALF_RAD;
  const r = KNIFE_MELEE_RANGE;
  const sweep = a1 - a0;
  const sweepT = clamp(age / 3, 0, 1);
  const headAngle = a0 + sweep * clamp(0.08 + sweepT * 1.08, 0, 1);
  const tailSpan = sweep * (0.22 + (1 - t) * 0.46);
  const tailStart = Math.max(a0, headAngle - tailSpan);
  const segments = 22;

  ctx.save();
  ctx.lineCap = "butt";
  for (let i = 0; i < segments; i += 1) {
    const seg0 = i / segments;
    const seg1 = (i + 1) / segments;
    const ang0 = tailStart + (headAngle - tailStart) * seg0;
    const ang1 = tailStart + (headAngle - tailStart) * seg1;
    const k = (seg0 + seg1) * 0.5;
    const kPow = Math.pow(k, 1.55);
    const alpha = fade * (0.06 + 0.9 * kPow);
    const lineW = 1.7 + 2.5 * Math.pow(k, 1.05);
    const rr = r * (0.95 + 0.08 * k);
    const g = Math.round(72 + 180 * kPow);
    const b = Math.round(44 + 170 * kPow);

    ctx.beginPath();
    ctx.arc(cx, cy, rr, ang0, ang1, false);
    ctx.strokeStyle = `rgba(255, ${g}, ${b}, ${alpha})`;
    ctx.lineWidth = lineW;
    if (k > 0.8) {
      ctx.shadowColor = `rgba(255, 238, 210, ${alpha})`;
      ctx.shadowBlur = 10 + 8 * k;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const hx = cx + Math.cos(headAngle) * r * 1.02;
  const hy = cy + Math.sin(headAngle) * r * 1.02;
  const core = 2.2 + 1.5 * fade;
  const coreGrad = ctx.createRadialGradient(hx, hy, core * 0.35, hx, hy, core * 2.1);
  coreGrad.addColorStop(0, `rgba(255, 255, 245, ${0.95 * fade})`);
  coreGrad.addColorStop(0.42, `rgba(255, 228, 170, ${0.7 * fade})`);
  coreGrad.addColorStop(1, "rgba(255, 132, 54, 0)");
  ctx.beginPath();
  ctx.arc(hx, hy, core * 2.1, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();
  ctx.restore();
}
