/**
 * APEX 1.9 (3D stage 2): flying creatures and altitude, the Fly spell, falling, climbing speed, 3D reach and
 * Fireball spheres in the air.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { emptyMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexMovementCost, hexSceneMap, setHeights } from '../src/campaign/hexScene';
import { hexKey } from '../src/game/hex';
import { altitudeOf, distance3d, fallDice, pcSpeeds } from '../src/game/altitude';
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
const druid = (): CharacterSheet => ({
  ...emptySheet(),
  details: [{ id: 'c', label: 'Race, class & level', value: 'Wizard 5' }],
  attributes: [{ id: 'i', name: 'Intelligence', value: '18', modifier: '+4' }, { id: 'd', name: 'Dexterity', value: '14', modifier: '+2' }],
  combat: [{ id: 'p', label: 'Proficiency bonus', value: '+3' }, { id: 's', label: 'Speed (walking)', value: '30ft.' }],
  hitPoints: { current: 30, max: 30, temp: 0 },
  spellcasting: [{ id: 'a', label: 'Spell attack bonus', value: '+7' }, { id: 'd', label: 'Spell save DC', value: '15' }],
  resources: [{ id: 'r3', name: 'Spell slots (level 3)', current: 3, max: 3 }],
  attacks: [{ id: 'q', name: 'Quarterstaff', bonus: '+5', damage: '1d6+2 bludgeoning', range: '5 ft', notes: '' }, { id: 'c', name: 'Light crossbow', bonus: '+5', damage: '1d8+2 piercing', range: '80/320 ft.', notes: '' }],
  spells: [bare('Fly', 3), bare('Fireball', 3)],
});

describe('rules', () => {
  it('3D distance, fall damage, speeds from sheet, beast and Fly', () => {
    expect(distance3d(5, 0, 20)).toBe(20);
    expect(distance3d(30, 0, 10)).toBe(30);
    expect(fallDice(5)).toBeNull();
    expect(fallDice(25)).toBe('2d6');
    expect(fallDice(500)).toBe('20d6');
    const climber = { ...emptySheet(), combat: [{ id: 'c', label: 'Speed (climbing)', value: '30ft.' }] };
    expect(pcSpeeds(climber)).toMatchObject({ fly: 0, climb: 30 });
    expect(pcSpeeds(emptySheet(), null, [{ mods: { fly: 60 } }])).toMatchObject({ fly: 60, flySource: 'spell' });
    expect(pcSpeeds({ ...emptySheet(), wildShape: { formId: 'x', formName: 'Eagle', hp: 3, maxHp: 3, since: '' } }, { speed: { fly: 60 } })).toMatchObject({ fly: 60, flySource: 'speed' });
  });

  it('climbing speed takes cliffs, flying ignores them', () => {
    let hex = hexSceneMap(emptyMap('battle'), encodeTiles(6, 'battle', () => 'grass')).hex!;
    hex = setHeights(hex, [hexKey({ q: 2, r: 0 })], () => 3);
    const m: SceneMap = { ...hexSceneMap(emptyMap('battle'), encodeTiles(6, 'battle', () => 'grass')), hex };
    const a = hexCentre(m, { q: 0, r: 0 }), b = hexCentre(m, { q: 2, r: 0 });
    expect(hexMovementCost(m, a, b).ok).toBe(false);
    expect(hexMovementCost(m, a, b, { climb: true })).toMatchObject({ ok: true, cost: 10 });
    expect(hexMovementCost(m, a, b, { fly: true })).toMatchObject({ ok: true, cost: 10 });
  });
});

describe('API: flying, falling, 3D reach, spheres in the air', () => {
  const cid = 'campaign-b19';
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
    const m: SceneMap = { ...meta, hex: { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) } };
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

  it('a giant bat flies up, is out of melee reach, falls when knocked prone; a goblin cannot fly', async () => {
    await saveSheet(druid());
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'giant-bat', x: me.x + 2 * step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x - 3 * step, y: me.y })).status).toBe(200);
    const [bat, goblin] = enemiesOf(st(), scene.id);
    Object.assign(bat, { hp: 200, maxHp: 200 });
    npcTurn(bat.id);
    const up = await turn(scene.id, { action: 'enemyMove', id: bat.id, x: me.x + step, y: me.y, alt: 20 });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect((up.body as { message: string }).message).toMatch(/flies 21 ft \(20 ft above the ground\)/) // APEX 2.6: slanted √(5² + 20²);
    expect(altitudeOf(st(), scene.id, `npc-${bat.id}`)).toBe(20);
    const snap = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    expect(snap.figures?.find((f) => f.id === bat.id)?.alt).toBe(20);
    // Sinna's staff can't reach 20 ft up; her crossbow can
    sinnaTurn(); fresh();
    const melee = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: bat.id }, attackIndex: 0 }, 'hannah');
    expect(melee.status).toBe(422);
    fresh();
    const shot = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: bat.id }, attackIndex: 1 }, 'hannah');
    expect(shot.status, JSON.stringify(shot.body)).toBe(200);
    // knocked prone in the air: it falls 20 ft (2d6) and lands prone
    const prone = await turn(scene.id, { action: 'condition', target: { kind: 'npc', id: bat.id }, condition: 'prone', add: true });
    expect((prone.body as { message: string }).message).toMatch(/falls 20 ft \(knocked prone\): \d+ bludgeoning damage \(2d6\) and lands prone/);
    expect(altitudeOf(st(), scene.id, `npc-${bat.id}`)).toBe(0);
    npcTurn(goblin.id);
    const g = await turn(scene.id, { action: 'enemyMove', id: goblin.id, x: me.x - 2 * step, y: me.y, alt: 10 });
    expect(g.status).toBe(422);
    expect((g.body as { error: string }).error).toMatch(/cannot fly/);
  });

  it('Fly lets a character take off; when the spell ends she falls', async () => {
    await saveSheet(druid());
    sinnaTurn();
    expect((await cast('fly', 3, [self])).status).toBe(200);
    const mv0 = ((await request('hannah', 'state')).body as PlayerPayload).scene!.movement!;
    expect(mv0.fly).toBe(60);
    const st0 = (await request('hannah', 'state')).body as PlayerPayload;
    const motion = st0.scene!.motion!;
    const tok = motion.tokens.find((t) => t.tokenId === sinna)!;
    const r = await request('hannah', 'scene-motion', { action: 'move', sceneId: scene.id, tokenId: sinna, x: me.x + step, y: me.y, alt: 15, sceneRevision: st0.scene!.scene!.revision, assignmentRevision: st0.scene!.assignmentRevision, tokenVersion: tok.version, epoch: 0, requestId: crypto.randomUUID() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(altitudeOf(st(), scene.id, `pc-${sinna}`)).toBe(15);
    expect((r.body as { spent: number }).spent).toBe(16); // APEX 2.6: slanted √(5² + 15²) ≈ 16 ft
    const fly = effectsOf(st(), scene.id, `pc-${sinna}`).find((e) => e.key === 'fly')!;
    const end = await turn(scene.id, { action: 'condition', target: self, effectId: fly.id, add: false });
    expect((end.body as { message: string }).message).toMatch(/falls 15 ft \(the flight spell ended\): \d+ bludgeoning damage \(1d6\)/);
    expect(altitudeOf(st(), scene.id, `pc-${sinna}`)).toBe(0);
    expect((await sheetOf()).sheet!.hitPoints!.current).toBeLessThan(30);
  });

  it('a Fireball centred 40 ft up hits the bat up there, not the goblin below', async () => {
    await saveSheet(druid());
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'giant-bat', x: me.x + 6 * step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 7 * step, y: me.y })).status).toBe(200);
    const [bat] = enemiesOf(st(), scene.id);
    for (const e of enemiesOf(st(), scene.id)) Object.assign(e, { hp: 200, maxHp: 200 });
    npcTurn(bat.id);
    expect((await turn(scene.id, { action: 'enemyMove', id: bat.id, x: me.x + 6 * step, y: me.y, alt: 40 })).status).toBe(200);
    sinnaTurn();
    const fb = await cast('fireball', 3, undefined);
    void fb;
    fresh();
    const r = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'fireball', slotLevel: 3, point: { x: me.x + 6 * step, y: me.y, alt: 40 } }, 'hannah');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const msg = (r.body as { message: string }).message;
    expect(msg).toMatch(/Giant bat 1: d20/);
    expect(msg).not.toMatch(/Goblin 1: d20/);
  });
});
