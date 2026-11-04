import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { ARMOR_PRESETS, WEAPON_PRESETS, deriveStats, suggestEquip, EQUIP_SLOTS } from '../src/game/equipment';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { parseCommand } from '../src/server/validate';
import type { GameState } from '../src/game/types';

/** Sinna (sinna.pdf): STR 11, DEX 11, WIS 18, PB +2, imported AC 16 (Breastplate + Shield). */
const sheet: CharacterSheet = {
  ...emptySheet(),
  attributes: [
    { id: 'a1', name: 'Strength', value: '11', modifier: '+0' },
    { id: 'a2', name: 'Dexterity', value: '11', modifier: '+0' },
    { id: 'a3', name: 'Constitution', value: '12', modifier: '+1' },
    { id: 'a4', name: 'Intelligence', value: '9', modifier: '-1' },
    { id: 'a5', name: 'Wisdom', value: '18', modifier: '+4' },
    { id: 'a6', name: 'Charisma', value: '9', modifier: '-1' },
  ],
  combat: [
    { id: 'c1', label: 'Armor Class', value: '16' },
    { id: 'c2', label: 'Proficiency bonus', value: '+2' },
  ],
};

const P = { role: 'player' as const, tokenId: 'sinna' };
const GM = { role: 'gm' as const };
function run(s: GameState, cmd: Command, actor: typeof P | typeof GM = P) {
  const r = executeCommand(s, actor, cmd);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function setup() {
  let s = createDemoState({ radius: 6, seed: 1 });
  s.tokens.sinna.inventory = [];
  s.tokens.sinna.equipment = undefined;
  for (const [id, name] of [['bp', 'Breastplate'], ['sh', 'Shield'], ['qs', 'Quarterstaff'], ['dg', 'Dagger'], ['gs', 'Greatsword']])
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: id, name });
  for (const [id, preset] of [['bp', ARMOR_PRESETS.Breastplate], ['sh', ARMOR_PRESETS.Shield], ['qs', WEAPON_PRESETS.Quarterstaff], ['dg', WEAPON_PRESETS.Dagger], ['gs', WEAPON_PRESETS.Greatsword]] as const)
    s = run(s, { type: 'setItemEquip', tokenId: 'sinna', itemId: id, rev: 0, equip: preset });
  return s;
}
const slotsUsing = (s: GameState, id: string) => EQUIP_SLOTS.filter((k) => s.tokens.sinna.equipment?.slots[k] === id);

