/** APEX 2.7: enemy AI – default behaviours, the planner, and a whole AI turn through the API. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { emptyMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { defaultProfile, planAiStep, type AiFigure, type AiSelf } from '../src/game/enemyAi';
import { enemiesOf } from '../src/game/sceneCombat';
import { emptySheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const block = (id: string) => BUILTIN_BESTIARY.find((b) => b.id === id)!;
const map: SceneMap = hexSceneMap(emptyMap('battle'), encodeTiles(10, 'battle', () => 'grass'));
const at = (q: number, r: number) => hexCentre(map, { q, r });
const self = (id: string, q: number, r: number, o: Partial<AiSelf> = {}): AiSelf => {
  const b = block(id);
  return { id: 'npc-me', name: b.name, side: 'enemy', ...at(q, r), alt: 0, hp: 1, profile: defaultProfile(b), attacks: b.attacks, attacksLeft: b.multiattack, actionFree: true, bonusFree: true, dashed: false, moveLeft: b.speedFt, areas: (b.areas ?? []).map((a, index) => ({ ...a, index, left: a.uses ?? null })), buffs: (b.buffs ?? []).map((x, index) => ({ ...x, index, left: x.uses ?? null })), ...o };
};
const pc = (id: string, q: number, r: number, hp = 1): AiFigure => ({ id: `pc-${id}`, name: id, side: 'party', ...at(q, r), alt: 0, hp });
const friend = (id: string, q: number, r: number): AiFigure => ({ id: `npc-${id}`, name: id, side: 'enemy', ...at(q, r), alt: 0, hp: 1 });

describe('behaviour presets', () => {
  it('every built-in creature has a tactic and a mood; some well-known ones', () => {
    for (const b of BUILTIN_BESTIARY) { const p = defaultProfile(b); expect(p.tactic, b.id).toBeTruthy(); expect(p.mood, b.id).toBeTruthy(); }
    expect(defaultProfile(block('wolf'))).toEqual({ tactic: 'pack', mood: 'aggressive' });
    expect(defaultProfile(block('spider')).tactic).toBe('ambusher');
    expect(defaultProfile(block('archer'))).toEqual({ tactic: 'skirmisher', mood: 'cautious' });
    expect(defaultProfile(block('mage')).tactic).toBe('caster');
    expect(defaultProfile(block('zombie'))).toEqual({ tactic: 'mindless', mood: 'aggressive' });
    expect(defaultProfile(block('orc-bloodcaller')).tactic).toBe('support');
    expect(defaultProfile(block('guard'))).toEqual({ tactic: 'guardian', mood: 'defensive' });
    expect(defaultProfile(block('commoner')).mood).toBe('cowardly');
    expect(defaultProfile(block('ogre')).tactic).toBe('brute');
  });
});

describe('planner', () => {
  it('melee: walks next to the target, then attacks, then ends', () => {
    const far = planAiStep(map, self('orc', 0, 0), [pc('a', 4, 0)]);
    expect(far.kind).toBe('move');
    const next = planAiStep(map, self('orc', 3, 0, { moveLeft: 15 }), [pc('a', 4, 0)]);
    expect(next).toMatchObject({ kind: 'attack', target: 'pc-a', attackIndex: 0 });
    expect(planAiStep(map, self('orc', 3, 0, { attacksLeft: 0, actionFree: false, moveLeft: 15 }), [pc('a', 4, 0)]).kind).toBe('end');
  });
  it('too far: advances, then Dashes (aggressive); a guard holds its ground with Dodge', () => {
    const others = [pc('a', 9, 0)];
    expect(planAiStep(map, self('orc', -9, 0), others)).toMatchObject({ kind: 'move' });
    expect(planAiStep(map, self('orc', -3, 0, { moveLeft: 0 }), others)).toMatchObject({ kind: 'standard', act: 'dash' });
    expect(planAiStep(map, self('guard', -9, 0), others)).toMatchObject({ kind: 'standard', act: 'dodge' });
  });
  it('archers shoot from where they stand and step back afterwards', () => {
    const shot = planAiStep(map, self('archer', 0, 0), [pc('a', 6, 0)]);
    expect(shot).toMatchObject({ kind: 'attack', target: 'pc-a' });
    expect(block('archer').attacks[(shot as { attackIndex: number }).attackIndex].kind).toBe('ranged');
    const after = planAiStep(map, self('archer', 0, 0, { attacksLeft: 0, actionFree: false }), [pc('a', 2, 0)]);
    expect(after).toMatchObject({ kind: 'move', why: 'falls back' });
  });
  it('the pack goes for the one a friend already holds; ambushers for the wounded', () => {
    const others = [pc('a', 2, 0), pc('b', -2, 0), friend('w2', 3, 0)];
    const step = planAiStep(map, self('wolf', 0, 0), others);
    expect(step.kind).toBe('move');
    expect(step.why).toMatch(/a$/);
    const hunt = planAiStep(map, self('spider', 0, 0), [pc('a', 1, 0), pc('b', -1, 0, 0.3)]);
    expect(hunt).toMatchObject({ kind: 'attack', target: 'pc-b' });
  });
  it('areas on a group, war cries first, the cowardly run, the curious watch', () => {
    const mage = planAiStep(map, self('mage', 0, 0), [pc('a', 6, 0), pc('b', 7, 0), pc('c', 6, 1)]);
    expect(mage).toMatchObject({ kind: 'area' });
    const cry = planAiStep(map, self('orc-bloodcaller', 0, 0), [pc('a', 8, 0), friend('o1', 1, 0), friend('o2', 0, 1)]);
    expect(cry).toMatchObject({ kind: 'buff' });
    const run = planAiStep(map, self('goblin', 0, 0, { hp: 0.4, nimble: true }), [pc('a', 1, 0)]);
    expect(run).toMatchObject({ kind: 'standard', act: 'disengage', viaBonus: true });
    const watch = planAiStep(map, self('pseudodragon', 0, 0, { flyFt: 60 }), [pc('a', 2, 0)]);
    expect(watch).toMatchObject({ kind: 'end' });
    expect(planAiStep(map, self('pseudodragon', 0, 0, { flyFt: 60, provoked: true }), [pc('a', 1, 0)]).kind).toBe('attack');
  });
  it('ignores the hidden and the fallen', () => {
    expect(planAiStep(map, self('orc', 0, 0), [{ ...pc('a', 1, 0), unseen: true }, { ...pc('b', -1, 0), down: true }])).toMatchObject({ kind: 'end' });
  });
});

describe('API: the AI plays an orc', () => {
  const cid = 'campaign-ai27';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.20', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
  let sinna: string;
  let me: { x: number; y: number };
  const step = Math.sqrt(3) * 30;
  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
    const created = (await request('gm', 'scenes', { name: 'Fight', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const m: SceneMap = { ...meta, hex: { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) } };
    scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: m })).body as { scene: SceneDefinition }).scene;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user('hannah').userId)!], requestId: crypto.randomUUID() });
    sinna = user('hannah').tokenIds[0];
    me = ((await request('hannah', 'state')).body as PlayerPayload).scene!.motion!.tokens.find((t) => t.tokenId === sinna)!;
    const cur = (await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload;
    await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet: { ...emptySheet(), hitPoints: { current: 200, max: 200, temp: 0 } }, expectedVersion: cur.version ?? 0 });
  });

  it('off by default; on: the orc walks up, attacks and ends its turn by itself; a creature can be taken out', async () => {
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc', x: me.x + 4 * step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'startInitiative' })).status).toBe(200);
    const orc = enemiesOf(st(), scene.id)[0];
    const enc = () => st().sceneEncounters![scene.id];
    // make it the orc's turn
    const e = enc(); e.turnIndex = e.participants.findIndex((p) => p.id === `npc-${orc.id}`); e.turnSerial = (e.turnSerial ?? 0) + 1;
    const serial = e.turnSerial;
    expect(((await turn(scene.id, { action: 'aiStep' })).body as { ai: { idle?: boolean } }).ai.idle).toBe(true);
    expect((await turn(scene.id, { action: 'ai', on: true }, 'hannah')).status).toBe(403);
    expect((await turn(scene.id, { action: 'ai', on: true })).status).toBe(200);
    const kinds: string[] = [];
    for (let i = 0; i < 10 && enc().turnSerial === serial; i++) {
      const r = await turn(scene.id, { action: 'aiStep' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      kinds.push((r.body as { ai: { step: string } }).ai.step);
    }
    expect(kinds[0]).toBe('move');
    expect(kinds).toContain('attack');
    expect(kinds[kinds.length - 1]).toBe('end');
    expect(enc().turnSerial).toBeGreaterThan(serial);
    const moved = enemiesOf(st(), scene.id)[0];
    expect(Math.hypot(moved.x - me.x, moved.y - me.y)).toBeLessThan(step * 1.2);
    expect((st().sceneCombatLog?.[scene.id] ?? []).some((l) => /Greataxe/.test(l.text))).toBe(true);
    // the GM takes the orc back: the AI leaves it alone
    expect((await turn(scene.id, { action: 'npcAi', id: orc.id, off: true, profile: { tactic: 'guardian', mood: 'defensive' } })).status).toBe(200);
    expect(enemiesOf(st(), scene.id)[0].ai).toEqual({ off: true, tactic: 'guardian', mood: 'defensive' });
    const e2 = enc(); e2.turnIndex = e2.participants.findIndex((p) => p.id === `npc-${orc.id}`); e2.turnSerial = (e2.turnSerial ?? 0) + 1;
    expect(((await turn(scene.id, { action: 'aiStep' })).body as { ai: { idle?: boolean } }).ai.idle).toBe(true);
    expect((await turn(scene.id, { action: 'npcAi', id: orc.id, profile: { tactic: 'nonsense' } })).status).toBe(400);
  });
});
