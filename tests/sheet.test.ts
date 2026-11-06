import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { containersOf } from '../src/game/inventory';
import { emptySheet, mergeSheets, parseSheet, spellMatchesQuery } from '../src/game/sheet';
import { buildPlayerView } from '../src/game/visibility';
import { mapExtraction, rowsToSheet } from '../src/sheetImport/map';

describe('Character sheet model', () => {
  it('validates and normalises sheets strictly', () => {
    const ok = parseSheet({ ...emptySheet(), notes: 'a\u0000b', details: [{ id: 'x', label: 'Class', value: 'Bard 3', extra: 1 }] });
    expect(ok.ok && ok.sheet.notes).toBe('ab');
    expect(ok.ok && ok.sheet.details[0]).toEqual({ id: 'x', label: 'Class', value: 'Bard 3' });
    expect(parseSheet({ ...emptySheet(), details: [{ id: 'x', label: 'A', value: '1' }, { id: 'x', label: 'B', value: '2' }] }).ok).toBe(false);
    expect(parseSheet({ ...emptySheet(), resources: [{ id: 'r', name: 'Ki', current: 1e9, max: null }] }).ok).toBe(false);
    expect(parseSheet({ ...emptySheet(), hitPoints: { current: 5, max: -1, temp: 0 } }).ok).toBe(false);
    expect(parseSheet('nope').ok).toBe(false);
  });

  it('preserves structured spell details and remains compatible with older saves', () => {
    const oldSave = parseSheet({ ...emptySheet(), spells: [{ id: 'spell-old', name: 'Mage Armor', level: 1, prepared: true, source: 'Wizard', notes: 'Check components' }] });
    expect(oldSave.ok && oldSave.sheet.spells[0]).toMatchObject({ school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });

    const spell = { id: 'spell-new', name: 'Mage Armor', level: 1, prepared: true, source: 'Wizard', notes: '', school: 'Abjuration', castingTime: '1 action', range: 'Touch', components: 'V, S, M', duration: '8 hours', concentration: false, ritual: false, description: 'Target AC becomes 13 + Dexterity modifier while unarmored.' };
    const parsed = parseSheet({ ...emptySheet(), spells: [spell] });
    expect(parsed.ok && parsed.sheet.spells[0]).toEqual(spell);
    if (parsed.ok) {
      const restored = parsed.sheet.spells[0];
      for (const detail of ['abjuration', 'wizard', '1 action', 'touch', 'v, s, m', '8 hours', 'unarmored']) {
        expect(spellMatchesQuery(restored, detail)).toBe(true);
      }
      expect(spellMatchesQuery(restored, '   ')).toBe(true);
      expect(spellMatchesQuery(restored, 'not present')).toBe(false);
    }
    const bounded = parseSheet({ ...emptySheet(), spells: [{ ...spell, description: 'x'.repeat(8001) }] });
    expect(bounded.ok && bounded.sheet.spells[0].description).toHaveLength(8000);
  });

  it('merge keeps existing entries and replaces same-named ones', () => {
    const a = { ...emptySheet(), attributes: [{ id: 'a1', name: 'Strength', value: '10', modifier: '+0' }], notes: 'Old' };
    const b = { ...emptySheet(), attributes: [{ id: 'b1', name: 'strength', value: '14', modifier: '+2' }, { id: 'b2', name: 'Dexterity', value: '12', modifier: '+1' }], notes: 'New', hitPoints: { current: 9, max: 9, temp: 0 } };
    const m = mergeSheets(a, b);
    expect(m.attributes.map((x) => [x.id, x.value])).toEqual([
      ['a1', '14'],
      ['b2', '12'],
    ]);
    expect(m.notes).toBe('Old\n\nNew');
    expect(m.hitPoints?.max).toBe(9);
  });
});

