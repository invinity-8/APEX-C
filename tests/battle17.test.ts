/**
 * APEX 1.7: Wild Shape granted by the sheet (a level-1 druid with a "Wild Shape" resource), beast form on the map,
 * no spells, revert at 0 beast HP; Shillelagh (Wisdom and a d8 for the staff); Thunderwave starts at the caster.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { areaHexes, parseArea } from '../src/campaign/hexArea';
import { encodeTiles, hexAt, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';
import { distance, parseKey } from '../src/game/hex';
import { wildShapeLevel } from '../src/game/abilities';
import { battleFeatures } from '../src/game/classFeatures';
import { spellNumbers, withShillelagh } from '../src/game/sceneActions';
import { effectsOf } from '../src/game/combatEffects';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const bare = (name: string, level = 0) => ({ id: name.toLowerCase().replace(/ /g, '-'), name, level, prepared: true, source: '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });
/** Like Sinna: "Level 1 Kor Druid", Wisdom 18, a Wild Shape resource the table granted, a quarterstaff. */
const druid = (): CharacterSheet => ({
  ...emptySheet(),
  details: [{ id: 'c', label: 'Race, class & level', value: 'Level 1 Kor Druid' }],
  attributes: [{ id: 's', name: 'Strength', value: '11', modifier: '+0' }, { id: 'w', name: 'Wisdom', value: '18', modifier: '+4' }],
  hitPoints: { current: 9, max: 9, temp: 0 },
  resources: [{ id: 'r', name: 'Spell slots (level 1)', current: 2, max: 2 }, { id: 'ws', name: 'Wild Shape', current: 2, max: 2 }],
  attacks: [{ id: 'q', name: 'Quarterstaff', bonus: '+2 vs AC', damage: '1d6+0 bludgeoning · Versatile', range: '5 ft', notes: '' }],
  spells: [{ ...bare('Shillelagh'), range: 'Touch' }, { ...bare('Thunderwave', 1), range: 'Self (15-foot cube)' }],
});

describe('rules', () => {
  it('a Wild Shape resource lets a level-1 druid transform (limits of level 2)', () => {
    expect(wildShapeLevel(druid())).toBe(2);
    expect(battleFeatures(druid()).map((f) => f.id)).toContain('wildShape');
    expect(wildShapeLevel({ ...druid(), resources: [] })).toBe(1);
    expect(battleFeatures({ ...druid(), resources: [] }).map((f) => f.id)).not.toContain('wildShape');
  });

  it('spell numbers missing on the sheet come from the class ability and proficiency', () => {
    expect(spellNumbers(druid())).toEqual({ attack: 6, dc: 14 }); // level 1: proficiency +2, Wisdom +4
    expect(spellNumbers({ ...druid(), spellcasting: [{ id: 'a', label: 'Spell attack bonus', value: '+9' }, { id: 'd', label: 'Spell save DC', value: '17' }] })).toEqual({ attack: 9, dc: 17 });
  });

  it('Shillelagh: the staff uses Wisdom and a d8', () => {
    const [a] = withShillelagh(druid().attacks, druid(), true);
    expect(a).toMatchObject({ name: 'Quarterstaff (Shillelagh)', bonus: '+6', damage: '1d8+4 bludgeoning (magical)' });
    expect(withShillelagh(druid().attacks, druid(), false)[0].name).toBe('Quarterstaff');
  });

  it('Thunderwave: a 15-foot cube next to the caster, never somewhere else', () => {
    const area = parseArea('Self (15-foot cube) Each creature in a 15-foot cube makes a saving throw.')!;
    expect(area).toMatchObject({ shape: 'cube', sizeFt: 15, fromSelf: true });
    const map: SceneMap = hexSceneMap(emptyMap('battle'), encodeTiles(12, 'battle', () => 'stone'));
    const me = hexCentre(map, { q: 0, r: 0 });
    for (const far of [{ q: 8, r: 0 }, { q: -3, r: 6 }]) {
      const hexes = areaHexes(map, me, hexCentre(map, far), area).map(parseKey);
      expect(hexes.length).toBe(7);
      expect(hexes.every((h) => distance(h, hexAt(map, me)) >= 1 && distance(h, hexAt(map, me)) <= 3)).toBe(true);
      expect(hexes.some((h) => distance(h, hexAt(map, me)) === 1)).toBe(true);
    }
  });
});

