/**
 * Scene-local rules: vision (line of sight, light, darkvision, region day/night), initiative on battle
 * maps, per-turn / free / per-day movement, and that nothing from the Arena leaks into scenes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyMap, type SceneMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexSceneMap, paintHexes } from '../src/campaign/hexScene';
import { darkvisionFeet, fogKeys, lineOfSight, sceneVision, type SceneClock } from '../src/campaign/hexVision';
import { hexKey } from '../src/game/hex';
import { emptySheet } from '../src/game/sheet';
import { endInitiative, endTurn, epochAllowance, initiativeBonus, joinInitiative, movementEpoch, setClock } from '../src/game/sceneTurns';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const clock = (over: Partial<SceneClock> = {}): SceneClock => ({ day: 1, phase: 'day', lighting: 'bright', version: 0, ...over });
const battleMap = (radius = 8): SceneMap => hexSceneMap(emptyMap('battle'), encodeTiles(radius, 'battle', () => 'stone'));
const at = (map: SceneMap, q: number, r: number) => ({ x: hexCentre(map, { q, r }).x, y: hexCentre(map, { q, r }).y });

describe('vision', () => {
  it('walls block line of sight – no looking around corners', () => {
    const map = battleMap();
    // A wall segment between (0,0) and (3,0); open space above it.
    map.hex = paintHexes(map.hex!, ['1,0', '1,-1', '2,-1', '1,1', '0,1'], 'wall');
    const blocks = (k: string) => ['1,0', '1,-1', '2,-1', '1,1', '0,1'].includes(k);
    expect(lineOfSight({ q: 0, r: 0 }, { q: 3, r: 0 }, blocks)).toBe(false);
    expect(lineOfSight({ q: 0, r: 0 }, { q: -3, r: 0 }, blocks)).toBe(true);
    const seen = sceneVision(map, clock(), [{ at: at(map, 0, 0), darkvisionFt: 0 }]);
    expect(seen.has('3,0')).toBe(false);
    expect(seen.has('1,0')).toBe(true); // you see the wall face itself
    expect(seen.has('-5,0')).toBe(true);
  });

  it('darkness limits sight to darkvision; light markers reveal lit hexes in view', () => {
    const map = battleMap(10);
    const dark = clock({ lighting: 'dark' });
    const human = sceneVision(map, dark, [{ at: at(map, 0, 0), darkvisionFt: 0 }]);
    expect(human.has('1,0')).toBe(true);
    expect(human.has('2,0')).toBe(false);
    const elf = sceneVision(map, dark, [{ at: at(map, 0, 0), darkvisionFt: 30 }]);
    expect(elf.has('6,0')).toBe(true);
    expect(elf.has('7,0')).toBe(false);
    map.nodes = [{ id: 'torch', kind: 'light', lightFt: 10, ...at(map, 8, 0), label: 'Torch', description: '', visible: true, width: 50, height: 50, targetScene: null }];
    const lit = sceneVision(map, dark, [{ at: at(map, 0, 0), darkvisionFt: 0 }]);
    expect(lit.has('8,0')).toBe(true);
    expect(lit.has('7,0')).toBe(true);
    expect(lit.has('4,0')).toBe(false);
    expect(darkvisionFeet('Darkvision 60 ft., Passive Perception 16')).toBe(60);
    expect(darkvisionFeet('Normal')).toBe(0);
  });

  it('region maps: 2 hexes by day, 1 at night, mountains hide what is behind them', () => {
    const map = hexSceneMap(emptyMap('region'), encodeTiles(6, 'region', (h) => (h.q === 1 && h.r === 0 ? 'mountain' : 'plains')));
    const day = sceneVision(map, clock(), [{ at: at(map, 0, 0), darkvisionFt: 0 }]);
    expect(day.has('0,2')).toBe(true);
    expect(day.has('0,3')).toBe(false);
    expect(day.has('2,0')).toBe(false); // behind the mountain
    const night = sceneVision(map, clock({ phase: 'night' }), [{ at: at(map, 0, 0), darkvisionFt: 0 }]);
    expect(night.has('0,2')).toBe(false);
    expect(night.has('0,1')).toBe(true);
    expect(fogKeys(1, 'vve....', 'e')).toHaveLength(1);
  });
});

describe('initiative and scene clock', () => {
  const base = () => { const s = createDemoState({ radius: 6, seed: 1 }); return s; };
  it('rolls into a stable order, inserts late arrivals without changing the active turn, and ends turns in order', () => {
    let s = base();
    const [a, b, c] = Object.keys(s.tokens).filter((id) => s.tokens[id].kind === 'player');
    let r = joinInitiative(s, 'scene', 'enc', [{ tokenId: a, name: 'A', roll: 10, bonus: 1 }, { tokenId: b, name: 'B', roll: 9, bonus: 2 }]);
    expect(r.ok).toBe(true); if (!r.ok) return; s = r.state;
    // Tie at 11: the higher modifier goes first.
    expect(s.sceneEncounters!.scene.participants.map((p) => p.tokenId)).toEqual([b, a]);
    // B and A follow each other: they act together as one block; each ends its own part
    expect(movementEpoch(s, 'scene', 'battle', a, false)).toMatchObject({ canMove: true });
    r = endTurn(s, 'scene', 'enc', 1, (t) => t === a); if (!r.ok) throw new Error(r.error); s = r.state;
    expect(s.sceneEncounters!.scene).toMatchObject({ turnSerial: 1, blockDone: [`pc-${a}`] });
    expect(movementEpoch(s, 'scene', 'battle', a, false)).toMatchObject({ canMove: false });
    expect(endTurn(s, 'scene', 'enc', 1, (t) => t === a)).toMatchObject({ ok: false });
    r = endTurn(s, 'scene', 'enc', 1, (t) => t === b); if (!r.ok) throw new Error(r.error); s = r.state;
    expect(s.sceneEncounters!.scene).toMatchObject({ turnIndex: 0, round: 2, turnSerial: 2, blockDone: [] });
    expect(endTurn(s, 'scene', 'enc', 1, () => true)).toMatchObject({ ok: false, error: 'The turn already changed.' });
    // an enemy between two characters splits the block
    r = joinInitiative(s, 'scene', 'other', [{ tokenId: c, name: 'C', roll: 20, bonus: 0 }]); if (!r.ok) throw new Error(); s = r.state;
    expect(s.sceneEncounters!.scene.participants[0].tokenId).toBe(c); // late arrival sorted in, active turn unchanged
    const ps = s.sceneEncounters!.scene.participants;
    s.sceneEncounters!.scene.participants = [ps.find((p) => p.tokenId === c)!, ps.find((p) => p.tokenId === b)!, { id: 'npc-x', name: 'X', initiative: 11, visible: true }, ps.find((p) => p.tokenId === a)!];
    s.sceneEncounters!.scene.turnIndex = 0;
    expect(movementEpoch(s, 'scene', 'battle', c, false)).toMatchObject({ canMove: true });
    expect(movementEpoch(s, 'scene', 'battle', a, false)).toMatchObject({ canMove: false });
    r = endTurn(s, 'scene', 'enc', 2, () => true, true); if (!r.ok) throw new Error(); s = r.state; // GM: next turn ends the block
    expect(s.sceneEncounters!.scene.participants[s.sceneEncounters!.scene.turnIndex].id).toBe('npc-x');
    expect(movementEpoch(s, 'scene', 'battle', c, false)).toMatchObject({ mode: 'turn', canMove: false, epoch: 't:enc:3' });
    r = endInitiative(s, 'scene'); if (!r.ok) throw new Error(); s = r.state;
    expect(movementEpoch(s, 'scene', 'battle', a, false)).toEqual({ mode: 'free', epoch: 'free', canMove: true });
  });

  it('scene clocks are per scene and version-checked; region budget is per day', () => {
    let s = base();
    const r = setClock(s, 'r1', 0, { phase: 'night' }); if (!r.ok) throw new Error(); s = r.state;
    expect(setClock(s, 'r1', 0, { nextDay: true })).toMatchObject({ ok: false });
    const n = setClock(s, 'r1', 1, { nextDay: true }); if (!n.ok) throw new Error(); s = n.state;
    expect(s.sceneClocks!.r1).toMatchObject({ day: 2, phase: 'day' });
    expect(s.sceneClocks!.other).toBeUndefined();
    expect(s.day).toBe(base().day); // Arena day untouched
    expect(movementEpoch(s, 'r1', 'region', 'x', false).epoch).toBe('d:2');
    expect(epochAllowance('day', 30)).toBe(24);
    expect(epochAllowance('turn', 25)).toBe(25);
    expect(initiativeBonus({ ...emptySheet(), combat: [{ label: 'Initiative', value: '+3' }] })).toBe(3);
    expect(initiativeBonus({ ...emptySheet(), attributes: [{ name: 'Dexterity', modifier: '-1' }] })).toBe(-1);
  });
});

describe('API: battle map turns, region days, fog of war', () => {
  const cid = 'campaign-local';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.12', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  async function publish(category: 'battle' | 'region', paint?: (m: SceneMap) => void) {
    const created = (await request('gm', 'scenes', { name: category, category, template: category === 'battle' ? 'hex-battle' : 'hex-region-blank' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const map: SceneMap = { ...meta, hex: { ...meta.hex!, terrain: (category === 'battle' ? 'S' : 'p').repeat(meta.hex!.terrain.length) } };
    paint?.(map);
    const r = await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map });
    expect(r.status).toBe(200);
    return { scene: (r.body as { scene: SceneDefinition }).scene, map };
  }
  const assign = async (sceneId: string | null) => {
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    return request('gm', 'scene-runtime', { sceneId, targets: ps.map((p) => ({ userId: p.userId, revision: p.revision })), requestId: crypto.randomUUID() });
  };
  const state = async (profile: string) => (await request(profile, 'state')).body as PlayerPayload;
  const move = async (profile: string, scene: SceneDefinition, x: number, y: number) => {
    const s = (await state(profile)).scene!;
    const token = user(profile).tokenIds[0];
    return request(profile, 'scene-motion', { action: 'move', requestId: crypto.randomUUID(), sceneId: scene.id, sceneRevision: scene.published_revision, tokenId: token, tokenVersion: s.motion?.tokens.find((t) => t.tokenId === token)?.version ?? 0, assignmentRevision: s.assignmentRevision, epoch: 0, x, y });
  };
  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah', 'jean']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
  });

  it('arrival starts initiative; only the active player moves, End turn passes on, the GM can free movement', async () => {
    const { scene, map } = await publish('battle');
    const spawn = map.nodes.find((n) => n.kind === 'spawn')!;
    const assigned = await assign(scene.id);
    expect(assigned.status).toBe(200);
    expect((assigned.body as { initiative?: string }).initiative).toMatch(/Initiative rolled/);
    const enc = repo.states.get(cid)!.state.sceneEncounters![scene.id];
    expect(enc.status).toBe('active');
    expect(enc.participants).toHaveLength(2);
    const first = enc.participants[0].tokenId!, second = enc.participants[1].tokenId!;
    const who = (token: string) => ['hannah', 'jean'].find((k) => user(k).tokenIds.includes(token))!;
    // Arena sneaking does not halve scene movement.
    repo.states.get(cid)!.state.tokens[first].sneaking = true;
    const step = Math.sqrt(3) * 30;
    // 4×4 arrival area: both characters stand on different hexes.
    const pos = async (token: string) => (await state(who(token))).scene!.motion!.tokens.find((t) => t.tokenId === token)!;
    const a = await pos(first), b = await pos(second);
    expect(`${a.x},${a.y}`).not.toBe(`${b.x},${b.y}`);
    void spawn;
    const dir = a.x >= b.x ? 1 : -1; // move away from the other character
    const together = await move(who(second), scene, b.x - dir * step, b.y);
    expect(together.status, JSON.stringify(together.body)).toBe(200); // consecutive characters act together
    const ok = await move(who(first), scene, a.x + dir * step * 6, a.y);
    expect(ok.status).toBe(200);
    expect((ok.body as { spent: number }).spent).toBe(30);
    expect((await move(who(first), scene, a.x + dir * step * 7, a.y)).status).toBe(422);
    const p1 = await state(who(first));
    expect(p1.scene?.movement).toMatchObject({ mode: 'turn', spent: 30, allowance: 30 });
    // Each ends their own part; the block (and the round) ends when both are done.
    expect((await request(who(second), 'scene-turn', { action: 'endTurn', sceneId: scene.id, encounterId: enc.id, turnSerial: 1 })).status).toBe(200);
    expect((await move(who(second), scene, b.x - dir * step * 2, b.y)).status).toBe(409); // already done
    expect((await request(who(first), 'scene-turn', { action: 'endTurn', sceneId: scene.id, encounterId: enc.id, turnSerial: 1 })).status).toBe(200);
    // Nobody can end on an occupied hex.
    const c = await pos(second);
    expect((await move(who(second), scene, a.x + dir * step * 6, a.y)).status).not.toBe(200);
    void c;
    expect((await state(who(first))).view?.sceneEncounter?.turnIndex).toBe(0);
    // Players cannot control initiative; the GM ends it → unlimited free movement.
    expect((await request(who(first), 'scene-turn', { action: 'endInitiative', sceneId: scene.id })).status).toBe(403);
    expect((await request('gm', 'scene-turn', { action: 'endInitiative', sceneId: scene.id })).status).toBe(200);
    expect((await move(who(first), scene, a.x - dir * step, a.y)).status).toBe(200); // 7 hexes back = 35 ft, free
    expect((await state(who(first))).scene?.movement?.mode).toBe('free');
    // Start again: everyone on the map rolls.
    expect((await request('gm', 'scene-turn', { action: 'startInitiative', sceneId: scene.id })).status).toBe(200);
    expect(repo.states.get(cid)!.state.sceneEncounters![scene.id].status).toBe('active');
  });

  it('fog of war: players receive only seen hexes; walls hide what is behind them; memory persists', async () => {
    const { scene, map } = await publish('battle', (m) => {
      const spawn = m.nodes.find((n) => n.kind === 'spawn')!;
      const s = { q: Math.round((spawn.x - m.width / 2) / (Math.sqrt(3) * 30)), r: 0 };
      // A wall ring three hexes away from the spawn.
      const ring: string[] = [];
      for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) { const d = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2; if (d === 3) ring.push(hexKey({ q: s.q + q, r: s.r + r })); }
      m.hex = paintHexes(m.hex!, ring, 'wall');
    });
    await assign(scene.id);
    await request('gm', 'scene-turn', { action: 'endInitiative', sceneId: scene.id });
    const s = await state('hannah');
    const fog = s.scene!.fog!;
    expect(fog).toBeDefined();
    const known = [...fog].filter((c) => c !== '.').length;
    expect(known).toBeGreaterThan(30);
    expect(known).toBeLessThan(map.hex!.terrain.length / 3);
    // Unknown hexes are not sent at all.
    const terrain = s.scene!.scene!.map.hex!.terrain;
    for (let i = 0; i < fog.length; i++) if (fog[i] === '.') expect(terrain[i]).toBe('.');
    // Darkness shrinks the view; what was seen on arrival stays remembered ('e') without moving.
    const clockVersion = repo.states.get(cid)!.state.sceneClocks?.[scene.id]?.version ?? 0;
    expect((await request('gm', 'scene-turn', { action: 'clock', sceneId: scene.id, expectedVersion: clockVersion, lighting: 'dark' })).status).toBe(200);
    const dark = (await state('hannah')).scene!;
    expect([...dark.fog!].filter((c) => c === 'v').length).toBeLessThan([...fog].filter((c) => c === 'v').length);
    expect([...dark.fog!].filter((c) => c === 'e').length).toBeGreaterThan(0);
    expect(dark.clock?.lighting).toBe('dark');
  });

  it('region: travel per scene day (8 hexes at speed 30), the GM starts the next day', async () => {
    const { scene, map } = await publish('region');
    await assign(scene.id);
    const spawn = map.nodes.find((n) => n.kind === 'spawn')!;
    const step = Math.sqrt(3) * 30;
    expect(repo.states.get(cid)!.state.sceneEncounters?.[scene.id]).toBeUndefined(); // no initiative on regions
    // Arrival area: both characters stand on different hexes next to the spawn.
    const me = (await state('hannah')).scene!.motion!.tokens.find((t) => t.tokenId === user('hannah').tokenIds[0])!;
    const other = (await state('jean')).scene!.motion!.tokens.find((t) => t.tokenId === user('jean').tokenIds[0])!;
    expect(`${me.x},${me.y}`).not.toBe(`${other.x},${other.y}`);
    void spawn;
    const dir = me.x >= other.x ? 1 : -1;
    expect((await move('hannah', scene, me.x + dir * step * 8, me.y)).status).toBe(200);
    expect((await move('hannah', scene, me.x + dir * step * 9, me.y)).status).toBe(422);
    expect((await request('hannah', 'scene-turn', { action: 'clock', sceneId: scene.id, expectedVersion: 0, nextDay: true })).status).toBe(403);
    expect((await request('gm', 'scene-turn', { action: 'clock', sceneId: scene.id, expectedVersion: 0, phase: 'night' })).status).toBe(200);
    expect((await state('hannah')).scene?.clock?.phase).toBe('night');
    expect((await request('gm', 'scene-turn', { action: 'clock', sceneId: scene.id, expectedVersion: 1, nextDay: true })).status).toBe(200);
    const next = await move('hannah', scene, me.x + dir * step * 9, me.y);
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(repo.states.get(cid)!.state.phase).toBe(createDemoState({ radius: 12, seed: 5 }).phase); // Arena untouched
  });
});