describe('PDF field mapping', () => {
  const fivee = {
    CharacterName: 'Sinna',
    ClassLevel: 'Sorcerer 3',
    'Race ': 'Half-Elf',
    STR: '8',
    STRmod: '-1',
    DEX: '14',
    'DEXmod ': '+2',
    CHA: '17',
    CHamod: '+3',
    HPMax: '20',
    HPCurrent: '17',
    AC: '12',
    Speed: '30 ft',
    Arcana: '+5',
    'Stealth ': '+2',
    'Check Box 11': 'Yes',
    'Features and Traits': 'Wild Magic Surge',
    'Wpn Name': 'Dagger',
    'Wpn1 AtkBonus': '+4',
    'Wpn1 Damage': '1d4+2 piercing',
    GP: '15',
    Equipment: 'Bedroll\nRope (50 ft)\nAqueduct-Stone Staff',
    MysteryField: 'Something custom',
  };

  it('recognises the fillable D&D 5e sheet', () => {
    const m = mapExtraction({ fields: fivee, text: '', pages: 3 });
    expect(m.format).toBe('Fillable D&D 5e character sheet');
    const by = (label: string) => m.rows.find((r) => r.label === label)!;
    expect(by('Class & level')).toMatchObject({ value: 'Sorcerer 3', status: 'recognized', include: true, group: 'identity' });
    expect(by('Charisma')).toMatchObject({ value: '17', modifier: '+3', status: 'recognized' });
    expect(by('Dexterity').modifier).toBe('+2');
    expect(by('Hit points (maximum)').value).toBe('20');
    expect(by('Armor Class')).toMatchObject({ value: '12', group: 'combat' });
    expect(m.rows.find((r) => r.kind === 'attack')).toMatchObject({ value: 'Dagger', bonus: '+4', damage: '1d4+2 piercing' });
    expect(m.rows.filter((r) => r.kind === 'item').map((r) => r.value)).toEqual(['Bedroll', 'Rope (50 ft)', 'Aqueduct-Stone Staff']);
    // unknown fields go to the Advanced section, not imported by default; checkboxes are ignored
    expect(by('MysteryField')).toMatchObject({ status: 'unrecognized', include: false, group: 'raw' });
    expect(m.rows.some((r) => r.source === 'Check Box 11')).toBe(false);
    // nothing important is missing here
    expect(m.rows.filter((r) => r.status === 'missing')).toEqual([]);
  });

  it('builds a sheet and inventory lines from the confirmed rows', () => {
    const m = mapExtraction({ fields: fivee, text: '', pages: 3 });
    const { sheet, items, problems } = rowsToSheet(m.rows, { fileName: 'sinna.pdf', format: m.format });
    expect(problems).toEqual([]);
    expect(sheet.hitPoints).toEqual({ current: 17, max: 20, temp: 0 });
    expect(sheet.resources.find((r) => r.name === 'Gold (gp)')?.current).toBe(15);
    expect(sheet.details.some((d) => d.label === 'MysteryField')).toBe(false);
    expect(sheet.raw).toEqual([]);
    expect(items).toEqual([
      { name: 'Bedroll', quantity: 1 },
      { name: 'Rope (50 ft)', quantity: 1 },
      { name: 'Aqueduct-Stone Staff', quantity: 1 },
    ]);
    expect(sheet.source).toMatchObject({ kind: 'pdf', fileName: 'sinna.pdf' });
    expect(parseSheet(sheet).ok).toBe(true);
  });

  it('marks values read from page text as uncertain and lists what is missing', () => {
    const text = 'Character Name: Aster\nFighter 5\nStrength 16 (+3)\nDexterity 12 (+1)\nArmor Class 18\nHit Point Maximum 44\nSpeed 30 ft.';
    const m = mapExtraction({ fields: {}, text, pages: 1 });
    expect(m.format).toMatch(/Text PDF/);
    const str = m.rows.find((r) => r.label === 'Strength')!;
    expect(str).toMatchObject({ value: '16', modifier: '+3', status: 'uncertain' });
    expect(m.rows.find((r) => r.label === 'Hit points (maximum)')).toMatchObject({ value: '44', status: 'uncertain' });
    expect(m.rows.find((r) => r.label === 'Class & level')?.value).toBe('Fighter 5');
    expect(m.rows.find((r) => r.label === 'Complete page text')?.include).toBe(false);
    const sparse = mapExtraction({ fields: {}, text: 'Some backstory without any numbers at all, just prose.', pages: 1 });
    expect(sparse.rows.filter((r) => r.status === 'missing').map((r) => r.label)).toEqual(['Hit points (maximum)', 'Attributes / ability scores', 'Class & level', 'Armor Class']);
    expect(sparse.rows.filter((r) => r.status === 'missing').every((r) => !r.include && r.value === '')).toBe(true);
  });

  it('detects image-only PDFs instead of pretending', () => {
    const m = mapExtraction({ fields: {}, text: '  \n ', pages: 2 });
    expect(m.imageOnly).toBe(true);
  });

  it('reports values that are not numbers instead of guessing', () => {
    const m = mapExtraction({ fields: { HPMax: 'twenty' }, text: '', pages: 1 });
    expect(m.rows.find((r) => r.hp === 'max')?.status).toBe('uncertain');
    expect(rowsToSheet(m.rows, { fileName: 'x.pdf', format: '' }).problems[0]).toMatch(/whole number/);
  });
});

describe('Inventory rules', () => {
  it('existing saves without containers get the default containers', () => {
    const s = createDemoState({ radius: 6, seed: 1 });
    expect(containersOf(s.tokens.sinna).map((c) => c.name)).toEqual(['Backpack', 'Pockets', 'Side Pouch', 'Equipped / Worn', 'Other']);
  });

  it('players can request only their own narrative items; requests stay out of the shared log', () => {
    const s = createDemoState({ radius: 6, seed: 1 });
    const own = executeCommand(s, { role: 'player', tokenId: 'sinna' }, { type: 'invRequestItem', tokenId: 'sinna', requestId: 'req-1', name: '  Old iron key  ', quantity: 1, description: 'A found key.' });
    expect(own.ok).toBe(true);
    expect(own.state.tokens.sinna.inventory.some(i => i.id === 'k1')).toBe(false);
    expect(own.state.tokens.sinna.itemRequests?.[0]).toMatchObject({ id: 'req-1', name: 'Old iron key', status: 'pending' });
    expect(own.state.log).toEqual(s.log);
    const other = executeCommand(s, { role: 'player', tokenId: 'sinna' }, { type: 'invRequestItem', tokenId: 'aster', requestId: 'req-2', name: 'x', quantity: 1, description: '' });
    expect(other.ok).toBe(false);
    const bypass = executeCommand(s, { role: 'player', tokenId: 'sinna' }, { type: 'invAddItem', tokenId: 'sinna', itemId: 'k1', name: 'Key' });
    expect(bypass.ok).toBe(false);
    const empty = executeCommand(s, { role: 'gm' }, { type: 'invAddItem', tokenId: 'aster', itemId: 'k3', name: '   ' });
    expect(empty.ok).toBe(false);
  });

  it('other party members never see an inventory in the player view', () => {
    const s = createDemoState({ radius: 6, seed: 1 });
    const v = buildPlayerView(s, 'sinna');
    expect(v.tokens.find((t) => t.id === 'sinna')!.details!.inventory.length).toBeGreaterThan(0);
    for (const t of v.tokens.filter((t) => t.id !== 'sinna')) expect(t.details?.inventory ?? []).toEqual([]);
  });
});

