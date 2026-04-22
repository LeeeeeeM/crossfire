import type { ItemType } from "../models/server-types";
import { ITEM } from "../../../shared/items";

export const DROP_QTY_KEY = {
  magSmg9mm: "mag_smg_9mm",
  magAr762: "mag_ar_762",
  magAk762: "mag_ak_762",
  magSniper762: "mag_sniper_762",
  magM99mm: "mag_m9_9mm"
} as const;

type DropQty = number | (typeof DROP_QTY_KEY)[keyof typeof DROP_QTY_KEY];

type DropLootRow = {
  item: ItemType;
  weight: number;
  qty: DropQty;
};

export const DROP_LOOT_TABLE: DropLootRow[] = [
  { item: ITEM.bandage, weight: 0.18, qty: 1 },
  { item: ITEM.ammo9mm, weight: 0.2, qty: 45 },
  { item: ITEM.ammo762, weight: 0.16, qty: 30 },
  { item: ITEM.armorLight, weight: 0.09, qty: 1 },
  { item: ITEM.armorMid, weight: 0.07, qty: 1 },
  { item: ITEM.armorHeavy, weight: 0.03, qty: 1 },
  { item: ITEM.bootsLight, weight: 0.04, qty: 1 },
  { item: ITEM.gunSmg9mm, weight: 0.08, qty: DROP_QTY_KEY.magSmg9mm },
  { item: ITEM.gunAr762, weight: 0.05, qty: DROP_QTY_KEY.magAr762 },
  { item: ITEM.gunAk762, weight: 0.04, qty: DROP_QTY_KEY.magAk762 },
  { item: ITEM.gunSniper762, weight: 0.02, qty: DROP_QTY_KEY.magSniper762 },
  { item: ITEM.gunM99mm, weight: 0.04, qty: DROP_QTY_KEY.magM99mm }
];

export function pickDropLootByRatio(r: number): DropLootRow {
  let acc = 0;
  for (const row of DROP_LOOT_TABLE) {
    acc += row.weight;
    if (r < acc) return row;
  }
  return DROP_LOOT_TABLE[DROP_LOOT_TABLE.length - 1];
}

export function resolveDropQty(
  qty: DropQty,
  mags: { smg9mm: number; ar762: number; ak762: number; sniper762: number; m9: number }
): number {
  if (qty === DROP_QTY_KEY.magSmg9mm) return mags.smg9mm;
  if (qty === DROP_QTY_KEY.magAr762) return mags.ar762;
  if (qty === DROP_QTY_KEY.magAk762) return mags.ak762;
  if (qty === DROP_QTY_KEY.magSniper762) return mags.sniper762;
  if (qty === DROP_QTY_KEY.magM99mm) return mags.m9;
  return qty;
}
