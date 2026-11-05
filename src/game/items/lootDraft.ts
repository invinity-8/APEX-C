/**
 * GM loot drafts (APEX 0.7) – "roll a drop, look at it, edit it, then approve it".
 *
 * Flow
 *  1. `lootDraftCreate` rolls a draft pool on the SERVER (seeded) from an encounter type, a reference character
 *     level and the categories the GM enabled. Nothing is created yet – a draft is a list of *specs*.
 *  2. The GM edits the draft (`lootDraftEdit`): remove entries, change quantity / item level / rarity / identified,
 *     add custom items, quest items, potions or currency. Every edit names the draft revision (no lost updates).
 *  3. `lootDraftApprove` turns the final pool into real items in the Arsenal tray (modifiers rolled with a new
 *     server seed). Nothing is distributed automatically – the GM gives tray items as before.
 *
 * Players never see drafts or the tray. Quest items are not salvageable by default (`locked`), may be bound
 * (no transfer) and carry GM notes that are stripped from player views.
 */
import type { CurrencyId } from './currency.js';
import { CURRENCY_IDS } from './currency.js';
import { BASE_ITEMS, type BaseCategory, type BaseItem } from './bases.js';
import { canRollMods, weightedPick, type Rng } from './generate.js';
import { MAX_ITEM_LEVEL } from './rules.js';

export type LootCategory = 'weapon' | 'armor' | 'accessory' | 'seal' | 'orb' | 'fragment' | 'potion' | 'consumable' | 'currency' | 'quest' | 'custom';
export const LOOT_CATEGORIES: LootCategory[] = ['weapon', 'armor', 'accessory', 'seal', 'orb', 'fragment', 'potion', 'consumable', 'currency', 'quest', 'custom'];
/** Categories the roller can produce; quest and custom entries are only ever added by the GM. */
export const ROLLED_CATEGORIES: LootCategory[] = ['weapon', 'armor', 'accessory', 'seal', 'orb', 'fragment', 'potion', 'consumable', 'currency'];
export const LOOT_CATEGORY_LABEL: Record<LootCategory, string> = {
  weapon: 'Weapons',
  armor: 'Armour & shields',
  accessory: 'Accessories',
  seal: 'Seals of Revelation',
  orb: 'Orbs of Renewal',
  fragment: 'Arcane Fragments',
  potion: 'Potions',
  consumable: 'Consumables',
  currency: 'Other currency',
  quest: 'Quest items',
  custom: 'Custom items',
};

export type Encounter = 'minion' | 'standard' | 'elite' | 'boss';
export const ENCOUNTERS: Encounter[] = ['minion', 'standard', 'elite', 'boss'];
export type DraftRarity = 'normal' | 'magic' | 'rare';

/** Rolls per drop, rarity weights (normal/magic/rare) and the item-level bonus over the reference level. */
export const ENCOUNTER_TABLE: Record<Encounter, { label: string; rolls: number; rarity: [number, number, number]; ilvlBonus: number }> = {
  minion: { label: 'Minion', rolls: 1, rarity: [80, 18, 2], ilvlBonus: 0 },
  standard: { label: 'Standard', rolls: 2, rarity: [65, 30, 5], ilvlBonus: 1 },
  elite: { label: 'Elite', rolls: 3, rarity: [45, 42, 13], ilvlBonus: 3 },
  boss: { label: 'Boss', rolls: 5, rarity: [25, 50, 25], ilvlBonus: 5 },
};
/** Relative weight of each category in a roll (only enabled categories count). */
export const CATEGORY_WEIGHT: Record<LootCategory, number> = { weapon: 20, armor: 16, accessory: 18, seal: 10, orb: 4, fragment: 14, potion: 12, consumable: 8, currency: 3, quest: 0, custom: 0 };

const ACCESSORY: BaseCategory[] = ['ring', 'amulet', 'cloak', 'head', 'gloves', 'boots', 'belt'];
export const CONSUMABLE_BASES = ['srd-torch', 'srd-rations-1-day', 'apex-arcane-dust', 'apex-iron-ingot'];
export const POTION_BASE = 'srd-potion-of-healing';
export const QUEST_BASE = 'apex-quest-token';

