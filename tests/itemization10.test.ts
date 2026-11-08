/**
 * APEX 1.0 itemization: armour pieces (armour / evasion → AC), attributes from items, encumbrance in percent,
 * one set of effective numbers for sheet + scene combat, upgrade comparison, base drop levels.
 */
import { describe, expect, it } from 'vitest';
import { deriveStats } from '../src/game/equipment';
import { combatAttacks, effectiveStats, targetAc } from '../src/game/effectiveStats';
import { compareItem, averageDamage } from '../src/game/itemCompare';
import { PIECE_RATINGS, PIECE_SLOTS, pieceAc, type PieceInput } from '../src/game/items/armour';
import { BASE_ITEMS, baseItem } from '../src/game/items/bases';
import { seededRng } from '../src/game/items/generate';
import { createItem } from '../src/game/items/instance';
import { basesOf } from '../src/game/items/lootDraft';
import { DEFAULT_ITEM_RULES } from '../src/game/items/rules';
import { encumberedSpeed } from '../src/game/items/weight';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import type { ArmorType, EquipSlot } from '../src/game/equipment';
import type { Item, RolledMod } from '../src/game/types';

const sheet = (dex: number, str = 14): CharacterSheet => ({
  ...emptySheet(),
  attributes: [
    { id: 's', name: 'Strength', value: String(str), modifier: '' },
    { id: 'd', name: 'Dexterity', value: String(10 + dex * 2), modifier: '' },
    { id: 'c', name: 'Constitution', value: '12', modifier: '' },
  ],
  combat: [
    { id: 'ac', label: 'Armor Class', value: '11' },
    { id: 'pb', label: 'Proficiency bonus', value: '+2' },
    { id: 'sp', label: 'Speed (walking)', value: '30 ft.' },
    { id: 'in', label: 'Initiative', value: `+${dex}` },
  ],
});
const make = (baseId: string, id: string, mods: RolledMod[] = [], rarity: 'normal' | 'magic' | 'rare' = 'normal'): Item => ({ ...createItem(baseItem(baseId)!, { id, rarity, itemLevel: 25, rng: seededRng(1), mods }), container: 'backpack' });
const wearing = (items: Array<[EquipSlot, Item]>, extra: Item[] = []) => ({ inventory: [...items.map(([, i]) => i), ...extra], equipment: { slots: Object.fromEntries(items.map(([s, i]) => [s, i.id])), activeSet: 1 as const, resting: false, restingKeep: [] } });
const SET: Record<ArmorType, string[]> = {
  light: ['apex-quilted-jerkin', 'apex-leather-cap', 'apex-leather-gloves', 'apex-soft-boots'],
  medium: ['apex-ringed-hauberk', 'apex-iron-helm', 'apex-studded-gloves', 'apex-marching-caligae'],
  heavy: ['apex-iron-cuirass', 'apex-crested-galea', 'apex-iron-gauntlets', 'apex-iron-sabatons'],
};
const SLOTS: EquipSlot[] = ['chest', 'head', 'gloves', 'boots'];
const fullSet = (w: ArmorType) => wearing(SET[w].map((id, n) => [SLOTS[n], make(id, `${w}-${n}`)] as [EquipSlot, Item]));

