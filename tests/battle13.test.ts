/**
 * APEX 1.3 battle rules: conditions and buffs, advantage/disadvantage, concentration, spells (buffs, conditions,
 * several targets, healing), Shield and Ready reactions, class features (Action Surge, Rage, Wild Shape …),
 * elite support abilities.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { addEffect, attackMods, conditionEffect, endConcentration, onTurnStart, startConcentration, effectsOf } from '../src/game/combatEffects';
import { resolveAttack } from '../src/game/sceneCombat';
import { spellCount, spellEffectOf, spellHealing } from '../src/game/spellEffects';
import { battleFeatures, spendUse } from '../src/game/classFeatures';
import { combatAttacks, effectiveStats } from '../src/game/effectiveStats';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import type { GameState } from '../src/game/types';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const spell = (o: Partial<CharacterSheet['spells'][number]>) => ({ id: 'x', name: 'X', level: 1, prepared: true, source: '', notes: '', school: '', castingTime: '1 action', range: '60 feet', components: '', duration: '', concentration: false, ritual: false, description: '', ...o });
const base = (o: Partial<CharacterSheet> = {}): CharacterSheet => ({ ...emptySheet(), hitPoints: { current: 40, max: 40, temp: 0 }, combat: [{ id: 'ac', label: 'Armor Class', value: '1' }, { id: 'pb', label: 'Proficiency bonus', value: '+2' }], attributes: [{ id: 's', name: 'Strength', value: '16', modifier: '' }, { id: 'd', name: 'Dexterity', value: '14', modifier: '' }, { id: 'c', name: 'Constitution', value: '14', modifier: '' }, { id: 'h', name: 'Charisma', value: '16', modifier: '' }], ...o });

describe('effects and attack modifiers (rules)', () => {
  const st = () => ({ sceneEffects: {}, sceneEncounters: {} } as unknown as GameState);
  it('conditions give advantage / disadvantage; both cancel; prone depends on distance', () => {
    const s = st();
    addEffect(s, 'sc', 'npc-g', conditionEffect('prone'));
    expect(attackMods(s, 'sc', { attacker: 'pc-a', target: 'npc-g', melee: true, distanceFt: 5 }).mode).toBe('adv');
    expect(attackMods(s, 'sc', { attacker: 'pc-a', target: 'npc-g', melee: false, distanceFt: 30 }).mode).toBe('dis');
    addEffect(s, 'sc', 'pc-a', conditionEffect('poisoned'));
    const m = attackMods(s, 'sc', { attacker: 'pc-a', target: 'npc-g', melee: true, distanceFt: 5 });
    expect(m.mode).toBe('normal');
    expect(m.reasons).toContain('advantage and disadvantage cancel');
    expect(attackMods(st(), 'sc', { attacker: 'pc-a', target: 'npc-g', melee: false, distanceFt: 100, longRange: true }).mode).toBe('dis');
    expect(attackMods(st(), 'sc', { attacker: 'pc-a', target: 'npc-g', melee: false, distanceFt: 30, hostileAdjacent: true }).mode).toBe('dis');
    const p = st();
    addEffect(p, 'sc', 'npc-g', conditionEffect('paralyzed'));
    expect(attackMods(p, 'sc', { attacker: 'pc-a', target: 'npc-g', melee: true, distanceFt: 5 })).toMatchObject({ mode: 'adv', autoCrit: true });
  });

  it('advantage takes the higher d20, bonus dice add, auto-crit doubles dice', () => {
    const seq = [3, 17, 4, 6];
    const r = resolveAttack('A', 'B', 'Sword', 2, { count: 1, sides: 8, mod: 1 }, 15, () => seq.shift()!, { mode: 'adv', toHitDice: ['1d4'] });
    expect(r).toMatchObject({ d20: 17, d20s: [3, 17], total: 23, hit: true, damage: 7 });
    expect(r.text).toMatch(/advantage: 3, 17.*\+ 4 \(1d4\)/);
    const crit = resolveAttack('A', 'B', 'Sword', 2, { count: 1, sides: 8, mod: 0 }, 5, (() => { const q = [10, 3, 4]; return () => q.shift()!; })(), { autoCrit: true });
    expect(crit).toMatchObject({ crit: true, damage: 7 });
  });

  it('effects end at the start of the right turn; concentration ends its effects', () => {
    const s = st();
    addEffect(s, 'sc', 'pc-a', { id: 'sh', name: 'Shield', key: 'shield', mods: { ac: 5 }, untilStartOf: 'pc-a' });
    addEffect(s, 'sc', 'pc-a', { id: 'rg', name: 'Raging', key: 'rage', mods: { resistPhysical: true }, turns: 2 });
    onTurnStart(s, 'sc', 'npc-g');
    expect(effectsOf(s, 'sc', 'pc-a').map((e) => e.id)).toEqual(['sh', 'rg']);
    onTurnStart(s, 'sc', 'pc-a');
    expect(effectsOf(s, 'sc', 'pc-a').map((e) => e.id)).toEqual(['rg']);
    onTurnStart(s, 'sc', 'pc-a');
    expect(effectsOf(s, 'sc', 'pc-a')).toEqual([]);
    startConcentration(s, 'sc', 'pc-a', 'Bless');
    addEffect(s, 'sc', 'pc-b', { id: 'bl', name: 'Blessed', key: 'bless', mods: { toHitDie: '1d4' }, source: { actor: 'pc-a', name: 'A', spell: 'Bless', concentration: true } });
    expect(startConcentration(s, 'sc', 'pc-a', 'Hold Person')).toBe('Bless');
    expect(effectsOf(s, 'sc', 'pc-b')).toEqual([]);
    expect(endConcentration(s, 'sc', 'pc-a')).toBe('Hold Person');
  });

  it('spells: target counts, rays, healing with upcast', () => {
    expect(spellCount(spellEffectOf({ name: 'Bless' })!, 1, 3, 1)).toBe(5);
    expect(spellCount(spellEffectOf({ name: 'Scorching Ray' })!, 2, 4, 1)).toBe(5);
    expect(spellCount(spellEffectOf({ name: 'Eldritch Blast' })!, 0, 0, 11)).toBe(3);
    expect(spellCount(spellEffectOf({ name: "Hunter's Mark" })!, 1, 1, 1)).toBe(1);
    expect(spellHealing({ level: 1, description: 'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier. At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d8 for each slot level above 1st.' }, 3)).toEqual({ dice: '3d8', addMod: true });
  });

  it('class features are found on the sheet and spend their uses', () => {
    const fighter = base({ details: [{ id: 'c', label: 'Class & level', value: 'Fighter 5' }], abilities: [{ id: 'as', name: 'Action Surge', text: '' }, { id: 'sw', name: 'Second Wind', text: '' }] });
    const f = battleFeatures(fighter);
    expect(f.map((x) => x.id)).toEqual(['actionSurge', 'secondWind']);
    const once = spendUse(fighter, f[0]) as CharacterSheet;
    expect(once.resources.find((r) => r.name === 'Action Surge')).toMatchObject({ current: 0, max: 1 });
    expect(spendUse(once, battleFeatures(once)[0])).toMatch(/No Action Surge use left/);
    const druid = base({ details: [{ id: 'c', label: 'Class & level', value: 'Druid 4' }] });
    expect(battleFeatures(druid).map((x) => x.id)).toEqual(['wildShape']);
    const wolf = { ...druid, wildShape: { formId: 'wolf', formName: 'Wolf', hp: 11, maxHp: 11, since: new Date().toISOString() } };
    expect(combatAttacks(wolf, { inventory: [] })[0]).toMatchObject({ name: 'Bite (Wolf)', source: 'beast' });
    expect(effectiveStats(wolf, { inventory: [] })).toMatchObject({ ac: { value: 13 }, speed: { value: 40 }, maxHp: { value: 11 } });
  });
});

describe('API: spells, reactions, features', () => {
  const cid = 'campaign-b13';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.15', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
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
  const sheetNow = async () => ((await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload).sheet;

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

  it('Bless (concentration) on Sinna and an ally, Hold Person ends it and paralyzes; Magic Missile darts; Cure Wounds', async () => {
    await saveSheet(base({
      spellcasting: [{ id: 'a', label: 'Spell attack bonus', value: '+5' }, { id: 'b', label: 'Spell save DC', value: '40' }],
      resources: [{ id: 'r1', name: 'Spell slots (level 1)', current: 4, max: 4 }, { id: 'r2', name: 'Spell slots (level 2)', current: 2, max: 2 }],
      spells: [spell({ id: 'bless', name: 'Bless', range: '30 feet', concentration: true }), spell({ id: 'hold', name: 'Hold Person', level: 2, concentration: true }), spell({ id: 'mm', name: 'Magic Missile', range: '120 feet' }), spell({ id: 'cw', name: 'Cure Wounds', range: 'Touch', description: 'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.' })],
    }));
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'bandit', x: me.x + step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'thug', x: me.x - step, y: me.y, side: 'ally' })).status).toBe(200);
    const [bandit, thug] = st().sceneEnemies![scene.id];
    await toTurn(`pc-${sinna}`);
    const bless = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'bless', slotLevel: 1, targets: [{ kind: 'pc', tokenId: sinna }, { kind: 'npc', id: thug.id }] }, 'hannah');
    expect(bless.status, JSON.stringify(bless.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `npc-${thug.id}`).map((x) => x.name)).toEqual(['Blessed']);
    expect(st().sceneConcentration![scene.id][`pc-${sinna}`].spell).toBe('Bless');
    const view = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    expect(view.self![sinna]).toMatchObject({ concentration: 'Bless', effects: [expect.objectContaining({ name: 'Blessed' })] });
    // next turn: Hold Person (DC 40) – Bless ends (one concentration), the bandit is paralyzed
    await toTurn(`npc-${bandit.id}`);
    await toTurn(`pc-${sinna}`);
    const hold = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'hold', slotLevel: 2, targets: [{ kind: 'npc', id: bandit.id }] }, 'hannah');
    expect(hold.status, JSON.stringify(hold.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `npc-${thug.id}`)).toEqual([]);
    expect(effectsOf(st(), scene.id, `npc-${bandit.id}`).map((x) => x.key)).toEqual(['paralyzed']);
    // the paralyzed bandit cannot move or attack on its turn
    await toTurn(`npc-${bandit.id}`);
    expect((await turn(scene.id, { action: 'enemyMove', id: bandit.id, x: me.x + 2 * step, y: me.y })).status).toBe(422);
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: bandit.id }, target: { kind: 'pc', tokenId: sinna } })).status).toBe(409);
    // the GM removes the condition by hand
    const fxId = effectsOf(st(), scene.id, `npc-${bandit.id}`)[0].id;
    expect((await turn(scene.id, { action: 'condition', target: { kind: 'npc', id: bandit.id }, effectId: fxId, add: false }, 'hannah')).status).toBe(403);
    expect((await turn(scene.id, { action: 'condition', target: { kind: 'npc', id: bandit.id }, effectId: fxId, add: false })).status).toBe(200);
    // Magic Missile: three darts that always hit (two at the bandit, one at the thug's … no: allies are valid targets too)
    await toTurn(`pc-${sinna}`);
    const hp = st().sceneEnemies![scene.id].find((x) => x.id === bandit.id)!.hp;
    const mm = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'mm', slotLevel: 1, targets: [{ kind: 'npc', id: bandit.id }, { kind: 'npc', id: bandit.id }] }, 'hannah');
    expect(mm.status, JSON.stringify(mm.body)).toBe(200);
    expect((mm.body as { message: string }).message.match(/dart \d/g)).toHaveLength(3);
    expect(st().sceneEnemies![scene.id].find((x) => x.id === bandit.id)!.hp).toBeLessThan(hp);
    // Cure Wounds (bonus to heal = attack bonus − proficiency = 3) on herself next turn
    await toTurn(`npc-${bandit.id}`);
    await toTurn(`pc-${sinna}`);
    const hurt = await sheetNow();
    await saveSheet({ ...hurt, hitPoints: { current: 10, max: 40, temp: 0 } });
    const cw = await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'cw', slotLevel: 1, targets: [{ kind: 'pc', tokenId: sinna }] }, 'hannah');
    expect(cw.status, JSON.stringify(cw.body)).toBe(200);
    expect((await sheetNow()).hitPoints!.current).toBeGreaterThanOrEqual(14);
  });

  it('Shield as a reaction to a hit; Ready and release with the reaction', async () => {
    await saveSheet(base({ resources: [{ id: 'r1', name: 'Spell slots (level 1)', current: 2, max: 2 }], spells: [spell({ id: 'sh', name: 'Shield', castingTime: '1 reaction', range: 'Self' })], attacks: [{ id: 'a', name: 'Spear', bonus: '+30', damage: '1d6+2', range: '5 ft.', notes: '' }] }));
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + step, y: me.y })).status).toBe(200);
    const goblin = st().sceneEnemies![scene.id][0];
    // a pending hit: total 4 vs AC 1 – Shield makes it AC 6 → miss
    const s = st();
    const serial = s.sceneEncounters![scene.id].turnSerial ?? 0;
    s.scenePendingHits = { [scene.id]: [{ id: 'h1', attacker: { kind: 'npc', id: goblin.id, name: 'Goblin 1' }, target: { kind: 'pc', id: sinna, name: 'Sinna' }, total: 4, ac: 1, crit: false, natural20: false, damage: 5, text: 'Goblin 1 hits', turnSerial: serial }] };
    s.sceneReactions = { [scene.id]: [{ id: 'o1', kind: 'shield', hitId: 'h1', reactor: { kind: 'pc', id: sinna, name: 'Sinna' }, target: { kind: 'npc', id: goblin.id, name: 'Goblin 1' }, turnSerial: serial, at: '', from: { x: 0, y: 0 } }] };
    expect(((await request('hannah', 'state')).body as PlayerPayload).scene!.reactions!.map((r) => r.kind)).toEqual(['shield']);
    const r = await turn(scene.id, { action: 'reaction', offerId: 'o1', accept: true }, 'hannah');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { message: string }).message).toMatch(/casts Shield .*AC 1 → 6.*misses/);
    expect((await sheetNow()).resources[0].current).toBe(1);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).map((x) => x.key)).toEqual(['shield']);
    // Ready on her turn, release on the goblin's turn with the reaction (the reaction refreshed at her turn start)
    await toTurn(`npc-${goblin.id}`);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).map((x) => x.key)).toEqual(['shield']); // still up during the goblin's turn
    await toTurn(`pc-${sinna}`);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`)).toEqual([]); // Shield ended at the start of her turn
    expect((await turn(scene.id, { action: 'ready', actor: { kind: 'pc', tokenId: sinna }, attackIndex: 0, trigger: 'when the goblin moves' }, 'hannah')).status).toBe(200);
    expect((await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id }, attackIndex: 0 }, 'hannah')).status).toBe(409); // action used
    await toTurn(`npc-${goblin.id}`);
    const rel = await turn(scene.id, { action: 'release', actor: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id } }, 'hannah');
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    expect(st().sceneReadied?.[scene.id]?.[`pc-${sinna}`]).toBeUndefined();
    expect((await turn(scene.id, { action: 'release', actor: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id } }, 'hannah')).status).toBe(409);
  });

  it('Action Surge, Rage, Wild Shape; an elite war cry buffs its allies', async () => {
    await saveSheet(base({ details: [{ id: 'c', label: 'Class & level', value: 'Fighter 5 / Barbarian 3 / Druid 2' }], abilities: [{ id: 'as', name: 'Action Surge', text: '' }, { id: 'r', name: 'Rage', text: '' }], attacks: [{ id: 'a', name: 'Greataxe', bonus: '+30', damage: '1d12+3 slashing', range: '5 ft.', notes: '' }] }));
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'ogre', x: me.x + step, y: me.y })).status).toBe(200);
    const ogre = st().sceneEnemies![scene.id][0];
    await toTurn(`pc-${sinna}`);
    const atk = { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: ogre.id }, attackIndex: 0 };
    expect((await turn(scene.id, { action: 'feature', tokenId: sinna, feature: 'rage' }, 'hannah')).status).toBe(200);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).map((x) => x.key)).toEqual(['rage']);
    expect((await turn(scene.id, atk, 'hannah')).status).toBe(200);
    expect(st().sceneCombatLog![scene.id].at(-1)!.text).toMatch(/\+2 Raging|natural 1/);
    expect((await turn(scene.id, atk, 'hannah')).status).toBe(409);
    expect((await turn(scene.id, { action: 'feature', tokenId: sinna, feature: 'actionSurge' }, 'hannah')).status).toBe(200);
    expect((await turn(scene.id, atk, 'hannah')).status).toBe(200); // the extra action
    expect((await turn(scene.id, { action: 'feature', tokenId: sinna, feature: 'actionSurge' }, 'hannah')).status).toBe(409);
    // next turn: Wild Shape into a wolf (action); attacks and AC follow the beast
    await toTurn(`npc-${ogre.id}`);
    await toTurn(`pc-${sinna}`);
    const ws = await turn(scene.id, { action: 'feature', tokenId: sinna, feature: 'wildShape', formId: 'wolf' }, 'hannah');
    expect(ws.status, JSON.stringify(ws.body)).toBe(200);
    expect((await sheetNow()).wildShape).toMatchObject({ formName: 'Wolf', hp: 11 });
    expect((await turn(scene.id, { action: 'cast', tokenId: sinna, spellId: 'none', slotLevel: 1 }, 'hannah')).status).toBe(409); // no spells as a beast
    // elite: the Bloodcaller's war cry gives the ogre +2 to hit until the Bloodcaller's next turn
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc-bloodcaller', x: me.x + 2 * step, y: me.y })).status).toBe(200);
    const bc = st().sceneEnemies![scene.id][1];
    await toTurn(`npc-${bc.id}`);
    const cry = await turn(scene.id, { action: 'npcBuff', id: bc.id, buff: 0 });
    expect(cry.status, JSON.stringify(cry.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `npc-${ogre.id}`)).toMatchObject([{ name: 'Blood war cry', mods: { toHit: 2 } }]);
    const focus = (await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot;
    expect(focus.figures!.find((f) => f.id === ogre.id)!.effects!.map((x) => x.name)).toEqual(['Blood war cry']);
  });
});
