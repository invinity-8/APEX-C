import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import { emptySheet } from '../src/game/sheet';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;
const call = (method: string, op: string, body: unknown = null, cookie?: string) =>
  handleApi({ method, op, query: {}, body, ip: '203.0.113.41', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX' });
  seedProfiles(repo, CID);
  repo.states.set(CID, { state: createDemoState({ radius: 8, seed: 2 }), version: 1 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  repo.sheets.set(`${CID}:sinna`, { data: { ...emptySheet(), hitPoints: { current: 7, max: 9, temp: 2 } }, version: 1, updatedAt: '2026-11-02T00:00:00Z', updatedBy: null });
  repo.sheets.set(`${CID}:aster`, { data: { ...emptySheet(), hitPoints: { current: 20, max: 24, temp: 0 } }, version: 1, updatedAt: '2026-11-02T00:00:00Z', updatedBy: null });
});

describe('Party Health (GET op=party)', () => {
  it('GM sees every player character’s HP; a player only their own; anonymous is refused', async () => {
    const gm = (await call('POST', 'login', { profile: 'gm', password: 'gm-secret-pass' })).cookies![0].split(';')[0];
    const pl = (await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' })).cookies![0].split(';')[0];
    const g = (await call('GET', 'party', null, gm)).body as { members: Array<{ tokenId: string; hp: unknown }> };
    expect(g.members.find((m) => m.tokenId === 'sinna')?.hp).toEqual({ current: 7, max: 9, temp: 2 });
    expect(g.members.find((m) => m.tokenId === 'aster')?.hp).toEqual({ current: 20, max: 24, temp: 0 });
    expect(g.members.some((m) => m.hp === null)).toBe(true); // characters without a sheet
    const p = (await call('GET', 'party', null, pl)).body as { members: Array<{ tokenId: string }> };
    expect(p.members.map((m) => m.tokenId)).toEqual(['sinna']);
    expect((await call('GET', 'party')).status).toBe(401);
  });
});