describe('armour pieces: armour and evasion translate into AC', () => {
  it('full sets match the SRD reference values', () => {
    expect(deriveStats(sheet(0), { inventory: [] }).ac.value).toBe(11); // nothing rated worn → imported
    expect(deriveStats(sheet(5), fullSet('light')).ac.value).toBe(17); // 12 + Dex 5 (studded leather)
    expect(deriveStats(sheet(3), fullSet('medium')).ac.value).toBe(17); // 15 + Dex max 2 (half plate)
    expect(deriveStats(sheet(3), fullSet('heavy')).ac.value).toBe(18); // plate, no Dex
    expect(deriveStats(sheet(0), fullSet('heavy')).ac.value).toBe(18);
  });

  it('no mix of pieces beats the 18 ceiling at any Dexterity – bounded accuracy holds', () => {
    const types: ArmorType[] = ['light', 'medium', 'heavy'];
    let best = 0;
    for (const b of types) for (const h of types) for (const g of types) for (const f of types) {
      const pieces: PieceInput[] = PIECE_SLOTS.map((slot, n) => ({ slot, rating: { ...PIECE_RATINGS[slot][[b, h, g, f][n]], type: [b, h, g, f][n] } }));
      for (let dex = -1; dex <= 5; dex++) best = Math.max(best, pieceAc(pieces, dex));
    }
    expect(best).toBe(18);
    // unarmoured (all slots empty) stays 10 + Dex
    expect(pieceAc(PIECE_SLOTS.map((slot) => ({ slot, rating: null })), 5)).toBe(15);
  });

  it('heavy body + light pieces locks Dex; light body + heavy pieces keeps some Dex', () => {
    const heavyBody = wearing([['chest', make('apex-iron-cuirass', 'b')], ['head', make('apex-leather-cap', 'h')]]);
    const d = deriveStats(sheet(4), heavyBody);
    expect(d.armour).toMatchObject({ dexLimit: 0 });
    const lightBody = wearing([['chest', make('apex-quilted-jerkin', 'b')], ['head', make('apex-crested-galea', 'h')], ['gloves', make('apex-iron-gauntlets', 'g')], ['boots', make('apex-iron-sabatons', 'f')]]);
    const l = deriveStats(sheet(4), lightBody);
    expect(l.armour!.dexLimit).toBe(3);
    expect(l.ac.value).toBe(10 + 5 + 3);
  });

  it('an SRD suit already includes helmet, gloves and boots: their ratings do not stack', () => {
    const plate = wearing([['chest', make('srd-plate-armor', 'p')], ['head', make('apex-crested-galea', 'h')]]);
    const d = deriveStats(sheet(0), plate);
    expect(d.ac.value).toBe(18);
    expect(d.ac.steps.some((s) => /already includes/.test(s.label))).toBe(true);
  });

  it('tiers of a base share ratings but differ in weight, stealth and drop level', () => {
    const t1 = baseItem('apex-iron-cuirass')!, t3 = baseItem('apex-praetorian-plate')!;
    expect(t1.equip).toMatchObject({ armour: 8, evasion: 0, armorType: 'heavy' });
    expect(t3.equip).toMatchObject({ armour: 8, evasion: 0 });
    expect(t3.weight).toBeLessThan(t1.weight);
    expect(t3.dropLevel).toBe(16);
    expect(basesOf('armor', 5).some((b) => b.id === 'apex-praetorian-plate')).toBe(false);
    expect(basesOf('armor', 16).some((b) => b.id === 'apex-praetorian-plate')).toBe(true);
    expect(basesOf('armor', 1).some((b) => b.category === 'head')).toBe(true);
    // every slot has light, medium and heavy bases
    for (const cat of ['armor', 'head', 'gloves', 'boots'] as const) for (const w of ['light', 'medium', 'heavy']) expect(BASE_ITEMS.some((b) => b.category === cat && b.equip?.armorType === w), `${cat} ${w}`).toBe(true);
  });
});

