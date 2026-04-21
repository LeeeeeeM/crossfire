import type { ItemType } from "../models/server-types";

type DropQty = number | "mag_smg_9mm" | "mag_ar_762" | "mag_ak_762" | "mag_sniper_762" | "mag_m9_9mm";

type DropLootRow = {
  item: ItemType;
  weight: number;
  qty: DropQty;
};

export const DROP_LOOT_TABLE: DropLootRow[] = [
  { item: "bandage", weight: 0.18, qty: 1 },
  { item: "ammo_9mm", weight: 0.2, qty: 45 },
  { item: "ammo_762", weight: 0.16, qty: 30 },
  { item: "armor_light", weight: 0.09, qty: 1 },
  { item: "armor_mid", weight: 0.07, qty: 1 },
  { item: "armor_heavy", weight: 0.03, qty: 1 },
  { item: "boots_light", weight: 0.04, qty: 1 },
  { item: "gun_smg_9mm", weight: 0.08, qty: "mag_smg_9mm" },
  { item: "gun_ar_762", weight: 0.05, qty: "mag_ar_762" },
  { item: "gun_ak_762", weight: 0.04, qty: "mag_ak_762" },
  { item: "gun_sniper_762", weight: 0.02, qty: "mag_sniper_762" },
  { item: "gun_m9_9mm", weight: 0.04, qty: "mag_m9_9mm" }
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
  if (qty === "mag_smg_9mm") return mags.smg9mm;
  if (qty === "mag_ar_762") return mags.ar762;
  if (qty === "mag_ak_762") return mags.ak762;
  if (qty === "mag_sniper_762") return mags.sniper762;
  if (qty === "mag_m9_9mm") return mags.m9;
  return qty;
}
