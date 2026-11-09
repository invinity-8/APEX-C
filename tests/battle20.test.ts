/**
 * APEX 2.0: jumping down a cliff (falling damage, prone) and shoving (push 5 ft – over the edge – or knock prone).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { emptyMap } from '../src/campaign/maps';
import { encodeTiles, hexAt, hexCentre, hexMovementCost, hexSceneMap, pathDrops, setHeights } from '../src/campaign/hexScene';
import { hexKey } from '../src/game/hex';
import { effectsOf } from '../src/game/combatEffects';
import { enemiesOf } from '../src/game/sceneCombat';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const bare = (name: string, level = 0) => ({ id: name.toLowerCase().replace(/ /g, '-'), name, level, prepared: true, source: '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });
const druid = (): CharacterSheet => ({ ...emptySheet(), hitPoints: { current: 30, max: 30, temp: 0 }, spells: [bare('Fire Bolt')] });

describe('rules', () => {
  it('walkers may jump down a cliff (paths prefer stairs) – the drop is reported', () => {
    let hex = hexSceneMap(emptyMap('battle'), encodeTiles(6, 'battle', () => 'grass')).hex!;
    hex = setHeights(hex, [hexKey({ q: 0, r: 0 })], () => 3);
    const m: SceneMap = { ...hexSceneMap(emptyMap('battle'), encodeTiles(6, 'battle', () => 'grass')), hex };
    const down = hexMovementCost(m, hexCentre(m, { q: 0, r: 0 }), hexCentre(m, { q: 1, r: 0 }));
    expect(down).toMatchObject({ ok: true, cost: 10 }); // 5 ft + the jump penalty
    if (!down.ok) throw new Error();
    expect(pathDrops(m, down.path, { q: 0, r: 0 })).toEqual([15]);
    expect(hexMovementCost(m, hexCentre(m, { q: 1, r: 0 }), hexCentre(m, { q: 0, r: 0 })).ok).toBe(false); // not up
  });
});

describe('API: jumping down, shoving', () => {
  const cid = 'campaign-b20';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.21', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
  let sinna: string;
  let me: { x: number; y: number };
  const step = Math.sqrt(3) * 30;
  const sheetOf = async () => ((await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload);
  const saveSheet = async (sheet: CharacterSheet) => {
    const cur = await sheetOf();
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet, expectedVersion: cur.version ?? 0 })).status).toBe(200);
  };
  /** A fresh turn for Sinna (the encounter economy forgets what she used). */
  const fresh = () => { const enc = st().sceneEncounters?.[scene.id]; if (enc?.economy) delete enc.economy[`pc-${sinna}`]; };
  const cast = (spellId: string, slotLevel: number, targets?: unknown[]) => (fresh(), turn(scene.id, { action: 'cast', tokenId: sinna, spellId, slotLevel, ...(targets ? { targets } : {}) }, 'hannah'));
  const self = { kind: 'pc', tokenId: '' };
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
    let hex = { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) };
    hex = setHeights(hex, [hexKey({ q: 2, r: -4 }), hexKey({ q: 3, r: -4 })], () => 3);
    const m: SceneMap = { ...meta, hex };
    scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: m })).body as { scene: SceneDefinition }).scene;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user('hannah').userId)!], requestId: crypto.randomUUID() });
    sinna = user('hannah').tokenIds[0];
    self.tokenId = sinna;
    me = ((await request('hannah', 'state')).body as PlayerPayload).scene!.motion!.tokens.find((t) => t.tokenId === sinna)!;
  });


  /** Sinna's turn (when initiative runs). */
  const sinnaTurn = () => { const e = st().sceneEncounters?.[scene.id]; if (e?.status === 'active') { const i = e.participants.findIndex((p) => p.id === `pc-${sinna}`); if (i >= 0) { e.turnIndex = i; e.turnSerial = (e.turnSerial ?? 0) + 1; e.blockDone = []; } } };

  const npcTurn = (id: string) => { const e = st().sceneEncounters?.[scene.id]; if (e?.status === 'active') { const i = e.participants.findIndex((p) => p.id === `npc-${id}`); if (i >= 0) { e.turnIndex = i; e.turnSerial = (e.turnSerial ?? 0) + 1; e.blockDone = []; } } };

  const at = (q: number, r: number) => hexCentre(scene.metadata as unknown as SceneMap, { q, r });

  it('a goblin jumps down a 15-ft cliff: 1d6 and prone', async () => {
    await saveSheet(druid());
    const a = at(3, -4);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: a.x, y: a.y })).status).toBe(200);
    const g = enemiesOf(st(), scene.id)[0];
    Object.assign(g, { hp: 200, maxHp: 200 });
    npcTurn(g.id);
    const b = at(4, -4);
    const r = await turn(scene.id, { action: 'enemyMove', id: g.id, x: b.x, y: b.y });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { message: string }).message).toMatch(/falls 15 ft \(jumps down a cliff\): \d+ bludgeoning damage \(1d6\)/);
    expect(effectsOf(st(), scene.id, `npc-${g.id}`).some((e) => e.key === 'prone')).toBe(true);
  });

  it('an orc shoves a goblin over the edge; a shove can knock prone', async () => {
    await saveSheet(druid());
    const a = at(2, -4), b = at(3, -4);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc', x: a.x, y: a.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: b.x, y: b.y })).status).toBe(200);
    const [orc, gob] = enemiesOf(st(), scene.id);
    Object.assign(orc, { abilities: { ...orc.abilities!, str: 60 } });
    Object.assign(gob, { hp: 200, maxHp: 200 });
    npcTurn(orc.id);
    const r = await turn(scene.id, { action: 'shove', attacker: { kind: 'npc', id: orc.id }, target: { kind: 'npc', id: gob.id }, mode: 'push' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const msg = (r.body as { message: string }).message;
    expect(msg).toMatch(/shoves Goblin 1 \(push 5 ft\).*→ success\. Goblin 1 is pushed 5 ft – over the edge!/);
    expect(msg).toMatch(/falls 15 ft \(pushed over the edge\)/);
    const moved = enemiesOf(st(), scene.id).find((e) => e.id === gob.id)!;
    const sm = scene.metadata as unknown as SceneMap;
    expect(hexKey(hexAt(sm, moved))).toBe(hexKey({ q: 4, r: -4 }));
    // from the cliff top it can't reach the goblin 15 ft below any more (3D distance)
    npcTurn(orc.id);
    const far = await turn(scene.id, { action: 'shove', attacker: { kind: 'npc', id: orc.id }, target: { kind: 'npc', id: gob.id }, mode: 'prone' });
    expect(far.status).toBe(422);
  });

  it('a shove knocks prone on flat ground; a prone flyer would fall', async () => {
    await saveSheet(druid());
    const a = at(-3, 3), b = at(-2, 3);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc', x: a.x, y: a.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: b.x, y: b.y })).status).toBe(200);
    const [orc, gob] = enemiesOf(st(), scene.id);
    Object.assign(orc, { abilities: { ...orc.abilities!, str: 60 } });
    npcTurn(orc.id);
    const r = await turn(scene.id, { action: 'shove', attacker: { kind: 'npc', id: orc.id }, target: { kind: 'npc', id: gob.id }, mode: 'prone' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `npc-${gob.id}`).some((e) => e.key === 'prone')).toBe(true);
  });

  it('a shove needs the target within 5 ft', async () => {
    await saveSheet(druid());
    const a = at(2, -4);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc', x: a.x, y: a.y })).status).toBe(200);
    const [orc] = enemiesOf(st(), scene.id);
    npcTurn(orc.id);
    const r = await turn(scene.id, { action: 'shove', attacker: { kind: 'npc', id: orc.id }, target: { kind: 'pc', tokenId: sinna }, mode: 'push' });
    expect(r.status).toBe(422);
  });
});
