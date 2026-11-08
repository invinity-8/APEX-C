/**
 * Tile library, colour schemes, arrival area, carried light, generic enemies and simple attacks.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyMap, parseMap, type SceneMap } from '../src/campaign/maps';
import { TILESETS, encodeTiles, hexCentre, hexSceneMap, paintHexes, spawnSlots, tileDef } from '../src/campaign/hexScene';
import { gradientMap, validPalette, PALETTE_PRESETS } from '../src/campaign/palette';
import { sceneVision } from '../src/campaign/hexVision';
import { ENEMY_TEMPLATES, addEnemy, parseBonus, parseDamage, parseRangeFt, resolveAttack, updateEnemy } from '../src/game/sceneCombat';
import { joinInitiative } from '../src/game/sceneTurns';
import { hexKey } from '../src/game/hex';
import { emptySheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition, SceneSummary } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

describe('tile library and colour schemes', () => {
  it('offers 30+ tiles per scale with unique codes, groups, and movement/sight rules', () => {
    for (const set of ['region', 'battle'] as const) {
      const tiles = TILESETS[set];
      expect(tiles.length).toBeGreaterThanOrEqual(40);
      expect(new Set(tiles.map((t) => t.code)).size).toBe(tiles.length);
      expect(new Set(tiles.map((t) => t.group)).size).toBeGreaterThanOrEqual(6);
    }
    expect(tileDef('battle', 'door')).toMatchObject({ cost: 1, blocksSight: true });
    expect(tileDef('battle', 'fence')).toMatchObject({ cost: null, blocksSight: false });
    expect(tileDef('battle', 'campfire')?.light).toBe(20);
    expect(tileDef('region', 'dunes')?.cost).toBe(3);
    const map = hexSceneMap(emptyMap('battle'), encodeTiles(4, 'battle', () => 'marble'));
    map.hex = paintHexes(map.hex!, ['1,0'], 'crates');
    expect(parseMap(JSON.parse(JSON.stringify(map)))?.hex).toEqual(map.hex);
  });

  it('recolours by brightness (gradient map) and validates schemes', () => {
    const mesa = PALETTE_PRESETS.find((p) => p.id === 'mesa')!.palette;
    const f = gradientMap({ ...mesa, strength: 1 });
    const dark = f([20, 30, 20]), light = f([230, 230, 220]);
    expect(dark[0]).toBeGreaterThan(dark[2]); // reddish
    expect(light[0] + light[1]).toBeGreaterThan(dark[0] + dark[1]); // keeps the brightness order
    expect(gradientMap({ ...mesa, strength: 0 })([10, 20, 30])).toEqual([10, 20, 30]);
    expect(validPalette({ colors: ['#ff0000'], strength: 0.5 })).toBe(false);
    expect(validPalette({ colors: ['#ff0000', 'red'], strength: 0.5 })).toBe(false);
    expect(parseMap({ ...emptyMap('region'), palette: mesa })?.palette).toEqual(mesa);
  });
});

describe('arrival area, light, enemies', () => {
  const map = (): SceneMap => hexSceneMap(emptyMap('battle'), encodeTiles(6, 'battle', () => 'stone'));
  it('16 distinct passable arrival hexes around the spawn, skipping walls', () => {
    const m = map();
    m.hex = paintHexes(m.hex!, ['1,0', '0,1'], 'wall');
    const slots = spawnSlots(m, hexCentre(m, { q: 0, r: 0 }));
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map(hexKey)).size).toBe(16);
    expect(slots.map(hexKey)).not.toContain('1,0');
    expect(hexKey(slots[0])).toBe('0,0');
  });

  it('glowing tiles and carried torches light the dark', () => {
    const m = map();
    const at = hexCentre(m, { q: 0, r: 0 });
    const dark = { day: 1, phase: 'day' as const, lighting: 'dark' as const, version: 0 };
    const blind = sceneVision(m, dark, [{ at, darkvisionFt: 0 }]);
    expect(blind.has('3,0')).toBe(false);
    const torch = sceneVision(m, dark, [{ at, darkvisionFt: 0 }], [{ ...at, ft: 40 }]);
    expect(torch.has('3,0')).toBe(true);
    expect(torch.has('8,0')).toBe(false);
    m.hex = paintHexes(m.hex!, ['5,0'], 'campfire');
    expect(sceneVision(m, dark, [{ at, darkvisionFt: 0 }]).has('5,1')).toBe(true);
  });

  it('dice text, attack resolution, enemies in initiative and defeat', () => {
    expect(parseDamage('1d8+3 slashing')).toEqual({ count: 1, sides: 8, mod: 3 });
    expect(parseDamage('2d6 − 1')).toEqual({ count: 2, sides: 6, mod: -1 });
    expect(parseBonus('+5 to hit')).toBe(5);
    expect(parseRangeFt('80/320 ft.')).toEqual({ reachFt: 5, rangeFt: 80 });
    expect(parseRangeFt('Reach 10 ft')).toEqual({ reachFt: 10 });
    const seq = [20, 4, 6];
    const crit = resolveAttack('A', 'B', 'Sword', 5, { count: 1, sides: 8, mod: 3 }, 30, () => seq.shift()!);
    expect(crit).toMatchObject({ crit: true, hit: true, damage: 13 });
    expect(resolveAttack('A', 'B', 'Sword', 5, { count: 1, sides: 8, mod: 3 }, 12, () => 1)).toMatchObject({ hit: false });
    let s = createDemoState({ radius: 6, seed: 1 });
    const pc = Object.keys(s.tokens).find((id) => s.tokens[id].kind === 'player')!;
    let r = joinInitiative(s, 'scene', 'enc', [{ tokenId: pc, name: 'PC', roll: 10, bonus: 0 }]); if (!r.ok) throw new Error(); s = r.state;
    r = addEnemy(s, 'scene', 'en-1', 'goblin', { x: 1, y: 1 }, undefined, 15); if (!r.ok) throw new Error(); s = r.state;
    expect(s.sceneEncounters!.scene.participants.map((p) => p.id)).toEqual(['npc-en-1', `pc-${pc}`]);
    expect(s.sceneEncounters!.scene.participants[s.sceneEncounters!.scene.turnIndex].tokenId).toBe(pc); // active turn unchanged
    r = updateEnemy(s, 'scene', 'en-1', { hpDelta: -50 }); if (!r.ok) throw new Error(); s = r.state;
    expect(s.sceneEnemies!.scene[0]).toMatchObject({ hp: 0, defeated: true });
    expect(s.sceneEncounters!.scene.participants.map((p) => p.id)).toEqual([`pc-${pc}`]);
    expect(ENEMY_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('API: enemies, attacks, torches, library preview', () => {
  const cid = 'campaign-combat';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.12', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah', 'jean']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
  });

  it('GM places a goblin; the player sees it only in sight, attacks once on their turn, the goblin hits back', async () => {
    const created = (await request('gm', 'scenes', { name: 'Fight', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const m: SceneMap = { ...meta, palette: PALETTE_PRESETS[0].palette, hex: { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) } };
    const scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: m })).body as { scene: SceneDefinition }).scene;
    // Library preview data: tiles + colour scheme of the draft.
    const list = ((await request('gm', 'scenes', undefined, { archived: '0' })).body as { scenes: SceneSummary[] }).scenes.find((s) => s.id === scene.id)!;
    expect(list.hex?.terrain).toBe(m.hex!.terrain);
    expect(list.palette).toEqual(m.palette);
    // Only Hannah enters.
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    const hannahRow = ps.find((p) => p.userId === user('hannah').userId)!;
    expect((await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [hannahRow], requestId: crypto.randomUUID() })).status).toBe(200);
    const sinna = user('hannah').tokenIds[0];
    const me = ((await request('hannah', 'state')).body as PlayerPayload).scene!.motion!.tokens.find((t) => t.tokenId === sinna)!;
    const step = Math.sqrt(3) * 30;
    // Placing on the character's hex is refused; next to it works.
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x, y: me.y })).status).toBe(409);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'dragon', x: me.x + 2 * step, y: me.y })).status).toBe(400);
    const goblin = repo.states.get(cid)!.state.sceneEnemies![scene.id][0];
    expect(goblin).toMatchObject({ name: 'Goblin 1', hp: 7, ac: 15 });
    // The goblin joined the running initiative.
    expect(repo.states.get(cid)!.state.sceneEncounters![scene.id].participants.map((p) => p.id)).toContain(`npc-${goblin.id}`);
    // Players see the goblin (bright light, in sight) but not its HP.
    let view = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    const seenGoblin = view.figures!.find((f) => f.kind === 'enemy')!;
    expect(seenGoblin).toMatchObject({ name: 'Goblin 1', condition: 'healthy' });
    expect(seenGoblin.hp).toBeUndefined();
    // In darkness without darkvision or a torch, the goblin next to you is still visible (adjacent) – one further away is not.
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'wolf', x: me.x - 4 * step, y: me.y })).status).toBe(200);
    await turn(scene.id, { action: 'clock', expectedVersion: 0, lighting: 'dark' });
    view = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    expect(view.figures!.filter((f) => f.kind === 'enemy').map((f) => f.name)).toEqual(['Goblin 1']);
    // Lighting a torch reveals the wolf.
    expect((await turn(scene.id, { action: 'torch', tokenId: sinna, on: true }, 'hannah')).status).toBe(200);
    expect((await turn(scene.id, { action: 'torch', tokenId: user('jean').tokenIds[0], on: true }, 'hannah')).status).toBe(403);
    view = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    expect(view.torch).toBe(true);
    expect(view.figures!.filter((f) => f.kind === 'enemy').map((f) => f.name).sort()).toEqual(['Goblin 1', 'Wolf 1']);
    // Attack with the sheet's weapon – on Hannah's turn, once.
    const sheet = { ...emptySheet(), hitPoints: { current: 20, max: 20, temp: 0 }, combat: [{ id: 'ac', label: 'Armor Class', value: '1' }], attacks: [{ id: 'a1', name: 'Quarterstaff', bonus: '+30', damage: '1d6+20', range: '5 ft.', notes: '' }, { id: 'a2', name: 'Shrug', bonus: '', damage: '', range: '', notes: '' }] };
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet, expectedVersion: 0 })).status).toBe(200);
    const enc = () => repo.states.get(cid)!.state.sceneEncounters![scene.id];
    while (enc().participants[enc().turnIndex].tokenId !== sinna) await turn(scene.id, { action: 'endTurn', encounterId: enc().id, turnSerial: enc().turnSerial });
    const wolf = repo.states.get(cid)!.state.sceneEnemies![scene.id][1];
    expect((await turn(scene.id, { action: 'attack', tokenId: sinna, enemyId: wolf.id, attackIndex: 0 }, 'hannah')).status).toBe(422); // out of reach
    expect((await turn(scene.id, { action: 'attack', tokenId: sinna, enemyId: goblin.id, attackIndex: 1 }, 'hannah')).status).toBe(422); // unreadable
    const hit = await turn(scene.id, { action: 'attack', tokenId: sinna, enemyId: goblin.id, attackIndex: 0 }, 'hannah');
    expect(hit.status).toBe(200);
    const after = repo.states.get(cid)!.state.sceneEnemies![scene.id][0];
    expect(after.hp < 7 || /natural 1/.test((hit.body as { message: string }).message)).toBe(true);
    expect((await turn(scene.id, { action: 'attack', tokenId: sinna, enemyId: goblin.id, attackIndex: 0 }, 'hannah')).status).toBe(409); // once per turn
    expect(repo.states.get(cid)!.state.sceneCombatLog![scene.id].at(-1)!.text).toMatch(/Sinna attacks Goblin 1 with Quarterstaff: d20/);
    // A living goblin attacks Sinna (AC 1): the sheet loses HP.
    if (!after.defeated) {
      const r = await turn(scene.id, { action: 'enemyAttack', id: goblin.id, tokenId: sinna });
      expect(r.status).toBe(200);
      const hp = ((await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload).sheet.hitPoints!.current;
      expect(hp <= 20).toBe(true);
    }
    expect((await turn(scene.id, { action: 'enemyHp', id: goblin.id, delta: -99 }, 'hannah')).status).toBe(403);
    expect((await turn(scene.id, { action: 'enemyRemove', id: wolf.id })).status).toBe(200);
  });
});
