/** APEX 2.12 – downtime: camp on the road, hideouts at home, the chest; the Obelisk opens in downtime. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { decodeTiles } from '../src/campaign/hexScene';
import { parseMap, type SceneMap } from '../src/campaign/maps';
import { campPresetFor, stashPut, stashTake, stashUnworn } from '../src/game/downtime';
import type { Item, Token } from '../src/game/types';
import { handleApi, resetSchemaCache } from '../src/server/api';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const item = (id: string): Item => ({ id, name: id, kind: 'misc', description: '', quantity: 1, rev: 0 });

describe('APEX 2.12 – downtime rules', () => {
  it('a camp looks like the land it is made in', () => {
    expect(campPresetFor([...Array(40).fill('sand'), ...Array(10).fill('grass')])).toBe('desert');
    expect(campPresetFor([...Array(30).fill('snow'), ...Array(30).fill('grass')])).toBe('winter');
    expect(campPresetFor([...Array(25).fill('tree'), ...Array(40).fill('grass')])).toBe('forest');
    expect(campPresetFor(Array(50).fill('grass'))).toBe('forest');
  });
  it('the chest: put in (taking it off if worn), take out, store everything not worn', () => {
    const t = { id: 't', name: 'T', inventory: [item('a'), item('b'), item('c')], equipment: { slots: { main1: 'a' }, activeSet: 1, resting: false, restingKeep: [] } } as unknown as Token;
    expect(stashPut(t, 'a')).toBeNull();
    expect(t.equipment?.slots.main1).toBeUndefined();
    expect(t.stash?.map((i) => i.id)).toEqual(['a']);
    expect(stashTake(t, 'a')).toBeNull();
    t.equipment = { ...t.equipment!, slots: { main1: 'a' } };
    expect(stashUnworn(t, new Set(['a']))).toBe(2);
    expect(t.inventory.map((i) => i.id)).toEqual(['a']);
    expect(stashTake(t, 'nope')).toBeTruthy();
  });
});

describe('APEX 2.12 – downtime through the API', () => {
  const cid = 'campaign-downtime';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.22', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const st = () => repo.states.get(cid)!.state;
  const dt = (who: string, body: Record<string, unknown>) => request(who, 'downtime', body);
  const where = async (key: string) => (await repo.sceneRuntime.assignment(cid, user(key).userId))?.scene_id ?? null;
  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah', 'jean']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
    st().tokens[user('hannah').tokenIds[0]].inventory = [item('d-sword'), item('d-rope')];
  });

  it('on the road: one camp for everybody (campfire, tents, chest), the chest opens, then back where they were', async () => {
    const before = await where('hannah');
    expect((await dt('hannah', { action: 'start', mode: 'road' })).status).toBe(400); // players do not start downtime
    const hero = user('hannah').tokenIds[0];
    expect((await dt('hannah', { action: 'stashPut', tokenId: hero, itemId: 'd-rope' })).status).toBe(409); // no chest outside downtime
    const r = await dt('gm', { action: 'start', mode: 'road' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const camp = st().downtime!.campSceneId!;
    expect(await where('hannah')).toBe(camp);
    expect(await where('jean')).toBe(camp);
    const map = parseMap((await repo.sceneCatalog.get(cid, camp))!.published_metadata) as SceneMap;
    const tiles = [...decodeTiles(map.hex!).values()].map((t) => t.id);
    expect(tiles).toContain('campfire');
    expect(tiles).toContain('tent');
    expect(tiles).toContain('crates');
    // the chest
    expect((await dt('hannah', { action: 'stashPut', tokenId: hero, itemId: 'd-rope' })).status).toBe(200);
    expect(st().tokens[hero].stash?.map((i) => i.id)).toEqual(['d-rope']);
    expect(JSON.stringify((await request('hannah', 'state')).body)).toContain('d-rope'); // the owner sees the chest
    expect((await dt('jean', { action: 'stashTake', tokenId: hero, itemId: 'd-rope' })).status).toBe(403);
    // the Obelisk is open now
    const status = (await request('hannah', 'obelisk')).body as { downtime: boolean };
    expect(status.downtime).toBe(true);
    // back to the adventure
    expect((await dt('gm', { action: 'end' })).status).toBe(200);
    expect(await where('hannah')).toBe(before);
    expect((await repo.sceneCatalog.get(cid, camp))!.archived).toBe(true);
    expect(st().downtime!.active).toBe(false);
  });

  it('at home: each player in their own hideout; they choose its land, arrange it and shape it (no enemies)', async () => {
    expect((await dt('gm', { action: 'start', mode: 'home' })).status).toBe(200);
    const h = st().downtime!.hideouts[user('hannah').userId];
    const j = st().downtime!.hideouts[user('jean').userId];
    expect(h.sceneId).not.toBe(j.sceneId);
    expect(await where('hannah')).toBe(h.sceneId);
    expect((await dt('hannah', { action: 'preset', preset: 'desert' })).status).toBe(200);
    expect(st().downtime!.hideouts[user('hannah').userId].preset).toBe('desert');
    expect((await dt('hannah', { action: 'keep', keep: ['crates', 'cart', 'bed'] })).status).toBe(200);
    const sc = parseMap((await repo.sceneCatalog.get(cid, h.sceneId))!.published_metadata) as SceneMap;
    expect([...decodeTiles(sc.hex!).values()].map((t) => t.id)).toContain('cart');
    // the player saves an edited map: enemies and GM notes are dropped, the arrival stays
    const edited = { ...sc, gmNotes: 'secret', nodes: [...sc.nodes.filter((n) => n.kind !== 'spawn'), { id: 'e1', x: 100, y: 100, label: 'Bandits', description: '', kind: 'enemies', visible: false, width: 50, height: 50, targetScene: null, group: 'bandits' }] };
    expect((await dt('hannah', { action: 'save', map: edited })).status).toBe(200);
    const saved = parseMap((await repo.sceneCatalog.get(cid, h.sceneId))!.published_metadata)!;
    expect(saved.nodes.some((n) => n.kind === 'enemies')).toBe(false);
    expect(saved.nodes.some((n) => n.kind === 'spawn')).toBe(true);
    expect(saved.gmNotes).toBe('');
    // the hideout is kept for the next downtime
    expect((await dt('gm', { action: 'end' })).status).toBe(200);
    expect(st().downtime!.hideouts[user('hannah').userId].sceneId).toBe(h.sceneId);
    expect((await dt('gm', { action: 'start', mode: 'home' })).status).toBe(200);
    expect(await where('hannah')).toBe(h.sceneId);
  });
});
