import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { PlayerPayload } from '../src/server/protocol';
import { autoLook, DEFAULT_LOOK, FIGURE_PARTS, FIGURE_PRESETS, lookFromPreset, parseLook, randomLook } from '../src/game/figure';
import { parseStatBlock, BUILTIN_BESTIARY } from '../src/game/bestiary';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

describe('APEX 2.1 – low-poly figure kit (data)', () => {
  it('the kit is full: well over 200 parts, every preset only uses catalogue parts', () => {
    expect(Object.values(FIGURE_PARTS).reduce((n, l) => n + l.length, 0)).toBeGreaterThan(200);
    expect(FIGURE_PRESETS.length).toBeGreaterThanOrEqual(35);
    for (const p of FIGURE_PRESETS) for (let s = 1; s < 6; s++) expect(parseLook(lookFromPreset(p, s)), p.id).not.toBeNull();
    for (let s = 1; s < 40; s++) expect(parseLook(randomLook(s))).not.toBeNull();
  });
  it('parseLook accepts a full look, fills missing parts with defaults and rejects unknown parts and bad colours', () => {
    expect(parseLook({ ...DEFAULT_LOOK, hair: 'mohawk', primary: '#AABBCC' })).toMatchObject({ hair: 'mohawk', primary: '#aabbcc' });
    expect(parseLook({ hair: 'braids' })).toMatchObject({ hair: 'braids', body: 'human' });
    expect(parseLook({ ...DEFAULT_LOOK, hair: 'laser' })).toBeNull();
    expect(parseLook({ ...DEFAULT_LOOK, skin: 'red' })).toBeNull();
    expect(parseLook({ ...DEFAULT_LOOK, tail: 'yes' })).toBeNull();
    expect(parseLook('bandit')).toBeNull();
    // unknown keys never reach the state
    expect(parseLook({ ...DEFAULT_LOOK, script: '<x>' } as never)).not.toHaveProperty('script');
  });
  it('automatic looks: bandits get the bandit preset, varied per figure but stable per id; beasts get none', () => {
    const a = autoLook('Bandit humanoid', 'npc-1')!, b = autoLook('Bandit humanoid', 'npc-2')!;
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(autoLook('Bandit humanoid', 'npc-1')).toEqual(a);
    expect(['bandana', 'hood', 'none', 'cap', 'mask']).toContain(a.hat);
    expect(autoLook('Cultist humanoid', 'x')!.torso).toBe('cultrobe');
    expect(autoLook('Orc humanoid', 'x')!.body).toBe('orc');
    expect(autoLook('Skeleton undead', 'x')!.body).toBe('skeleton');
    expect(autoLook('Wolf beast', 'x')).toBeNull();
  });
  it('a custom stat block keeps a valid look and drops an invalid one', () => {
    const base = { ...BUILTIN_BESTIARY.find((x) => x.id === 'bandit')!, id: 'river-bandit' };
    const ok = parseStatBlock({ ...base, look: { ...DEFAULT_LOOK, hat: 'tricorn' } });
    expect(ok.ok && ok.block.look?.hat).toBe('tricorn');
    const bad = parseStatBlock({ ...base, look: { hat: 'jetpack' } });
    expect(bad.ok && bad.block.look).toBeUndefined();
  });
});

const CID = 'c-main';
let repo: MemoryRepo;
let gm: string, hannah: string, jean: string;
const call = (method: string, op: string, body: unknown = null, query: Record<string, string> = {}, cookie?: string) =>
  handleApi({ method, op, query, body, ip: '203.0.113.31', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
const login = async (p: string, pw: string) => (await call('POST', 'login', { profile: p, password: pw })).cookies![0].split(';')[0];

describe('APEX 2.1 – the hero figure is saved on the character', () => {
  beforeEach(async () => {
    resetSchemaCache();
    repo = new MemoryRepo();
    repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX' });
    seedProfiles(repo, CID);
    repo.states.set(CID, { state: createDemoState({ radius: 8, seed: 2 }), version: 1 });
    await activate(repo, CID, 'gm', 'gm-secret-pass');
    await activate(repo, CID, 'hannah', 'hannah-pass-1');
    await activate(repo, CID, 'jean', 'jean-pass-12');
    gm = await login('gm', 'gm-secret-pass');
    hannah = await login('hannah', 'hannah-pass-1');
    jean = await login('jean', 'jean-pass-12');
  });
  it('a player saves the own figure, it is public in the views, can be removed; others cannot change it', async () => {
    const look = { ...DEFAULT_LOOK, body: 'dwarf', beard: 'braided', main: 'warhammer' };
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', figure: look } }, {}, hannah)).status).toBe(200);
    expect(repo.states.get(CID)!.state.tokens.sinna.figure).toMatchObject({ body: 'dwarf', beard: 'braided' });
    const own = (await call('GET', 'state', null, {}, hannah)).body as PlayerPayload;
    expect(own.view?.tokens.find((t) => t.id === 'sinna')?.figure?.main).toBe('warhammer');
    // not someone else's character, not an invalid part
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', figure: look } }, {}, jean)).status).toBe(403);
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', figure: { ...look, hat: 'jetpack' } } }, {}, hannah)).status).toBe(400);
    // the GM can change it, null removes it
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', figure: null } }, {}, gm)).status).toBe(200);
    expect(repo.states.get(CID)!.state.tokens.sinna.figure).toBeUndefined();
  });
});
