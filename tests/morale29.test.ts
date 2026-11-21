/** APEX 2.9: enemy personality and morale – presets, morale checks, rally, surrender, the planner and the API. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { emptyMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { BUILTIN_BESTIARY, parseStatBlock } from '../src/game/bestiary';
import { defaultProfile, planAiStep, type AiFigure, type AiSelf } from '../src/game/enemyAi';
import { breakAt, creaturePersonality, isLeader, parsePersonality, rally, rollMorale, surrenders, type MoraleSituation } from '../src/game/morale';
import { enemiesOf } from '../src/game/sceneCombat';
import { emptySheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const block = (id: string) => BUILTIN_BESTIARY.find((b) => b.id === id)!;
const pers = (id: string) => { const b = block(id); return creaturePersonality(b, { name: b.name, elite: b.elite, abilities: b.abilities }); };
const calm: MoraleSituation = { alliesDown: 0, leaderDown: false, hp: 1, isolated: false, outnumbered: false, lightNear: false, leaderBonus: 0, wisSave: 0 };
const dice = (...rolls: number[]) => { let i = 0; return () => rolls[Math.min(i++, rolls.length - 1)]; };

describe('personality presets', () => {
  it('styles by kind: troops, packs, the relentless, beasts, the proud; leaders', () => {
    expect(pers('goblin').style).toBe('troop');
    expect(pers('orc').style).toBe('troop');
    expect(pers('wolf')).toMatchObject({ style: 'pack', lightShy: true });
    expect(pers('giant-wolf-spider').style).toBe('beast');
    expect(pers('zombie').style).toBe('horde');
    expect(pers('skeleton').style).toBe('horde');
    expect(pers('bear')).toMatchObject({ style: 'beast', lightShy: true });
    expect(pers('cow').lightShy).toBe(false);
    expect(pers('young-red-dragon').style).toBe('proud');
    expect(pers('giant-eagle').style).toBe('beast');
    expect(isLeader(pers('bandit-captain'))).toBe(true);
    expect(isLeader(pers('orc-bloodcaller'))).toBe(true);
    expect(isLeader(pers('dire-wolf'))).toBe(true);
    expect(isLeader(pers('goblin'))).toBe(false);
    expect(pers('goblin').traits.opportunism).toBeGreaterThanOrEqual(7);
    expect(pers('guard').traits.loyalty).toBeGreaterThanOrEqual(7);
    expect(pers('berserker').traits.savagery).toBeGreaterThanOrEqual(9);
    // an elite of a troop leads; the GM's changes override the preset
    const gob = block('goblin');
    expect(isLeader(creaturePersonality(gob, { name: gob.name, elite: true }))).toBe(true);
    expect(creaturePersonality({ ...gob, personality: { traits: { inspire: 9 }, style: 'pack' } }, { name: gob.name }).traits.inspire).toBe(9);
  });
  it('the library keeps a valid personality and drops a broken one', () => {
    expect(parsePersonality({ style: 'pack', lightShy: true, traits: { greed: 3 } })).toEqual({ style: 'pack', lightShy: true, traits: { greed: 3 } });
    expect(parsePersonality({ traits: { greed: 11 } })).toBeNull();
    expect(parsePersonality({ style: 'robot' })).toBeNull();
    const ok = parseStatBlock({ ...block('goblin'), personality: { traits: { inspire: 8 } } });
    expect(ok.ok && ok.block.personality).toEqual({ traits: { inspire: 8 } });
  });
});

describe('morale checks', () => {
  it('comrades falling and losing sight of the group add fatigue; at the break point it breaks', () => {
    const p = pers('goblin');
    let r = rollMorale(p, { fatigue: 0 }, { ...calm, alliesDown: 1 }, dice(2));
    expect(r.state.fatigue).toBe(1);
    expect(r.state.seenDown).toBe(1);
    // the same fallen comrade does not shake it twice
    expect(rollMorale(p, r.state, { ...calm, alliesDown: 1 }, dice(1)).state.fatigue).toBe(1);
    r = rollMorale(p, r.state, { ...calm, alliesDown: 2, isolated: true, hp: 0.4 }, dice(1, 1, 1));
    expect(r.broke).toBe(true);
    expect(r.state.broken).toBe(true);
    expect(r.state.fatigue).toBeGreaterThanOrEqual(breakAt(p));
    expect(r.lines.length).toBeGreaterThan(0);
  });
  it('good rolls and a leader in sight hold; the relentless never check', () => {
    const p = pers('goblin');
    expect(rollMorale(p, { fatigue: 0 }, { ...calm, alliesDown: 1 }, dice(18)).state.fatigue).toBe(0);
    // 9 + leader bonus 3 vs DC 10 holds
    expect(rollMorale(p, { fatigue: 0 }, { ...calm, alliesDown: 1, leaderBonus: 3 }, dice(9)).state.fatigue).toBe(0);
    expect(rollMorale(p, { fatigue: 0 }, { ...calm, alliesDown: 1 }, dice(9)).state.fatigue).toBe(1);
    const z = rollMorale(pers('zombie'), { fatigue: 0 }, { ...calm, alliesDown: 5, leaderDown: true, hp: 0.1, isolated: true }, dice(1));
    expect(z.state.fatigue).toBe(0);
    expect(z.lines).toEqual([]);
  });
  it('a pack wavers when outnumbered and at a torch; a lone beast only when badly hurt', () => {
    const w = rollMorale(pers('wolf'), { fatigue: 0 }, { ...calm, outnumbered: true, lightNear: true }, dice(3, 2, 4));
    expect(w.state.fatigue).toBe(2);
    expect(rollMorale(pers('bear'), { fatigue: 0 }, { ...calm, alliesDown: 3, isolated: true }, dice(1)).state.fatigue).toBe(0);
    expect(rollMorale(pers('bear'), { fatigue: 0 }, { ...calm, hp: 0.2 }, dice(1, 1)).state.fatigue).toBeGreaterThan(0);
  });
  it('a rally takes fatigue away and brings the broken back; who surrenders', () => {
    const lead = pers('bandit-captain');
    const after = rally(pers('bandit'), { fatigue: 3, broken: true }, lead);
    expect(after.fatigue).toBeLessThan(3);
    expect(after.broken).toBeUndefined();
    expect(surrenders(pers('bandit'), 10)).toBe(true);
    expect(surrenders(pers('orc'), 7)).toBe(false); // too savage
    expect(surrenders(pers('wolf'), 3)).toBe(false);
  });
});

describe('planner with morale', () => {
  const map: SceneMap = hexSceneMap(emptyMap('battle'), encodeTiles(10, 'battle', () => 'grass'));
  const at = (q: number, r: number) => hexCentre(map, { q, r });
  const self = (id: string, q: number, r: number, o: Partial<AiSelf> = {}): AiSelf => {
    const b = block(id);
    return { id: 'npc-me', name: b.name, side: 'enemy', ...at(q, r), alt: 0, hp: 1, profile: defaultProfile(b), attacks: b.attacks, attacksLeft: b.multiattack, actionFree: true, bonusFree: true, dashed: false, moveLeft: b.speedFt, areas: [], buffs: [], traits: pers(id).traits, ...o };
  };
  const pc = (id: string, q: number, r: number, o: Partial<AiFigure> = {}): AiFigure => ({ id: `pc-${id}`, name: id, side: 'party', ...at(q, r), alt: 0, hp: 1, ...o });
  it('the broken flee, the cornered broken surrender, the surrendered do nothing', () => {
    expect(planAiStep(map, self('bandit', 0, 0, { morale: 'broken' }), [pc('a', 3, 0)])).toMatchObject({ kind: 'move', why: 'panics and flees' });
    // walled in at the map edge with no movement left
    const cornered = planAiStep(map, self('bandit', 0, 0, { morale: 'broken', moveLeft: 0, actionFree: false, canSurrender: true }), [pc('a', 2, 0)]);
    expect(cornered.kind).toBe('surrender');
    expect(planAiStep(map, self('bandit', 0, 0, { morale: 'surrendered' }), [pc('a', 1, 0)]).kind).toBe('end');
  });
  it('a leader rallies first (bonus action); light-shy wolves leave the torch-bearer alone when outnumbered', () => {
    expect(planAiStep(map, self('bandit-captain', 0, 0, { rallyable: 2 }), [pc('a', 1, 0)]).kind).toBe('rally');
    expect(planAiStep(map, self('bandit-captain', 0, 0, { rallyable: 2, bonusFree: false }), [pc('a', 1, 0)]).kind).not.toBe('rally');
    const wolf = self('wolf', 0, 0, { lightShy: true });
    const step = planAiStep(map, wolf, [pc('torch', 1, 0, { light: true }), pc('dark', -1, 0), pc('third', 0, 1)]);
    expect(step).toMatchObject({ kind: 'attack' });
    expect((step as { target: string }).target).not.toBe('pc-torch');
  });
});

describe('API: morale on the battle map', () => {
  const cid = 'campaign-morale29';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.22', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
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
    const sinna = user('hannah').tokenIds[0];
    me = ((await request('hannah', 'state')).body as PlayerPayload).scene!.motion!.tokens.find((t) => t.tokenId === sinna)!;
    const cur = (await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload;
    await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet: { ...emptySheet(), hitPoints: { current: 200, max: 200, temp: 0 } }, expectedVersion: cur.version ?? 0 });
  });
  const myTurn = (enemyId: string) => { const e = st().sceneEncounters![scene.id]; e.turnIndex = e.participants.findIndex((p) => p.id === `npc-${enemyId}`); e.turnSerial = (e.turnSerial ?? 0) + 1; e.economy = {}; };

  it('a leader rallies the shaken it sees (bonus action, GM only); players see fleeing and surrender, not fatigue', async () => {
    await turn(scene.id, { action: 'enemyAdd', templateId: 'bandit-captain', x: me.x + 6 * step, y: me.y });
    await turn(scene.id, { action: 'enemyAdd', templateId: 'bandit', x: me.x + 7 * step, y: me.y });
    await turn(scene.id, { action: 'enemyAdd', templateId: 'bandit', x: me.x + 5 * step, y: me.y });
    expect((await turn(scene.id, { action: 'startInitiative' })).status).toBe(200);
    const [cap, b1, b2] = enemiesOf(st(), scene.id);
    b1.morale = { fatigue: 3, broken: true };
    b2.morale = { fatigue: 1 };
    // GM and players see different things
    const gmFig = ((await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot).figures!;
    expect(gmFig.find((f) => f.id === b1.id)!.morale).toBe('broken');
    expect(gmFig.find((f) => f.id === b2.id)!.morale).toBe('shaken');
    const pv = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    const pfig = (pv as unknown as { figures?: Array<{ id: string; morale?: string }> }).figures ?? [];
    expect(pfig.find((f) => f.id === b2.id)).toBeTruthy();
    expect(pfig.find((f) => f.id === b2.id)!.morale).toBeUndefined();
    expect(pfig.find((f) => f.id === b1.id)?.morale).toBe('broken');
    // rally: not for a bandit, only on the leader's turn, GM only
    myTurn(cap.id);
    expect((await turn(scene.id, { action: 'npcRally', id: b1.id })).status).toBe(409);
    expect((await turn(scene.id, { action: 'npcRally', id: cap.id }, 'hannah')).status).toBe(403);
    expect((await turn(scene.id, { action: 'npcRally', id: cap.id })).status).toBe(200);
    const [, r1, r2] = enemiesOf(st(), scene.id);
    expect(r1.morale!.broken).toBeUndefined();
    expect(r1.morale!.fatigue).toBeLessThan(3);
    expect(r2.morale!.fatigue).toBe(0);
    expect((st().sceneCombatLog?.[scene.id] ?? []).some((l) => /rallies the troops/.test(l.text))).toBe(true);
    // a second rally in the same turn: the bonus action is spent
    expect((await turn(scene.id, { action: 'npcRally', id: cap.id })).status).not.toBe(200);
  });

  it('the AI: a broken bandit runs; a new fight resets the nerves; the horde never checks', async () => {
    await turn(scene.id, { action: 'enemyAdd', templateId: 'bandit', x: me.x + 2 * step, y: me.y });
    await turn(scene.id, { action: 'enemyAdd', templateId: 'zombie', x: me.x - 2 * step, y: me.y });
    expect((await turn(scene.id, { action: 'startInitiative' })).status).toBe(200);
    await turn(scene.id, { action: 'ai', on: true });
    const [bandit, zombie] = enemiesOf(st(), scene.id);
    bandit.morale = { fatigue: 4, broken: true };
    myTurn(bandit.id);
    const r = await turn(scene.id, { action: 'aiStep' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { ai: { why: string } }).ai.why).toMatch(/flees|breaks away|runs/);
    // the zombie: comrades down, hurt – still no morale
    enemiesOf(st(), scene.id)[0].defeated = true;
    zombie.hp = 1;
    myTurn(zombie.id);
    const z = await turn(scene.id, { action: 'aiStep' });
    expect((z.body as { ai: { morale?: string } }).ai.morale).toBeUndefined();
    expect(enemiesOf(st(), scene.id)[1].morale).toBeUndefined();
    // end and start again: fresh nerves
    await turn(scene.id, { action: 'endInitiative' });
    enemiesOf(st(), scene.id)[0].defeated = false;
    expect((await turn(scene.id, { action: 'startInitiative' })).status).toBe(200);
    expect(enemiesOf(st(), scene.id)[0].morale).toBeUndefined();
  });

  it('the AI rolls morale at the start of a turn when a comrade fell (GM sees the roll)', async () => {
    await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 3 * step, y: me.y });
    await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 4 * step, y: me.y });
    expect((await turn(scene.id, { action: 'startInitiative' })).status).toBe(200);
    await turn(scene.id, { action: 'ai', on: true });
    const [g1, g2] = enemiesOf(st(), scene.id);
    g1.defeated = true; g1.hp = 0;
    myTurn(g2.id);
    const r = await turn(scene.id, { action: 'aiStep' });
    expect(r.status).toBe(200);
    expect((r.body as { ai: { morale?: string } }).ai.morale).toMatch(/morale \(a comrade fell\)/);
    expect(enemiesOf(st(), scene.id)[1].morale!.seenDown).toBe(1);
  });
});
