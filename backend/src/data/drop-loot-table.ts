import type { ItemType } from "../models/server-types";

type DropQty = number | "mag_smg_9mm";

type DropLootRow = {
  item: ItemType;
  weight: number;
  qty: DropQty;
};

export const DROP_LOOT_TABLE: DropLootRow[] = [
  { item: "bandage", weight: 0.26, qty: 1 },
  { item: "ammo_9mm", weight: 0.24, qty: 45 },
  { item: "ammo_762", weight: 0.18, qty: 30 },
  { item: "armor_light", weight: 0.1, qty: 1 },
  { item: "armor_mid", weight: 0.08, qty: 1 },
  { item: "armor_heavy", weight: 0.04, qty: 1 },
  { item: "boots_light", weight: 0.05, qty: 1 },
  { item: "gun_smg_9mm", weight: 0.05, qty: "mag_smg_9mm" }
];

export function pickDropLootByRatio(r: number): DropLootRow {
  let acc = 0;
  for (const row of DROP_LOOT_TABLE) {
    acc += row.weight;
    if (r < acc) return row;
  }
  return DROP_LOOT_TABLE[DROP_LOOT_TABLE.length - 1];
}

export function resolveDropQty(qty: DropQty, magSmg9mm: number): number {
  return qty === "mag_smg_9mm" ? magSmg9mm : qty;
}
