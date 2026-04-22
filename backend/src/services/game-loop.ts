import { applyKnifeMelee } from "./combat-service";
import { clearReloadState, gunStat, isGunItem, tryCompleteReload, tryStartAutoReload, tryStartManualReload } from "./inventory-service";
import { pickDropLootByRatio, resolveDropQty } from "../data/drop-loot-table";
import type { RoomPlayer, RoomState } from "../models/server-types";
import { ITEM } from "../../../shared/items";
import { WS_ROOM_EVENT, WS_ROOM_STATUS, WS_STATE_TYPE, wsRoomReason } from "../../../shared/ws-protocol";

type GameLoopContext = {
  tickMs: number;
  rooms: Map<string, RoomState>;
  obstacles: Array<{ x: number; y: number; w: number; h: number }>;
  maxDrops: number;
  dropIntervalFrames: number;
  dropJitterFrames: number;
  dropBatchBase: number;
  dropBatchCycle: number;
  dropSpawnAttempts: number;
  dropRandomSaltMod: number;
  magSmg9mm: number;
  magAr762: number;
  magAk762: number;
  magSniper762: number;
  magM9: number;
  playerRadius: number;
  worldWidth: number;
  worldHeight: number;
  inputTimeoutMs: number;
  movePerFrame: number;
  maxHp: number;
  knifeCooldownFrames: number;
  bulletSpawnOffset: number;
  bulletHitRadiusPadding: number;
  explosionFxFrames: number;
  respawnFrames: number;
  weaponSlotSize: number;
  knifeArcFxFrames: number;
  collisionAt: (x: number, y: number) => boolean;
  clearActionInputKeepAim: (input: RoomPlayer["input"]) => RoomPlayer["input"];
  removePlayerFromRoom: (room: RoomState, playerKey: string, reason: string) => void;
  spawnFor: (player: RoomPlayer) => { x: number; y: number };
  clamp: (v: number, min: number, max: number) => number;
  broadcastSnapshot: (room: RoomState, reason: string) => void;
  statePayload: (room: RoomState, type: (typeof WS_STATE_TYPE)[keyof typeof WS_STATE_TYPE], reason?: string) => unknown;
  broadcastToRoom: (room: RoomState, data: unknown) => void;
};

