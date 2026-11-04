/**
 * Item generation (APEX 0.6): a PURE function of (base, rarity, item level, random source).
 *
 * The server supplies the random source (crypto-seeded, never client-provided), so the same seed always gives
 * the same item – rolls are reproducible and explainable – while players cannot influence them.
 *
 * Algorithm (unbiased weighted choice):
 *  1. affix count: uniform integer in the rarity's [min, max];
 *  2. for each affix: collect every (modifier, tier) pair that is eligible – tag matches the base, tier item level
 *     ≤ item level, family not yet on the item, prefix/suffix budget left – and pick one with probability
 *     weight / total weight;
 *  3. value: uniform integer in the tier's [min, max].
 * If the pool runs dry (a base with few eligible modifiers) the item simply gets fewer affixes.
 */
import type { RolledMod } from '../types.js';
import type { BaseItem } from './bases.js';
import { eligibleMods, modifier, type ModDef, type ModTier } from './modifiers.js';
import { AFFIX_RULES, MAX_ITEM_LEVEL, type Rarity } from './rules.js';

/** Returns a float in [0, 1). */
export type Rng = () => number;

/** Small deterministic PRNG (mulberry32) – seeded by the server with crypto randomness. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

export function weightedPick<T>(rng: Rng, entries: Array<{ value: T; weight: number }>): T | undefined {
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const e of entries) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e.value;
  }
  return entries[entries.length - 1].value;
}

export const clampItemLevel = (n: number) => Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(Number.isFinite(n) ? n : 1)));

export function canRollMods(base: BaseItem): boolean {
  return base.modTags.length > 0;
}

export function rollMods(base: BaseItem, rarity: Exclude<Rarity, 'unique'>, itemLevel: number, rng: Rng): RolledMod[] {
  const rule = AFFIX_RULES[rarity];
  if (!rule.max || !canRollMods(base)) return [];
  return addMods(base, rarity, itemLevel, [], randInt(rng, rule.min, rule.max), rng);
}

/** Modifiers that could still be added to an item (families free, prefix/suffix budget left) – for previews. */
export function addableMods(base: BaseItem, rarity: Exclude<Rarity, 'unique'>, itemLevel: number, existing: RolledMod[]): ModDef[] {
  const rule = AFFIX_RULES[rarity];
  if (existing.length >= rule.max || !canRollMods(base)) return [];
  const defs = existing.map((m) => modifier(m.modId)).filter((d): d is ModDef => !!d);
  const families = new Set(defs.map((d) => d.family));
  const prefixes = defs.filter((d) => d.affix === 'prefix').length;
  const suffixes = defs.length - prefixes;
  return eligibleMods(base.modTags, clampItemLevel(itemLevel))
    .map((e) => e.def)
    .filter((d) => !families.has(d.family) && (d.affix === 'prefix' ? prefixes < rule.maxPrefixes : suffixes < rule.maxSuffixes));
}

/**
 * Adds up to `n` modifiers to `existing` (kept untouched) with the same unbiased weighted rules as a fresh roll:
 * eligible tag, tier item level, free family, prefix/suffix budget and the rarity's maximum.
 */
export function addMods(base: BaseItem, rarity: Exclude<Rarity, 'unique'>, itemLevel: number, existing: RolledMod[], n: number, rng: Rng): RolledMod[] {
  const rule = AFFIX_RULES[rarity];
  const pool = eligibleMods(base.modTags, clampItemLevel(itemLevel));
  const out: RolledMod[] = [...existing];
  const defs = existing.map((m) => modifier(m.modId)).filter((d): d is ModDef => !!d);
  const families = new Set<string>(defs.map((d) => d.family));
  let prefixes = defs.filter((d) => d.affix === 'prefix').length;
  let suffixes = defs.length - prefixes;
  const count = Math.min(n, rule.max - existing.length);
  for (let i = 0; i < count; i++) {
    const options: Array<{ value: { def: ModDef; tier: ModTier }; weight: number }> = [];
    for (const { def, tiers } of pool) {
      if (families.has(def.family)) continue;
      if (def.affix === 'prefix' ? prefixes >= rule.maxPrefixes : suffixes >= rule.maxSuffixes) continue;
      for (const tier of tiers) options.push({ value: { def, tier }, weight: tier.weight });
    }
    const pick = weightedPick(rng, options);
    if (!pick) break;
    families.add(pick.def.family);
    if (pick.def.affix === 'prefix') prefixes++;
    else suffixes++;
    out.push({ modId: pick.def.id, tier: pick.tier.tier, value: randInt(rng, pick.tier.min, pick.tier.max) });
  }
  // stable display order: prefixes first
  return out.sort((a, b) => Number(modifier(a.modId)?.affix === 'suffix') - Number(modifier(b.modId)?.affix === 'suffix'));
}

// ---------------------------------------------------------------- names (original word lists)
const RARE_FIRST = ['Ash', 'Dusk', 'Iron', 'Grim', 'Storm', 'Vigil', 'Ember', 'Raven', 'Oath', 'Gloom', 'Sun', 'Wolf', 'Bone', 'Thorn', 'Dread', 'Gale', 'Cinder', 'Eagle', 'Frost', 'Hollow'];
const RARE_SECOND: Record<string, string[]> = {
  weapon: ['Bite', 'Fang', 'Edge', 'Song', 'Verdict', 'Toll', 'Reaver', 'Mercy', 'Sting', 'Oath'],
  armour: ['Ward', 'Shell', 'Bastion', 'Mantle', 'Aegis', 'Hide', 'Bulwark', 'Wall'],
  jewellery: ['Loop', 'Eye', 'Seal', 'Circle', 'Knot', 'Spark', 'Coil', 'Whisper'],
  other: ['Relic', 'Token', 'Charm', 'Keepsake', 'Grip', 'Stride', 'Cowl', 'Girdle'],
};

export function generatedName(base: BaseItem, rarity: Rarity, mods: RolledMod[], rng: Rng): string {
  if (rarity === 'magic') {
    const pre = mods.map((m) => modifier(m.modId)).find((d) => d?.affix === 'prefix');
    const suf = mods.map((m) => modifier(m.modId)).find((d) => d?.affix === 'suffix');
    return [pre?.name, base.name, suf?.name].filter(Boolean).join(' ');
  }
  if (rarity === 'rare') {
    const group = base.modTags.includes('weapon') ? 'weapon' : base.modTags.includes('jewellery') ? 'jewellery' : base.modTags.includes('armour') ? 'armour' : 'other';
    const list = RARE_SECOND[group];
    return `${RARE_FIRST[randInt(rng, 0, RARE_FIRST.length - 1)]} ${list[randInt(rng, 0, list.length - 1)]}`;
  }
  return base.name;
}
