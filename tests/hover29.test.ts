/** APEX 2.9: the hover card – a character's armour class with its effects (Mage Armor) reaches the map. */
import { describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { emptySheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

describe('API: armour class on the map', () => {
  it('vitals carry the AC as attacks see it – Mage Armor counts', async () => {
    const cid = 'campaign-hover29';
    resetSchemaCache(); const repo = new MemoryRepo(); const cookies: Record<string, string> = {};
    const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
      handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.24', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah']) { await activate(repo, cid, key, `${key}-test-password`); cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0]; }
    const created = (await request('gm', 'scenes', { name: 'Fight', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: meta })).body as { scene: SceneDefinition }).scene;
    const user = repo.profileList.find((p) => p.key === 'hannah')!;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user.userId)!], requestId: crypto.randomUUID() });
    const sinna = user.tokenIds[0];
    const cur = (await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload;
    const sheet = { ...emptySheet(), attributes: [{ id: 'a2', name: 'Dexterity', value: '14', modifier: '+2' }], combat: [{ id: 'c1', label: 'Armor Class', value: '12' }], hitPoints: { current: 21, max: 27, temp: 0 },
      resources: [{ id: 'r1', name: 'Spell slots (level 1)', current: 3, max: 3 }], spells: [{ id: 'ma', name: 'Mage Armor', level: 1, prepared: true, source: 'Wizard', notes: '', school: 'Abjuration', castingTime: '1 action', range: 'Touch', components: 'V, S, M', duration: '8 hours', concentration: false, ritual: false, description: '' }] };
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet, expectedVersion: cur.version ?? 0 })).status).toBe(200);
    const vitals = async () => ((await request('hannah', 'state')).body as PlayerPayload).scene!.vitals![sinna];
    expect(await vitals()).toMatchObject({ hp: 21, maxHp: 27, ac: 12 });
    const cast = await request('hannah', 'scene-turn', { sceneId: scene.id, action: 'cast', tokenId: sinna, spellId: 'ma', slotLevel: 1, targets: [{ kind: 'pc', tokenId: sinna }] });
    expect(cast.status, JSON.stringify(cast.body)).toBe(200);
    expect((await vitals()).ac).toBe(15);
    // the GM sees the same
    expect(((await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot).vitals![sinna].ac).toBe(15);
  });
});
