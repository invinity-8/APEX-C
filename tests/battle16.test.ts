/**
 * APEX 1.6: the extra action of Haste, Aid (hit point maximum, back down when it ends), Heroism (temporary HP at the
 * start of each turn), temporary HP of NPCs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { effectsOf } from '../src/game/combatEffects';
import { budgetOf, useEconomy } from '../src/game/sceneActions';
import { grantEnemyTempHp, updateEnemy, enemiesOf } from '../src/game/sceneCombat';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import type { SceneEncounter } from '../src/game/types';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const bare = (name: string, level = 0) => ({ id: name.toLowerCase().replace(/ /g, '-'), name, level, prepared: true, source: '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });

describe('rules', () => {
  it('Haste: one extra limited action, once', () => {
    const e = { id: 'e', status: 'active', round: 1, turnIndex: 0, turnSerial: 1, version: 1, participants: [{ id: 'a', name: 'A', initiative: 10, visible: true }] } as unknown as SceneEncounter;
    expect(useEconomy(e, 'a', 'action', { gm: false })).toBeNull();
    expect(useEconomy(e, 'a', 'action', { gm: false })).toMatch(/already used/);
    expect(useEconomy(e, 'a', 'action', { gm: false, haste: true })).toBeNull();
    expect(budgetOf(e, 'a').hasted).toBe(true);
    expect(useEconomy(e, 'a', 'action', { gm: false, haste: true })).toMatch(/already used/);
    // a hasted attacker without Extra Attack: one more weapon attack
    const f = { ...e, economy: {} } as SceneEncounter;
    expect(useEconomy(f, 'a', 'attack', { gm: false, haste: true })).toBeNull();
    expect(useEconomy(f, 'a', 'attack', { gm: false, haste: true })).toBeNull();
    expect(useEconomy(f, 'a', 'attack', { gm: false, haste: true })).toMatch(/already made/);
  });

  it('NPC temporary hit points soak damage first and do not stack', () => {
    const s = createDemoState({ radius: 6, seed: 1 });
    s.sceneEnemies = { sc: [{ id: 'g', templateId: 'goblin', name: 'G', x: 0, y: 0, hp: 7, maxHp: 7, ac: 15, speedFt: 30, init: 2, attack: { name: 'x', bonus: 4, damage: '1d6' }, color: '#000', icon: 'g' } as never] };
    grantEnemyTempHp(s, 'sc', 'g', 5);
    grantEnemyTempHp(s, 'sc', 'g', 3);
    const r = updateEnemy(s, 'sc', 'g', { hpDelta: -6 });
    if (!r.ok) throw new Error();
    expect(enemiesOf(r.state, 'sc')[0]).toMatchObject({ hp: 6 });
    expect(enemiesOf(r.state, 'sc')[0].tempHp).toBeUndefined();
  });
});

describe('API: Aid, Heroism, Haste', () => {
  const cid = 'campaign-b16';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.18', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
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
  const caster = (spells: ReturnType<typeof bare>[]): CharacterSheet => ({ ...emptySheet(), hitPoints: { current: 10, max: 30, temp: 0 }, attributes: [{ id: 'd', name: 'Dexterity', value: '16', modifier: '+3' }], details: [{ id: 'c', label: 'Class & level', value: 'Wizard 5' }], combat: [{ id: 'p', label: 'Proficiency bonus', value: '+3' }], spellcasting: [{ id: 'a', label: 'Spell attack bonus', value: '+7' }, { id: 'd', label: 'Spell save DC', value: '15' }], resources: [{ id: 'r1', name: 'Spell slots (level 1)', current: 4, max: 4 }, { id: 'r2', name: 'Spell slots (level 2)', current: 3, max: 3 }, { id: 'r3', name: 'Spell slots (level 3)', current: 2, max: 2 }], spells });
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

  const toTurn = async (id: string) => { for (let i = 0; i < 12; i++) { const e = st().sceneEncounters![scene.id]; if (e.participants[e.turnIndex].id === id) return; await turn(scene.id, { action: 'endTurn', encounterId: e.id, turnSerial: e.turnSerial }); } };

  it('Aid raises the hit point maximum (upcast +5 per level) and lowers it again when it ends', async () => {
    await saveSheet(caster([bare('Aid', 2)]));
    const r = await cast('aid', 3, [self]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await sheetOf()).sheet!.hitPoints).toMatchObject({ max: 40, current: 20 });
    const fx = effectsOf(st(), scene.id, `pc-${sinna}`).find((e) => e.key === 'aid')!;
    expect(fx.mods.maxHp).toBe(10);
    // a second Aid does not stack
    await cast('aid', 2, [self]);
    expect((await sheetOf()).sheet!.hitPoints!.max).toBe(40);
    const off = await turn(scene.id, { action: 'condition', target: self, effectId: effectsOf(st(), scene.id, `pc-${sinna}`).find((e) => e.key === 'aid')!.id, add: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await sheetOf()).sheet!.hitPoints).toMatchObject({ max: 30, current: 20 });
  });

  it('Heroism: temporary hit points when cast and again at the start of each of her turns', async () => {
    await saveSheet(caster([bare('Heroism', 1)]));
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 8 * step, y: me.y })).status).toBe(200);
    Object.assign(st().sceneEnemies![scene.id][0], { hp: 200, maxHp: 200 });
    await turn(scene.id, { action: 'startInitiative' });
    await toTurn(`pc-${sinna}`);
    const r = await cast('heroism', 1, [self]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await sheetOf()).sheet!.hitPoints!.temp).toBe(4); // spell attack +7 − proficiency +3
    const cur = await sheetOf();
    await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet: { ...cur.sheet!, hitPoints: { ...cur.sheet!.hitPoints!, temp: 0 } }, expectedVersion: cur.version ?? 0 });
    await toTurn(`npc-${st().sceneEnemies![scene.id][0].id}`);
    await toTurn(`pc-${sinna}`);
    expect((await sheetOf()).sheet!.hitPoints!.temp).toBe(4);
  });

  it('combat feedback: attacks and healing leave visual events in the snapshot', async () => {
    await saveSheet(caster([bare('Fire Bolt'), bare('Cure Wounds', 1)]));
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 4 * step, y: me.y })).status).toBe(200);
    const goblin = st().sceneEnemies![scene.id][0];
    Object.assign(goblin, { hp: 200, maxHp: 200 });
    expect((await cast('fire-bolt', 0, [{ kind: 'npc', id: goblin.id }])).status).toBe(200);
    expect((await cast('cure-wounds', 1, [self])).status).toBe(200);
    const fx = ((await request('hannah', 'state')).body as PlayerPayload).scene!.fx ?? [];
    const bolt = fx.find((f) => f.to === `npc-${goblin.id}`)!;
    expect(bolt).toMatchObject({ from: `pc-${sinna}`, element: 'fire', ranged: true });
    expect(['hit', 'crit', 'miss']).toContain(bolt.kind);
    expect(fx.find((f) => f.kind === 'heal')).toMatchObject({ to: `pc-${sinna}`, element: 'heal' });
  });
});
