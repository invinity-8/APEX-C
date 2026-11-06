import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { applyLevelUp, buildSnapshot, diffSheets, restoreSheetParts, sheetLevel } from '../src/game/progression';
import { emptySheet, mergeSheets, parseSheet, type CharacterSheet } from '../src/game/sheet';
import { carryCharacters, reconcileRestore } from '../src/game/world';
import { buildPlayerView } from '../src/game/visibility';
import { applyIdentity, suggestTagline } from '../src/components/IdentityEditor';
import { toCsv } from '../src/components/Feedback';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { FeedbackRow } from '../src/server/repo';
import type { SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const lvl1: CharacterSheet = {
  ...emptySheet(),
  hitPoints: { current: 5, max: 9, temp: 0 },
  details: [
    { id: 'd1', label: 'Race, class & level', value: 'Kor Druid 1' },
    { id: 'd2', label: 'Background', value: 'Sage' },
  ],
  attributes: [{ id: 'a1', name: 'Strength', value: '11', modifier: '+0' }],
  resources: [{ id: 'r1', name: '1st-level slots', current: 1, max: 2 }],
  abilities: [{ id: 'f1', name: 'Druidic', text: 'You know Druidic.' }],
};
const pdf2: CharacterSheet = {
  ...emptySheet(),
  hitPoints: { current: 16, max: 16, temp: 0 },
  details: [{ id: 'x1', label: 'Race, class & level', value: 'Kor Druid 2' }],
  attributes: [{ id: 'x2', name: 'Strength', value: '12', modifier: '+1' }],
  resources: [{ id: 'x3', name: '1st-level slots', current: 3, max: 3 }],
  abilities: [{ id: 'x4', name: 'Wild Shape', text: 'Turn into a beast.' }],
};

describe('progression', () => {
  it('detects levels and lists readable changes', () => {
    expect(sheetLevel(lvl1)).toBe(1);
    expect(sheetLevel({ details: [{ id: 'a', label: 'Race, class & level', value: 'Human Fighter 3 / Wizard 2' }] })).toBe(5);
    const d = diffSheets(lvl1, mergeSheets(lvl1, pdf2));
    const line = (l: string) => d.find((c) => c.label === l);
    expect(line('Level')).toMatchObject({ before: '1', after: '2' });
    expect(line('Strength')).toMatchObject({ before: '11 (+0)', after: '12 (+1)' });
    expect(line('Maximum HP')).toMatchObject({ before: '9', after: '16' });
    expect(line('Feature: Wild Shape')).toMatchObject({ before: null });
    expect(line('Background')).toBeUndefined(); // untouched manual data is not a change
  });

  it('a level-up applies only approved values and never refills consumables without consent', () => {
    const next = applyLevelUp(lvl1, pdf2, { refillCurrent: false, mergeSheets });
    expect(next.hitPoints).toEqual({ max: 16, current: 5, temp: 0 });
    expect(next.resources[0]).toMatchObject({ current: 1, max: 3 });
    expect(next.details.find((d) => d.label === 'Background')?.value).toBe('Sage'); // manual edit preserved
    expect(next.abilities.map((a) => a.name)).toEqual(['Druidic', 'Wild Shape']);
    expect(applyLevelUp(lvl1, pdf2, { refillCurrent: true, mergeSheets }).hitPoints!.current).toBe(16);
  });

  it('restores selected sheet parts only, never raising current HP', () => {
    const now: CharacterSheet = { ...mergeSheets(lvl1, pdf2), hitPoints: { current: 3, max: 16, temp: 2 } };
    const r = restoreSheetParts(now, lvl1, ['attributes', 'combat']);
    expect(r.attributes[0].value).toBe('11');
    expect(r.hitPoints).toEqual({ max: 9, current: 3, temp: 2 });
    expect(r.abilities.length).toBe(2); // features not restored
  });

  it('progression history survives validation and imports', () => {
    const s = { ...lvl1, progression: [{ id: 'lvl-1', at: '2026-11-04T10:00:00Z', fromLevel: 1, toLevel: 2, fileName: 'sinna.pdf', changed: ['Strength'], approved: ['Strength'], note: '' }] };
    const p = parseSheet(s);
    expect(p.ok && p.sheet.progression?.[0].toLevel).toBe(2);
    expect(mergeSheets(s, pdf2).progression).toHaveLength(1);
    expect(parseSheet({ ...s, progression: [{ id: 'bad id!' }] }).ok).toBe(false);
  });

  it('identity fields and tagline suggestions', () => {
    expect(suggestTagline(lvl1)).toBe('Kor Druid');
    expect(suggestTagline({ details: [{ id: 'a', label: 'Race, class & level', value: 'Level 1 Kor Druid' }] })).toBe('Kor Druid');
    const s = applyIdentity(lvl1, { species: 'Kor', subclass: 'Circle of the Land', background: '' });
    expect(s.details.find((d) => d.label === 'Species')?.value).toBe('Kor');
    expect(s.details.find((d) => d.label === 'Subclass')?.value).toBe('Circle of the Land');
    expect(s.details.find((d) => d.label === 'Background')).toBeUndefined();
  });
});

describe('character tokens', () => {
  it('a manually set tagline is marked custom; players may rename their own character only', () => {
    let s = createDemoState({ radius: 6, seed: 2 });
    const r = executeCommand(s, { role: 'player', tokenId: 'sinna' }, { type: 'setAppearance', tokenId: 'sinna', name: 'Sinna Vael', title: 'Will-Weaver of the North' });
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.tokens.sinna).toMatchObject({ name: 'Sinna Vael', title: 'Will-Weaver of the North', titleCustom: true });
    expect(buildPlayerView(s, 'sinna').tokens.find((t) => t.id === 'sinna')?.titleCustom).toBe(true);
    expect(executeCommand(s, { role: 'player', tokenId: 'aster' }, { type: 'setAppearance', tokenId: 'sinna', title: 'x' }).ok).toBe(false);
  });

  it('a new world keeps equipment, currency, cosmetics and the custom tagline; restoring never brings archived items back', () => {
    const prev = createDemoState({ radius: 6, seed: 2 });
    Object.assign(prev.tokens.sinna, { titleCustom: true, accent: '#123456', currency: { orb: 3 }, currencyRev: 4, equipment: { slots: { main1: 'x' }, activeSet: 1, resting: false, restingKeep: [] } });
    const next = carryCharacters(prev, createDemoState({ radius: 6, seed: 9 }));
    expect(next.tokens.sinna).toMatchObject({ titleCustom: true, accent: '#123456', currency: { orb: 3 }, currencyRev: 4 });
    expect(next.tokens.sinna.equipment?.slots.main1).toBe('x');
    const archived = structuredClone(prev);
    archived.tokens.sinna.currency = { orb: 99 };
    const now = structuredClone(prev);
    now.tokens.sinna.currency = { orb: 1 };
    expect(reconcileRestore(now, archived, 'keep-current').tokens.sinna.currency).toEqual({ orb: 1 });
  });

  it('gmRestoreCharacter is GM-only and drops slots of items no longer owned', () => {
    const s = createDemoState({ radius: 6, seed: 2 });
    s.tokens.sinna.inventory = [{ id: 'own', name: 'Sword', kind: 'weapon', description: '', quantity: 1, equip: { kind: 'weapon', damage: '1d8', versatileDamage: '1d10', properties: ['versatile'] } }];
    const cmd = { type: 'gmRestoreCharacter' as const, tokenId: 'sinna', equipment: { slots: { main1: 'own', ring1: 'sold-ring' }, twoHandedGrips: ['own', 'sold-weapon'], activeSet: 1 as const, resting: false, restingKeep: [] } };
    expect(executeCommand(s, { role: 'player', tokenId: 'sinna' }, cmd).ok).toBe(false);
    const r = executeCommand(s, { role: 'gm' }, cmd);
    expect(r.ok && r.state.tokens.sinna.equipment?.slots).toEqual({ main1: 'own' });
    expect(r.ok && r.state.tokens.sinna.equipment?.twoHandedGrips).toEqual(['own']);
    expect(r.ok && r.state.tokens.sinna.inventory).toHaveLength(1);
  });

  it('snapshots record (but cannot restore) inventory and currency', () => {
    const s = createDemoState({ radius: 6, seed: 2 });
    s.tokens.sinna.currency = { seal: 2 };
    const snap = buildSnapshot(lvl1, s.tokens.sinna, 'Level 1 – Campaign Start', '');
    expect(snap.character.currency).toEqual({ seal: 2 });
    expect(snap.level).toBe('Kor Druid 1');
  });
});

