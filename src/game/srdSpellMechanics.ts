/**
 * Game mechanics of common SRD 5.1 spells (CC BY 4.0, “System Reference Document 5.1” by Wizards of the Coast LLC)
 * – NUMBERS ONLY: level, range, casting time, attack or save, damage / healing dice, area, upcasting. No spell
 * descriptions are copied. Used when an imported sheet lists a spell by name without its details (Aurora PDFs
 * often do), so a druid can still cast Produce Flame and a wizard Fire Bolt on the battle map.
 * The sheet's own data always wins; this only fills empty fields.
 */
import type { SheetSpell } from './sheet.js';

interface M { level: number; range: string; time?: string; attack?: 'ranged' | 'melee'; save?: string; damage?: string; up?: string; heal?: string; area?: string; conc?: boolean }
const m = (x: M) => x;

export const SRD_SPELL_MECHANICS: Record<string, M> = {
  // cantrips (damage grows at character levels 5, 11, 17)
  'fire bolt': m({ level: 0, range: '120 feet', attack: 'ranged', damage: '1d10 fire' }),
  'ray of frost': m({ level: 0, range: '60 feet', attack: 'ranged', damage: '1d8 cold' }),
  'chill touch': m({ level: 0, range: '120 feet', attack: 'ranged', damage: '1d8 necrotic' }),
  'eldritch blast': m({ level: 0, range: '120 feet', attack: 'ranged', damage: '1d10 force' }),
  'produce flame': m({ level: 0, range: '30 feet', attack: 'ranged', damage: '1d8 fire' }),
  'shocking grasp': m({ level: 0, range: 'Touch', attack: 'melee', damage: '1d8 lightning' }),
  'sacred flame': m({ level: 0, range: '60 feet', save: 'Dexterity', damage: '1d8 radiant' }),
  'acid splash': m({ level: 0, range: '60 feet', save: 'Dexterity', damage: '1d6 acid' }),
  'poison spray': m({ level: 0, range: '10 feet', save: 'Constitution', damage: '1d12 poison' }),
  'vicious mockery': m({ level: 0, range: '60 feet', save: 'Wisdom', damage: '1d4 psychic' }),
  'shillelagh': m({ level: 0, range: 'Touch', time: '1 bonus action' }),
  // 1st level
  'burning hands': m({ level: 1, range: 'Self (15-foot cone)', save: 'Dexterity', damage: '3d6 fire', up: '1d6', area: '15-foot cone' }),
  'thunderwave': m({ level: 1, range: 'Self (15-foot cube)', save: 'Constitution', damage: '2d8 thunder', up: '1d8', area: '15-foot cube' }),
  'guiding bolt': m({ level: 1, range: '120 feet', attack: 'ranged', damage: '4d6 radiant', up: '1d6' }),
  'inflict wounds': m({ level: 1, range: 'Touch', attack: 'melee', damage: '3d10 necrotic', up: '1d10' }),
  'magic missile': m({ level: 1, range: '120 feet' }),
  'cure wounds': m({ level: 1, range: 'Touch', heal: '1d8', up: '1d8' }),
  'healing word': m({ level: 1, range: '60 feet', time: '1 bonus action', heal: '1d4', up: '1d4' }),
  'bless': m({ level: 1, range: '30 feet', conc: true }),
  'bane': m({ level: 1, range: '30 feet', save: 'Charisma', conc: true }),
  'shield': m({ level: 1, range: 'Self', time: '1 reaction' }),
  'shield of faith': m({ level: 1, range: '60 feet', time: '1 bonus action', conc: true }),
  "hunter's mark": m({ level: 1, range: '90 feet', time: '1 bonus action', conc: true }),
  'hex': m({ level: 1, range: '90 feet', time: '1 bonus action', conc: true }),
  'entangle': m({ level: 1, range: '90 feet', save: 'Strength', area: '20-foot cube', conc: true }),
  'faerie fire': m({ level: 1, range: '60 feet', save: 'Dexterity', area: '20-foot cube', conc: true }),
  'command': m({ level: 1, range: '60 feet', save: 'Wisdom' }),
  'mage armor': m({ level: 1, range: 'Touch' }),
  'longstrider': m({ level: 1, range: 'Touch' }),
  'false life': m({ level: 1, range: 'Self' }),
  'armor of agathys': m({ level: 1, range: 'Self' }),
  'heroism': m({ level: 1, range: 'Touch', conc: true }),
  'divine favor': m({ level: 1, range: 'Self', time: '1 bonus action', conc: true }),
  // 2nd level
  'barkskin': m({ level: 2, range: 'Touch', conc: true }),
  'lesser restoration': m({ level: 2, range: 'Touch' }),
  'prayer of healing': m({ level: 2, range: '30 feet', time: '10 minutes', heal: '2d8', up: '1d8' }),
  'scorching ray': m({ level: 2, range: '120 feet', attack: 'ranged', damage: '2d6 fire' }),
  'shatter': m({ level: 2, range: '60 feet', save: 'Constitution', damage: '3d8 thunder', up: '1d8', area: '10-foot-radius sphere' }),
  'acid arrow': m({ level: 2, range: '90 feet', attack: 'ranged', damage: '4d4 acid', up: '1d4' }),
  'moonbeam': m({ level: 2, range: '120 feet', save: 'Constitution', damage: '2d10 radiant', up: '1d10', area: '5-foot-radius cylinder', conc: true }),
  'hold person': m({ level: 2, range: '60 feet', save: 'Wisdom', conc: true }),
  'web': m({ level: 2, range: '60 feet', save: 'Dexterity', area: '20-foot cube', conc: true }),
  'blur': m({ level: 2, range: 'Self', conc: true }),
  'invisibility': m({ level: 2, range: 'Touch', conc: true }),
  // 3rd level and up
  'fireball': m({ level: 3, range: '150 feet', save: 'Dexterity', damage: '8d6 fire', up: '1d6', area: '20-foot-radius sphere' }),
  'lightning bolt': m({ level: 3, range: 'Self (100-foot line)', save: 'Dexterity', damage: '8d6 lightning', up: '1d6', area: '100-foot line' }),
  'haste': m({ level: 3, range: '30 feet', conc: true }),
  'mass healing word': m({ level: 3, range: '60 feet', time: '1 bonus action', heal: '1d4', up: '1d4' }),
  'stoneskin': m({ level: 4, range: 'Touch', conc: true }),
  'greater invisibility': m({ level: 4, range: 'Touch', conc: true }),
  'blight': m({ level: 4, range: '30 feet', save: 'Constitution', damage: '8d8 necrotic', up: '1d8' }),
  'mass cure wounds': m({ level: 5, range: '60 feet', heal: '3d8', up: '1d8' }),
  'cone of cold': m({ level: 5, range: 'Self (60-foot cone)', save: 'Constitution', damage: '8d8 cold', up: '1d8', area: '60-foot cone' }),
  'flame strike': m({ level: 5, range: '60 feet', save: 'Dexterity', damage: '8d6 fire', up: '1d6', area: '10-foot-radius cylinder' }),
};

