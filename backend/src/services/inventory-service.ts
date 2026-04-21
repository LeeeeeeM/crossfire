import { SERVER_CONSTANTS } from "../config/game-constants";
import {
  AMMO_ITEMS,
  AMMO_TO_GUNS,
  GUN_ITEMS,
  GUN_STATS,
  GUN_TO_AMMO,
  ITEM_FIRE_COOLDOWN,
  ITEM_MAX_STACK,
  STACKABLE_ITEMS,
  type AmmoItemType,
  type GunItemType
} from "../data/item-balance";
import type { InventorySlot, ItemType, RoomPlayer, RoomState } from "../models/server-types";

const WEAPON_SLOT_SIZE = SERVER_CONSTANTS.weaponSlotSize;
const ITEM_SLOT_SIZE = SERVER_CONSTANTS.itemSlotSize;
const RELOAD_DURATION_FRAMES = SERVER_CONSTANTS.reloadDurationFrames;

function isStackable(t: ItemType) {
  return STACKABLE_ITEMS.has(t);
}

export function isAmmoItem(t: ItemType): t is AmmoItemType {
  return AMMO_ITEMS.has(t as AmmoItemType);
}

export function isGunItem(t: ItemType): t is GunItemType {
  return GUN_ITEMS.has(t as GunItemType);
}

export function maxStack(t: ItemType) {
  return ITEM_MAX_STACK[t];
}

function hasItemSpace(items: Array<InventorySlot | null>, t: ItemType) {
  if (isStackable(t)) {
    for (const slot of items) {
      if (slot && slot.t === t && slot.q < maxStack(t)) return true;
    }
  }
  return items.some((s) => !s);
}

function addItem(items: Array<InventorySlot | null>, t: ItemType, qty: number) {
  let remaining = qty;
  if (isStackable(t)) {
    const cap = maxStack(t);
    for (let i = 0; i < items.length; i += 1) {
      const s = items[i];
      if (!s || s.t !== t || s.q >= cap) continue;
      const take = Math.min(remaining, cap - s.q);
      s.q += take;
      remaining -= take;
      if (remaining <= 0) return 0;
    }
  }
  const cap = maxStack(t);
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]) continue;
    const put = Math.min(remaining, cap);
    items[i] = { t, q: put };
    remaining -= put;
    if (remaining <= 0) return 0;
  }
  return remaining;
}

function findEmptyWeaponSlot(weapons: Array<InventorySlot | null>) {
  for (let i = 0; i < weapons.length; i += 1) {
    if (!weapons[i]) return i;
  }
  return -1;
}

export function hasSpaceForPickup(weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, t: ItemType) {
  if (isGunItem(t)) {
    return findEmptyWeaponSlot(weapons) >= 0;
  }
  return hasItemSpace(items, t);
}

export function addPickup(weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, t: ItemType, qty: number) {
  if (isGunItem(t)) {
    const idx = findEmptyWeaponSlot(weapons);
    if (idx < 0) return qty;
    weapons[idx] = { t, q: Math.min(qty, maxStack(t)) };
    return Math.max(0, qty - maxStack(t));
  }
  return addItem(items, t, qty);
}

export function removeWeaponAt(weapons: Array<InventorySlot | null>, idx: number, qty?: number) {
  const s = weapons[idx];
  if (!s) return null;
  if (s.t === "knife") return null;
  const take = Math.max(1, Math.min(qty ?? s.q, s.q));
  s.q -= take;
  const ret: InventorySlot = { t: s.t, q: take };
  if (s.q <= 0) weapons[idx] = null;
  return ret;
}

export function removeItemAt(items: Array<InventorySlot | null>, idx: number, qty?: number) {
  const s = items[idx];
  if (!s) return null;
  const take = Math.max(1, Math.min(qty ?? s.q, s.q));
  s.q -= take;
  const ret: InventorySlot = { t: s.t, q: take };
  if (s.q <= 0) items[idx] = null;
  return ret;
}

