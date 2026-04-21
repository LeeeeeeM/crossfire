import { SERVER_CONSTANTS } from "../config/game-constants";
import type { ItemType } from "../models/server-types";

export type AmmoItemType = Extract<ItemType, "ammo_9mm" | "ammo_762">;
export type GunItemType = Extract<ItemType, "gun_smg_9mm" | "gun_ar_762" | "gun_ak_762" | "gun_sniper_762" | "gun_m9_9mm">;

export const AMMO_ITEMS = new Set<AmmoItemType>(["ammo_9mm", "ammo_762"]);
export const GUN_ITEMS = new Set<GunItemType>(["gun_smg_9mm", "gun_ar_762", "gun_ak_762", "gun_sniper_762", "gun_m9_9mm"]);

export const STACKABLE_ITEMS = new Set<ItemType>(["bandage", "ammo_9mm", "ammo_762"]);

export const GUN_TO_AMMO: Record<GunItemType, AmmoItemType> = {
  gun_smg_9mm: "ammo_9mm",
  gun_ar_762: "ammo_762",
  gun_ak_762: "ammo_762",
  gun_sniper_762: "ammo_762",
  gun_m9_9mm: "ammo_9mm"
};

export const AMMO_TO_GUNS: Record<AmmoItemType, GunItemType[]> = {
  ammo_9mm: ["gun_smg_9mm", "gun_m9_9mm"],
  ammo_762: ["gun_ar_762", "gun_ak_762", "gun_sniper_762"]
};

export type GunStat = {
  ammoType: AmmoItemType;
  magSize: number;
  bulletSpeed: number;
  bulletTtl: number;
  damage: number;
  fireCooldownFrames: number;
};

export const GUN_STATS: Record<GunItemType, GunStat> = {
  gun_smg_9mm: {
    ammoType: "ammo_9mm",
    magSize: SERVER_CONSTANTS.magSmg9mm,
    bulletSpeed: 17,
    bulletTtl: 70,
    damage: 22,
    fireCooldownFrames: SERVER_CONSTANTS.smgFireCooldownFrames
  },
  gun_ar_762: {
    ammoType: "ammo_762",
    magSize: SERVER_CONSTANTS.magAr762,
    bulletSpeed: 18,
    bulletTtl: 85,
    damage: 32,
    fireCooldownFrames: SERVER_CONSTANTS.arFireCooldownFrames
  },
  gun_ak_762: {
    ammoType: "ammo_762",
    magSize: SERVER_CONSTANTS.magAk762,
    bulletSpeed: 18,
    bulletTtl: 90,
    damage: 38,
    fireCooldownFrames: 8
  },
  gun_sniper_762: {
    ammoType: "ammo_762",
    magSize: SERVER_CONSTANTS.magSniper762,
    bulletSpeed: 24,
    bulletTtl: 110,
    damage: 72,
    fireCooldownFrames: 20
  },
  gun_m9_9mm: {
    ammoType: "ammo_9mm",
    magSize: SERVER_CONSTANTS.magM9,
    bulletSpeed: 16,
    bulletTtl: 75,
    damage: 20,
    fireCooldownFrames: 6
  }
};

export const ITEM_MAX_STACK: Record<ItemType, number> = {
  knife: 1,
  bandage: 5,
  ammo_9mm: 240,
  ammo_762: 180,
  armor_light: 1,
  armor_mid: 1,
  armor_heavy: 1,
  boots_light: 1,
  boots_mid: 1,
  boots_heavy: 1,
  gun_smg_9mm: GUN_STATS.gun_smg_9mm.magSize,
  gun_ar_762: GUN_STATS.gun_ar_762.magSize,
  gun_ak_762: GUN_STATS.gun_ak_762.magSize,
  gun_sniper_762: GUN_STATS.gun_sniper_762.magSize,
  gun_m9_9mm: GUN_STATS.gun_m9_9mm.magSize
};

export const ITEM_FIRE_COOLDOWN: Record<ItemType, number> = {
  knife: 0,
  bandage: 0,
  ammo_9mm: 0,
  ammo_762: 0,
  armor_light: 0,
  armor_mid: 0,
  armor_heavy: 0,
  boots_light: 0,
  boots_mid: 0,
  boots_heavy: 0,
  gun_smg_9mm: GUN_STATS.gun_smg_9mm.fireCooldownFrames,
  gun_ar_762: GUN_STATS.gun_ar_762.fireCooldownFrames,
  gun_ak_762: GUN_STATS.gun_ak_762.fireCooldownFrames,
  gun_sniper_762: GUN_STATS.gun_sniper_762.fireCooldownFrames,
  gun_m9_9mm: GUN_STATS.gun_m9_9mm.fireCooldownFrames
};