describe('feedback CSV', () => {
  it('quotes and neutralises formulas', () => {
    const row = { createdAt: 'x', kind: 'bug', category: 'c', status: 'new', title: '=HYPERLINK("evil")', description: 'a "b"', steps: '', page: '', appVersion: '', profileKey: 'hannah', tokenId: null, gmNotes: '', shared: false, statusChangedAt: null } as unknown as FeedbackRow;
    const csv = toCsv([row]);
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(csv).toContain('"a ""b"""');
  });
});

// ---------------------------------------------------------------- API
describe('API: character archive & feedback', () => {
  const CID = 'c-main';
  let repo: MemoryRepo;
  const call = (method: string, op: string, body: unknown, cookie?: string, query: Record<string, string> = {}) =>
    handleApi({ method, op, query, body, ip: '203.0.113.8', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1', origin: 'https://apex.test' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
  const login = async (profile: string, password: string) => (await call('POST', 'login', { profile, password })).cookies![0].split(';')[0];
  let gm: string, hannah: string, jean: string;
  beforeEach(async () => {
    resetSchemaCache();
    repo = new MemoryRepo();
    repo.campaigns.push({ id: CID, slug: 'main', name: 'Test' });
    seedProfiles(repo, CID);
    const st = createDemoState({ radius: 8, seed: 5 });
    st.tokens.sinna.currency = { orb: 2 };
    repo.states.set(CID, { state: st, version: 1 });
    await activate(repo, CID, 'gm', 'gm-secret-pass');
    await activate(repo, CID, 'hannah', 'hannah-pass-1');
    await activate(repo, CID, 'jean', 'jean-pass-12');
    gm = await login('gm', 'gm-secret-pass');
    hannah = await login('hannah', 'hannah-pass-1');
    jean = await login('jean', 'jean-pass-12');
    await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: lvl1, expectedVersion: 0 }, hannah);
  });

  it('level-up import snapshots first; the GM lists, compares and restores selected parts', async () => {
    const r = await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: applyLevelUp(lvl1, pdf2, { refillCurrent: false, mergeSheets }), expectedVersion: 1, reason: 'import-levelup' }, hannah);
    expect(r.status).toBe(200);
    expect((await call('POST', 'character-archive', { action: 'list', tokenId: 'sinna' }, hannah)).status).toBe(403);
    const list = (await call('POST', 'character-archive', { action: 'list', tokenId: 'sinna' }, gm)).body as { snapshots: Array<{ id: number; name: string; kind: string }> };
    expect(list.snapshots[0]).toMatchObject({ kind: 'snapshot', name: 'Before level-up 1 → 2' });
    const got = (await call('POST', 'character-archive', { action: 'get', id: list.snapshots[0].id }, gm)).body as { snapshot: { sheet: CharacterSheet } };
    expect(got.snapshot.sheet.attributes[0].value).toBe('11');
    const res = await call('POST', 'character-archive', { action: 'restore', tokenId: 'sinna', id: list.snapshots[0].id, parts: ['attributes'], expectedVersion: 2 }, gm);
    expect(res.status).toBe(200);
    const sheet = ((await call('GET', 'sheet', null, hannah, { token: 'sinna' })).body as SheetPayload).sheet;
    expect(sheet.attributes[0].value).toBe('11'); // restored
    expect(sheet.hitPoints!.max).toBe(16); // not restored
    // restoring never touches the game state (items / currency)
    expect(repo.states.get(CID)!.state.tokens.sinna.currency).toEqual({ orb: 2 });
    // the state before the restore was snapshotted
    const after = (await call('POST', 'character-archive', { action: 'list', tokenId: 'sinna' }, gm)).body as { snapshots: Array<{ name: string }> };
    expect(after.snapshots[0].name).toMatch(/^Before restore/);
    // stale version → conflict
    expect((await call('POST', 'character-archive', { action: 'restore', tokenId: 'sinna', id: list.snapshots[0].id, parts: ['attributes'], expectedVersion: 2 }, gm)).status).toBe(409);
  });

  it('feedback: submit, privacy, GM workflow, validation and rate limit', async () => {
    const sent = await call('POST', 'feedback', { action: 'submit', kind: 'bug', title: 'Map freezes', description: 'details', steps: '1. zoom', page: 'Map', appVersion: '0.7.0', category: 'Map & movement' }, hannah);
    expect(sent.status).toBe(200);
    const id = (sent.body as { feedback: FeedbackRow }).feedback.id;
    expect((await call('POST', 'feedback', { action: 'submit', kind: 'praise', title: 'x' }, hannah)).status).toBe(400);
    expect((await call('POST', 'feedback', { action: 'submit', kind: 'bug', title: 'x', screenshot: 'data:image/png;base64,SGVsbG8=' }, hannah)).status).toBe(415);
    // other players see nothing, the GM sees it
    expect(((await call('GET', 'feedback', null, jean)).body as { feedback: FeedbackRow[] }).feedback).toHaveLength(0);
    expect(((await call('GET', 'feedback', null, gm)).body as { feedback: FeedbackRow[] }).feedback[0].title).toBe('Map freezes');
    expect((await call('POST', 'feedback', { action: 'update', id, status: 'resolved' }, hannah)).status).toBe(403);
    const upd = await call('POST', 'feedback', { action: 'update', id, status: 'acknowledged', gmNotes: 'repro on iPad', shared: true }, gm);
    expect((upd.body as { feedback: FeedbackRow }).feedback).toMatchObject({ status: 'acknowledged', shared: true });
    const mine = ((await call('GET', 'feedback', null, hannah)).body as { feedback: FeedbackRow[] }).feedback[0];
    expect(mine.status).toBe('acknowledged');
    expect(mine.gmNotes).toBe(''); // GM notes stay private
    const shared = ((await call('GET', 'feedback', null, jean)).body as { feedback: FeedbackRow[] }).feedback[0];
    expect(shared.title).toBe('Map freezes');
    expect(shared.profileKey).toBe(''); // the reporter is not revealed
    for (let i = 0; i < 9; i++) await call('POST', 'feedback', { action: 'submit', kind: 'feature', title: `idea ${i}` }, hannah);
    expect((await call('POST', 'feedback', { action: 'submit', kind: 'feature', title: 'one too many' }, hannah)).status).toBe(429);
  });
});
