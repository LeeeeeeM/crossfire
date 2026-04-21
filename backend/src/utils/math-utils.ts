import type { Obstacle } from "../models/server-types";

export function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = (h ^ id.charCodeAt(i)) * 16777619;
  return Math.abs(h | 0);
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function angleWrapDelta(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function circleRectHit(cx: number, cy: number, r: number, ob: Obstacle) {
  const nx = clamp(cx, ob.x, ob.x + ob.w);
  const ny = clamp(cy, ob.y, ob.y + ob.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export function collisionAt(x: number, y: number, worldWidth: number, worldHeight: number, playerRadius: number, obstacles: Obstacle[]) {
  if (x < playerRadius || y < playerRadius || x > worldWidth - playerRadius || y > worldHeight - playerRadius) return true;
  return obstacles.some((ob) => circleRectHit(x, y, playerRadius, ob));
}
