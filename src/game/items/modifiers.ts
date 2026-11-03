/**
 * APEX modifier repository (APEX 0.6) – original affixes for a D&D-flavoured tabletop game.
 *
 * Concepts (inspired by action-RPG itemisation in general, not copied from any game's database):
 *  - prefix / suffix: a magic item has at most one of each, a rare item at most two of each;
 *  - family: an item can carry at most ONE modifier of a family (no "+1 to hit" twice on one sword);
 *  - tiers: each tier has a minimum item level, a value range and a roll weight – higher item levels unlock
 *    stronger tiers but never remove the weaker ones, so higher rarity widens combinations rather than
 *    multiplying numbers;
 *  - tags: which base items may roll the modifier (weapons, armour, jewellery …);
 *  - local: the effect applies to the item itself (a weapon's to-hit or bonus damage) instead of the character.
 * Changing tiers/values requires bumping MODIFIER_VERSION; rolled items store the version they were rolled with.
 */
import type { ModTag } from './bases.js';

export type Element = 'fire' | 'cold' | 'lightning' | 'poison' | 'necrotic' | 'radiant';
export const ELEMENTS: Element[] = ['fire', 'cold', 'lightning', 'poison', 'necrotic', 'radiant'];
export type SaveAbility = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type DamageKind = 'physical' | 'fire' | 'cold' | 'lightning';
export type Creature = 'beasts' | 'undead' | 'fiends' | 'constructs';

export type ModEffect =
  | { type: 'resistance'; element: Element }
  | { type: 'flatDamage'; damage: DamageKind }
  | { type: 'toHit' }
  | { type: 'ac' }
  | { type: 'maxHp' }
  | { type: 'save'; ability: SaveAbility }
  | { type: 'skill'; skill: string }
  | { type: 'initiative' }
  | { type: 'carry' }
  | { type: 'speed' }
  | { type: 'bane'; creature: Creature }
  | { type: 'critDamage' };

export interface ModTier {
  tier: number;
  /** Minimum item level. */
  ilvl: number;
  min: number;
  max: number;
  weight: number;
}

export interface ModDef {
  id: string;
  /** Affix name shown on magic items, e.g. "Smouldering" or "of Ash". */
  name: string;
  affix: 'prefix' | 'suffix';
  family: string;
  tags: ModTag[];
  tiers: ModTier[];
  effect: ModEffect;
  local?: boolean;
  /** Line shown on the identified item, `{v}` = rolled value. */
  text: string;
  description: string;
}

const t = (tier: number, ilvl: number, min: number, max: number, weight: number): ModTier => ({ tier, ilvl, min, max, weight });
const DEFENSIVE_SLOTS: ModTag[] = ['armour', 'shield', 'jewellery', 'cloak', 'head', 'hands', 'feet', 'belt'];
const RES_NAMES: Record<Element, string> = { fire: 'of Ash', cold: 'of the North Wind', lightning: 'of Grounding', poison: 'of the Antidote', necrotic: 'of the Living', radiant: 'of Shade' };
const resistance = (e: Element): ModDef => ({
  id: `res-${e}`,
  name: RES_NAMES[e],
  affix: 'suffix',
  family: `res-${e}`,
  tags: DEFENSIVE_SLOTS,
  tiers: [t(1, 1, 5, 10, 1000), t(2, 8, 11, 18, 700), t(3, 16, 19, 26, 400), t(4, 24, 27, 34, 200)],
  effect: { type: 'resistance', element: e },
  text: `+{v} ${e[0].toUpperCase()}${e.slice(1)} Resistance`,
  description: `APEX resistance points against ${e} damage (100 points = 50 % reduction).`,
});
const FLAT_NAMES: Record<DamageKind, string> = { physical: 'Honed', fire: 'Smouldering', cold: 'Frostbitten', lightning: 'Stormcharged' };
const flat = (d: DamageKind): ModDef => ({
  id: `dmg-${d}`,
  name: FLAT_NAMES[d],
  affix: 'prefix',
  family: 'flat-damage',
  tags: ['weapon'],
  tiers: [t(1, 1, 1, 1, 600), t(2, 10, 1, 2, 400), t(3, 18, 2, 3, 200), t(4, 26, 3, 4, 80)],
  effect: { type: 'flatDamage', damage: d },
  local: true,
  text: `+{v} ${d} damage`,
  description: `Adds {v} ${d} damage to each hit with this weapon.`,
});
const SKILLS: Array<[string, string]> = [
  ['Perception', 'of the Watch'],
  ['Stealth', 'of Hushed Steps'],
  ['Athletics', 'of the Legion'],
  ['Survival', 'of the Wilds'],
  ['Insight', 'of Discernment'],
  ['Persuasion', 'of the Senate'],
];
const SAVES: Array<[SaveAbility, string, string]> = [
  ['con', 'Constitution', 'of Fortitude'],
  ['dex', 'Dexterity', 'of Reflexes'],
  ['wis', 'Wisdom', 'of Resolve'],
  ['str', 'Strength', 'of the Ox'],
  ['int', 'Intelligence', 'of the Scholar'],
  ['cha', 'Charisma', 'of Presence'],
];

