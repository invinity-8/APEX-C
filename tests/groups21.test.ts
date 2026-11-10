/**
 * APEX 2.1: enemy groups (built-in and own), spawn markers on battle maps (hidden from players), the composer and
 * spawning a marker's group during the game.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MapNode, SceneMap } from '../src/campaign/maps';
import { emptyMap, parseMap } from '../src/campaign/maps';
import { generateBattleScene, hexAt, hexCentre, hexSceneMap, tileLookup } from '../src/campaign/hexScene';
import { distance, hexKey } from '../src/game/hex';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { BUILTIN_GROUPS, LAYOUT_GROUPS, allGroups, composeSpawns, groupSize, parseGroup, spotsAround } from '../src/game/groups';
import { enemiesOf } from '../src/game/sceneCombat';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import { publicMap } from '../src/server/sceneRuntime';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

describe('enemy groups (data)', () => {
  it('every built-in group uses library creatures, has 1–12 members and every layout suggests existing groups', () => {
    expect(BUILTIN_GROUPS.length).toBeGreaterThanOrEqual(12);
    for (const g of BUILTIN_GROUPS) {
      expect(parseGroup(g, BUILTIN_BESTIARY), g.id).not.toBeNull();
      expect(groupSize(g)).toBeGreaterThan(0);
      expect(groupSize(g)).toBeLessThanOrEqual(12);
    }
    for (const ids of Object.values(LAYOUT_GROUPS)) for (const id of ids) expect(BUILTIN_GROUPS.some((g) => g.id === id), id).toBe(true);
  });
  it('parseGroup rejects unknown creatures, too many members and bad ids; own groups override built-ins by id', () => {
    const ok = { id: 'river-gang', name: 'River gang', members: [{ templateId: 'bandit', count: 4 }] };
    expect(parseGroup(ok, BUILTIN_BESTIARY)).toMatchObject({ id: 'river-gang', source: 'custom' });
    expect(parseGroup({ ...ok, members: [{ templateId: 'dragon', count: 1 }] }, BUILTIN_BESTIARY)).toBeNull();
    expect(parseGroup({ ...ok, members: [{ templateId: 'bandit', count: 13 }] }, BUILTIN_BESTIARY)).toBeNull();
    expect(parseGroup({ ...ok, members: [{ templateId: 'bandit', count: 7 }, { templateId: 'orc', count: 6 }] }, BUILTIN_BESTIARY)).toBeNull();
    expect(parseGroup({ ...ok, id: 'Bad Id' }, BUILTIN_BESTIARY)).toBeNull();
    const own = { ...BUILTIN_GROUPS[0], name: 'My cell', source: 'custom' as const };
    expect(allGroups([own]).filter((g) => g.id === own.id)).toEqual([own]);
  });
  it('spawn spots: the marker hex first, then ring by ring, only passable and free hexes', () => {
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('market', 9, 3));
    const at = hexCentre(map, { q: 2, r: 2 });
    const spots = spotsAround(map, at, 6, new Set());
    expect(spots).toHaveLength(6);
    const tile = tileLookup(map);
    for (const s of spots) expect(tile(hexKey(hexAt(map, s)))?.cost).not.toBeNull();
    expect(new Set(spots.map((s) => hexKey(hexAt(map, s)))).size).toBe(6);
    for (const s of spots) expect(distance(hexAt(map, s), hexAt(map, at))).toBeLessThanOrEqual(3);
  });
  it('the composer spreads groups apart, away from the party spawn, on passable hexes', () => {
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('hamlet', 10, 5));
    const spawn: MapNode = { id: 'sp', x: hexCentre(map, { q: 0, r: 0 }).x, y: hexCentre(map, { q: 0, r: 0 }).y, label: 'Arrival', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null };
    const m = { ...map, nodes: [spawn] };
    const groups = LAYOUT_GROUPS.hamlet.map((id) => BUILTIN_GROUPS.find((g) => g.id === id)!).slice(0, 3);
    const spots = composeSpawns(m, groups, 11);
    expect(spots).toHaveLength(3);
    const tile = tileLookup(m);
    for (const s of spots) { expect(tile(hexKey(hexAt(m, s)))?.cost).not.toBeNull(); expect(distance(hexAt(m, s), { q: 0, r: 0 })).toBeGreaterThanOrEqual(4); }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(distance(hexAt(m, spots[i]), hexAt(m, spots[j]))).toBeGreaterThanOrEqual(3);
    expect(composeSpawns(m, groups, 11)).toEqual(spots);
  });
  it('enemy markers survive parseMap but never reach players', () => {
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('blank', 6, 1));
    const node: MapNode = { id: 'en1', x: map.width / 2, y: map.height / 2, label: 'Cultist cell', description: '', kind: 'enemies', group: 'g-cult-cell', visible: true, width: 50, height: 50, targetScene: null };
    const parsed = parseMap({ ...map, nodes: [node] })!;
    expect(parsed.nodes[0]).toMatchObject({ kind: 'enemies', group: 'g-cult-cell' });
    expect(publicMap(parsed)!.nodes).toHaveLength(0);
    expect(parseMap({ ...map, nodes: [{ ...node, group: 'Bad Group!' }] })).toBeNull();
  });
});

describe('API: own groups and spawning a marker', () => {
  const cid = 'campaign-g21';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.23', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
    const created = (await request('gm', 'scenes', { name: 'Village', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const hex = { ...meta.hex!, terrain: 'G'.repeat(meta.hex!.terrain.length) };
    const base: SceneMap = { ...meta, hex };
    const at = hexCentre(base, { q: 3, r: -3 });
    const nodes: MapNode[] = [...meta.nodes, { id: 'm-cult', ...at, label: 'Cultist cell', description: '', kind: 'enemies', group: 'g-cult-cell', visible: false, width: 50, height: 50, targetScene: null }, { id: 'm-own', ...hexCentre(base, { q: -3, r: 3 }), label: 'River gang', description: '', kind: 'enemies', group: 'river-gang', visible: false, width: 50, height: 50, targetScene: null }];
    scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: { ...base, nodes } })).body as { scene: SceneDefinition }).scene;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user('hannah').userId)!], requestId: crypto.randomUUID() });
  });

  it('the GM saves an own group; players cannot', async () => {
    const group = { id: 'river-gang', name: 'River gang', icon: '🗡', color: '#335577', members: [{ templateId: 'bandit', count: 2 }, { templateId: 'archer', count: 1 }] };
    expect((await request('hannah', 'command', { campaignId: cid, command: { type: 'enemyGroupSave', group } })).status).toBe(403);
    expect((await request('gm', 'command', { campaignId: cid, command: { type: 'enemyGroupSave', group } })).status).toBe(200);
    expect(st().enemyGroups).toHaveLength(1);
    expect((await request('gm', 'command', { campaignId: cid, command: { type: 'enemyGroupSave', group: { ...group, members: [{ templateId: 'dragon', count: 1 }] } } })).status).not.toBe(200);
    expect((await request('gm', 'command', { campaignId: cid, command: { type: 'enemyGroupRemove', id: 'river-gang' } })).status).toBe(200);
    expect(st().enemyGroups).toHaveLength(0);
  });

  it('spawning a marker puts its group on free hexes around it; spawn all brings the rest; players never see the markers', async () => {
    const r = await request('gm', 'scene-turn', { sceneId: scene.id, action: 'encounter', op: 'spawnGroup', nodeId: 'm-cult' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const placed = enemiesOf(st(), scene.id);
    expect(placed.map((e) => e.templateId).sort()).toEqual(['cultist', 'cultist', 'cultist', 'thug']);
    expect(new Set(placed.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`)).size).toBe(4);
    const map = parseMap(scene.metadata)!;
    for (const e of placed) expect(distance(hexAt(map, e), { q: 3, r: -3 })).toBeLessThanOrEqual(1);
    // own group defined later, then spawn all
    await request('gm', 'command', { campaignId: cid, command: { type: 'enemyGroupSave', group: { id: 'river-gang', name: 'River gang', members: [{ templateId: 'bandit', count: 2 }] } } });
    expect((await request('gm', 'scene-turn', { sceneId: scene.id, action: 'encounter', op: 'spawnAll' })).status).toBe(200);
    expect(enemiesOf(st(), scene.id).length).toBe(4 + 4 + 2);
    // players: no marker, no spawning
    const pl = (await request('hannah', 'state')).body as PlayerPayload;
    expect(JSON.stringify(pl)).not.toContain('m-cult');
    expect((await request('hannah', 'scene-turn', { sceneId: scene.id, action: 'encounter', op: 'spawnGroup', nodeId: 'm-cult' })).status).toBe(403);
    expect((await request('gm', 'scene-turn', { sceneId: scene.id, action: 'encounter', op: 'spawnGroup', nodeId: 'nope' })).status).toBe(404);
  });
});
