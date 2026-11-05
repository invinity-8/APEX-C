import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { emptySheet } from '../src/game/sheet';
import type { GameState } from '../src/game/types';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;
const call = (method: string, op: string, body: unknown, cookie?: string) =>
  handleApi({ method, op, query: {}, body, ip: '203.0.113.9', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1', origin: 'https://apex.test' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
const login = async (p: string, pw: string) => (await call('POST', 'login', { profile: p, password: pw })).cookies![0].split(';')[0];
const cmd = (command: unknown, cookie: string) => call('POST', 'command', { campaignId: CID, command }, cookie);
const stored = () => repo.states.get(CID)!.state as GameState;
const sheetWith = (label: string, value: string) => ({ data: { ...emptySheet(), details: [{ id: 'd', label, value }] }, version: 1, updatedAt: '2026-11-05T00:00:00Z', updatedBy: null });
let gm: string, hannah: string, jean: string;

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'T' });
  seedProfiles(repo, CID);
  const s = createDemoState({ radius: 8, seed: 2 });
  for (const t of Object.values(s.tokens)) t.inventory = [];
  repo.states.set(CID, { state: s, version: 1 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  await activate(repo, CID, 'jean', 'jean-pass-12');
  gm = await login('gm', 'gm-secret-pass');
  hannah = await login('hannah', 'hannah-pass-1');
  jean = await login('jean', 'jean-pass-12');
});

describe('loot drafts default to the party median level', () => {
  it('reads the levels from the stored sheets; an explicit GM level wins', async () => {
    repo.sheets.set(`${CID}:sinna`, sheetWith('Level', '9'));
    repo.sheets.set(`${CID}:aster`, sheetWith('Class & Level', 'Fighter 3 / Rogue 2'));
    repo.sheets.set(`${CID}:elwin`, sheetWith('Level', '4'));
    expect((await cmd({ type: 'lootDraftCreate', draftId: 'd1', encounter: 'minion', categories: ['weapon'] }, gm)).status).toBe(200);
    expect(stored().arsenal!.draft!.referenceLevel).toBe(5); // levels 9, 5, 4 → median 5
    // the client cannot smuggle a party level in
    await cmd({ type: 'lootDraftDiscard' }, gm);
    expect((await cmd({ type: 'lootDraftCreate', draftId: 'd2', encounter: 'minion', categories: ['weapon'], partyLevel: 20 }, gm)).status).toBe(200);
    expect(stored().arsenal!.draft!.referenceLevel).toBe(5);
    await cmd({ type: 'lootDraftDiscard' }, gm);
    await cmd({ type: 'lootDraftCreate', draftId: 'd3', encounter: 'minion', categories: ['weapon'], referenceLevel: 12 }, gm);
    expect(stored().arsenal!.draft!.referenceLevel).toBe(12);
  });
  it('without sheets the median is level 1', async () => {
    await cmd({ type: 'lootDraftCreate', draftId: 'd1', encounter: 'boss', categories: ['weapon'] }, gm);
    expect(stored().arsenal!.draft!.referenceLevel).toBe(1);
  });
});

describe('party loot rolls through the API', () => {
  beforeEach(async () => {
    await cmd({ type: 'arsenalGenerate', stagedId: 'sw', baseId: 'srd-longsword', rarity: 'magic', itemLevel: 5, identified: true }, gm);
  });
  it('permissions, server-side time and dice, single resolution under concurrent requests', async () => {
    expect((await cmd({ type: 'lootRollStart', rollId: 'r', stagedIds: ['sw'], tokenIds: ['sinna', 'aster'], minutes: 5 }, hannah)).status).toBe(403);
    expect((await cmd({ type: 'lootRollStart', rollId: 'r', stagedIds: ['sw'], tokenIds: ['sinna', 'aster'], minutes: 5, now: 0 }, gm)).status).toBe(200);
    const roll = stored().lootRolls![0];
    expect(Date.parse(roll.deadline) - Date.parse(roll.createdAt)).toBe(300_000);
    expect(Math.abs(Date.parse(roll.createdAt) - Date.now())).toBeLessThan(5000); // server clock, not the client's `now: 0`
    // a player can only choose for their own character
    expect((await cmd({ type: 'lootRollChoose', rollId: 'r-1', tokenId: 'sinna', choice: 'need' }, jean)).status).toBe(403);
    expect((await cmd({ type: 'lootRollChoose', rollId: 'r-1', tokenId: 'sinna', choice: 'need', seed: 1 }, hannah)).status).toBe(200);
    // the player view hides Sinna's choice from Jean until resolution
    const jeanView = (await call('GET', 'state', null, jean)).body as { view: { lootRolls: Array<{ choices: Record<string, string>; decided: string[] }> } };
    expect(jeanView.view.lootRolls[0].choices).toEqual({});
    expect(jeanView.view.lootRolls[0].decided).toEqual(['sinna']);
    // Jean's last choice and the GM's "resolve now" race: exactly one resolution, the item exists exactly once
    const [a, b] = await Promise.all([cmd({ type: 'lootRollChoose', rollId: 'r-1', tokenId: 'aster', choice: 'need' }, jean), cmd({ type: 'lootRollResolve', rollId: 'r-1' }, gm)]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const s = stored();
    expect(s.lootRolls![0].status).toBe('won');
    const holders = Object.values(s.tokens).filter((t) => t.inventory.some((i) => i.id === 'sw'));
    expect(holders.map((t) => t.id)).toEqual([s.lootRolls![0].winner]);
    expect(s.arsenal!.staged.some((i) => i.id === 'sw')).toBe(false);
    expect(s.log.some((e) => e.audience === 'all' && /Loot roll – .* wins/.test(e.text))).toBe(true);
  });
});
