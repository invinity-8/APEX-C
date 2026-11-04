/**
 * Item instances (APEX 0.6): turning a base template + roll into an inventory Item, and redacting hidden data.
 */
import type { Item, ItemOrigin, RolledMod } from '../types.js';
import type { BaseItem } from './bases.js';
import { generatedName, rollMods, clampItemLevel, type Rng } from './generate.js';
import { modifier, modText } from './modifiers.js';
import { MODIFIER_VERSION, RARITY_LABEL, type Rarity } from './rules.js';

const KIND_OF: Record<BaseItem['category'], Item['kind']> = {
  weapon: 'weapon',
  armor: 'armor',
  shield: 'armor',
  ring: 'misc',
  amulet: 'misc',
  cloak: 'misc',
  head: 'armor',
  gloves: 'armor',
  boots: 'armor',
  belt: 'misc',
  gear: 'tool',
  consumable: 'consumable',
  material: 'misc',
  quest: 'misc',
  currency: 'misc',
};

export interface CreateOptions {
  id: string;
  rarity: Exclude<Rarity, 'unique'>;
  itemLevel: number;
  rng: Rng;
  identified?: boolean;
  quantity?: number;
  source?: ItemOrigin;
  /** Fixed modifiers (manual GM items) – bypasses rolling but not validation (see validateMods). */
  mods?: RolledMod[];
  name?: string;
}

export function createItem(base: BaseItem, o: CreateOptions): Item {
  const mods = o.mods ?? rollMods(base, o.rarity, o.itemLevel, o.rng);
  const rarity = o.rarity;
  const item: Item = {
    id: o.id,
    name: o.name?.trim() || generatedName(base, rarity, mods, o.rng),
    kind: KIND_OF[base.category],
    description: base.description ?? '',
    quantity: base.stackable ? Math.max(1, Math.floor(o.quantity ?? 1)) : 1,
    rev: 0,
    baseId: base.id,
    itemLevel: clampItemLevel(o.itemLevel),
    ...(base.equip ? { equip: { ...structuredClone(base.equip), gmLocked: true } } : {}),
    ...(base.category === 'weapon' || base.category === 'armor' || base.category === 'shield' || base.equip ? { rarity } : {}),
    ...(mods.length ? { mods, modVersion: MODIFIER_VERSION } : {}),
    ...(o.identified === false && mods.length ? { identified: false } : {}),
    ...(o.source ? { source: o.source } : {}),
  };
  return item;
}

/** Checks manual modifiers against the repository: known id, tag allowed, tier reachable, value in range, families unique. */
export function validateMods(base: BaseItem, itemLevel: number, mods: RolledMod[], rarity: Exclude<Rarity, 'unique'>): string | null {
  const families = new Set<string>();
  let p = 0;
  let s = 0;
  for (const m of mods) {
    const def = modifier(m.modId);
    if (!def) return `Unknown modifier ${m.modId}.`;
    if (!def.tags.some((t) => base.modTags.includes(t))) return `${def.id} cannot appear on ${base.name}.`;
    const tier = def.tiers.find((t) => t.tier === m.tier);
    if (!tier || tier.ilvl > itemLevel) return `${def.id} tier ${m.tier} needs item level ${tier?.ilvl ?? '?'}.`;
    if (!Number.isInteger(m.value) || m.value < tier.min || m.value > tier.max) return `${def.id} value must be ${tier.min}–${tier.max}.`;
    if (families.has(def.family)) return `Only one modifier of the ${def.family} family per item.`;
    families.add(def.family);
    if (def.affix === 'prefix') p++;
    else s++;
  }
  const limits = { normal: [0, 0], magic: [1, 1], rare: [2, 2] }[rarity];
  if (p > limits[0] || s > limits[1]) return `${RARITY_LABEL[rarity]} items allow at most ${limits[0]} prefix(es) and ${limits[1]} suffix(es).`;
  return null;
}

/** Player-facing copy: unidentified items lose their modifiers (and anything derived from them). */
export function redactItem(item: Item): Item {
  if (item.quest?.gmNotes) {
    const { gmNotes: _n, ...quest } = item.quest; // GM notes never reach players
    void _n;
    item = { ...item, quest };
  }
  if (item.identified !== false) return item;
  const { mods: _m, modVersion: _v, ...rest } = item;
  void _m;
  void _v;
  return rest;
}

export function describeMods(item: Pick<Item, 'mods' | 'identified'>): string[] {
  if (item.identified === false) return ['Unidentified – its properties are unknown.'];
  return (item.mods ?? []).map((m) => {
    const def = modifier(m.modId);
    return def ? modText(def, m.value) : `Unknown modifier (${m.modId})`;
  });
}
