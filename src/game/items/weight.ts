/**
 * Carry weight (APEX 0.7). One internal unit: KILOGRAMS. SRD 5.1 weights are given in pounds and converted once
 * here (1 lb = 0.45359237 kg). An item's weight is its own `weightKg` (set by hand for free-text items) or the
 * converted weight of its base item; free-text items without a weight count 0.
 *
 * Load = Σ quantity × weight over the inventory, EXCEPT items inside a Bag of Holding (only the bag's own 15 lb
 * counts). Equipped items are inventory items too – counted exactly once.
 *
 * Capacity (SRD 5.1): Strength score × 15 lb. Item "carrying capacity" modifiers (lb) add to it.
 * Variant encumbrance (GM option): above STR × 5 lb "Encumbered" (speed −10 ft), above STR × 10 lb "Heavily
 * encumbered" (speed −20 ft, disadvantage on STR/DEX/CON ability checks, attack rolls and saves).
 * APEX shows the state; it never blocks movement automatically – the GM applies speed penalties (see the
 * movement rules). Magical currency (Seals, Orbs, Fragments) is weightless; Gold Pieces in the purse weigh
 * 50 coins = 1 lb. Free-text items get a rough estimate from their name (weightGuess.ts). Without a Strength score
 * on the sheet the capacity uses STR 10 and says so.
 */
import type { Item, Token } from '../types.js';
import { baseItem } from './bases.js';

export const LB_TO_KG = 0.45359237;
export const lbToKg = (lb: number) => Math.round(lb * LB_TO_KG * 100) / 100;
export const BAG_OF_HOLDING = 'srd-bag-of-holding';
export const BAG_CAPACITY_KG = lbToKg(500);
export const holdingContainerId = (bagItemId: string) => `hold-${bagItemId}`;
export const isBagOfHolding = (i: Pick<Item, 'baseId'>) => i.baseId === BAG_OF_HOLDING;

export function itemWeightGrams(i: Pick<Item, 'weightKg' | 'baseId'>): number {
  if (typeof i.weightKg === 'number' && Number.isFinite(i.weightKg) && i.weightKg >= 0) return Math.round(i.weightKg * 1000);
  const b = baseItem(i.baseId);
  return b ? Math.round(lbToKg(b.weight) * 1000) : 0;
}
export const itemWeightKg = (i: Pick<Item, 'weightKg' | 'baseId'>): number => itemWeightGrams(i) / 1000;

/** Bag of Holding ids by their holding container id. */
export function holdingContainers(t: Pick<Token, 'inventory'>): Map<string, Item> {
  return new Map(t.inventory.filter(isBagOfHolding).map((b) => [holdingContainerId(b.id), b]));
}

export function bagContentsKg(t: Pick<Token, 'inventory'>, bagItemId: string): number {
  const id = holdingContainerId(bagItemId);
  return round(t.inventory.filter((i) => i.container === id).reduce((s, i) => s + itemWeightGrams(i) * i.quantity, 0) / 1000);
}

export type LoadState = 'ok' | 'encumbered' | 'heavily' | 'over';
export interface CarryLoad {
  loadKg: number;
  capacityKg: number | null;
  pct: number | null;
  state: LoadState;
  /** variant thresholds (kg) when the GM enabled the variant rule */
  encumberedAtKg?: number;
  heavilyAtKg?: number;
  bags: Array<{ id: string; name: string; contentsKg: number; capacityKg: number }>;
  /** Weight of the Gold Pieces in the purse (SRD: 50 coins = 1 lb). */
  coinsKg: number;
  /** True when the sheet has no Strength score and APEX assumed 10. */
  assumedStrength?: boolean;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export const ASSUMED_STRENGTH = 10;

export function carryLoad(t: Pick<Token, 'inventory'> & { currency?: Token['currency'] }, strength: number | null, carryBonusLb: number, variant: boolean): CarryLoad {
  const holding = holdingContainers(t);
  let load = 0;
  for (const i of t.inventory) if (!(i.container && holding.has(i.container))) load += itemWeightGrams(i) * i.quantity;
  const coinsKg = round(lbToKg(Math.max(0, t.currency?.gold ?? 0) / 50));
  const loadKg = round(load / 1000 + coinsKg);
  const bags = [...holding.values()].map((b) => ({ id: b.id, name: b.name, contentsKg: bagContentsKg(t, b.id), capacityKg: BAG_CAPACITY_KG }));
  // without a Strength score on the sheet APEX assumes an average 10, so the gauge still gives a guide value
  const assumed = strength === null || !Number.isFinite(strength) || strength <= 0;
  const str = assumed ? ASSUMED_STRENGTH : strength;
  const capacityKg = round(lbToKg(str * 15 + Math.max(0, carryBonusLb)));
  const pct = capacityKg > 0 ? Math.round((loadKg / capacityKg) * 100) : null;
  let state: LoadState = loadKg > capacityKg ? 'over' : 'ok';
  const out: CarryLoad = { loadKg, capacityKg, pct, state, bags, coinsKg, ...(assumed ? { assumedStrength: true } : {}) };
  if (variant) {
    out.encumberedAtKg = round(lbToKg(str * 5));
    out.heavilyAtKg = round(lbToKg(str * 10));
    if (state !== 'over') state = loadKg > out.heavilyAtKg ? 'heavily' : loadKg > out.encumberedAtKg ? 'encumbered' : 'ok';
    out.state = state;
  }
  return out;
}

/** Strength SCORE from the character sheet (not the modifier), or null. */
export function strengthScore(sheet: { attributes: Array<{ name: string; value: string }> } | null | undefined): number | null {
  const a = sheet?.attributes.find((x) => /^str/i.test(x.name.trim()));
  const n = a ? Number(/\d+/.exec(a.value)?.[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

