/**
 * Regression tests with the real Aurora Builder sample (tests/fixtures/sinna.pdf), read with the real
 * pdf.js through the same extraction core as the browser (src/sheetImport/pdfCore.ts).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSheet } from '../src/game/sheet';
import { extractWithPdfjs, type PdfjsLike } from '../src/sheetImport/pdfCore';
import { mapExtraction, rowsToSheet, type Extracted, type ImportRow, type MappingResult } from '../src/sheetImport/map';

let x: Extracted;
let m: MappingResult;
const find = (kind: string, label: string) => m.rows.find((r) => r.kind === kind && r.label === label);

beforeAll(async () => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike;
  x = await extractWithPdfjs(pdfjs, new Uint8Array(readFileSync('tests/fixtures/sinna.pdf')));
  m = mapExtraction(x);
}, 60_000);

describe('Aurora PDF import – sinna.pdf', () => {
  it('reads real form fields and checkbox states, and detects the Aurora layout', () => {
    expect(x.pages).toBe(6);
    expect(Object.keys(x.fields).length).toBeGreaterThan(400);
    expect(x.checkboxes?.['details_wis_save_proficiency']).toBe(true);
    expect(x.checkboxes?.['details_str_save_proficiency']).toBe(false);
    expect(m.format).toMatch(/Aurora/);
  });

  it('identity: name, build, background, alignment – from fields, not page text', () => {
    expect(find('detail', 'Character name')).toMatchObject({ value: 'Sinna', status: 'recognized', source: 'details_character_name' });
    expect(find('detail', 'Race, class & level')?.value).toBe('Level 1 Kor Druid');
    expect(find('detail', 'Background')?.value).toBe('Custom Background');
    expect(find('detail', 'Alignment')?.value).toBe('Lawful Good');
    expect(find('appearance', 'Gender')?.value).toBe('Female');
    expect(m.rows.some((r) => r.value === 'EXPERIENCE')).toBe(false);
  });

  it('attributes with modifiers, Armor Class 16 and maximum HP 9', () => {
    expect(find('attribute', 'Wisdom')).toMatchObject({ value: '18', modifier: '+4', status: 'recognized' });
    expect(find('attribute', 'Strength')).toMatchObject({ value: '11', modifier: '+0' });
    expect(find('attribute', 'Charisma')).toMatchObject({ value: '9', modifier: '-1' });
    expect(find('combat', 'Armor Class')).toMatchObject({ value: '16', status: 'recognized', source: 'details_armor_class' });
    expect(find('hp', 'Hit points (maximum)')).toMatchObject({ value: '9', status: 'recognized' });
    expect(find('combat', 'Hit dice')?.value).toBe('1d8');
    expect(find('combat', 'Proficiency bonus')?.value).toBe('+2');
    expect(find('combat', 'Passive Perception')?.value).toBe('16');
    expect(find('combat', 'Speed (walking)')?.value).toBe('30ft.');
    expect(find('combat', 'Speed (flying)')).toBeUndefined(); // "0ft." is not imported
    expect(m.rows.filter((r) => r.status === 'missing')).toEqual([]);
  });

  it('skills and saving throws with proficiencies', () => {
    expect(find('save', 'Wisdom save')).toMatchObject({ value: '+6', proficient: true });
    expect(find('save', 'Strength save')).toMatchObject({ value: '+0', proficient: false });
    expect(find('skill', 'Perception (Wis)')).toMatchObject({ value: '+6', proficient: true });
    expect(find('skill', 'Arcana (Int)')).toMatchObject({ value: '-1', proficient: false });
    expect(m.rows.filter((r) => r.kind === 'skill')).toHaveLength(18);
  });

  it('attacks, equipment (no duplicates from item cards or equipped slots) and currency', () => {
    expect(find('attack', 'Quarterstaff')).toMatchObject({ bonus: '+2 vs AC', range: '5 ft' });
    const items = m.rows.filter((r) => r.kind === 'item');
    expect(items.map((r) => [r.value, r.quantity, r.equipped])).toEqual([
      ['Breastplate', 1, true],
      ['Shield', 1, true],
      ['Quarterstaff', 1, true],
    ]);
    expect(m.rows.some((r) => r.source.startsWith('card_'))).toBe(false);
  });

  it('spells: cantrips, prepared spells and the full spell list are distinguished', () => {
    const spells = m.rows.filter((r) => r.kind === 'spell');
    const cantrips = spells.filter((s) => s.level === 0).map((s) => s.value);
    expect(cantrips).toEqual(['Primal Savagery', 'Shillelagh']);
    const prepared = spells.filter((s) => s.level === 1 && s.prepared).map((s) => s.value).sort();
    expect(prepared).toEqual(['Entangle', 'Faerie Fire', 'Healing Word', 'Speak with Animals', 'Thunderwave']);
    // full list, duplicates collapsed, NOT marked prepared
    expect(spells.filter((s) => s.value === 'Animal Friendship')).toHaveLength(1);
    expect(spells.find((s) => s.value === 'Goodberry')?.prepared).toBe(false);
    expect(spells.filter((s) => s.level === 1).length).toBeGreaterThan(20);
    expect(find('spellcasting', 'Spellcasting ability')?.value).toBe('Wisdom');
    expect(find('spellcasting', 'Spell attack bonus')?.value).toBe('+6');
    expect(find('spellcasting', 'Spell save DC')?.value).toBe('14');
    expect(find('resource', 'Spell slots (level 1)')).toMatchObject({ value: '2', modifier: '2' });
  });

  it('features & traits from the printed block, background story from its field', () => {
    expect(find('feature', 'Lucky')?.value).toMatch(/^When you roll a 1 on an attack roll/);
    expect(find('feature', 'Brave')?.value).toMatch(/advantage on saving throws against being frightened/);
    expect(find('feature', 'Proficiencies & languages')?.value).toMatch(/Languages: Kor, Common, Druidic/);
    expect(find('feature', 'Druidic')?.status).toBe('uncertain');
    expect(find('note', 'Background story')?.value.length).toBeGreaterThan(100);
  });

  it('only few leftovers reach the Advanced section, unticked', () => {
    const raw = m.rows.filter((r) => r.kind === 'raw');
    expect(raw.length).toBeLessThan(10);
    expect(raw.every((r) => !r.include)).toBe(true);
  });

  it('builds a valid sheet and inventory list', () => {
    const { sheet, items, problems } = rowsToSheet(m.rows, { fileName: 'sinna.pdf', format: m.format });
    expect(problems).toEqual([]);
    expect(parseSheet(sheet).ok).toBe(true);
    expect(sheet.hitPoints).toEqual({ current: 9, max: 9, temp: 0 });
    expect(sheet.spells.filter((s) => s.prepared && s.level > 0)).toHaveLength(5);
    expect(sheet.saves.find((s) => s.name === 'Wisdom save')?.proficient).toBe(true);
    expect(items).toEqual([
      { name: 'Breastplate', quantity: 1 },
      { name: 'Shield', quantity: 1 },
      { name: 'Quarterstaff', quantity: 1 },
    ]);
    expect(sheet.raw).toEqual([]);
    const _r: ImportRow[] = m.rows; // type check
    expect(_r.length).toBeGreaterThan(50);
  });
});
