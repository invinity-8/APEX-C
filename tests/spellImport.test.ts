/**
 * "Import Spells": spell cards from the real Aurora sample (tests/fixtures/sinna.pdf, page 5),
 * review planning against an existing spellbook, and the server rule that only spells change.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { emptySheet, type CharacterSheet, type SheetSpell } from '../src/game/sheet';
import { importSpellList } from '../src/game/spellImport';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { SheetPayload } from '../src/server/protocol';
import { extractWithPdfjs, type PdfjsLike } from '../src/sheetImport/pdfCore';
import type { Extracted } from '../src/sheetImport/map';
import { applySpellImport, parseSpellCards, parseSpellSubtitle, planSpellImport, readSpellsFromPdf } from '../src/sheetImport/spellCards';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

let fillable: Extracted;
let printed: Extracted;
const CARDS = ['Primal Savagery', 'Shillelagh', 'Entangle', 'Faerie Fire', 'Healing Word', 'Speak with Animals', 'Thunderwave'];

beforeAll(async () => {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike;
  fillable = await extractWithPdfjs(pdfjs, new Uint8Array(readFileSync('tests/fixtures/sinna.pdf')));
  printed = await extractWithPdfjs(pdfjs, new Uint8Array(readFileSync('tests/fixtures/sinna-printed.pdf')));
}, 60_000);

const spell = (over: Partial<SheetSpell>): SheetSpell => ({ id: 'sp-x', name: '', level: 1, prepared: false, source: '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '', ...over });

describe('spell card subtitles', () => {
  it('reads level, school and ritual tag', () => {
    expect(parseSpellSubtitle('Transmutation Cantrip')).toEqual({ level: 0, school: 'Transmutation', ritual: false });
    expect(parseSpellSubtitle('1st-level conjuration')).toEqual({ level: 1, school: 'Conjuration', ritual: false });
    expect(parseSpellSubtitle('1st-level divination (ritual)')).toEqual({ level: 1, school: 'Divination', ritual: true });
    expect(parseSpellSubtitle('3rd-level evocation')?.level).toBe(3);
    expect(parseSpellSubtitle('Armor')).toBeNull();
  });
});

describe('spell cards in sinna.pdf (page 5)', () => {
  it('finds exactly the seven printed cards on page 5, and no item cards', () => {
    const cards = parseSpellCards(fillable);
    expect(cards.map((c) => c.name)).toEqual(CARDS);
    expect(cards.every((c) => c.origin === 'page 5 · spell card')).toBe(true);
    expect(cards.every((c) => c.uncertain.length === 0)).toBe(true);
  });

  it('reads every card field from the PDF', () => {
    const by = Object.fromEntries(parseSpellCards(fillable).map((c) => [c.name, c]));
    expect(by['Primal Savagery']).toMatchObject({ level: 0, prepared: true, school: 'Transmutation', castingTime: '1 action', range: 'Self', duration: 'Instantaneous', components: 'S', concentration: false, ritual: false, source: 'Druid', book: 'Xanathar’s Guide to Everything' });
    expect(by.Shillelagh).toMatchObject({ level: 0, castingTime: '1 bonus action', range: 'Touch', duration: '1 minute', components: 'V, S, M (mistletoe, a shamrock leaf, and a club or quarterstaff)' });
    expect(by.Entangle).toMatchObject({ level: 1, prepared: true, school: 'Conjuration', range: '90 feet', duration: 'Concentration, up to 1 minute', concentration: true, components: 'V, S' });
    expect(by['Faerie Fire']).toMatchObject({ level: 1, school: 'Evocation', range: '60 feet', components: 'V', concentration: true });
    expect(by['Healing Word']).toMatchObject({ castingTime: '1 bonus action', range: '60 feet', duration: 'Instantaneous', concentration: false });
    expect(by['Speak with Animals']).toMatchObject({ school: 'Divination', ritual: true, range: 'Self', duration: '10 minutes', components: 'V, S' });
    expect(by.Thunderwave).toMatchObject({ range: 'Self (15-foot cube)', duration: 'Instantaneous', components: 'V, S' });
  });

  it('keeps each description inside its own card and splits paragraphs at indents', () => {
    const by = Object.fromEntries(parseSpellCards(fillable).map((c) => [c.name, c]));
    expect(by['Primal Savagery'].description).toMatch(/^You channel primal magic to cause your teeth or fingernails to sharpen,/);
    expect(by['Primal Savagery'].description).toMatch(/\nThe spell’s damage increases by 1d10 when you reach 5th level \(2d10\), 11th level \(3d10\), and 17th level \(4d10\)\.$/);
    expect(by.Entangle.description.split('\n')).toHaveLength(3);
    expect(by.Entangle.description).toMatch(/When the spell ends, the conjured plants wilt away\.$/);
    expect(by['Healing Word'].description).toMatch(/\nAt Higher Levels\. When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d4 for each slot level above 1st\.$/);
    expect(by.Thunderwave.description).toMatch(/^A wave of thunderous force sweeps out from you\./);
    // Neighbouring cards never bleed into each other and footers are not part of the text.
    for (const c of Object.values(by)) {
      expect(c.description).not.toMatch(/Player’s Handbook|Prepared \(Druid\)|Spellcasting \(Druid\)|CASTING TIME/);
    }
    expect(by.Shillelagh.description).not.toMatch(/Grasping weeds/);
  });

  it('reads the flattened (printed) copy of the same sheet identically', () => {
    const a = parseSpellCards(fillable);
    const b = parseSpellCards(printed);
    expect(b.map(({ name, level, school, castingTime, range, components, duration, description }) => ({ name, level, school, castingTime, range, components, duration, description }))).toEqual(
      a.map(({ name, level, school, castingTime, range, components, duration, description }) => ({ name, level, school, castingTime, range, components, duration, description })),
    );
  });

  it('combines cards with the spell list; list-only spells are marked and never get invented text', () => {
    const r = readSpellsFromPdf(fillable);
    expect(r.spells.slice(0, 7).map((s) => s.name)).toEqual(CARDS);
    const listOnly = r.spells.slice(7);
    expect(listOnly.length).toBeGreaterThan(0);
    for (const s of listOnly) {
      expect(s.description).toBe('');
      expect(s.castingTime).toBe('');
      expect(s.uncertain).toEqual(expect.arrayContaining(['description', 'castingTime', 'range']));
      expect(s.origin).toMatch(/^spell list/);
    }
  });
});

describe('review plan against an existing spellbook', () => {
  it('fills empty fields, never removes spells, keeps ids and notes', () => {
    const existing = [
      spell({ id: 'sp-ent', name: 'Entangle', prepared: true, source: 'Druid', notes: 'my note' }),
      spell({ id: 'sp-house', name: 'Moonbeam of Doom', level: 2, description: 'House rule spell.' }),
    ];
    const incoming = readSpellsFromPdf(fillable).spells;
    const plan = planSpellImport(existing, incoming);
    const ent = plan.find((r) => r.existingId === 'sp-ent')!;
    expect(ent.status).toBe('update');
    expect(ent.changes.every((c) => !c.conflict && c.apply)).toBe(true);
    // New spells from cards are selected, list-only spells are opt-in.
    expect(plan.filter((r) => r.status === 'new' && r.include).map((r) => r.incoming.name)).toEqual(CARDS.filter((n) => n !== 'Entangle'));
    const next = applySpellImport(existing, plan, (() => { let i = 0; return () => `sp-new${i++}`; })());
    expect(next.find((s) => s.id === 'sp-house')).toEqual(existing[1]);
    expect(next.find((s) => s.id === 'sp-ent')).toMatchObject({ notes: 'my note', school: 'Conjuration', range: '90 feet', concentration: true });
    expect(next).toHaveLength(2 + 6);
  });

  it('does not overwrite an edited description or house rule unless the change is ticked', () => {
    const existing = [spell({ id: 'sp-fw', name: 'Faerie Fire', description: 'House rule: outline lasts 2 rounds.', range: '60 feet' })];
    const plan = planSpellImport(existing, readSpellsFromPdf(fillable).spells);
    const row = plan.find((r) => r.existingId === 'sp-fw')!;
    const desc = row.changes.find((c) => c.field === 'description')!;
    expect(desc).toMatchObject({ conflict: true, apply: false, current: 'House rule: outline lasts 2 rounds.' });
    expect(row.changes.some((c) => c.field === 'range')).toBe(false); // identical
    expect(applySpellImport(existing, plan).find((s) => s.id === 'sp-fw')!.description).toBe('House rule: outline lasts 2 rounds.');
    const ticked = plan.map((r) => (r === row ? { ...r, include: true, changes: r.changes.map((c) => ({ ...c, apply: true })) } : r));
    expect(applySpellImport(existing, ticked).find((s) => s.id === 'sp-fw')!.description).toMatch(/^Each object in a 20-foot cube/);
  });

  it('uncertain empty values never clear stored data', () => {
    const existing = [spell({ id: 'sp-a', name: 'Cure Wounds', castingTime: '1 action', description: 'Typed by hand.' })];
    const row = planSpellImport(existing, readSpellsFromPdf(fillable).spells).find((r) => r.existingId === 'sp-a')!;
    expect(row.changes.map((c) => c.field)).not.toContain('description');
    expect(row.changes.map((c) => c.field)).not.toContain('castingTime');
  });
});

describe('server rule: Import Spells changes only the spell list', () => {
  const base: CharacterSheet = {
    ...emptySheet(),
    hitPoints: { current: 7, max: 9, temp: 0 },
    attributes: [{ id: 'wis', name: 'Wisdom', value: '18', modifier: '+4' }],
    notes: 'Edited notes',
    spells: [spell({ id: 'sp-keep', name: 'Shillelagh', level: 0, prepared: true })],
  };

  it('keeps every other part of the sheet and refuses to remove spells', () => {
    const r = importSpellList(base, [...base.spells, spell({ id: 'sp-new', name: 'Entangle' })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect({ ...r.sheet, spells: base.spells }).toEqual(base);
    expect(r.added).toBe(1);
    expect(importSpellList(base, [])).toEqual({ ok: false, error: 'A spell import cannot remove existing spells.' });
    expect(importSpellList(base, 'x').ok).toBe(false);
  });

  describe('API', () => {
    const CID = 'c-main';
    let repo: MemoryRepo;
    const call = (method: string, op: string, body: unknown, cookie?: string, query: Record<string, string> = {}) =>
      handleApi({ method, op, query, body, ip: '203.0.113.5', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1', origin: 'https://apex.test' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
    const login = async (p: string, pw: string) => (await call('POST', 'login', { profile: p, password: pw })).cookies![0].split(';')[0];
    let hannah: string, jean: string;
    beforeEach(async () => {
      resetSchemaCache();
      repo = new MemoryRepo();
      repo.campaigns.push({ id: CID, slug: 'main', name: 'T' });
      seedProfiles(repo, CID);
      repo.states.set(CID, { state: createDemoState({ radius: 8, seed: 2 }), version: 1 });
      await activate(repo, CID, 'hannah', 'hannah-pass-1');
      await activate(repo, CID, 'jean', 'jean-pass-12');
      hannah = await login('hannah', 'hannah-pass-1');
      jean = await login('jean', 'jean-pass-12');
      await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: base, expectedVersion: 0 }, hannah);
    });

    it('saves the imported spells version-checked, with a backup, without touching other data', async () => {
      const spells = applySpellImport(base.spells, planSpellImport(base.spells, readSpellsFromPdf(fillable).spells));
      expect((await call('POST', 'sheet', { action: 'importSpells', tokenId: 'sinna', spells, expectedVersion: 1 }, jean)).status).toBe(403);
      const r = await call('POST', 'sheet', { action: 'importSpells', tokenId: 'sinna', spells, expectedVersion: 1 }, hannah);
      expect(r.status).toBe(200);
      const saved = (r.body as SheetPayload).sheet;
      expect(saved.spells.map((s) => s.name)).toEqual(['Shillelagh', ...CARDS.filter((n) => n !== 'Shillelagh')]);
      expect(saved.spells[0]).toMatchObject({ id: 'sp-keep', castingTime: '1 bonus action', range: 'Touch' });
      expect({ ...saved, spells: base.spells, spellEffects: [] }).toEqual({ ...base, spellEffects: [] });
      expect((r.body as SheetPayload).message).toBe('6 spells added, 1 updated.');
      // A second click with the old version is refused – no duplicate import.
      expect((await call('POST', 'sheet', { action: 'importSpells', tokenId: 'sinna', spells, expectedVersion: 1 }, hannah)).status).toBe(409);
      // Removing spells through the import is refused.
      expect((await call('POST', 'sheet', { action: 'importSpells', tokenId: 'sinna', spells: spells.slice(1), expectedVersion: 2 }, hannah)).status).toBe(400);
    });
  });
});
