/**
 * Game scene director: selecting a scene previews it without switching; "Switch Scene" (optionally
 * with all players) and single-player transfers use the server's assignment revisions. Regression for
 * "Send selected to chosen scene": selection, current scene and player selection never reset each other.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import {
  ARENA_ID,
  assignmentDestination,
  currentToStored,
  describeTransferError,
  directorReducer,
  initialDirector,
  locationLabel,
  storedToCurrent,
  transferTargets,
  type DirectorPlayer,
} from '../src/game/sceneDirector';
import { stepZoom, clampHeight, MIN_STAGE_HEIGHT } from '../src/components/map/MapStage';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition, SceneSummary } from '../src/server/scenes';
import type { PlayerPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const FOREST = '11111111-1111-4111-8111-111111111111';
const CAVE = '22222222-2222-4222-8222-222222222222';
const ARENA_ROW = '33333333-3333-4333-8333-333333333333';
const scenes = [
  { id: FOREST, name: 'Forest' },
  { id: CAVE, name: 'Cave' },
  { id: ARENA_ROW, name: 'Arena', is_legacy_arena: true },
];
const players: DirectorPlayer[] = [
  { userId: 'u1', name: 'Hannah', tokenIds: ['sinna'], sceneId: null, revision: 0 },
  { userId: 'u2', name: 'Jean', tokenIds: ['aster'], sceneId: FOREST, revision: 3 },
];

describe('scene director state', () => {
  it('clicking a scene only previews it; the current scene and the player selection stay', () => {
    let s = initialDirector(ARENA_ID);
    s = directorReducer(s, { type: 'togglePlayer', userId: 'u1', on: true });
    s = directorReducer(s, { type: 'select', id: FOREST });
    expect(s).toEqual({ current: ARENA_ID, selected: FOREST, selectedPlayers: ['u1'] });
    // Regression: the old Game page cleared the chosen scene and selected players on every click,
    // so "Send selected to chosen scene" could never be pressed.
    s = directorReducer(s, { type: 'select', id: CAVE });
    expect(s.selectedPlayers).toEqual(['u1']);
    expect(s.current).toBe(ARENA_ID);
  });

  it('switching makes the selected scene current and keeps ticked players for follow-up transfers', () => {
    let s = directorReducer(initialDirector(ARENA_ID), { type: 'selectPlayers', userIds: ['u1', 'u2', 'u1'] });
    s = directorReducer(s, { type: 'select', id: CAVE });
    s = directorReducer(s, { type: 'switched', id: CAVE });
    expect(s).toEqual({ current: CAVE, selected: CAVE, selectedPlayers: ['u1', 'u2'] });
  });

  it('refreshing assignments keeps the selection of players that still exist', () => {
    let s = directorReducer(initialDirector(FOREST), { type: 'selectPlayers', userIds: ['u1', 'u2', 'gone'] });
    s = directorReducer(s, { type: 'playersLoaded', players });
    expect(s.selectedPlayers).toEqual(['u1', 'u2']);
    expect(directorReducer(s, { type: 'playersLoaded', players })).toBe(s);
  });

  it('stores the Arena as null (compatible with the previous GM focus key)', () => {
    expect(storedToCurrent(null)).toBe(ARENA_ID);
    expect(storedToCurrent(FOREST)).toBe(FOREST);
    expect(currentToStored(ARENA_ID)).toBeNull();
    expect(currentToStored(CAVE)).toBe(CAVE);
  });

  it('maps the Arena entry to the legacy Arena scene row for transfers', () => {
    expect(assignmentDestination(ARENA_ID, scenes)).toBe(ARENA_ROW);
    expect(assignmentDestination(FOREST, scenes)).toBe(FOREST);
    expect(assignmentDestination(ARENA_ID, scenes.slice(0, 2))).toBeUndefined();
    expect(assignmentDestination('unknown', scenes)).toBeUndefined();
  });

  it('builds transfer targets with the seen revisions and skips players already there', () => {
    expect(transferTargets(players, ['u1', 'u2'], FOREST)).toEqual([{ userId: 'u1', revision: 0 }]);
    expect(transferTargets(players, ['u1', 'u2'], null)).toEqual([{ userId: 'u2', revision: 3 }]);
    expect(transferTargets(players, ['u2'], CAVE)).toEqual([{ userId: 'u2', revision: 3 }]);
  });

  it('never offers players who have not joined the campaign yet (server would refuse them)', () => {
    const withNew = [...players, { userId: 'u3', name: 'Simon', tokenIds: [], sceneId: null, revision: 0, joined: false }];
    expect(transferTargets(withNew, ['u1', 'u3'], CAVE)).toEqual([{ userId: 'u1', revision: 0 }]);
    expect(describeTransferError(409, 'Player is not active in this campaign.')).toMatch(/not joined/);
  });

  it('labels locations and explains stale revisions', () => {
    expect(locationLabel(players[0], scenes, FOREST)).toBe('Sanctuary');
    expect(locationLabel(players[1], scenes, FOREST)).toBe('Forest · current scene');
    expect(locationLabel({ sceneId: ARENA_ROW }, scenes, ARENA_ID)).toBe('Arena · current scene');
    expect(locationLabel({ sceneId: CAVE }, scenes, ARENA_ID)).toBe('Cave');
    expect(describeTransferError(409, 'ApiError: Player assignment changed. Refresh the selection.')).toMatch(/revision changed/);
    expect(describeTransferError(0, 'Failed to fetch')).toMatch(/Verify or retry/);
    expect(describeTransferError(409, 'Publish a valid spawn point first.')).toMatch(/spawn point/);
  });
});

describe('map stage', () => {
  it('zooms in fixed steps and clamps the stage height', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(clampHeight(10, 900)).toBe(MIN_STAGE_HEIGHT);
    expect(clampHeight(5000, 900)).toBe(900);
  });
});

describe('scene switch through the server (scene-runtime)', () => {
  const cid = 'campaign-game';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.12', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  type Players = { players: DirectorPlayer[] };
  const playerList = async () => ((await request('gm', 'scene-runtime')).body as Players).players;
  const assign = (sceneId: string | null, targets: Array<{ userId: string; revision: number }>, requestId = crypto.randomUUID()) => request('gm', 'scene-runtime', { sceneId, targets, requestId });
  async function battle(name: string) {
    const created = (await request('gm', 'scenes', { name, category: 'battle', template: 'square-battle' })).body as { scene: SceneDefinition };
    const published = await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: created.scene.metadata });
    expect(published.status).toBe(200);
    return (published.body as { scene: SceneDefinition }).scene;
  }
  beforeEach(async () => {
    resetSchemaCache();
    repo = new MemoryRepo();
    cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' });
    seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah', 'jean']) {
      await activate(repo, cid, key, `${key}-test-password`);
      const r = await request(key, 'login', { profile: key, password: `${key}-test-password` });
      cookies[key] = r.cookies![0].split(';')[0];
    }
  });

  it('Switch Scene with everyone, then single transfers and Sanctuary, with fresh revisions each time', async () => {
    const forest = await battle('Forest');
    const cave = await battle('Cave');
    const list = ((await request('gm', 'scenes', undefined, { archived: '0', sort: 'name' })).body as { scenes: SceneSummary[] }).scenes;
    // Selecting a scene is client state only: the server assignment does not change.
    let ps = await playerList();
    expect(ps).toHaveLength(2);
    expect(ps.every((p) => p.joined === true)).toBe(true);
    expect(ps.some((p) => p.sceneId === forest.id)).toBe(false);
    const r0 = ps.map((p) => p.revision);

    // "Switch and move all players" → one transition for everyone.
    const all = transferTargets(ps, ps.map((p) => p.userId), assignmentDestination(forest.id, list)!);
    expect((await assign(forest.id, all)).status).toBe(200);
    ps = await playerList();
    expect(ps.every((p) => p.sceneId === forest.id)).toBe(true);
    expect(ps.map((p) => p.revision)).toEqual(r0.map((r) => r + 1));
    for (const key of ['hannah', 'jean']) expect(((await request(key, 'state')).body as PlayerPayload).scene?.scene?.id).toBe(forest.id);

    // Then one player to another scene, one back to the Sanctuary.
    expect((await assign(cave.id, transferTargets(ps, [ps[0].userId], cave.id))).status).toBe(200);
    expect((await assign(null, transferTargets(ps, [ps[1].userId], null))).status).toBe(200);
    ps = await playerList();
    expect(ps.map((p) => p.sceneId)).toEqual([cave.id, null]);
    expect(ps.map((p) => p.revision)).toEqual(r0.map((r) => r + 2));

    // The Arena is a normal destination (legacy Arena scene row).
    const arena = assignmentDestination(ARENA_ID, list);
    expect(arena).toBeTruthy();
    expect((await assign(arena!, transferTargets(ps, ps.map((p) => p.userId), arena!))).status).toBe(200);
    expect((await playerList()).every((p) => p.sceneId === arena)).toBe(true);
  });

  it('refuses a stale revision without changing anyone, and a retried request is not applied twice', async () => {
    const forest = await battle('Forest');
    const ps = await playerList();
    const targets = transferTargets(ps, ps.map((p) => p.userId), forest.id);
    const requestId = crypto.randomUUID();
    expect((await assign(forest.id, targets, requestId)).status).toBe(200);
    // Network retry with the same request id: acknowledged, no second revision bump.
    expect((await assign(forest.id, targets, requestId)).status).toBe(200);
    expect((await playerList()).map((p) => p.revision)).toEqual(ps.map((p) => p.revision + 1));
    // A second GM tab still holding revision 0 is refused; nobody moves.
    const stale = await assign(null, targets);
    expect(stale.status).toBe(409);
    expect(describeTransferError(409, String((stale.body as { error: string }).error))).toMatch(/revision changed/);
    expect((await playerList()).every((p) => p.sceneId === forest.id)).toBe(true);
  });
});
