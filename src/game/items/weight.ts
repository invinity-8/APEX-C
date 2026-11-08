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
 * APEX encumbrance (default since APEX 1.0, rule value 2): above 50 % of capacity "Encumbered" (speed −25 %), above
 * 75 % "Heavily encumbered" (speed −50 %), rounded down to 5 ft. APEX applies these speed penalties everywhere
 * (sheet, scenes, Arena) and the server blocks movement above carrying capacity. Magical currency
 * (Seals, Orbs, Fragments) is weightless; Gold Pieces in the purse weigh
 * 50 coins = 1 lb. Free-text items get a rough estimate from their name (weightGuess.ts). Without a Strength score
 * on the sheet the capacity uses STR 10 and says so.
 */
import type { CharacterSheet } from '../sheet.js';
import { activeSlots, equipmentOf, type EquipSlot } from '../equipment.js';
import { movePointsForSpeed, walkingSpeed } from '../resources.js';
import type { GameState, Item, Token } from '../types.js';
import { baseItem } from './bases.js';
import { itemBonuses } from '../equipment.js';
import { itemRulesOf } from './rules.js';

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
  /** Encumbrance rule in effect (see EncumbranceMode). */
  mode?: EncumbranceMode;
  /** True when the sheet has no Strength score and APEX assumed 10. */
  assumedStrength?: boolean;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export const ASSUMED_STRENGTH = 10;

/** Encumbrance mode: 0 / false = SRD standard, 1 / true = SRD variant (−10/−20 ft), 2 = APEX percentage (−25/−50 %). */
export type EncumbranceMode = 0 | 1 | 2;
const modeOf = (v: boolean | number): EncumbranceMode => (v === true || v === 1 ? 1 : v === 2 ? 2 : 0);

export function carryLoad(t: Pick<Token, 'inventory'> & { currency?: Token['currency'] }, strength: number | null, carryBonusLb: number, variant: boolean | number): CarryLoad {
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
  const mode = modeOf(variant);
  out.mode = mode;
  if (mode) {
    out.encumberedAtKg = mode === 1 ? round(lbToKg(str * 5)) : round(capacityKg * 0.5);
    out.heavilyAtKg = mode === 1 ? round(lbToKg(str * 10)) : round(capacityKg * 0.75);
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

export interface CharacterMovementLoad {
  load: CarryLoad;
  speedFt: number;
  speedSteps: Array<{ label: string; value: number; op: '=' | '+' | 'cap' }>;
  maxMovePoints: number;
  spentMovePoints: number;
  remainingMovePoints: number;
}

/** Shared authoritative load and movement calculation used by server command guards and the player view. */
export function characterMovementLoad(state: Pick<GameState, 'itemRules'>, token: Token, sheet: CharacterSheet | null): CharacterMovementLoad {
  const rules = itemRulesOf(state);
  const equipment = equipmentOf(token);
  const items = new Map(token.inventory.map(item => [item.id, item]));
  const worn = activeSlots(equipment).flatMap((slot: EquipSlot) => {
    const item = equipment.slots[slot] ? items.get(equipment.slots[slot]!) : undefined;
    return item?.equip ? [{ slot, item }] : [];
  });
  const bonuses = itemBonuses(worn, rules);
  const load = carryLoad(token, strengthScore(sheet), bonuses.carry.value, rules.encumbranceVariant);
  const baseSpeed = token.speedFt ?? (sheet ? walkingSpeed(sheet) : null) ?? 30;
  const { speedFt, steps } = encumberedSpeed(baseSpeed, bonuses.speed.value, load.state, modeOf(rules.encumbranceVariant));
  const adjustedMax = load.state === 'over' || speedFt <= 0 ? 0 : movePointsForSpeed(speedFt);
  const maxMovePoints = Math.min(Math.max(0, token.maxMovePoints), adjustedMax);
  const spentMovePoints = Math.max(0, token.maxMovePoints - token.movePoints);
  const remainingMovePoints = Math.max(0, Math.min(token.movePoints, maxMovePoints - spentMovePoints));
  return { load, speedFt, speedSteps: steps, maxMovePoints, spentMovePoints, remainingMovePoints };
}

/** Walking speed after item bonuses and encumbrance – the one rule used by the sheet, scenes and the Arena. */
export function encumberedSpeed(baseFt: number, itemBonusFt: number, state: LoadState, mode: EncumbranceMode): { speedFt: number; steps: Array<{ label: string; value: number; op: '=' | '+' | 'cap' }> } {
  const steps: Array<{ label: string; value: number; op: '=' | '+' | 'cap' }> = [{ label: 'Walking speed', value: baseFt, op: '=' }];
  let speed = baseFt;
  if (itemBonusFt) {
    speed += itemBonusFt;
    steps.push({ label: 'Equipped modifiers', value: itemBonusFt, op: '+' });
  }
  if (state === 'over') {
    steps.push({ label: 'Over carrying capacity – cannot move', value: -speed, op: 'cap' });
    return { speedFt: 0, steps };
  }
  if (mode === 1 && (state === 'encumbered' || state === 'heavily')) {
    const p = state === 'heavily' ? 20 : 10;
    steps.push({ label: state === 'heavily' ? 'Heavily encumbered' : 'Encumbered', value: -p, op: '+' });
    speed -= p;
  } else if (mode === 2 && (state === 'encumbered' || state === 'heavily')) {
    const pct = state === 'heavily' ? 50 : 25;
    const next = Math.floor((speed * (100 - pct)) / 100 / 5) * 5;
    steps.push({ label: `${state === 'heavily' ? 'Heavily encumbered' : 'Encumbered'} (−${pct} %)`, value: next - speed, op: '+' });
    speed = next;
  }
  return { speedFt: Math.max(0, speed), steps };
}

