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
