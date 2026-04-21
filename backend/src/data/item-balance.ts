import { SERVER_CONSTANTS } from "../config/game-constants";
import type { ItemType } from "../models/server-types";

export type AmmoItemType = Extract<ItemType, "ammo_9mm" | "ammo_762">;
export type GunItemType = Extract<ItemType, "gun_smg_9mm" | "gun_ar_762">;

export const AMMO_ITEMS = new Set<AmmoItemType>(["ammo_9mm", "ammo_762"]);
export const GUN_ITEMS = new Set<GunItemType>(["gun_smg_9mm", "gun_ar_762"]);

export const STACKABLE_ITEMS = new Set<ItemType>(["bandage", "ammo_9mm", "ammo_762"]);

export const GUN_TO_AMMO: Record<GunItemType, AmmoItemType> = {
  gun_smg_9mm: "ammo_9mm",
  gun_ar_762: "ammo_762"
};

export const AMMO_TO_GUNS: Record<AmmoItemType, GunItemType[]> = {
  ammo_9mm: ["gun_smg_9mm"],
  ammo_762: ["gun_ar_762"]
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
  gun_smg_9mm: SERVER_CONSTANTS.magSmg9mm,
  gun_ar_762: SERVER_CONSTANTS.magAr762
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
  gun_smg_9mm: SERVER_CONSTANTS.smgFireCooldownFrames,
  gun_ar_762: SERVER_CONSTANTS.arFireCooldownFrames
};
