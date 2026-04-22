export const ITEM = {
  knife: "knife",
  bandage: "bandage",
  ammo9mm: "ammo_9mm",
  ammo762: "ammo_762",
  armorLight: "armor_light",
  armorMid: "armor_mid",
  armorHeavy: "armor_heavy",
  bootsLight: "boots_light",
  bootsMid: "boots_mid",
  bootsHeavy: "boots_heavy",
  gunSmg9mm: "gun_smg_9mm",
  gunAr762: "gun_ar_762",
  gunAk762: "gun_ak_762",
  gunSniper762: "gun_sniper_762",
  gunM99mm: "gun_m9_9mm"
} as const;

export type ItemType = (typeof ITEM)[keyof typeof ITEM];

export const AMMO_ITEM_TYPES = [ITEM.ammo9mm, ITEM.ammo762] as const;
export type AmmoItemType = (typeof AMMO_ITEM_TYPES)[number];

export const GUN_ITEM_TYPES = [ITEM.gunSmg9mm, ITEM.gunAr762, ITEM.gunAk762, ITEM.gunSniper762, ITEM.gunM99mm] as const;
export type GunItemType = (typeof GUN_ITEM_TYPES)[number];

export const ARMOR_ITEM_TYPES = [ITEM.armorLight, ITEM.armorMid, ITEM.armorHeavy] as const;
export type ArmorItemType = (typeof ARMOR_ITEM_TYPES)[number];

export const BOOTS_ITEM_TYPES = [ITEM.bootsLight, ITEM.bootsMid, ITEM.bootsHeavy] as const;
export type BootsItemType = (typeof BOOTS_ITEM_TYPES)[number];

const AMMO_ITEM_SET = new Set<ItemType>(AMMO_ITEM_TYPES);
const GUN_ITEM_SET = new Set<ItemType>(GUN_ITEM_TYPES);
const ARMOR_ITEM_SET = new Set<ItemType>(ARMOR_ITEM_TYPES);
const BOOTS_ITEM_SET = new Set<ItemType>(BOOTS_ITEM_TYPES);

export function isAmmoItemType(item: string): item is AmmoItemType {
  return AMMO_ITEM_SET.has(item as ItemType);
}

export function isGunItemType(item: string): item is GunItemType {
  return GUN_ITEM_SET.has(item as ItemType);
}

export function isArmorItemType(item: string): item is ArmorItemType {
  return ARMOR_ITEM_SET.has(item as ItemType);
}

export function isBootsItemType(item: string): item is BootsItemType {
  return BOOTS_ITEM_SET.has(item as ItemType);
}
