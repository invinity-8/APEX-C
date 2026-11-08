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
  | { type: 'critDamage' }
  /** APEX 0.7: spell attack rolls (bounded, tiny, rare). */
  | { type: 'spellAttack' }
  /** APEX 0.7: spell save DC (extremely rare, capped at +1 overall). */
  | { type: 'spellDc' }
  /** APEX 0.7: +1 to one ability score (capped per ability, never above 20 from items). */
  | { type: 'ability'; ability: SaveAbility }
  /** APEX 0.7: retaliatory damage – see the trigger in the text. */
  | { type: 'thorns' }
  /** APEX 0.7: applies only in a narrow situation the GM adjudicates – shown, never added automatically. */
  | { type: 'situational' }
  /** APEX 0.7: no mechanical effect at all. */
  | { type: 'cosmetic' };

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
  /** APEX 0.7 flavour: 'situational' (GM-adjudicated) or 'cosmetic' (no effect). Shown as such on the item. */
  flavor?: 'situational' | 'cosmetic';
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
    tiers: [t(1, 1, 2, 4, 800), t(2, 10, 5, 8, 500), t(3, 20, 9, 12, 250), t(4, 27, 13, 16, 90)],
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
    tiers: [t(1, 12, 5, 5, 120), t(2, 22, 10, 10, 40)],
    effect: { type: 'speed' },
    text: '+{v} ft walking speed',
    description: 'Walking speed in scenes, on the character sheet and in scene combat (Arena movement points stay a GM decision; encumbrance can still slow you).',
  },
  // ---------- APEX 0.7 – additional families (rare, capped; see ITEMIZATION_BALANCE.md §14)
  {
    id: 'spell-attack',
    name: 'Channeling',
    affix: 'prefix',
    family: 'spell-attack',
    tags: ['jewellery', 'weapon'],
    tiers: [t(1, 14, 1, 1, 60)],
    effect: { type: 'spellAttack' },
    text: '+{v} to spell attack rolls',
    description: 'Bounded accuracy: at most +1 from all equipped items.',
  },
  {
    id: 'spell-dc',
    name: 'Commanding',
    affix: 'prefix',
    family: 'spell-dc',
    tags: ['jewellery'],
    tiers: [t(1, 22, 1, 1, 15)],
    effect: { type: 'spellDc' },
    text: '+{v} to your spell save DC',
    description: 'Extremely rare. At most +1 from all equipped items.',
  },
  ...SAVES.map(
    ([a, label]): ModDef => ({
      id: `attr-${a}`,
      name: `of ${label === 'Strength' ? 'Might' : label === 'Dexterity' ? 'Grace' : label === 'Constitution' ? 'Vigour' : label === 'Intelligence' ? 'Insight' : label === 'Wisdom' ? 'the Sage' : 'Majesty'}`,
      affix: 'suffix',
      family: 'attribute',
      // APEX 1.0: attribute bonuses on every worn slot; +1 from item level 10, +2 from item level 24
      tags: ['jewellery', 'belt', 'head', 'hands', 'feet', 'cloak', 'armour'],
      tiers: [t(1, 10, 1, 1, 60), t(2, 24, 2, 2, 15)],
      effect: { type: 'ability', ability: a },
      text: `+{v} ${label}`,
      description: 'At most +2 per ability from all equipped items, and never above 20 through items. Raises the modifier used for AC, attacks and initiative.',
    }),
  ),
  {
    id: 'thorns',
    name: 'of Thorns',
    affix: 'suffix',
    family: 'thorns',
    tags: ['armour', 'shield'],
    tiers: [t(1, 8, 1, 2, 120), t(2, 18, 2, 3, 50)],
    effect: { type: 'thorns' },
    text: 'Thorns: once per turn, when a creature within 5 ft hits you with a melee attack, it takes {v} piercing damage',
    description: 'Total from all items at most 4. Thorns damage never triggers thorns (no recursion); the GM applies it.',
  },
  {
    id: 'skill-acrobatics',
    name: 'of the Tumbler',
    affix: 'suffix',
    family: 'skill',
    tags: ['feet', 'hands', 'cloak'],
    tiers: [t(1, 1, 1, 1, 300), t(2, 15, 2, 2, 120)],
    effect: { type: 'skill', skill: 'Acrobatics' },
    text: '+{v} to Acrobatics',
    description: 'At most +2 per skill from all equipped modifiers.',
  },
  // ---------- APEX 0.7 flavour: low impact, common – more variety, fewer "perfect" rares
  {
    id: 'trailworn',
    name: 'Trailworn',
    affix: 'prefix',
    family: 'carry-minor',
    tags: ['feet', 'belt', 'cloak'],
    tiers: [t(1, 1, 3, 5, 600)],
    effect: { type: 'carry' },
    text: '+{v} lb carrying capacity',
    description: 'A small, always-on carrying bonus.',
  },
  {
    id: 'featherweight',
    name: 'Featherweight',
    affix: 'prefix',
    family: 'light-make',
    tags: ['armour', 'shield', 'weapon'],
    tiers: [t(1, 1, 10, 25, 500)],
    effect: { type: 'situational' },
    flavor: 'situational',
    text: 'Weighs {v}% less (GM applies it to encumbrance)',
    description: 'Lighter make. APEX does not track item weight automatically – the GM applies it.',
  },
  {
    id: 'glimmering',
    name: 'Glimmering',
    affix: 'prefix',
    family: 'glow',
    tags: ['weapon', 'jewellery', 'head'],
    tiers: [t(1, 1, 5, 5, 450)],
    effect: { type: 'cosmetic' },
    flavor: 'cosmetic',
    text: 'Sheds a faint glow in a {v} ft radius on command (cosmetic, not bright enough to see by)',
    description: 'Purely atmospheric.',
  },
  {
    id: 'engraved',
    name: 'Engraved',
    affix: 'prefix',
    family: 'engraving',
    tags: ['weapon', 'armour', 'shield', 'jewellery'],
    tiers: [t(1, 1, 1, 3, 500)],
    effect: { type: 'cosmetic' },
    flavor: 'cosmetic',
    text: 'Masterwork imperial engraving (quality {v}) – cosmetic only',
    description: 'No mechanical effect.',
  },
  {
    id: 'forager',
    name: 'of the Forager',
    affix: 'suffix',
    family: 'forage',
    tags: ['hands', 'belt', 'cloak'],
    tiers: [t(1, 1, 1, 1, 550)],
    effect: { type: 'situational' },
    flavor: 'situational',
    text: '+{v} to Survival checks made to forage',
    description: 'Situational – the GM adds it when foraging.',
  },
  {
    id: 'climber',
    name: 'of the Climber',
    affix: 'suffix',
    family: 'climb',
    tags: ['hands', 'feet'],
    tiers: [t(1, 1, 1, 1, 550)],
    effect: { type: 'situational' },
    flavor: 'situational',
    text: '+{v} to Athletics checks made to climb',
    description: 'Situational – the GM adds it when climbing.',
  },
  {
    id: 'hearth',
    name: 'of the Hearth',
    affix: 'suffix',
    family: 'env-cold',
    tags: ['cloak', 'armour', 'head'],
    tiers: [t(1, 1, 5, 10, 500)],
    effect: { type: 'situational' },
    flavor: 'situational',
    text: '+{v} Cold Resistance against environmental cold only (weather, icy water) – not against attacks or spells',
    description: 'Situational – not added to the Cold Resistance total.',
  },
  {
    id: 'long-road',
    name: 'of the Long Road',
    affix: 'suffix',
    family: 'travel',
    tags: ['feet', 'cloak'],
    tiers: [t(1, 1, 1, 1, 450)],
    effect: { type: 'situational' },
    flavor: 'situational',
    text: 'Once per day, ignore {v} level of exhaustion from a forced march (GM)',
    description: 'Situational – travel fatigue only.',
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
