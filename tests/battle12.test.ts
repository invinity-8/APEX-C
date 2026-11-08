/**
 * APEX 1.2 battle maps: stat blocks / enemy library, NPC attacks (multiattack, ranged, spell), NPC area abilities,
 * player area spells aimed at a point, weapon set II, area geometry.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyMap, type SceneMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexSceneMap, paintHexes } from '../src/campaign/hexScene';
import { areaHexes, parseArea } from '../src/campaign/hexArea';
import { BUILTIN_BESTIARY, bestiary, parseStatBlock, saveBonus } from '../src/game/bestiary';
import { executeCommand } from '../src/game/commands';
import { addEnemy, npcAttacks, npcReach } from '../src/game/sceneCombat';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { combatAttacks } from '../src/game/effectiveStats';
import { baseItem } from '../src/game/items/bases';
import { createItem } from '../src/game/items/instance';
import { seededRng } from '../src/game/items/generate';
import { activate, seedProfiles } from './seed';

describe('areas of effect', () => {
  const map = (): SceneMap => hexSceneMap(emptyMap('battle'), encodeTiles(8, 'battle', () => 'stone'));
  it('reads spell areas and covers the right hexes; walls stop the effect', () => {
    expect(parseArea('Self (15-foot cone)')).toEqual({ shape: 'cone', sizeFt: 15, fromSelf: true });
    expect(parseArea('each creature in a 20-foot-radius sphere centered on that point')).toEqual({ shape: 'sphere', sizeFt: 20 });
    expect(parseArea('a line 100 feet long and 5 feet wide')).toEqual({ shape: 'line', sizeFt: 100 });
    expect(parseArea('Make a ranged spell attack')).toBeNull();
    const m = map();
    const c = (q: number, r: number) => hexCentre(m, { q, r });
    expect(areaHexes(m, c(0, 0), c(0, 0), { shape: 'sphere', sizeFt: 20 })).toHaveLength(61); // radius 4
    const cone = areaHexes(m, c(0, 0), c(3, 0), { shape: 'cone', sizeFt: 15 });
    expect(cone).toContain('1,0');
    expect(cone).toContain('3,0');
    expect(cone).not.toContain('0,0');
    expect(cone).not.toContain('-1,0');
    const line = areaHexes(m, c(0, 0), c(5, 0), { shape: 'line', sizeFt: 30 });
    expect(line).toEqual(['1,0', '2,0', '3,0', '4,0', '5,0', '6,0'].filter((k) => line.includes(k)));
    expect(line).toHaveLength(6);
    m.hex = paintHexes(m.hex!, ['2,0', '2,-1', '1,1', '2,1'], 'wall');
    expect(areaHexes(m, c(0, 0), c(0, 0), { shape: 'sphere', sizeFt: 20 })).not.toContain('3,0'); // behind the wall
  });
});

describe('enemy library', () => {
  it('built-in SRD stat blocks: multiattack, ranged attacks, saves, an elite', () => {
    const bear = BUILTIN_BESTIARY.find((b) => b.id === 'bear')!;
    expect(bear.multiattack).toBe(2);
    expect(BUILTIN_BESTIARY.find((b) => b.id === 'goblin')!.attacks.map((a) => a.kind)).toEqual(['melee', 'ranged']);
    expect(saveBonus(bear, 'str')).toBe(4);
    expect(BUILTIN_BESTIARY.find((b) => b.elite)).toMatchObject({ name: 'Orc Bloodcaller', areas: expect.arrayContaining([expect.objectContaining({ shape: 'cone' }), expect.objectContaining({ condition: 'restrained' })]) });
  });

  it('the GM saves own creatures and elites; built-ins can be overridden per campaign', () => {
    let s = createDemoState({ radius: 6, seed: 2 });
    const grak = { ...structuredClone(BUILTIN_BESTIARY.find((b) => b.id === 'orc')!), id: 'grak', name: 'Grak', title: 'the White', elite: true, hp: 60 };
    expect(parseStatBlock({ ...grak, attacks: [{ name: 'X', kind: 'melee', bonus: 99, damage: '1d6', damageType: 's', reachFt: 5 }] })).toMatchObject({ ok: false });
    expect(executeCommand(s, { role: 'player', tokenId: 'sinna' }, { type: 'enemyLibrarySave', block: grak })).toMatchObject({ ok: false });
    let r = executeCommand(s, { role: 'gm' }, { type: 'enemyLibrarySave', block: grak });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(bestiary(s).find((b) => b.id === 'grak')).toMatchObject({ elite: true, source: 'custom' });
    const placed = addEnemy(s, 'scene', 'e1', 'grak', { x: 1, y: 1 }, undefined, null);
    if (!placed.ok) throw new Error();
    expect(placed.state.sceneEnemies!.scene[0]).toMatchObject({ name: 'Grak the White', elite: true, hp: 60 });
    r = executeCommand(s, { role: 'gm' }, { type: 'enemyLibrarySave', block: { ...structuredClone(BUILTIN_BESTIARY[0]), hp: 99 } });
    if (!r.ok) throw new Error(r.error);
    expect(bestiary(r.state).find((b) => b.id === 'goblin')!.hp).toBe(99);
    r = executeCommand(r.state, { role: 'gm' }, { type: 'enemyLibraryRemove', id: 'goblin' });
    if (!r.ok) throw new Error(r.error);
    expect(bestiary(r.state).find((b) => b.id === 'goblin')!.hp).toBe(7);
  });

  it('weapon set II is offered after the active attacks and marked for switching', () => {
    const items = [
      { ...createItem(baseItem('srd-longsword')!, { id: 'sw', rarity: 'normal', itemLevel: 1, rng: seededRng(1) }), container: 'backpack' },
      { ...createItem(baseItem('srd-longbow')!, { id: 'bow', rarity: 'normal', itemLevel: 1, rng: seededRng(1) }), container: 'backpack' },
    ];
    const sh = { ...emptySheet(), attributes: [{ id: 's', name: 'Strength', value: '14', modifier: '' }, { id: 'd', name: 'Dexterity', value: '16', modifier: '' }], combat: [{ id: 'pb', label: 'Proficiency bonus', value: '+2' }] };
    const list = combatAttacks(sh, { inventory: items, equipment: { slots: { main1: 'sw', main2: 'bow' }, activeSet: 1, resting: false, restingKeep: [] } });
    expect(list.map((a) => a.name)).toEqual(['Longsword (equipped)', 'Longbow (set II)']);
    expect(list[1]).toMatchObject({ otherSet: true, range: '80/320 ft', bonus: '+5' });
  });

  it('older saved enemies (single attack) still work', () => {
    const old = { attack: { name: 'Bite', bonus: 4, damage: '2d4+2', reachFt: 5 } };
    expect(npcAttacks(old)).toMatchObject([{ name: 'Bite', kind: 'melee' }]);
    expect(npcReach({ attack: { name: 'Glaive', bonus: 4, damage: '1d10', reachFt: 10 } })).toBe(10);
  });
});

describe('API: NPC actions, area spells, weapon sets', () => {
  const cid = 'campaign-b12';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.14', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
  });

  it('bear multiattack, elite area ability, a fireball at a point, weapon set II', async () => {
    const created = (await request('gm', 'scenes', { name: 'Fight', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const m: SceneMap = { ...meta, hex: { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) } };
    const scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: m })).body as { scene: SceneDefinition }).scene;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user('hannah').userId)!], requestId: crypto.randomUUID() });
    const sinna = user('hannah').tokenIds[0];
    const sheet: CharacterSheet = {
      ...emptySheet(), hitPoints: { current: 200, max: 200, temp: 0 }, combat: [{ id: 'ac', label: 'Armor Class', value: '1' }],
      saves: [{ id: 'sv', name: 'Dexterity', value: '-20', proficient: false }],
      spellcasting: [{ id: 'dc', label: 'Spell save DC', value: '30' }], resources: [{ id: 'r3', name: 'Spell slots (level 3)', current: 1, max: 1 }],
      spells: [{ id: 'fireball', name: 'Fireball', level: 3, prepared: true, source: '', notes: '', school: '', castingTime: '1 action', range: '150 feet', components: '', duration: '', concentration: false, ritual: false, description: 'Each creature in a 20-foot-radius sphere centered on that point must make a Dexterity saving throw. A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one.' }],
    };
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet, expectedVersion: 0 })).status).toBe(200);
    const view = async () => ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    const me = (await view()).motion!.tokens.find((t) => t.tokenId === sinna)!;
    const step = Math.sqrt(3) * 30;
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'bear', x: me.x + step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc-bloodcaller', x: me.x + 8 * step, y: me.y })).status).toBe(200);
    const st = () => repo.states.get(cid)!.state;
    const [bear, shaman] = st().sceneEnemies![scene.id];
    expect(shaman).toMatchObject({ name: 'Orc Bloodcaller', elite: true });
    const e = () => st().sceneEncounters![scene.id];
    const toTurn = async (id: string) => { for (let i = 0; i < 10 && e().participants[e().turnIndex].id !== id; i++) await turn(scene.id, { action: 'endTurn', encounterId: e().id, turnSerial: e().turnSerial }); };

    // the bear attacks twice (Multiattack), a third attack is refused
    await toTurn(`npc-${bear.id}`);
    for (const i of [0, 1]) expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: bear.id }, target: { kind: 'pc', tokenId: sinna }, attackIndex: i })).status).toBe(200);
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: bear.id }, target: { kind: 'pc', tokenId: sinna }, attackIndex: 0 })).status).toBe(409);
    expect(st().sceneCombatLog![scene.id].slice(-2).map((l) => l.text.split(' with ')[1].split(':')[0])).toEqual(['Claws', 'Bite']);

    // the shaman's spell attack reaches 120 ft; its Burning howl (cone) hits Sinna only when she is in it
    await toTurn(`npc-${shaman.id}`);
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: shaman.id }, target: { kind: 'pc', tokenId: sinna }, attackIndex: 0 })).status).toBe(422); // staff: out of reach
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: shaman.id }, target: { kind: 'pc', tokenId: sinna }, attackIndex: 1 })).status).toBe(200);
    expect(st().sceneCombatLog![scene.id].at(-1)!.text).toMatch(/Orc Bloodcaller attacks Sinna with Blood flame/);
    await toTurn(`npc-${bear.id}`);
    await toTurn(`npc-${shaman.id}`);
    const howl = await turn(scene.id, { action: 'npcArea', id: shaman.id, area: 0, point: { x: me.x, y: me.y } });
    expect(howl.status).toBe(200);
    expect((howl.body as { message: string }).message).toMatch(/Burning howl.*Nobody is in the area/); // 15-ft cone, Sinna is 40 ft away

    // Sinna's turn: Fireball at the bear's hex (DC 30): the bear saves badly or well – either way it takes damage
    await toTurn(`pc-${sinna}`);
    const before = st().sceneEnemies![scene.id].find((x) => x.id === bear.id)!.hp;
    const fb = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'fireball', slotLevel: 3, point: { x: me.x + 2 * step, y: me.y } }, 'hannah');
    expect(fb.status, JSON.stringify(fb.body)).toBe(200);
    const msg = (fb.body as { message: string }).message;
    expect(msg).toMatch(/Fireball.*20-ft sphere, DC 30 Dexterity save/);
    expect(msg).toMatch(/Brown bear 1: d20/);
    expect(msg).toMatch(/Sinna: d20 \d+ − 20/); // the caster stands in her own fireball
    expect(st().sceneEnemies![scene.id].find((x) => x.id === bear.id)!.hp).toBeLessThan(before);
    expect(((await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload).sheet.resources[0].current).toBe(0);
    expect((await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'fireball', slotLevel: 3, point: { x: me.x + 40 * step, y: me.y } }, 'hannah')).status).toBe(422); // out of range / no slot
  });
});
