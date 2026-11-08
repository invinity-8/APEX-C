/**
 * APEX 1.0 – one source for the character's numbers at the table.
 *
 * The character sheet stays the imported baseline; equipment (worn items in active slots) changes the numbers
 * players actually use: Armor Class, walking speed (item bonus and encumbrance), initiative, maximum hit points,
 * ability scores, resistances and the attacks of the equipped weapons. The character sheet overview, party
 * widgets, scene combat (enemy attacks against the character, player attacks with equipped weapons), scene and
 * Arena movement all read these values, so changing armour in the inventory changes AC everywhere.
 */
import type { CharacterSheet, SheetAttack } from './sheet.js';
import type { Token } from './types.js';
import { deriveStats, type CalcStep, type DerivedStats } from './equipment.js';
import { DEFAULT_ITEM_RULES, type ItemRules } from './items/rules.js';
import { carryLoad, encumberedSpeed, strengthScore, type CarryLoad, type EncumbranceMode } from './items/weight.js';
import { walkingSpeed } from './resources.js';
import { ELEMENTS, type Element } from './items/modifiers.js';
import { initiativeBonus } from './sceneTurns.js';

export type StatsToken = Pick<Token, 'inventory' | 'equipment' | 'armorWornAt'> & { currency?: Token['currency']; speedFt?: number };

export interface EffectiveStats {
  ac: { value: number | null; sheet: number | null; steps: CalcStep[]; source: DerivedStats['ac']['source'] };
  speed: { value: number; sheet: number | null; steps: CalcStep[] };
  initiative: { value: number; sheet: number; bonus: number };
  maxHp: { sheet: number | null; bonus: number; value: number | null };
  resistances: Array<{ element: Element; points: number; reduction: number; capped: boolean }>;
  abilities: DerivedStats['abilityScores'];
  load: CarryLoad;
  derived: DerivedStats;
}

const num = (s: string | undefined): number | null => {
  const m = /([+-]?\d+)/.exec(s ?? '');
  return m ? Number(m[1]) : null;
};

export function effectiveStats(sheet: CharacterSheet, token: StatsToken, rules: ItemRules = DEFAULT_ITEM_RULES, nowMs = Date.now()): EffectiveStats {
  const derived = deriveStats(sheet, token, rules, nowMs);
  const b = derived.bonuses;
  const load = carryLoad({ inventory: token.inventory, currency: token.currency }, strengthScore(sheet), b.carry.value, rules.encumbranceVariant);
  const sheetSpeed = walkingSpeed(sheet);
  const speed = encumberedSpeed(token.speedFt ?? sheetSpeed ?? 30, b.speed.value, load.state, rules.encumbranceVariant as EncumbranceMode);
  const sheetInit = initiativeBonus(sheet);
  // Dexterity raised by an item also raises initiative (5e: initiative = Dex check) when the sheet value is Dex-based
  const dexGain = (derived.abilityScores.dex?.bonus ?? 0) ? Math.floor((derived.abilityScores.dex!.value - 10) / 2) - Math.floor((derived.abilityScores.dex!.base - 10) / 2) : 0;
  const initBonus = b.initiative.value + dexGain;
  const sheetAc = num(sheet.combat.find((c) => c.label === 'Armor Class')?.value);
  const hpMax = sheet.hitPoints?.max ?? null;
  return {
    ac: { value: derived.ac.value, sheet: sheetAc, steps: derived.ac.steps, source: derived.ac.source },
    speed: { value: speed.speedFt, sheet: sheetSpeed, steps: speed.steps },
    initiative: { value: sheetInit + initBonus, sheet: sheetInit, bonus: initBonus },
    maxHp: { sheet: hpMax, bonus: b.maxHp.value, value: hpMax === null ? null : hpMax + b.maxHp.value },
    resistances: ELEMENTS.map((element) => ({ element, points: b.resistances[element].value, reduction: b.resistances[element].reduction, capped: b.resistances[element].total > b.resistances[element].value })),
    abilities: derived.abilityScores,
    load,
    derived,
  };
}

/** Armor Class a creature attacks against: effective AC, else the sheet value, else 10. */
export const targetAc = (sheet: CharacterSheet, token: StatsToken, rules?: ItemRules) => effectiveStats(sheet, token, rules).ac.value ?? 10;

/**
 * Attacks offered in scene combat: the equipped weapons of the active set (derived to-hit and damage, including
 * weapon modifiers) first, then the attacks written on the sheet. Indices are stable for a given sheet + equipment.
 */
export function combatAttacks(sheet: CharacterSheet, token: StatsToken, rules: ItemRules = DEFAULT_ITEM_RULES): Array<SheetAttack & { source: 'equipment' | 'sheet' }> {
  const derived = deriveStats(sheet, token, rules);
  const fromGear = derived.attacks.flatMap((a): Array<SheetAttack & { source: 'equipment' }> => {
    if (a.toHit === null) return [];
    const item = token.inventory.find((i) => i.id === a.itemId);
    const props = a.properties;
    const range = props.includes('ranged') ? '80/320 ft' : props.includes('thrown') ? '20/60 ft (thrown) · 5 ft' : props.includes('reach') ? 'Reach 10 ft' : '5 ft';
    // flat bonus damage of weapon modifiers is folded into the damage modifier so the scene dice can roll it
    const flat = [...a.damage.matchAll(/\+ (\d+) (physical|fire|cold|lightning)/g)].reduce((s, m) => s + Number(m[1]), 0);
    const dice = /(\d{1,2}d\d{1,3})([+-]\d+)?/.exec(a.damage);
    const mod = (dice?.[2] ? Number(dice[2]) : 0) + flat;
    const damage = dice ? `${dice[1]}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ''}${item?.equip?.damageType ? ` ${item.equip.damageType}` : ''}` : a.damage;
    return [{ id: `eq-${a.slot}`, name: `${a.name} (equipped)`, bonus: a.toHit >= 0 ? `+${a.toHit}` : `${a.toHit}`, damage, range: props.includes('reach') ? 'Reach 10 ft' : range, notes: a.extra.join('; '), source: 'equipment' }];
  });
  return [...fromGear, ...sheet.attacks.map((a) => ({ ...a, source: 'sheet' as const }))];
}