describe('equipment rules (server-authoritative)', () => {
  it('equips armour + shield: derived AC 16 matches the imported AC with an explanation', () => {
    let s = setup();
    expect(deriveStats(sheet, s.tokens.sinna).ac).toMatchObject({ value: 16, source: 'imported' });
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' });
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sh', slot: 'off1' });
    const ac = deriveStats(sheet, s.tokens.sinna).ac;
    expect(ac).toMatchObject({ value: 16, source: 'derived', imported: 16 });
    expect(ac.steps.map((x) => x.label)).toEqual(['Breastplate (medium armour)', 'Dexterity modifier', 'Shield (shield)']);
  });

  it('medium armour caps Dexterity at +2, heavy ignores it', () => {
    let s = setup();
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' });
    const dex18 = { ...sheet, attributes: sheet.attributes.map((a) => (a.name === 'Dexterity' ? { ...a, value: '18' } : a)) };
    expect(deriveStats(dex18, s.tokens.sinna).ac.value).toBe(16); // 14 + min(4, 2)
    s = run(s, { type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 1, equip: ARMOR_PRESETS['Plate armor'] });
    expect(deriveStats(dex18, s.tokens.sinna).ac.value).toBe(18);
  });

  it('weapon sets: only the active set counts; switching never duplicates an item', () => {
    let s = setup();
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'qs', slot: 'main1' });
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sh', slot: 'off1' });
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'dg', slot: 'main2' });
    let d = deriveStats(sheet, s.tokens.sinna);
    expect(d.attacks.map((a) => [a.name, a.toHit, a.damage])).toEqual([['Quarterstaff', 2, '1d6 bludgeoning']]);
    s = run(s, { type: 'setWeaponSet', tokenId: 'sinna', set: 2 });
    d = deriveStats(sheet, s.tokens.sinna);
    expect(d.attacks.map((a) => a.name)).toEqual(['Dagger']);
    expect(d.ac.value).toBe(10); // shield is in set 1 → not held now
    // moving the dagger into set 1 removes it from set 2 (one slot per item)
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'dg', slot: 'off1' });
    expect(slotsUsing(s, 'dg')).toEqual(['off1']);
    expect(slotsUsing(s, 'sh')).toEqual([]);
    expect(s.tokens.sinna.inventory.filter((i) => i.id === 'dg')).toHaveLength(1);
  });

  it('two-handed weapons occupy both hands', () => {
    let s = setup();
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sh', slot: 'off1' });
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'gs', slot: 'main1' });
    expect(s.tokens.sinna.equipment!.slots.off1).toBeUndefined();
    expect(executeCommand(s, P, { type: 'equipItem', tokenId: 'sinna', itemId: 'sh', slot: 'off1' }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'equipItem', tokenId: 'sinna', itemId: 'gs', slot: 'off2' }).ok).toBe(false);
  });

  it('resting preset: armour and shield count as removed, nothing else changes; switching back restores', () => {
    let s = setup();
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' });
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'sh', slot: 'off1' });
    const before = { mp: s.tokens.sinna.movePoints, inv: structuredClone(s.tokens.sinna.inventory.length) };
    s = run(s, { type: 'setResting', tokenId: 'sinna', resting: true });
    expect(deriveStats(sheet, s.tokens.sinna).ac).toMatchObject({ value: 10 });
    expect({ mp: s.tokens.sinna.movePoints, inv: s.tokens.sinna.inventory.length }).toEqual(before); // no rest benefits granted
    s = run(s, { type: 'setResting', tokenId: 'sinna', resting: false });
    expect(deriveStats(sheet, s.tokens.sinna).ac.value).toBe(16);
    expect(s.tokens.sinna.equipment!.slots).toMatchObject({ chest: 'bp', off1: 'sh' });
  });

  it('wrong slots, undefined properties and removed items are handled safely', () => {
    let s = setup();
    s = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'rope', name: 'Rope' });
    expect(executeCommand(s, P, { type: 'equipItem', tokenId: 'sinna', itemId: 'rope', slot: 'main1' }).ok).toBe(false);
    expect(executeCommand(s, P, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'main1' }).ok).toBe(false);
    s = run(s, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' });
    s = run(s, { type: 'invRemoveItem', tokenId: 'sinna', itemId: 'bp', rev: 1 });
    expect(s.tokens.sinna.equipment!.slots.chest).toBeUndefined();
  });

  it('permissions: players only for their own character; GM-locked properties', () => {
    let s = setup();
    expect(executeCommand(s, { role: 'player', tokenId: 'aster' }, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' }).ok).toBe(false);
    s = run(s, { type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 1, equip: { kind: 'armor', armorType: 'medium', armorBase: 15 }, gmLocked: true }, GM);
    expect(s.tokens.sinna.inventory.find((i) => i.id === 'bp')!.equip!.gmLocked).toBe(true);
    expect(executeCommand(s, P, { type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 2, equip: { kind: 'armor', armorBase: 25 } }).ok).toBe(false);
    // a player can still equip a locked item
    expect(executeCommand(s, P, { type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' }).ok).toBe(true);
  });

  it('validation rejects malformed equipment payloads', () => {
    expect(parseCommand({ type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 0, equip: { kind: 'armor', armorBase: 99 } }).ok).toBe(false);
    expect(parseCommand({ type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 0, equip: { kind: 'weapon', damage: 'rm -rf' } }).ok).toBe(false);
    expect(parseCommand({ type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 0, equip: { kind: 'weapon', evil: 1 } }).ok).toBe(false);
    expect(parseCommand({ type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'tail' }).ok).toBe(false);
    expect(parseCommand({ type: 'setItemEquip', tokenId: 'sinna', itemId: 'bp', rev: 0, equip: WEAPON_PRESETS.Longsword }).ok).toBe(true);
  });

  it('suggestions are only suggestions (by name, incl. Aurora "[Breastplate]")', () => {
    expect(suggestEquip('[Breastplate]')?.preset).toBe('Breastplate');
    expect(suggestEquip('Mysterious Orb')).toBeNull();
  });
});
