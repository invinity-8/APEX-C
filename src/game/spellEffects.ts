/**
 * What common SRD 5.1 spells DO on the battle map (APEX 1.3). Spells not listed here still work through the generic
 * rules (attack-roll spells, saving-throw damage, areas, healing read from the description); this table adds the
 * effects the description alone can't drive: buffs and debuffs, conditions, several targets, marks.
 */
import type { EffectMods } from './combatEffects.js';
import type { ConditionId } from './combatEffects.js';
import type { AbilityKey } from './bestiary.js';
import type { SheetSpell } from './sheet.js';

export type Targeting = 'enemy' | 'ally' | 'self' | 'point' | 'none';

export interface SpellEffectDef {
  targeting: Targeting;
  /** Number of targets at the spell's base level, +perSlot per slot level above it. */
  targets?: number;
  perSlot?: number;
  /** Several attacks / darts at one or more targets (Scorching Ray, Magic Missile, Eldritch Blast). */
  projectiles?: { base: number; perSlot?: number; byLevel?: Array<[number, number]>; damage: string; autoHit?: boolean; label: string };
  /** Saving throw against the effect (ability), else the effect simply applies (buffs). */
  save?: AbilityKey;
  /** Effect on each (failed) target. */
  effect?: { key: string; name: string; mods?: EffectMods; condition?: ConditionId; untilStartOfCaster?: boolean; turns?: number };
  /** APEX 1.5 – temporary hit points ('1d4+4', '5', or 'mod' = the caster's spellcasting modifier), +perSlot per level above. */
  tempHp?: { amount: string; perSlot?: number };
  /** Aid: the maximum (and current) hit points rise by `maxHp` + this per slot level above the spell's. */
  maxHpPerSlot?: number;
  /** Ends one of these conditions on the target (Lesser Restoration). */
  removes?: ConditionId[];
  /** The effect sits on the TARGET but works for the caster (Hunter's Mark: +1d6 on the caster's hits). */
  mark?: string;
}

const T = (d: SpellEffectDef) => d;
export const SPELL_EFFECTS: Record<string, SpellEffectDef> = {
  'bless': T({ targeting: 'ally', targets: 3, perSlot: 1, effect: { key: 'bless', name: 'Blessed', mods: { toHitDie: '1d4' } } }),
  'bane': T({ targeting: 'enemy', targets: 3, perSlot: 1, save: 'cha', effect: { key: 'bane', name: 'Baned', mods: { toHitDie: '-1d4' } } }),
  'shield of faith': T({ targeting: 'ally', targets: 1, effect: { key: 'shield-of-faith', name: 'Shield of Faith', mods: { ac: 2 } } }),
  'shield': T({ targeting: 'self', effect: { key: 'shield', name: 'Shield', mods: { ac: 5 }, untilStartOfCaster: true } }),
  "hunter's mark": T({ targeting: 'enemy', targets: 1, mark: '1d6', effect: { key: 'hunters-mark', name: "Hunter's Mark", mods: { markDamage: '1d6' } } }),
  'hex': T({ targeting: 'enemy', targets: 1, mark: '1d6', effect: { key: 'hex', name: 'Hex', mods: { markDamage: '1d6' } } }),
  'hold person': T({ targeting: 'enemy', targets: 1, perSlot: 1, save: 'wis', effect: { key: 'paralyzed', name: 'Paralyzed (Hold Person)', condition: 'paralyzed' } }),
  'hold monster': T({ targeting: 'enemy', targets: 1, perSlot: 1, save: 'wis', effect: { key: 'paralyzed', name: 'Paralyzed (Hold Monster)', condition: 'paralyzed' } }),
  'faerie fire': T({ targeting: 'point', save: 'dex', effect: { key: 'faerie-fire', name: 'Outlined (Faerie Fire)', mods: { attacked: 'adv' } } }),
  'web': T({ targeting: 'point', save: 'dex', effect: { key: 'restrained', name: 'Restrained (Web)', condition: 'restrained' } }),
  'entangle': T({ targeting: 'point', save: 'str', effect: { key: 'restrained', name: 'Restrained (Entangle)', condition: 'restrained' } }),
  'blindness/deafness': T({ targeting: 'enemy', targets: 1, perSlot: 1, save: 'con', effect: { key: 'blinded', name: 'Blinded', condition: 'blinded' } }),
  'invisibility': T({ targeting: 'ally', targets: 1, perSlot: 1, effect: { key: 'invisible', name: 'Invisible', condition: 'invisible' } }),
  'blur': T({ targeting: 'self', effect: { key: 'blur', name: 'Blurred', mods: { attacked: 'dis' } } }),
  'tasha’s hideous laughter': T({ targeting: 'enemy', targets: 1, save: 'wis', effect: { key: 'prone', name: 'Laughing (prone, incapacitated)', mods: { attack: 'dis', attacked: 'proneAware', incapacitated: true, speedZero: true } } }),
  'command': T({ targeting: 'enemy', targets: 1, perSlot: 1, save: 'wis', effect: { key: 'prone', name: 'Prone (Command: grovel)', condition: 'prone' } }),
  // APEX 1.5 – buffs and support for allies and yourself (SRD 5.1 numbers)
  'mage armor': T({ targeting: 'ally', targets: 1, effect: { key: 'mage-armor', name: 'Mage Armor (AC 13 + Dex)', mods: { acBase: 13 } } }),
  'barkskin': T({ targeting: 'ally', targets: 1, effect: { key: 'barkskin', name: 'Barkskin (AC ≥ 16)', mods: { acMin: 16 } } }),
  'longstrider': T({ targeting: 'ally', targets: 1, perSlot: 1, effect: { key: 'longstrider', name: 'Longstrider (+10 ft)', mods: { speed: 10 } } }),
  'haste': T({ targeting: 'ally', targets: 1, effect: { key: 'haste', name: 'Hasted (+2 AC, speed ×2)', mods: { ac: 2, speedMult: 2 } } }),
  'stoneskin': T({ targeting: 'ally', targets: 1, effect: { key: 'stoneskin', name: 'Stoneskin (resists physical)', mods: { resistPhysical: true } } }),
  'greater invisibility': T({ targeting: 'ally', targets: 1, effect: { key: 'invisible', name: 'Invisible (Greater Invisibility)', condition: 'invisible' } }),
  'divine favor': T({ targeting: 'self', effect: { key: 'divine-favor', name: 'Divine Favor (+1d4 radiant)', mods: { weaponDamage: '1d4' } } }),
  'false life': T({ targeting: 'self', tempHp: { amount: '1d4+4', perSlot: 5 } }),
  'armor of agathys': T({ targeting: 'self', tempHp: { amount: '5', perSlot: 5 }, effect: { key: 'armor-of-agathys', name: 'Armor of Agathys' } }),
  'heroism': T({ targeting: 'ally', targets: 1, perSlot: 1, tempHp: { amount: 'mod' }, effect: { key: 'heroism', name: 'Heroism (not frightened)', mods: { tempHpTurn: -1 } } }),
  'aid': T({ targeting: 'ally', targets: 3, effect: { key: 'aid', name: 'Aid', mods: { maxHp: 5 } }, maxHpPerSlot: 5 }),
  'lesser restoration': T({ targeting: 'ally', targets: 1, removes: ['blinded', 'deafened', 'paralyzed', 'poisoned'] }),
  'mass healing word': T({ targeting: 'ally', targets: 6 }),
  'mass cure wounds': T({ targeting: 'ally', targets: 6 }),
  'prayer of healing': T({ targeting: 'ally', targets: 6 }),
  'cure wounds': T({ targeting: 'ally', targets: 1 }),
  'healing word': T({ targeting: 'ally', targets: 1 }),
  'magic missile': T({ targeting: 'enemy', projectiles: { base: 3, perSlot: 1, damage: '1d4+1', autoHit: true, label: 'dart' } }),
  'scorching ray': T({ targeting: 'enemy', projectiles: { base: 3, perSlot: 1, damage: '2d6', label: 'ray' } }),
  'eldritch blast': T({ targeting: 'enemy', projectiles: { base: 1, byLevel: [[5, 2], [11, 3], [17, 4]], damage: '1d10', label: 'beam' } }),
};