describe('API: a level-1 druid with Wild Shape, Shillelagh, Thunderwave', () => {
  const cid = 'campaign-b17';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.19', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
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

  it('Wild Shape: beast form on the map, beast attacks, no spells, back to normal at 0 beast HP', async () => {
    await saveSheet(druid());
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + step, y: me.y })).status).toBe(200);
    const goblin = st().sceneEnemies![scene.id][0];
    Object.assign(goblin, { hp: 200, maxHp: 200 }); // survives the bite
    sinnaTurn();
    const ws = await turn(scene.id, { action: 'feature', tokenId: sinna, feature: 'wildShape', formId: 'wolf' }, 'hannah');
    expect(ws.status, JSON.stringify(ws.body) + JSON.stringify(st().sceneEncounters?.[scene.id])).toBe(200);
    const snap = ((await request('hannah', 'state')).body as PlayerPayload).scene!;
    expect(snap.vitals?.[sinna]).toMatchObject({ form: 'Wolf', hp: 11, maxHp: 11 });
    const spell = await cast('thunderwave', 1);
    expect(spell.status).toBe(409);
    fresh();
    const bite = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id }, attackIndex: 0 }, 'hannah');
    expect((bite.body as { message: string }).message).toMatch(/Bite \(Wolf\)/);
    // the goblin hits the wolf for more than 11: the druid reverts, the rest carries over
    const cur = await sheetOf();
    await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet: { ...cur.sheet!, wildShape: { ...cur.sheet!.wildShape!, hp: 1 } }, expectedVersion: cur.version ?? 0 });
    Object.assign(st().sceneEnemies![scene.id][0], { attacks: [{ name: 'Club', kind: 'melee', bonus: 40, damage: '3d1', damageType: 'bludgeoning', reachFt: 5 }] });
    const e = st().sceneEncounters?.[scene.id];
    if (e) { e.turnIndex = e.participants.findIndex((p) => p.id === `npc-${goblin.id}`); e.turnSerial = (e.turnSerial ?? 0) + 1; }
    const hit = await turn(scene.id, { action: 'strike', attacker: { kind: 'npc', id: goblin.id }, target: { kind: 'pc', tokenId: sinna }, attackIndex: 0 });
    expect(hit.status, JSON.stringify(hit.body)).toBe(200);
    if (/may cast Shield|natural 1|→ miss/.test((hit.body as { message: string }).message)) return; // a natural 1 misses even with +40
    expect((hit.body as { message: string }).message).toMatch(/reverts to normal form/);
    const after = (await sheetOf()).sheet!;
    expect(after.wildShape).toBeUndefined();
    expect(after.hitPoints!.current).toBe(7); // 3 damage: 1 to the wolf, 2 carried over
  });

  it('Shillelagh on yourself: the staff strike uses the Shillelagh numbers', async () => {
    await saveSheet(druid());
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + step, y: me.y })).status).toBe(200);
    const goblin = st().sceneEnemies![scene.id][0];
    Object.assign(goblin, { hp: 200, maxHp: 200 });
    sinnaTurn();
    const sh = await cast('shillelagh', 0);
    expect(sh.status, JSON.stringify(sh.body) + JSON.stringify(st().sceneEncounters?.[scene.id])).toBe(200);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).map((x) => x.key)).toContain('shillelagh');
    fresh();
    const r = await turn(scene.id, { action: 'strike', attacker: { kind: 'pc', tokenId: sinna }, target: { kind: 'npc', id: goblin.id }, attackIndex: 0 }, 'hannah');
    expect(r.status, JSON.stringify(r.body) + JSON.stringify(st().sceneEncounters?.[scene.id])).toBe(200);
    expect((r.body as { message: string }).message).toMatch(/Quarterstaff \(Shillelagh\): d20 \d+ \+ 6|Quarterstaff \(Shillelagh\)/);
  });
});
