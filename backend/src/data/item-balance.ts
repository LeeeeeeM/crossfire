import { SERVER_CONSTANTS } from "../config/game-constants";
import {
  AMMO_ITEM_TYPES,
  GUN_ITEM_TYPES,
  ITEM,
  type AmmoItemType,
  type GunItemType,
  type ItemType
} from "../../../shared/items";

export type { AmmoItemType, GunItemType };
export { ITEM };

const AMMO_ORDER = AMMO_ITEM_TYPES;
const GUN_ORDER = GUN_ITEM_TYPES;

export const AMMO_ITEMS = new Set<AmmoItemType>(AMMO_ORDER);
export const GUN_ITEMS = new Set<GunItemType>(GUN_ORDER);

export const STACKABLE_ITEMS = new Set<ItemType>([ITEM.bandage, ...AMMO_ORDER]);

export type GunStat = {
  ammoType: AmmoItemType;
  magSize: number;
  bulletSpeed: number;
  bulletTtl: number;
  damage: number;
  fireCooldownFrames: number;
};

const GUN_STAT_CONFIG: Record<GunItemType, GunStat> = {
  [ITEM.gunSmg9mm]: {
    ammoType: ITEM.ammo9mm,
    magSize: SERVER_CONSTANTS.magSmg9mm,
    bulletSpeed: 17,
    bulletTtl: 70,
    damage: 22,
    fireCooldownFrames: SERVER_CONSTANTS.smgFireCooldownFrames
  },
  [ITEM.gunAr762]: {
    ammoType: ITEM.ammo762,
    magSize: SERVER_CONSTANTS.magAr762,
    bulletSpeed: 18,
    bulletTtl: 85,
    damage: 32,
    fireCooldownFrames: SERVER_CONSTANTS.arFireCooldownFrames
  },
  [ITEM.gunAk762]: {
    ammoType: ITEM.ammo762,
    magSize: SERVER_CONSTANTS.magAk762,
    bulletSpeed: 18,
    bulletTtl: 90,
    damage: 38,
    fireCooldownFrames: SERVER_CONSTANTS.arFireCooldownFrames
  },
  [ITEM.gunSniper762]: {
    ammoType: ITEM.ammo762,
    magSize: SERVER_CONSTANTS.magSniper762,
    bulletSpeed: 24,
    bulletTtl: 110,
    damage: 72,
    fireCooldownFrames: 20
  },
  [ITEM.gunM99mm]: {
    ammoType: ITEM.ammo9mm,
    magSize: SERVER_CONSTANTS.magM9,
    bulletSpeed: 16,
    bulletTtl: 75,
    damage: 20,
    fireCooldownFrames: SERVER_CONSTANTS.defaultGunCooldownFrames
  }
};

export const GUN_STATS: Record<GunItemType, GunStat> = GUN_STAT_CONFIG;

export const GUN_TO_AMMO: Record<GunItemType, AmmoItemType> = Object.fromEntries(
  GUN_ORDER.map((gun) => [gun, GUN_STATS[gun].ammoType])
) as Record<GunItemType, AmmoItemType>;

export const AMMO_TO_GUNS: Record<AmmoItemType, GunItemType[]> = Object.fromEntries(
  AMMO_ORDER.map((ammo) => [ammo, [] as GunItemType[]])
) as Record<AmmoItemType, GunItemType[]>;
for (const gun of GUN_ORDER) {
  AMMO_TO_GUNS[GUN_TO_AMMO[gun]].push(gun);
}

const ITEM_MAX_STACK_BASE: Omit<Record<ItemType, number>, GunItemType> = {
  [ITEM.knife]: 1,
  [ITEM.bandage]: 5,
  [ITEM.ammo9mm]: 240,
  [ITEM.ammo762]: 180,
  [ITEM.armorLight]: 1,
  [ITEM.armorMid]: 1,
  [ITEM.armorHeavy]: 1,
  [ITEM.bootsLight]: 1,
  [ITEM.bootsMid]: 1,
  [ITEM.bootsHeavy]: 1
};

const ITEM_FIRE_COOLDOWN_BASE: Omit<Record<ItemType, number>, GunItemType> = {
  [ITEM.knife]: 0,
  [ITEM.bandage]: 0,
  [ITEM.ammo9mm]: 0,
  [ITEM.ammo762]: 0,
  [ITEM.armorLight]: 0,
  [ITEM.armorMid]: 0,
  [ITEM.armorHeavy]: 0,
  [ITEM.bootsLight]: 0,
  [ITEM.bootsMid]: 0,
  [ITEM.bootsHeavy]: 0
};

const GUN_MAX_STACK: Record<GunItemType, number> = Object.fromEntries(
  GUN_ORDER.map((gun) => [gun, GUN_STATS[gun].magSize])
) as Record<GunItemType, number>;

const GUN_FIRE_COOLDOWN: Record<GunItemType, number> = Object.fromEntries(
  GUN_ORDER.map((gun) => [gun, GUN_STATS[gun].fireCooldownFrames])
) as Record<GunItemType, number>;

export const ITEM_MAX_STACK: Record<ItemType, number> = {
  ...ITEM_MAX_STACK_BASE,
  ...GUN_MAX_STACK
};

export const ITEM_FIRE_COOLDOWN: Record<ItemType, number> = {
  ...ITEM_FIRE_COOLDOWN_BASE,
  ...GUN_FIRE_COOLDOWN
};
