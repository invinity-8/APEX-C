import { describe, expect, it } from 'vitest';
import { deriveStats, emptyEquipment } from '../src/game/equipment';
import { emptySheet, parseSheet } from '../src/game/sheet';
import { MAGE_ARMOR_DURATION_MS, castMageArmor, isWearingArmor } from '../src/game/spells';
import type { CharacterSheet } from '../src/game/sheet';
import type { Item, Token } from '../src/game/types';

const mageArmor: CharacterSheet['spells'][number] = {
  id: 'mage-armor', name: 'Mage Armor', level: 1, prepared: true, source: 'Wizard', notes: '', school: 'Abjuration',
  castingTime: '1 action', range: 'Touch', components: 'V, S, M', duration: '8 hours', concentration: false, ritual: false,
  description: 'Base AC 13 + Dexterity while unarmored.',
};
const sheet: CharacterSheet = {
  ...emptySheet(),
  attributes: [{ id: 'dex', name: 'Dexterity', value: '16', modifier: '+3' }],
  combat: [{ id: 'ac', label: 'Armor Class', value: '14' }],
  spells: [mageArmor],
  resources: [{ id: 'slot-1', name: 'Spell slots (level 1)', current: 2, max: 2 }],
};
const token: Pick<Token, 'inventory' | 'equipment' | 'armorWornAt'> = { inventory: [], equipment: emptyEquipment() };

describe('Mage Armor spell rules', () => {
  it('consumes one level 1 slot and creates one eight-hour effect without stacking', () => {
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    const first = castMageArmor(sheet, token, mageArmor.id, now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.sheet.resources[0].current).toBe(1);
    expect(first.sheet.spellEffects).toEqual([{ id: 'mage-armor', kind: 'mageArmor', spellId: mageArmor.id, castAt: new Date(now).toISOString(), expiresAt: new Date(now + MAGE_ARMOR_DURATION_MS).toISOString() }]);
    const again = castMageArmor(first.sheet, token, mageArmor.id, now + 1000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.sheet.resources[0].current).toBe(0);
    expect(again.sheet.spellEffects).toHaveLength(1);
    expect(again.sheet.spellEffects[0].expiresAt).toBe(new Date(now + 1000 + MAGE_ARMOR_DURATION_MS).toISOString());
  });

  it('requires a prepared spell, a level 1 slot, and an unarmored character', () => {
    expect(castMageArmor({ ...sheet, spells: [{ ...mageArmor, prepared: false }] }, token, mageArmor.id, 1).ok).toBe(false);
    expect(castMageArmor({ ...sheet, resources: [{ ...sheet.resources[0], current: 0 }] }, token, mageArmor.id, 1).ok).toBe(false);
    const armoredItem: Item = { id: 'plate', name: 'Plate armor', kind: 'armor', description: '', quantity: 1, equip: { kind: 'armor', armorType: 'heavy', armorBase: 18 } };
    const armored = { inventory: [armoredItem], equipment: { ...emptyEquipment(), slots: { chest: armoredItem.id } } };
    expect(isWearingArmor(armored)).toBe(true);
    expect(castMageArmor(sheet, armored, mageArmor.id, 1)).toMatchObject({ ok: false });
  });

  it('applies 13 + Dexterity, expires at the server timestamp, and ends when armor is donned', () => {
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    const cast = castMageArmor(sheet, token, mageArmor.id, now);
    expect(cast.ok).toBe(true);
    if (!cast.ok) return;
    expect(deriveStats(cast.sheet, token, undefined, now).ac).toMatchObject({ value: 16, source: 'derived' });
    expect(deriveStats(cast.sheet, token, undefined, now).ac.steps[0].label).toContain('Mage Armor');
    expect(deriveStats(cast.sheet, token, undefined, now + MAGE_ARMOR_DURATION_MS).ac).toMatchObject({ value: 14, source: 'imported' });

    const plate: Item = { id: 'plate', name: 'Plate armor', kind: 'armor', description: '', quantity: 1, equip: { kind: 'armor', armorType: 'heavy', armorBase: 18 } };
    const donned = { inventory: [plate], equipment: { ...emptyEquipment(), slots: { chest: plate.id } }, armorWornAt: new Date(now + 1000).toISOString() };
    expect(deriveStats(cast.sheet, donned, undefined, now + 2000).ac.value).toBe(18);
    const doffed = { inventory: [], equipment: emptyEquipment(), armorWornAt: donned.armorWornAt };
    expect(deriveStats(cast.sheet, doffed, undefined, now + 3000).ac).toMatchObject({ value: 14, source: 'imported' });
  });

  it('normalises active effects and defaults missing effect data for old sheet saves', () => {
    const old = { ...emptySheet() } as Record<string, unknown>;
    delete old.spellEffects;
    const parsedOld = parseSheet(old);
    expect(parsedOld.ok && parsedOld.sheet.spellEffects).toEqual([]);
    expect(parseSheet({ ...emptySheet(), spellEffects: [{ id: 'e', kind: 'mageArmor', spellId: 'mage-armor', castAt: 'not-a-date', expiresAt: 'also-not-a-date' }] }).ok).toBe(false);
  });
});