export const DRAFT_LIMITS = { entries: 24, name: 80, description: 600, gmNotes: 600, quantity: 99, image: 400 } as const;

export interface LootDraftEntry {
  key: string;
  category: LootCategory;
  /** Base item (equipment, potions, consumables). */
  baseId?: string;
  rarity?: DraftRarity;
  itemLevel?: number;
  identified?: boolean;
  quantity: number;
  /** Currency entries (seal/orb/fragment/currency). */
  currency?: CurrencyId;
  /** Quest and custom items. */
  name?: string;
  description?: string;
  /** Optional https image URL (quest items). */
  image?: string;
  /** GM-only notes (quest items) – never shown to players. */
  gmNotes?: string;
  /** Quest items: cannot be given/traded to another character. */
  noTransfer?: boolean;
  /** Quest/custom items: allow salvage (quest items default to false). */
  salvageable?: boolean;
}

export interface LootDraft {
  id: string;
  encounter: Encounter;
  referenceLevel: number;
  categories: LootCategory[];
  entries: LootDraftEntry[];
  rev: number;
  createdDay: number;
}

/** Median of character levels (lower middle for an even count – loot should never overshoot the party); 1 if none. */
export function medianLevel(levels: number[]): number {
  if (!levels.length) return 1;
  const s = [...levels].sort((a, b) => a - b);
  return clampLevel(s[Math.floor((s.length - 1) / 2)]);
}

export const clampLevel = (n: number) => Math.max(1, Math.min(20, Math.floor(n)));
const clampIlvl = (n: number) => Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.floor(n)));

/** Boss drops: +0 (85 %), +1 (12 %), +2 (3 %) extra item levels on top of the encounter bonus. */
export const BOSS_ILVL_SPREAD: Array<{ value: number; weight: number }> = [
  { value: 0, weight: 85 },
  { value: 1, weight: 12 },
  { value: 2, weight: 3 },
];

export function draftItemLevel(encounter: Encounter, referenceLevel: number, rng: Rng): number {
  const extra = encounter === 'boss' ? (weightedPick(rng, BOSS_ILVL_SPREAD) ?? 0) : 0;
  return clampIlvl(clampLevel(referenceLevel) + ENCOUNTER_TABLE[encounter].ilvlBonus + extra);
}

function basesOf(cat: LootCategory): BaseItem[] {
  if (cat === 'weapon') return BASE_ITEMS.filter((b) => b.category === 'weapon');
  if (cat === 'armor') return BASE_ITEMS.filter((b) => b.category === 'armor' || b.category === 'shield');
  if (cat === 'accessory') return BASE_ITEMS.filter((b) => ACCESSORY.includes(b.category) && canRollMods(b));
  return [];
}

const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length) % list.length];
const between = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Rolls one draft (pure; the seed comes from the server). */
export function rollDraft(encounter: Encounter, referenceLevel: number, categories: LootCategory[], rng: Rng, keyPrefix: string): LootDraftEntry[] {
  const enabled = categories.filter((c) => CATEGORY_WEIGHT[c] > 0);
  const table = ENCOUNTER_TABLE[encounter];
  const out: LootDraftEntry[] = [];
  if (!enabled.length) return out;
  for (let n = 0; n < table.rolls; n++) {
    const cat = weightedPick(rng, enabled.map((c) => ({ value: c, weight: CATEGORY_WEIGHT[c] })))!;
    const key = `${keyPrefix}-${n + 1}`;
    if (cat === 'weapon' || cat === 'armor' || cat === 'accessory') {
      const base = pick(rng, basesOf(cat));
      const [wn, wm, wr] = table.rarity;
      const rarity = weightedPick<DraftRarity>(rng, [
        { value: 'normal', weight: wn },
        { value: 'magic', weight: wm },
        { value: 'rare', weight: wr },
      ])!;
      out.push({ key, category: cat, baseId: base.id, rarity: canRollMods(base) ? rarity : 'normal', itemLevel: draftItemLevel(encounter, referenceLevel, rng), identified: rarity === 'normal', quantity: 1 });
    } else if (cat === 'potion') out.push({ key, category: cat, baseId: POTION_BASE, quantity: between(rng, 1, encounter === 'boss' ? 3 : 2) });
    else if (cat === 'consumable') out.push({ key, category: cat, baseId: pick(rng, CONSUMABLE_BASES), quantity: between(rng, 1, 3) });
    else if (cat === 'seal') out.push({ key, category: cat, currency: 'seal', quantity: between(rng, 1, encounter === 'boss' ? 3 : 1) });
    else if (cat === 'orb') out.push({ key, category: cat, currency: 'orb', quantity: 1 });
    else if (cat === 'fragment') out.push({ key, category: cat, currency: 'fragment', quantity: between(rng, 2, 4) * (encounter === 'boss' ? 3 : encounter === 'elite' ? 2 : 1) });
    else out.push({ key, category: cat, currency: pick<CurrencyId>(rng, ['augment', 'ascend']), quantity: 1 });
  }
  return out;
}