export const MODIFIERS: ModDef[] = [
  // ---------- prefixes
  ...(['physical', 'fire', 'cold', 'lightning'] as DamageKind[]).map(flat),
  {
    id: 'to-hit',
    name: 'Disciplined',
    affix: 'prefix',
    family: 'to-hit',
    tags: ['weapon'],
    tiers: [t(1, 12, 1, 1, 120), t(2, 24, 2, 2, 30)],
    effect: { type: 'toHit' },
    local: true,
    text: '+{v} to attack rolls with this weapon',
    description: 'Bounded accuracy: at most +2 from modifiers on one weapon.',
  },
  {
    id: 'ac',
    name: 'Bulwark',
    affix: 'prefix',
    family: 'ac',
    tags: ['armour', 'shield'],
    tiers: [t(1, 14, 1, 1, 100)],
    effect: { type: 'ac' },
    text: '+{v} Armour Class',
    description: 'Bounded accuracy: at most +2 AC from all equipped modifiers together.',
  },
  {
    id: 'max-hp',
    name: 'Hale',
    affix: 'prefix',
    family: 'max-hp',
    tags: ['armour', 'shield', 'belt', 'jewellery', 'head'],
    tiers: [t(1, 1, 2, 4, 800), t(2, 10, 5, 8, 500), t(3, 20, 9, 12, 250)],
    effect: { type: 'maxHp' },
    text: '+{v} maximum hit points',
    description: 'Extra hit points while equipped (shown next to the sheet value, never written into it).',
  },
  ...(['beasts', 'undead', 'fiends', 'constructs'] as Creature[]).map(
    (c): ModDef => ({
      id: `bane-${c}`,
      name: `${c[0].toUpperCase()}${c.slice(1, -1)}-bane`,
      affix: 'prefix',
      family: 'bane',
      tags: ['weapon'],
      tiers: [t(1, 6, 1, 2, 200), t(2, 18, 2, 4, 100)],
      effect: { type: 'bane', creature: c },
      local: true,
      text: `+{v} damage against ${c}`,
      description: `Extra damage per hit against ${c} (the GM decides which creatures count).`,
    }),
  ),
  // ---------- suffixes
  ...ELEMENTS.map(resistance),
  ...SAVES.map(
    ([a, label, name]): ModDef => ({
      id: `save-${a}`,
      name,
      affix: 'suffix',
      family: 'save',
      tags: ['jewellery', 'cloak', 'belt', 'shield'],
      tiers: [t(1, 8, 1, 1, 150), t(2, 22, 2, 2, 40)],
      effect: { type: 'save', ability: a },
      text: `+{v} to ${label} saving throws`,
      description: 'At most +2 per ability from all equipped modifiers.',
    }),
  ),
  ...SKILLS.map(
    ([skill, name]): ModDef => ({
      id: `skill-${skill.toLowerCase()}`,
      name,
      affix: 'suffix',
      family: 'skill',
      tags: ['jewellery', 'head', 'hands', 'feet', 'cloak', 'belt'],
      tiers: [t(1, 1, 1, 1, 300), t(2, 15, 2, 2, 120)],
      effect: { type: 'skill', skill },
      text: `+{v} to ${skill}`,
      description: 'At most +2 per skill from all equipped modifiers.',
    }),
  ),
  {
    id: 'initiative',
    name: 'of Alacrity',
    affix: 'suffix',
    family: 'initiative',
    tags: ['feet', 'hands', 'jewellery', 'weapon'],
    tiers: [t(1, 6, 1, 1, 250), t(2, 20, 2, 2, 80)],
    effect: { type: 'initiative' },
    text: '+{v} to initiative',
    description: 'At most +2 from all equipped modifiers.',
  },
  {
    id: 'crit-damage',
    name: 'of Ruin',
    affix: 'suffix',
    family: 'crit-damage',
    tags: ['weapon'],
    tiers: [t(1, 1, 2, 3, 500), t(2, 10, 3, 5, 300), t(3, 20, 5, 8, 120)],
    effect: { type: 'critDamage' },
    local: true,
    text: '+{v} damage on a critical hit with this weapon',
    description: 'Added once to the total damage of a critical hit (not doubled).',
  },
  {
    id: 'carry',
    name: 'of the Mule',
    affix: 'suffix',
    family: 'carry',
    tags: ['belt', 'hands'],
    tiers: [t(1, 1, 10, 20, 400), t(2, 12, 25, 40, 200)],
    effect: { type: 'carry' },
    text: '+{v} lb carrying capacity',
    description: 'Adds to the carrying capacity shown for the character.',
  },
  {
    id: 'speed',
    name: 'of the March',
    affix: 'suffix',
    family: 'speed',
    tags: ['feet'],
    tiers: [t(1, 12, 5, 5, 120)],
    effect: { type: 'speed' },
    text: '+{v} ft walking speed',
    description: 'Character-sheet walking speed only. It never changes arena movement points (those stay a GM decision).',
  },
];

const BY_ID = new Map(MODIFIERS.map((m) => [m.id, m]));
export const modifier = (id: string): ModDef | undefined => BY_ID.get(id);

/** Modifiers a base item may roll at an item level (each with its eligible tiers). */
export function eligibleMods(tags: ModTag[], itemLevel: number): Array<{ def: ModDef; tiers: ModTier[] }> {
  if (!tags.length) return [];
  const out: Array<{ def: ModDef; tiers: ModTier[] }> = [];
  for (const def of MODIFIERS) {
    if (!def.tags.some((tg) => tags.includes(tg))) continue;
    const tiers = def.tiers.filter((tr) => tr.ilvl <= itemLevel);
    if (tiers.length) out.push({ def, tiers });
  }
  return out;
}

export const modText = (def: ModDef, value: number) => def.text.replace('{v}', String(value));