describe('attributes, speed and the numbers used at the table', () => {
  it('a Dexterity item raises the modifier used for AC (never above 20)', () => {
    const ring = make('apex-silver-ring', 'r', [{ modId: 'attr-dex', tier: 2, value: 2 }], 'magic');
    const gear = wearing([['chest', make('apex-quilted-jerkin', 'b')], ['ring1', ring]]);
    const d = deriveStats(sheet(2), gear); // Dex 14 → 16
    expect(d.abilityScores.dex).toEqual({ base: 14, bonus: 2, value: 16 });
    expect(d.abilityMods.dex).toBe(3);
    const capped = deriveStats(sheet(5), gear); // Dex 20 stays 20
    expect(capped.abilityScores.dex).toEqual({ base: 20, bonus: 0, value: 20 });
  });

  it('encumbrance slows by percent (APEX default), speed items count', () => {
    expect(DEFAULT_ITEM_RULES.encumbranceVariant).toBe(2);
    expect(encumberedSpeed(30, 0, 'ok', 2).speedFt).toBe(30);
    expect(encumberedSpeed(30, 0, 'encumbered', 2).speedFt).toBe(20); // 22.5 → 20 (5-ft steps)
    expect(encumberedSpeed(30, 10, 'encumbered', 2).speedFt).toBe(30);
    expect(encumberedSpeed(30, 0, 'heavily', 2).speedFt).toBe(15);
    expect(encumberedSpeed(30, 0, 'over', 2).speedFt).toBe(0);
    expect(encumberedSpeed(30, 0, 'encumbered', 1).speedFt).toBe(20); // SRD variant −10 ft
    expect(encumberedSpeed(30, 0, 'encumbered', 0).speedFt).toBe(30);
  });

  it('effective stats: AC, speed, resistances and initiative follow the equipment', () => {
    const boots = make('apex-soft-boots', 'f', [{ modId: 'speed', tier: 1, value: 5 }, { modId: 'res-fire', tier: 3, value: 24 }], 'magic');
    const gloves = make('apex-leather-gloves', 'g', [{ modId: 'initiative', tier: 1, value: 1 }], 'magic');
    const token = { ...fullSet('heavy'), currency: {} };
    token.inventory = token.inventory.filter((i) => !i.id.endsWith('-3') && !i.id.endsWith('-2'));
    token.inventory.push(boots, gloves);
    token.equipment.slots = { ...token.equipment.slots, boots: 'f', gloves: 'g' };
    const e = effectiveStats(sheet(1, 16), token);
    expect(e.speed.value).toBe(35);
    expect(e.resistances.find((r) => r.element === 'fire')).toMatchObject({ points: 24, reduction: 0.12 });
    expect(e.initiative).toMatchObject({ sheet: 1, bonus: 1, value: 2 });
    expect(e.ac.sheet).toBe(11);
    expect(e.ac.value).toBe(targetAc(sheet(1, 16), token));
    expect(e.ac.value).not.toBe(11);
  });

  it('scene combat offers the equipped weapon with derived numbers', () => {
    const sword = make('srd-longsword', 'w', [{ modId: 'dmg-fire', tier: 2, value: 2 }], 'magic');
    const list = combatAttacks(sheet(1, 16), wearing([['main1', sword]]));
    expect(list[0]).toMatchObject({ name: `${sword.name} (equipped)`, bonus: '+5', damage: '1d8+5 slashing', source: 'equipment' });
  });
});

describe('upgrade comparison', () => {
  it('rates better armour as an upgrade and worse as a downgrade', () => {
    const worn = make('apex-quilted-jerkin', 'j');
    const better = make('apex-ringed-hauberk', 'h2');
    const st = { inventory: [worn, better], equipment: { slots: { chest: 'j' }, activeSet: 1 as const, resting: false, restingKeep: [] } };
    const up = compareItem(sheet(0), st, 'h2');
    expect('verdict' in up && up.verdict).toBe('upgrade');
    const st2 = { inventory: [worn, better], equipment: { slots: { chest: 'h2' }, activeSet: 1 as const, resting: false, restingKeep: [] } };
    const down = compareItem(sheet(0), st2, 'j');
    expect('verdict' in down && down.verdict).toBe('downgrade');
    expect('lines' in down && down.lines.find((l) => l.label === 'Armor Class')).toMatchObject({ delta: -1 });
  });

  it('averages damage text', () => {
    expect(averageDamage('2d6+3 slashing + 2 fire')).toBe(12);
    expect(averageDamage('—')).toBeNull();
  });
});
