/**
 * APEX 1.4: turn blocks end per character, ranges like "120 ft", SRD spell mechanics for imported spells, ranged
 * attacks, hide / sneak / search with passive Perception, flanking, Sneak Attack on request, walking into reach.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyMap, type SceneMap } from '../src/campaign/maps';
import { encodeTiles, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { addEffect, attackMods, flanks, hiddenEffect, effectsOf } from '../src/game/combatEffects';
import { parseRangeFt } from '../src/game/sceneCombat';
import { characterLevel, planSpell, withSrdSpells } from '../src/game/sceneActions';
import { endTurn, joinInitiative } from '../src/game/sceneTurns';
import { approachHex } from '../src/components/pcInteraction';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import type { GameState } from '../src/game/types';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const bare = (name: string, level = 0) => ({ id: name.toLowerCase().replace(/ /g, '-'), name, level, prepared: true, source: '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });

describe('rules', () => {
  it('ranges with three digits are ranged; long range is read', () => {
    expect(parseRangeFt('120 ft.')).toEqual({ reachFt: 5, rangeFt: 120 });
    expect(parseRangeFt('Range 150 feet')).toEqual({ reachFt: 5, rangeFt: 150 });
    expect(parseRangeFt('80/320 ft.')).toEqual({ reachFt: 5, rangeFt: 80, longRangeFt: 320 });
    expect(parseRangeFt('5 ft.')).toEqual({ reachFt: 5 });
  });

  it('imported spells without details get SRD mechanics (Fire Bolt, Produce Flame, Healing Word, Fireball)', () => {
    const sheet = { ...emptySheet(), details: [{ id: 'c', label: 'Class & level', value: 'Wizard 5' }], resources: [{ id: 'r', name: 'Spell slots (level 3)', current: 1, max: 1 }], spells: [bare('Fire Bolt'), bare('Produce Flame'), bare('Healing Word', 1), bare('Fireball', 3)] } as CharacterSheet;
    expect(planSpell(sheet, 'fire-bolt', 0, characterLevel(sheet))).toMatchObject({ mode: 'attack', rangeFt: 120, damage: '2d10 fire' });
    expect(planSpell(sheet, 'produce-flame', 0, 1)).toMatchObject({ mode: 'attack', rangeFt: 30, damage: '1d8 fire' });
    expect(planSpell(sheet, 'fireball', 3)).toMatchObject({ mode: 'save', save: 'dexterity', rangeFt: 150, damage: '8d6 fire' });
    expect(withSrdSpells(sheet).spells.find((s) => s.name === 'Healing Word')).toMatchObject({ castingTime: '1 bonus action', range: '60 feet' });
  });

  it('hex flanking and its advantage', () => {
    expect(flanks({ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(flanks({ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: -1 })).toBe(false);
    expect(flanks({ q: -2, r: 0 }, { q: 0, r: 0 }, { q: 2, r: 0 })).toBe(false);
    const st = { sceneEffects: {} } as unknown as GameState;
    expect(attackMods(st, 's', { attacker: 'a', target: 't', melee: true, distanceFt: 5, flanking: true })).toMatchObject({ mode: 'adv', reasons: ['+ flanking'] });
    addEffect(st, 's', 'a', hiddenEffect(15, () => 'h'));
    expect(attackMods(st, 's', { attacker: 'a', target: 't', melee: true, distanceFt: 5 }).mode).toBe('adv');
  });

  it('a block ends only when each character ended its own part – also when the GM ends one figure', () => {
    let s = createDemoState({ radius: 6, seed: 1 });
    const [a, b] = Object.keys(s.tokens).filter((id) => s.tokens[id].kind === 'player');
    const r = joinInitiative(s, 'sc', 'enc', [{ tokenId: a, name: 'A', roll: 15, bonus: 0 }, { tokenId: b, name: 'B', roll: 10, bonus: 0 }]);
    if (!r.ok) throw new Error();
    s = r.state;
    s.sceneEncounters!.sc.participants.push({ id: 'npc-x', name: 'X', initiative: 1, visible: true });
    const gmEnd = endTurn(s, 'sc', 'enc', 1, () => true, false, `pc-${a}`);
    if (!gmEnd.ok) throw new Error(gmEnd.error);
    expect(gmEnd.state.sceneEncounters!.sc).toMatchObject({ turnIndex: 0, blockDone: [`pc-${a}`] });
    const second = endTurn(gmEnd.state, 'sc', 'enc', 1, (t) => t === b);
    if (!second.ok) throw new Error();
    expect(second.state.sceneEncounters!.sc.participants[second.state.sceneEncounters!.sc.turnIndex].id).toBe('npc-x');
  });

  it('walking into reach: the cheapest free hex next to the target', () => {
    const map: SceneMap = hexSceneMap(emptyMap('battle'), encodeTiles(6, 'battle', () => 'stone'));
    const c = (q: number, r: number) => hexCentre(map, { q, r });
    const spot = approachHex(map, c(0, 0), c(4, 0), 5, new Set(['3,0']), 30);
    expect(spot).not.toBeNull();
    expect(spot!.cost).toBe(20); // (3,0) is taken: a neighbour one step further
    expect(approachHex(map, c(0, 0), c(6, 0), 5, new Set(), 10)).toBeNull();
  });
});

describe('API: ranged attacks, hiding, Sneak Attack', () => {
  const cid = 'campaign-b14';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.16', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
  let sinna: string;
  let me: { x: number; y: number };
  const step = Math.sqrt(3) * 30;
  const e = () => st().sceneEncounters![scene.id];
  const toTurn = async (id: string) => { for (let i = 0; i < 12 && e().participants[e().turnIndex].id !== id; i++) await turn(scene.id, { action: 'endTurn', encounterId: e().id, turnSerial: e().turnSerial }); };
  const saveSheet = async (sheet: CharacterSheet) => {
    const cur = (await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload;
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet, expectedVersion: cur.version ?? 0 })).status).toBe(200);
  };
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
  });

  it('Fire Bolt from an imported spell list and a ranged weapon hit at range; too far is refused', async () => {
    await saveSheet({ ...emptySheet(), hitPoints: { current: 30, max: 30, temp: 0 }, details: [{ id: 'c', label: 'Class & level', value: 'Wizard 1' }], spellcasting: [{ id: 'a', label: 'Spell attack bonus', value: '+5' }], spells: [bare('Fire Bolt')], attacks: [{ id: 'x', name: 'Light crossbow', bonus: '+4', damage: '1d8+2 piercing', range: '80/320 ft.', notes: '' }] });
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 8 * step, y: me.y })).status).toBe(200);
    const goblin = st().sceneEnemies![scene.id][0];
    Object.assign(st().sceneEnemies![scene.id][0], { hp: 200, maxHp: 200 }); // survives every roll
    await toTurn(`pc-${sinna}`);
    const fb = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'fire-bolt', slotLevel: 0, targets: [{ kind: 'npc', id: goblin.id }] }, 'hannah');
    expect(fb.status, JSON.stringify(fb.body)).toBe(200);
    expect((fb.body as { message: string }).message).toMatch(/Sinna attacks Goblin 1 with Fire Bolt: d20/);
    await toTurn(`npc-${goblin.id}`);
    await toTurn(`pc-${sinna}`);
    const shot = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id }, attackIndex: 0 }, 'hannah');
    expect(shot.status, JSON.stringify(shot.body)).toBe(200);
    expect((shot.body as { message: string }).message).toMatch(/with Light crossbow/);
    // the goblin answers with its shortbow from 50 ft
    await toTurn(`npc-${goblin.id}`);
    const bow = await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: goblin.id }, target: { kind: 'pc', tokenId: sinna }, attackIndex: 1 });
    expect(bow.status, JSON.stringify(bow.body)).toBe(200);
  });

  it('hidden creatures: passive Perception decides who is seen; Search finds them; attacking reveals', async () => {
    await saveSheet({ ...emptySheet(), hitPoints: { current: 30, max: 30, temp: 0 }, skills: [{ id: 's', name: 'Stealth', value: '+40', proficient: true }, { id: 'p', name: 'Perception', value: '+0', proficient: false }], attacks: [{ id: 'x', name: 'Rapier', bonus: '+30', damage: '1d8+3 piercing', range: '5 ft.', notes: 'finesse' }] });
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 2 * step, y: me.y })).status).toBe(200);
    const goblin = st().sceneEnemies![scene.id][0];
    Object.assign(st().sceneEnemies![scene.id][0], { hp: 200, maxHp: 200 });
    await toTurn(`pc-${sinna}`);
    const hide = await turn(scene.id, { action: 'hide', actor: { kind: 'pc', tokenId: sinna } }, 'hannah');
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`)[0]).toMatchObject({ key: 'hidden' });
    // the goblin (passive Perception 9) does not see her in its own sight; the GM full view shows her
    const gv = (await request('gm', 'scene-runtime', undefined, { focus: scene.id, view: goblin.id })).body as SceneSnapshot;
    expect(gv.figures!.some((f) => f.kind === 'pc')).toBe(false);
    const all = (await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot;
    expect(all.figures!.find((f) => f.kind === 'pc')!.effects!.map((x) => x.key)).toEqual(['hidden']);
    // a hidden goblin (Stealth 25) is invisible to Sinna (passive 10); one at Stealth 5 is seen
    const s = st();
    addEffect(s, scene.id, `npc-${goblin.id}`, hiddenEffect(25, () => 'gh'));
    expect(((await request('hannah', 'state')).body as PlayerPayload).scene!.figures!.some((f) => f.id === goblin.id)).toBe(false);
    s.sceneEffects![scene.id][`npc-${goblin.id}`][0].value = 5;
    expect(((await request('hannah', 'state')).body as PlayerPayload).scene!.figures!.some((f) => f.id === goblin.id)).toBe(true);
    // the goblin searches on its turn (d20 + −1 vs 41+): it does not find her
    await toTurn(`npc-${goblin.id}`);
    const search = await turn(scene.id, { action: 'standard', actor: { kind: 'npc', id: goblin.id }, act: 'search' });
    expect((search.body as { message: string }).message).toMatch(/Goblin 1 searches: Perception d20 .* finds nothing/);
    // Sinna attacks from hiding: advantage, then she is revealed
    await toTurn(`pc-${sinna}`);
    const atk = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id }, attackIndex: 0 }, 'hannah');
    expect(atk.status, JSON.stringify(atk.body)).toBe(422); // two hexes away: out of reach
    const near = { x: me.x + step, y: me.y };
    const pos = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    const mv = await request('hannah', 'scene-motion', { action: 'move', requestId: crypto.randomUUID(), tokenId: sinna, tokenVersion: pos.motion!.tokens.find((t) => t.tokenId === sinna)!.version, sceneId: scene.id, sceneRevision: pos.scene!.revision, assignmentRevision: pos.assignmentRevision, epoch: 0, x: near.x, y: near.y });
    expect(mv.status, JSON.stringify(mv.body)).toBe(200);
    const atk2 = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id }, attackIndex: 0 }, 'hannah');
    expect(atk2.status, JSON.stringify(atk2.body)).toBe(200);
    expect((atk2.body as { message: string }).message).toMatch(/advantage/);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`)).toEqual([]);
  });

  it('Sneak Attack only when wanted; flanking with an ally gives advantage', async () => {
    await saveSheet({ ...emptySheet(), hitPoints: { current: 30, max: 30, temp: 0 }, details: [{ id: 'c', label: 'Class & level', value: 'Rogue 3' }], abilities: [{ id: 'sa', name: 'Sneak Attack', text: '' }], attacks: [{ id: 'x', name: 'Rapier', bonus: '+30', damage: '1d8+3 piercing', range: '5 ft.', notes: 'finesse' }] });
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'ogre', x: me.x + step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'thug', x: me.x + 2 * step, y: me.y, side: 'ally' })).status).toBe(200);
    const ogre = st().sceneEnemies![scene.id][0];
    Object.assign(st().sceneEnemies![scene.id][0], { hp: 500, maxHp: 500 });
    await toTurn(`pc-${sinna}`);
    const no = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: ogre.id }, attackIndex: 0, sneak: false }, 'hannah');
    expect(no.status).toBe(200);
    expect((no.body as { message: string }).message).toMatch(/flanking/);
    expect((no.body as { message: string }).message).not.toMatch(/Sneak Attack/);
    await toTurn(`npc-${ogre.id}`);
    await toTurn(`pc-${sinna}`);
    const yes = (await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: ogre.id }, attackIndex: 0 }, 'hannah')).body as { message: string };
    if (/ hit| CRITICAL/.test(yes.message)) expect(yes.message).toMatch(/\+\d+ Sneak Attack/);
  });
});
