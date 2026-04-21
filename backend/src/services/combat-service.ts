import { SERVER_CONSTANTS } from "../config/game-constants";
import { angleWrapDelta } from "../utils/math-utils";
import type { RoomPlayer, RoomState } from "../models/server-types";

const KNIFE_MELEE_RANGE = SERVER_CONSTANTS.knifeMeleeRange;
const KNIFE_ARC_HALF_RAD = SERVER_CONSTANTS.knifeArcHalfRad;
const KNIFE_MELEE_DAMAGE = SERVER_CONSTANTS.knifeMeleeDamage;
const PLAYER_R = SERVER_CONSTANTS.playerRadius;
const RESPAWN_FRAMES = SERVER_CONSTANTS.respawnFrames;

export function applyKnifeMelee(
  attacker: RoomPlayer,
  room: RoomState,
  sortedIds: string[],
  clearReloadState: (p: RoomPlayer) => void
) {
  for (const oid of sortedIds) {
    if (oid === attacker.id) continue;
    const t = room.players.get(oid);
    if (!t || !t.alive) continue;
    const dx = t.x - attacker.x;
    const dy = t.y - attacker.y;
    const dist = Math.hypot(dx, dy);
    if (dist > KNIFE_MELEE_RANGE + PLAYER_R * 2) continue;
    const toTarget = Math.atan2(dy, dx);
    if (Math.abs(angleWrapDelta(toTarget, attacker.dir)) > KNIFE_ARC_HALF_RAD) continue;
    t.hp -= KNIFE_MELEE_DAMAGE;
    room.explosions.push({
      x: (attacker.x + t.x) * 0.5,
      y: (attacker.y + t.y) * 0.5,
      born: room.frame
    });
    if (t.hp <= 0) {
      t.alive = false;
      t.deaths += 1;
      t.respawnAt = room.frame + RESPAWN_FRAMES;
      clearReloadState(t);
    }
  }
}
