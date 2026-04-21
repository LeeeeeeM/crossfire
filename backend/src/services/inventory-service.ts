import { SERVER_CONSTANTS } from "../config/game-constants";
import {
  AMMO_ITEMS,
  AMMO_TO_GUNS,
  GUN_ITEMS,
  GUN_TO_AMMO,
  ITEM_FIRE_COOLDOWN,
  ITEM_MAX_STACK,
  STACKABLE_ITEMS,
  type AmmoItemType,
  type GunItemType
} from "../data/item-balance";
import type { InventorySlot, ItemType, RoomPlayer, RoomState } from "../models/server-types";

const INVENTORY_SIZE = SERVER_CONSTANTS.inventorySize;
const RELOAD_DURATION_FRAMES = SERVER_CONSTANTS.reloadDurationFrames;

function isStackable(t: ItemType) {
  return STACKABLE_ITEMS.has(t);
}

function isAmmoItem(t: ItemType): t is AmmoItemType {
  return AMMO_ITEMS.has(t as AmmoItemType);
}

function isGunItem(t: ItemType): t is GunItemType {
  return GUN_ITEMS.has(t as GunItemType);
}

export function maxStack(t: ItemType) {
  return ITEM_MAX_STACK[t];
}

export function invHasSpaceFor(inv: Array<InventorySlot | null>, t: ItemType) {
  if (isStackable(t)) {
    for (const slot of inv) {
      if (slot && slot.t === t && slot.q < maxStack(t)) return true;
    }
  }
  return inv.some((s) => !s);
}

export function invAdd(inv: Array<InventorySlot | null>, t: ItemType, qty: number) {
  let remaining = qty;
  if (isStackable(t)) {
    const cap = maxStack(t);
    for (let i = 0; i < inv.length; i += 1) {
      const s = inv[i];
      if (!s || s.t !== t || s.q >= cap) continue;
      const take = Math.min(remaining, cap - s.q);
      s.q += take;
      remaining -= take;
      if (remaining <= 0) return 0;
    }
  }
  const cap = maxStack(t);
  for (let i = 0; i < inv.length; i += 1) {
    if (inv[i]) continue;
    const put = Math.min(remaining, cap);
    inv[i] = { t, q: put };
    remaining -= put;
    if (remaining <= 0) return 0;
  }
  return remaining;
}

export function invRemoveAt(inv: Array<InventorySlot | null>, idx: number, qty?: number) {
  const s = inv[idx];
  if (!s) return null;
  if (s.t === "knife") return null;
  const take = Math.max(1, Math.min(qty ?? s.q, s.q));
  s.q -= take;
  const ret: InventorySlot = { t: s.t, q: take };
  if (s.q <= 0) inv[idx] = null;
  return ret;
}

export function invApplyAmmoPickup(inv: Array<InventorySlot | null>, ammoType: ItemType, qty: number): number {
  if (!isAmmoItem(ammoType)) return invAdd(inv, ammoType, qty);
  let remaining = qty;
  const bindGuns = AMMO_TO_GUNS[ammoType];
  for (let i = 0; i < inv.length && remaining > 0; i += 1) {
    const s = inv[i];
    if (!s || !isGunItem(s.t) || !bindGuns.includes(s.t)) continue;
    const cap = maxStack(s.t);
    const space = cap - s.q;
    if (space <= 0) continue;
    const add = Math.min(remaining, space);
    s.q += add;
    remaining -= add;
    if (remaining <= 0) break;
  }
  if (remaining <= 0) return 0;
  return invAdd(inv, ammoType, remaining);
}

export function invCanTakeAmmoPickup(inv: Array<InventorySlot | null>, ammoType: ItemType) {
  if (!isAmmoItem(ammoType)) return invHasSpaceFor(inv, ammoType);

  const bindGuns = AMMO_TO_GUNS[ammoType];
  if (
    inv.some((s) => {
      if (!s || !isGunItem(s.t) || !bindGuns.includes(s.t)) return false;
      return s.q < maxStack(s.t);
    })
  ) {
    return true;
  }
  return invHasSpaceFor(inv, ammoType);
}

function invAmmoStackTotal(inv: Array<InventorySlot | null>, ammoType: AmmoItemType): number {
  let n = 0;
  for (const s of inv) {
    if (s && s.t === ammoType) n += s.q;
  }
  return n;
}

function invReloadGunFromStacks(inv: Array<InventorySlot | null>, gunSlotIdx: number) {
  const gun = inv[gunSlotIdx];
  if (!gun || !isGunItem(gun.t)) return;
  const ammoType = GUN_TO_AMMO[gun.t];
  const cap = maxStack(gun.t);
  let need = cap - gun.q;
  if (need <= 0) return;
  for (let i = 0; i < inv.length && need > 0; i += 1) {
    if (i === gunSlotIdx) continue;
    const s = inv[i];
    if (!s || s.t !== ammoType) continue;
    const take = Math.min(need, s.q);
    gun.q += take;
    s.q -= take;
    need -= take;
    if (s.q <= 0) inv[i] = null;
  }
}

export function clearReloadState(p: RoomPlayer) {
  p.reloadEndFrame = 0;
  p.reloadStartFrame = 0;
  p.reloadSlotIdx = -1;
}

export function tryCompleteReload(p: RoomPlayer, room: RoomState) {
  if (!p.reloadEndFrame || room.frame < p.reloadEndFrame) return;
  const idx = p.reloadSlotIdx;
  if (idx >= 0 && idx < INVENTORY_SIZE) {
    invReloadGunFromStacks(p.inv, idx);
  }
  clearReloadState(p);
}

export function tryStartAutoReload(p: RoomPlayer, room: RoomState, gunSlotIdx: number) {
  if (p.reloadEndFrame > room.frame) return;
  const gun = p.inv[gunSlotIdx];
  if (!gun || !isGunItem(gun.t)) return;
  if (gun.q > 0) return;
  const ammoType = GUN_TO_AMMO[gun.t];
  if (invAmmoStackTotal(p.inv, ammoType) <= 0) return;
  p.reloadStartFrame = room.frame;
  p.reloadEndFrame = room.frame + RELOAD_DURATION_FRAMES;
  p.reloadSlotIdx = gunSlotIdx;
}

export const GUN_FIRE_COOLDOWN: Record<ItemType, number> = {
  ...ITEM_FIRE_COOLDOWN
};
