/**
 * APEX 1.1 battle actions: turn economy, standard actions, opportunity attacks (reactions), spells with slots and
 * upcasting, allies, GM vision modes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { PALETTE_PRESETS } from '../src/campaign/palette';
import { attacksPerAction, budgetOf, opportunityOffers, planSpell, spellDamage, spellRangeFt, useEconomy, type Figure } from '../src/game/sceneActions';
import type { SceneEncounter } from '../src/game/types';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const enc = (over: Partial<SceneEncounter> = {}): SceneEncounter => ({ id: 'e', sceneId: 's', title: 'I', round: 1, turnIndex: 0, version: 1, turnSerial: 1, status: 'active', participants: [{ id: 'pc-a', name: 'A', initiative: 15, visible: true, tokenId: 'a' }, { id: 'npc-g', name: 'G', initiative: 10, visible: true }], ...over });

const spell = (o: Partial<CharacterSheet['spells'][number]>) => ({ id: 'x', name: 'X', level: 0, prepared: true, source: '', notes: '', school: '', castingTime: '1 action', range: '', components: '', duration: '', concentration: false, ritual: false, description: '', ...o });
const caster = (): CharacterSheet => ({
  ...emptySheet(),
  hitPoints: { current: 30, max: 30, temp: 0 },
  combat: [{ id: 'ac', label: 'Armor Class', value: '1' }],
  attacks: [{ id: 'a1', name: 'Quarterstaff', bonus: '+30', damage: '1d6+20', range: '5 ft.', notes: '' }],
  spellcasting: [{ id: 'sc1', label: 'Spell attack bonus', value: '+30' }, { id: 'sc2', label: 'Spell save DC', value: '13' }],
  resources: [{ id: 'r1', name: 'Spell slots (level 1)', current: 2, max: 2 }, { id: 'r2', name: 'Spell slots (level 2)', current: 1, max: 1 }],
  spells: [
    spell({ id: 'fb', name: 'Fire Bolt', level: 0, range: '120 feet', description: 'Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage. This spell’s damage increases by 1d10 when you reach 5th level.' }),
    spell({ id: 'bh', name: 'Burning Hands', level: 1, range: 'Self (15-foot cone)', description: 'Each creature in a 15-foot cone must make a Dexterity saving throw. A creature takes 3d6 fire damage on a failed save, or half as much damage on a successful one. At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d6 for each slot level above 1st.' }),
    spell({ id: 'sh', name: 'Shield', level: 1, castingTime: '1 reaction', range: 'Self' }),
    spell({ id: 'mm', name: 'Magic Missile', level: 1, prepared: false, range: '120 feet' }),
  ],
});

describe('turn economy and spells (rules)', () => {
  it('one action, one bonus action, Extra Attack, a reaction per round; new turns are fresh', () => {
    const e = enc();
    expect(useEconomy(e, 'pc-a', 'attack', { gm: false, attacksAllowed: 2 })).toBeNull();
    expect(useEconomy(e, 'pc-a', 'attack', { gm: false, attacksAllowed: 2 })).toBeNull();
    expect(useEconomy(e, 'pc-a', 'attack', { gm: false, attacksAllowed: 2 })).toMatch(/All 2 attacks/);
    expect(useEconomy(e, 'pc-a', 'action', { gm: false })).toMatch(/already used/);
    expect(useEconomy(e, 'pc-a', 'bonus', { gm: false })).toBeNull();
    expect(useEconomy(e, 'pc-a', 'bonus', { gm: false })).toMatch(/bonus action/);
    expect(useEconomy(e, 'npc-g', 'action', { gm: false })).toMatch(/Wait for your turn/);
    expect(useEconomy(e, 'npc-g', 'reaction', { gm: true })).toBeNull();
    expect(useEconomy(e, 'npc-g', 'reaction', { gm: true })).toMatch(/reaction/);
    e.turnSerial = 2; // next turn: the old budget does not carry over
    expect(budgetOf(e, 'pc-a')).toEqual({ serial: 2 });
    expect(useEconomy(null, 'pc-a', 'action', { gm: false })).toBeNull(); // no initiative: free play
    expect(attacksPerAction({ abilities: [{ id: 'x', name: 'Extra Attack', text: 'You can attack twice' }], details: [] })).toBe(2);
    expect(attacksPerAction({ abilities: [], details: [{ id: 'c', label: 'Class & level', value: 'Fighter 11' }] })).toBe(3);
  });

  it('opportunity attacks: leaving reach without Disengage, hostiles only, reaction available', () => {
    const e = enc();
    const dist = (a: { x: number }, b: { x: number }) => Math.abs(a.x - b.x);
    const mover: Figure = { kind: 'pc', id: 'a', name: 'A', side: 'party', x: 5, y: 0, reachFt: 5 };
    const goblin: Figure = { kind: 'npc', id: 'g', name: 'G', side: 'enemy', x: 0, y: 0, reachFt: 5 };
    const friend: Figure = { kind: 'npc', id: 'f', name: 'F', side: 'party', x: 0, y: 0, reachFt: 5 };
    e.participants.push({ id: 'npc-f', name: 'F', initiative: 1, visible: true });
    let n = 0;
    const offers = opportunityOffers(mover, { x: 30, y: 0 }, [goblin, friend], dist, e, () => `o${n++}`, 'now');
    expect(offers.map((o) => o.reactor.name)).toEqual(['G']);
    expect(opportunityOffers(mover, { x: 5, y: 3 }, [goblin], dist, e, () => 'o', 'now')).toEqual([]); // still in reach
    e.economy = { 'pc-a': { serial: 1, action: true, disengage: true } };
    expect(opportunityOffers(mover, { x: 30, y: 0 }, [goblin], dist, e, () => 'o', 'now')).toEqual([]);
    e.economy = {};
    e.reactions = { 'npc-g': 1 };
    expect(opportunityOffers(mover, { x: 30, y: 0 }, [goblin], dist, e, () => 'o', 'now')).toEqual([]);
  });

  it('spells: prepared/cantrip, slot choice and upcasting, range, damage', () => {
    const s = caster();
    expect(spellRangeFt('120 feet')).toBe(120);
    expect(spellRangeFt('Touch')).toBe(5);
    expect(spellRangeFt('Self (15-foot cone)')).toBe(15);
    expect(spellDamage(s.spells[0], 0, 5)).toBe('2d10 fire');
    expect(spellDamage(s.spells[1], 2)).toBe('4d6 fire');
    expect(planSpell(s, 'bh', 2)).toMatchObject({ mode: 'save', save: 'dexterity', slotLevel: 2, damage: '4d6 fire' });
    expect(planSpell(s, 'fb', 3)).toMatchObject({ mode: 'attack', slotLevel: 0 });
    expect(planSpell(s, 'mm', 1)).toEqual({ error: 'Magic Missile is not prepared.' });
    expect(planSpell(s, 'bh', 3)).toMatchObject({ error: expect.stringMatching(/level 3/) });
    expect(planSpell(s, 'sh', 1)).toMatchObject({ reaction: true });
  });
});

describe('API: battle actions', () => {
  const cid = 'campaign-actions';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.13', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
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

  it('standard actions, spells with slots, opportunity attacks both ways, allies, GM vision modes', async () => {
    const created = (await request('gm', 'scenes', { name: 'Fight', category: 'battle', template: 'hex-battle' })).body as { scene: SceneDefinition };
    const meta = created.scene.metadata as unknown as SceneMap;
    const m: SceneMap = { ...meta, palette: PALETTE_PRESETS[0].palette, hex: { ...meta.hex!, terrain: 'S'.repeat(meta.hex!.terrain.length) } };
    const scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: m })).body as { scene: SceneDefinition }).scene;
    const ps = ((await request('gm', 'scene-runtime')).body as { players: Array<{ userId: string; revision: number }> }).players;
    expect((await request('gm', 'scene-runtime', { sceneId: scene.id, targets: [ps.find((p) => p.userId === user('hannah').userId)!], requestId: crypto.randomUUID() })).status).toBe(200);
    const sinna = user('hannah').tokenIds[0];
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet: caster(), expectedVersion: 0 })).status).toBe(200);
    const view = async () => ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    const me = (await view()).motion!.tokens.find((t) => t.tokenId === sinna)!;
    const step = Math.sqrt(3) * 30;
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'wolf', x: me.x + 2 * step, y: me.y, side: 'ally' })).status).toBe(200);
    const st = () => repo.states.get(cid)!.state;
    const [goblin, wolf] = st().sceneEnemies![scene.id];
    expect(wolf.side).toBe('ally');
    const e = () => st().sceneEncounters![scene.id];
    const toTurn = async (id: string) => { for (let i = 0; i < 10 && e().participants[e().turnIndex].id !== id; i++) await turn(scene.id, { action: 'endTurn', encounterId: e().id, turnSerial: e().turnSerial }); };

    // GM: the ally (wolf) attacks the goblin next to it; enemies cannot be targeted by players' allies out of reach
    Object.assign(st().sceneEnemies![scene.id][0], { hp: 100, maxHp: 100 }); // the goblin must survive the random wolf bite
    await toTurn(`npc-${wolf.id}`);
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: wolf.id }, target: { kind: 'npc', id: goblin.id } })).status).toBe(200);
    expect(st().sceneCombatLog![scene.id].at(-1)!.text).toMatch(/^Wolf 1 attacks Goblin 1 with Bite/);

    // Sinna's turn: Dash doubles movement, then the action is used
    await toTurn(`pc-${sinna}`);
    expect((await turn(scene.id, { action: 'standard', actor: { kind: 'pc', tokenId: sinna }, act: 'dash' }, 'hannah')).status).toBe(200);
    expect((await view()).movement!.allowance).toBe(60);
    expect((await turn(scene.id, { action: 'standard', actor: { kind: 'pc', tokenId: sinna }, act: 'disengage' }, 'hannah')).status).toBe(409);
    expect((await turn(scene.id, { action: 'standard', actor: { kind: 'pc', tokenId: sinna }, act: 'bonusOther', note: 'Second Wind' }, 'hannah')).status).toBe(200);
    // a spell with the bonus action already used? Burning Hands is an action – also used → refused
    expect((await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'bh', slotLevel: 1 }, 'hannah')).status).toBe(409);

    // Moving away from the goblin without Disengage: the GM gets an opportunity attack prompt
    const pos = (await view()).motion!.tokens.find((t) => t.tokenId === sinna)!;
    const v0 = await view();
    const moved = await request('hannah', 'scene-motion', { action: 'move', requestId: crypto.randomUUID(), tokenId: sinna, tokenVersion: pos.version, sceneId: scene.id, sceneRevision: v0.scene!.revision, assignmentRevision: v0.assignmentRevision, epoch: 0, x: pos.x - 3 * step, y: pos.y });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((moved.body as { message?: string }).message).toMatch(/opportunity attack/);
    const focus = (await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot;
    expect(focus.reactions!.map((r) => `${r.reactor.name}→${r.target.name}`)).toEqual(['Goblin 1→Sinna']);
    expect((await turn(scene.id, { action: 'reaction', offerId: focus.reactions![0].id, accept: true }, 'hannah')).status).toBe(403); // the GM decides for the goblin
    expect((await turn(scene.id, { action: 'reaction', offerId: focus.reactions![0].id, accept: true })).status).toBe(200);
    expect(st().sceneCombatLog![scene.id].at(-1)!.text).toMatch(/Goblin 1 attacks Sinna .*\(opportunity attack\)/);
    expect(e().reactions![`npc-${goblin.id}`]).toBeDefined();
    expect((await turn(scene.id, { action: 'reaction', offerId: focus.reactions![0].id, accept: true })).status).toBe(409);

    // Next round, Sinna casts Burning Hands with a 2nd-level slot (upcast): the slot is spent on the server
    await toTurn(`npc-${goblin.id}`);
    await toTurn(`pc-${sinna}`);
    const cast = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'bh', slotLevel: 2 }, 'hannah');
    expect(cast.status, JSON.stringify(cast.body)).toBe(200);
    expect((cast.body as { message: string }).message).toMatch(/Burning Hands \(2nd-level slot, upcast\).*Dexterity save DC 13/);
    const slots = ((await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload).sheet.resources.map((r) => r.current);
    expect(slots).toEqual([2, 0]);
    expect((await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'fb', slotLevel: 0, target: { kind: 'npc', id: goblin.id } }, 'hannah')).status).toBe(409); // action used

    // The GM moves the goblin (on its turn) away from Sinna: the move pauses and Sinna's player is asked
    const g0 = (await view()).motion!.tokens.find((t) => t.tokenId === sinna)!;
    expect((await turn(scene.id, { action: 'enemyMove', id: goblin.id, x: g0.x + step, y: g0.y })).status).toBe(409); // not its turn
    await toTurn(`npc-${goblin.id}`);
    const g = st().sceneEnemies![scene.id].find((x) => x.id === goblin.id)!;
    const sNow = (await view()).motion!.tokens.find((t) => t.tokenId === sinna)!;
    {
      // walking past the allied wolf pauses the goblin: the wolf may react (GM decides) – the GM lets it go
      const r1 = await turn(scene.id, { action: 'enemyMove', id: goblin.id, x: sNow.x + step, y: sNow.y });
      expect(r1.status, JSON.stringify(r1.body)).toBe(200);
      expect((r1.body as { message: string }).message).toMatch(/Wolf 1 may make an opportunity attack/);
      const wolfOffer = ((await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot).reactions!.find((o) => o.reactor.name === 'Wolf 1')!;
      expect((await turn(scene.id, { action: 'reaction', offerId: wolfOffer.id, accept: false })).status).toBe(200);
      const arrived = st().sceneEnemies![scene.id].find((x) => x.id === goblin.id)!;
      expect(Math.round(arrived.x)).toBe(Math.round(sNow.x + step));
    }
    void g;
    const away = await turn(scene.id, { action: 'enemyMove', id: goblin.id, x: sNow.x + 4 * step, y: sNow.y });
    expect(away.status, JSON.stringify(away.body)).toBe(200);
    const offers = (await view()).reactions!;
    expect(offers.map((o) => `${o.reactor.name}→${o.target.name}`)).toEqual(['Sinna→Goblin 1']);
    const paused = st().sceneEnemies![scene.id].find((x) => x.id === goblin.id)!;
    expect(`${paused.x},${paused.y}`).not.toBe(`${sNow.x + 4 * step},${sNow.y}`); // stopped next to Sinna
    expect((await turn(scene.id, { action: 'enemyMove', id: goblin.id, x: sNow.x + 3 * step, y: sNow.y })).status).toBe(409); // decide first
    const skip = await turn(scene.id, { action: 'reaction', offerId: offers[0].id, accept: false }, 'hannah');
    expect(skip.status).toBe(200);
    expect((skip.body as { message: string }).message).toMatch(/Goblin 1 moves/);
    expect((await view()).reactions).toEqual([]);
    const done = st().sceneEnemies![scene.id].find((x) => x.id === goblin.id)!;
    expect(Math.round(done.x)).toBe(Math.round(sNow.x + 4 * step)); // the move continued to its destination
    expect((await turn(scene.id, { action: 'enemyMove', id: goblin.id, x: sNow.x + 6 * step, y: sNow.y })).status).toBe(422); // speed 30 used up

    // GM vision modes: no fog in the full view, fog in the group and single-figure views
    expect(((await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot).fog).toBeUndefined();
    for (const v of ['party', 'enemies', `pc-${sinna}`, goblin.id]) {
      const f = (await request('gm', 'scene-runtime', undefined, { focus: scene.id, view: v })).body as SceneSnapshot;
      expect(f.fog, v).toMatch(/^[ve]+$/);
      expect(f.fog!.includes('v'), v).toBe(true);
    }
    // players cannot use NPC or other characters
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: goblin.id }, target: { kind: 'pc', tokenId: sinna } }, 'hannah')).status).toBe(403);
  });
});