export function startGameLoop(ctx: GameLoopContext) {
  return setInterval(() => {
    const now = Date.now();
    for (const room of ctx.rooms.values()) {
      if (room.status !== WS_ROOM_STATUS.started) continue;

      room.frame += 1;

      if (room.drops.length < ctx.maxDrops && room.frame >= room.nextDropAt) {
        const batchCycle = Math.max(1, ctx.dropBatchCycle);
        const randomSaltMod = Math.max(1, ctx.dropRandomSaltMod);
        const spawnAttempts = Math.max(1, ctx.dropSpawnAttempts);
        const batch = Math.max(1, ctx.dropBatchBase) + (room.frame % batchCycle);
        for (let i = 0; i < batch && room.drops.length < ctx.maxDrops; i += 1) {
          const r = (Math.random() + (room.frame % randomSaltMod) / randomSaltMod) % 1;
          const pick = pickDropLootByRatio(r);
          const qty = resolveDropQty(pick.qty, {
            smg9mm: ctx.magSmg9mm,
            ar762: ctx.magAr762,
            ak762: ctx.magAk762,
            sniper762: ctx.magSniper762,
            m9: ctx.magM9
          });
          let x = 0;
          let y = 0;
          for (let t = 0; t < spawnAttempts; t += 1) {
            x = ctx.playerRadius + Math.random() * (ctx.worldWidth - ctx.playerRadius * 2);
            y = ctx.playerRadius + Math.random() * (ctx.worldHeight - ctx.playerRadius * 2);
            if (ctx.collisionAt(x, y)) continue;
            break;
          }
          room.drops.push({ id: `d_${room.id}_${room.dropSeq++}`, t: pick.item, x, y, q: qty, born: room.frame });
        }

        const jitter = Math.floor((Math.random() * 2 - 1) * ctx.dropJitterFrames);
        room.nextDropAt = room.frame + ctx.dropIntervalFrames + jitter;
        ctx.broadcastSnapshot(room, WS_ROOM_EVENT.dropWave);
      }

      for (const [playerKey, deadline] of room.offlineDeadlines.entries()) {
        if (now >= deadline) {
          ctx.removePlayerFromRoom(room, playerKey, wsRoomReason(WS_ROOM_EVENT.playerTimeout, playerKey));
        }
      }

      const ids = Array.from(room.players.keys()).sort();

      for (const id of ids) {
        const p = room.players.get(id);
        if (!p) continue;

        if (now - p.lastInputAt > ctx.inputTimeoutMs) {
          p.input = ctx.clearActionInputKeepAim(p.input);
        }

        const input = p.input;

        if (!p.alive) {
          clearReloadState(p);
          if (room.frame >= p.respawnAt) {
            const s = ctx.spawnFor(p);
            p.x = s.x;
            p.y = s.y;
            p.hp = ctx.maxHp;
            p.alive = true;
            p.cooldown = 0;
            p.prevShoot = false;
            p.prevReload = false;
            clearReloadState(p);
          }
          continue;
        }

        tryCompleteReload(p, room);

        const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const len = Math.hypot(dx, dy) || 1;
        const vx = (dx / len) * ctx.movePerFrame;
        const vy = (dy / len) * ctx.movePerFrame;

        let nx = p.x + vx;
        let ny = p.y;
        if (ctx.collisionAt(nx, ny)) nx = p.x;
        ny = p.y + vy;
        if (ctx.collisionAt(nx, ny)) ny = p.y;
        p.x = nx;
        p.y = ny;

        const angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
        if (Number.isFinite(angle)) p.dir = angle;

        if (p.cooldown > 0) p.cooldown -= 1;
        const shootEdge = input.shoot && !p.prevShoot;
        const rawSlot = Number(input.slot);
        const selIdx = ctx.clamp(Number.isFinite(rawSlot) ? Math.floor(rawSlot) : 0, 0, ctx.weaponSlotSize - 1);
        const selWeapon = p.weapons[selIdx];
        const reloadEdge = input.reload && !p.prevReload;
        if (reloadEdge && selWeapon && isGunItem(selWeapon.t)) {
          tryStartManualReload(p, room, selIdx);
        }
        if (shootEdge && p.cooldown <= 0 && selWeapon) {
          if (selWeapon.t === ITEM.knife) {
            applyKnifeMelee(p, room, ids, clearReloadState);
            room.knifeArcs.push({
              x: p.x,
              y: p.y,
              dir: p.dir,
              born: room.frame
            });
            p.cooldown = ctx.knifeCooldownFrames;
          } else if (isGunItem(selWeapon.t)) {
            const stat = gunStat(selWeapon.t);
            if (selWeapon.q > 0) {
              selWeapon.q -= 1;
              room.bullets.push({
                id: `${room.frame}-${room.bulletSeq++}`,
                owner: p.id,
                x: p.x + Math.cos(p.dir) * ctx.bulletSpawnOffset,
                y: p.y + Math.sin(p.dir) * ctx.bulletSpawnOffset,
                vx: Math.cos(p.dir) * stat.bulletSpeed,
                vy: Math.sin(p.dir) * stat.bulletSpeed,
                ttl: stat.bulletTtl,
                damage: stat.damage
              });
              p.cooldown = stat.fireCooldownFrames;
              if (selWeapon.q === 0) {
                tryStartAutoReload(p, room, selIdx);
              }
            } else {
              tryStartAutoReload(p, room, selIdx);
            }
          }
        }
        p.prevShoot = input.shoot;
        p.prevReload = input.reload;
      }

      for (let i = room.bullets.length - 1; i >= 0; i -= 1) {
        const b = room.bullets[i];
        b.x += b.vx;
        b.y += b.vy;
        b.ttl -= 1;

        let remove = b.ttl <= 0;
        if (!remove && (b.x < 0 || b.y < 0 || b.x > ctx.worldWidth || b.y > ctx.worldHeight)) {
          remove = true;
        }

        if (!remove) {
          for (const ob of ctx.obstacles) {
            if (b.x >= ob.x && b.x <= ob.x + ob.w && b.y >= ob.y && b.y <= ob.y + ob.h) {
              remove = true;
              room.explosions.push({ x: b.x, y: b.y, born: room.frame });
              break;
            }
          }
        }

        if (!remove) {
          for (const id of ids) {
            if (id === b.owner) continue;
            const p = room.players.get(id);
            if (!p || !p.alive) continue;

            const d2 = (p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y);
            if (d2 <= (ctx.playerRadius + ctx.bulletHitRadiusPadding) * (ctx.playerRadius + ctx.bulletHitRadiusPadding)) {
              p.hp -= b.damage;
              room.explosions.push({ x: b.x, y: b.y, born: room.frame });
              if (p.hp <= 0) {
                p.alive = false;
                p.deaths += 1;
                p.respawnAt = room.frame + ctx.respawnFrames;
                clearReloadState(p);
              }
              remove = true;
              break;
            }
          }
        }

        if (remove) room.bullets.splice(i, 1);
      }

      room.explosions = room.explosions.filter((e) => room.frame - e.born <= ctx.explosionFxFrames);
      room.knifeArcs = room.knifeArcs.filter((e) => room.frame - e.born <= ctx.knifeArcFxFrames);

      ctx.broadcastToRoom(room, ctx.statePayload(room, WS_STATE_TYPE.state));
    }
  }, ctx.tickMs);
}