const CURRENCY_CATS: Partial<Record<LootCategory, CurrencyId>> = { seal: 'seal', orb: 'orb', fragment: 'fragment' };

/** Checks one entry against the rules of its category; returns the normalised entry or an error. */
export function normaliseEntry(e: LootDraftEntry, baseOf: (id?: string) => BaseItem | undefined): LootDraftEntry | string {
  const quantity = Math.max(1, Math.min(DRAFT_LIMITS.quantity, Math.floor(e.quantity)));
  const base = { key: e.key, category: e.category, quantity };
  switch (e.category) {
    case 'weapon':
    case 'armor':
    case 'accessory': {
      const b = baseOf(e.baseId);
      const ok = b && basesOf(e.category).some((x) => x.id === b.id);
      if (!ok) return 'Choose a base item of this category.';
      const rarity: DraftRarity = canRollMods(b) ? (e.rarity ?? 'normal') : 'normal';
      return { ...base, baseId: b.id, rarity, itemLevel: clampIlvl(e.itemLevel ?? 1), identified: rarity === 'normal' ? true : e.identified !== false, quantity: 1 };
    }
    case 'potion':
    case 'consumable': {
      const b = baseOf(e.baseId);
      const ok = e.category === 'potion' ? b?.id === POTION_BASE : !!b && CONSUMABLE_BASES.includes(b.id);
      if (!ok) return 'Unknown consumable.';
      return { ...base, baseId: b!.id };
    }
    case 'seal':
    case 'orb':
    case 'fragment':
      return { ...base, currency: CURRENCY_CATS[e.category] };
    case 'currency':
      if (!e.currency || !CURRENCY_IDS.includes(e.currency)) return 'Choose a currency.';
      return { ...base, currency: e.currency };
    case 'quest':
    case 'custom': {
      const name = (e.name ?? '').trim().slice(0, DRAFT_LIMITS.name);
      if (!name) return 'Give the item a name.';
      const image = e.image?.trim();
      if (image && (!/^https:\/\/[^\s"'<>]+$/.test(image) || image.length > DRAFT_LIMITS.image)) return 'The image must be an https:// address.';
      return {
        ...base,
        name,
        ...(e.description?.trim() ? { description: e.description.trim().slice(0, DRAFT_LIMITS.description) } : {}),
        ...(image && e.category === 'quest' ? { image } : {}),
        ...(e.gmNotes?.trim() && e.category === 'quest' ? { gmNotes: e.gmNotes.trim().slice(0, DRAFT_LIMITS.gmNotes) } : {}),
        ...(e.noTransfer && e.category === 'quest' ? { noTransfer: true } : {}),
        // quest items are NOT salvageable unless the GM allows it; custom items follow the normal rules
        ...(e.category === 'quest' ? (e.salvageable ? { salvageable: true } : {}) : e.salvageable === false ? { salvageable: false } : {}),
      };
    }
  }
}