export const spellEffectOf = (spell: Pick<SheetSpell, 'name'>) => SPELL_EFFECTS[spell.name.trim().toLowerCase().replace(/'/g, '’').replace('hunter’s', "hunter's")] ?? SPELL_EFFECTS[spell.name.trim().toLowerCase()];

/** Number of targets / projectiles at a slot level. */
export function spellCount(def: SpellEffectDef, spellLevel: number, slotLevel: number, characterLevel: number): number {
  if (def.projectiles) {
    const p = def.projectiles;
    if (p.byLevel) return p.byLevel.reduce((n, [lvl, c]) => (characterLevel >= lvl ? c : n), p.base);
    return p.base + (p.perSlot ?? 0) * Math.max(0, slotLevel - spellLevel);
  }
  return (def.targets ?? 1) + (def.perSlot ?? 0) * Math.max(0, slotLevel - spellLevel);
}

/** Does the spell help (heal, buff, restore) rather than harm? Used for right-click targeting of allies. */
export function supportive(spell: Pick<SheetSpell, 'name' | 'description' | 'level'>): boolean {
  const def = spellEffectOf(spell);
  if (def) return def.targeting === 'ally' || def.targeting === 'self';
  return !!spellHealing(spell, spell.level || 1);
}

/** Healing from the description: "regains hit points equal to 1d8 + your spellcasting ability modifier" (+ upcast). */
export function spellHealing(spell: Pick<SheetSpell, 'description' | 'level'>, slotLevel: number): { dice: string; addMod: boolean } | null {
  const t = spell.description.replace(/\s+/g, ' ');
  const m = /regains? (?:a number of )?hit points equal to (\d{1,2})d(\d{1,2})( \+ your spellcasting ability modifier)?/i.exec(t);
  if (!m) return null;
  let count = Number(m[1]);
  const sides = Number(m[2]);
  const up = /(?:healing|hit points?) increases? by (\d)d(\d{1,2}) for each (?:slot )?level above (\d)/i.exec(t);
  if (up && Number(up[2]) === sides && slotLevel > spell.level) count += Number(up[1]) * (slotLevel - Math.max(spell.level, Number(up[3])));
  return { dice: `${count}d${sides}`, addMod: !!m[3] };
}