const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/**
 * The spell with empty fields filled from the SRD mechanics (range, casting time and a short mechanical summary
 * that the battle rules read). Spells the table doesn't know are returned unchanged.
 */
export function withSrdMechanics(spell: SheetSpell): SheetSpell {
  const x = SRD_SPELL_MECHANICS[spell.name.trim().toLowerCase().replace(/’/g, "'")];
  if (!x) return spell;
  const bits: string[] = [];
  if (x.attack) bits.push(`Make a ${x.attack} spell attack.`);
  if (x.area) bits.push(`Each creature in a ${x.area} makes a saving throw.`);
  if (x.save) bits.push(`The target must make a ${x.save} saving throw.`);
  if (x.damage) bits.push(`It takes ${x.damage} damage${x.save ? ' on a failed save, or half as much on a successful one' : ''}.`);
  if (x.heal) bits.push(`A creature regains hit points equal to ${x.heal} + your spellcasting ability modifier.`);
  if (x.up && x.level > 0) bits.push(`The ${x.heal ? 'healing' : 'damage'} increases by ${x.up} for each slot level above ${ord(x.level)}.`);
  const summary = `[APEX: SRD 5.1 mechanics] ${bits.join(' ')}`.trim();
  return {
    ...spell,
    range: spell.range || x.range,
    castingTime: spell.castingTime || x.time || '1 action',
    concentration: spell.concentration || !!x.conc,
    description: spell.description || summary,
  };
}