export function applyAmmoPickup(weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, ammoType: ItemType, qty: number): number {
  if (!isAmmoItem(ammoType)) return addPickup(weapons, items, ammoType, qty);
  let remaining = qty;
  const bindGuns = AMMO_TO_GUNS[ammoType];
  for (let i = 0; i < weapons.length && remaining > 0; i += 1) {
    const s = weapons[i];
    if (!s || !isGunItem(s.t) || !bindGuns.includes(s.t)) continue;
    const cap = maxStack(s.t);
    const space = cap - s.q;
    if (space <= 0) continue;
    const add = Math.min(remaining, space);
    s.q += add;
    remaining -= add;
  }
  if (remaining <= 0) return 0;
  return addItem(items, ammoType, remaining);
}

export function canTakeAmmoPickup(weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, ammoType: ItemType) {
  if (!isAmmoItem(ammoType)) return hasSpaceForPickup(weapons, items, ammoType);
  const bindGuns = AMMO_TO_GUNS[ammoType];
  if (
    weapons.some((s) => {
      if (!s || !isGunItem(s.t) || !bindGuns.includes(s.t)) return false;
      return s.q < maxStack(s.t);
    })
  ) {
    return true;
  }
  return hasItemSpace(items, ammoType);
}

function ammoStackTotal(items: Array<InventorySlot | null>, ammoType: AmmoItemType): number {
  let n = 0;
  for (const s of items) {
    if (s && s.t === ammoType) n += s.q;
  }
  return n;
}

function reloadGunFromAmmoStacks(weapons: Array<InventorySlot | null>, items: Array<InventorySlot | null>, gunSlotIdx: number) {
  const gun = weapons[gunSlotIdx];
  if (!gun || !isGunItem(gun.t)) return;
  const ammoType = GUN_TO_AMMO[gun.t];
  const cap = maxStack(gun.t);
  let need = cap - gun.q;
  if (need <= 0) return;
  for (let i = 0; i < items.length && need > 0; i += 1) {
    const s = items[i];
    if (!s || s.t !== ammoType) continue;
    const take = Math.min(need, s.q);
    gun.q += take;
    s.q -= take;
    need -= take;
    if (s.q <= 0) items[i] = null;
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
  if (idx >= 0 && idx < WEAPON_SLOT_SIZE) {
    reloadGunFromAmmoStacks(p.weapons, p.items, idx);
  }
  clearReloadState(p);
}

function tryStartReload(p: RoomPlayer, room: RoomState, gunSlotIdx: number, allowPartial: boolean) {
  if (p.reloadEndFrame > room.frame) return;
  const gun = p.weapons[gunSlotIdx];
  if (!gun || !isGunItem(gun.t)) return;
  const cap = maxStack(gun.t);
  if (!allowPartial && gun.q > 0) return;
  if (gun.q >= cap) return;
  const ammoType = GUN_TO_AMMO[gun.t];
  if (ammoStackTotal(p.items, ammoType) <= 0) return;
  p.reloadStartFrame = room.frame;
  p.reloadEndFrame = room.frame + RELOAD_DURATION_FRAMES;
  p.reloadSlotIdx = gunSlotIdx;
}

export function tryStartAutoReload(p: RoomPlayer, room: RoomState, gunSlotIdx: number) {
  tryStartReload(p, room, gunSlotIdx, false);
}

export function tryStartManualReload(p: RoomPlayer, room: RoomState, gunSlotIdx: number) {
  tryStartReload(p, room, gunSlotIdx, true);
}

export function initialWeapons() {
  const out: Array<InventorySlot | null> = Array.from({ length: WEAPON_SLOT_SIZE }, () => null);
  out[0] = { t: "knife", q: 1 };
  return out;
}

export function initialItems() {
  return Array.from({ length: ITEM_SLOT_SIZE }, () => null) as Array<InventorySlot | null>;
}

export function gunStat(t: GunItemType) {
  return GUN_STATS[t];
}

export const GUN_FIRE_COOLDOWN: Record<ItemType, number> = {
  ...ITEM_FIRE_COOLDOWN
};
