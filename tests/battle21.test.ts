/**
 * APEX 2.0: themed scenario presets (seeded, with heights) and the encounter generator (XP budget, themes,
 * situations, placement on the map, the GM's plan/apply API).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { emptyMap } from '../src/campaign/maps';
import { PRESETS, centralPassableHex, generateBattleScene, hexAt, hexSceneMap, setHeights, tileLookup, validHexData, encodeTiles } from '../src/campaign/hexScene';
import { hexKey, distance } from '../src/game/hex';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { multiplier, partyThreshold, placeEncounter, planEncounter, rate, THEMES } from '../src/game/encounters';
import { effectsOf } from '../src/game/combatEffects';
import { enemiesOf } from '../src/game/sceneCombat';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

void setHeights; void encodeTiles;
const druid = (): CharacterSheet => ({ ...emptySheet(), hitPoints: { current: 30, max: 30, temp: 0 } });

describe('scenario presets', () => {
  it('every battle preset is a valid map, the same for the same seed, different for another', () => {
    for (const p of PRESETS.battle) {
      const a = generateBattleScene(p.id, 10, 42), b = generateBattleScene(p.id, 10, 42), c = generateBattleScene(p.id, 10, 43);
      expect(validHexData(a), p.id).toBe(true);
      expect(a).toEqual(b);
      if (!['blank'].includes(p.id)) expect(JSON.stringify(a) === JSON.stringify(c) && !['camp', 'temple'].includes(p.id), p.id).toBe(false);
      // a passable hex near the centre for the arrival
      const m = hexSceneMap(emptyMap('battle'), a);
      expect(tileLookup(m)(hexKey(centralPassableHex(a)))?.cost, p.id).not.toBeNull();
    }
    expect(PRESETS.battle.length).toBeGreaterThanOrEqual(14);
    for (const id of ['highlands', 'cave', 'temple', 'chasm'] as const) expect(generateBattleScene(id, 10, 7).heights, id).toBeTruthy();
  });
});

describe('encounter rules', () => {
  it('DMG thresholds and multipliers', () => {
    expect(partyThreshold(4, 1, 'medium')).toBe(200);
    expect(partyThreshold(4, 5, 'hard')).toBe(3000);
    expect(multiplier(1, 4)).toBe(1);
    expect(multiplier(4, 4)).toBe(2);
    expect(multiplier(4, 2)).toBe(2.5);
    expect(multiplier(4, 6)).toBe(1.5);
    expect(rate([50, 50, 50], 4, 1)).toMatchObject({ raw: 150, adjusted: 300, difficulty: 'hard' });
  });

  it('plans fill the budget with the theme, seeded; harder plans have more XP', () => {
    for (const t of THEMES) {
      const plan = planEncounter({ theme: t.id, situation: 'camp', difficulty: 'medium', partySize: 4, partyLevel: 3, seed: 5, blocks: BUILTIN_BESTIARY });
      expect(plan.entries.length, t.id).toBeGreaterThan(0);
      expect(plan.rating.adjusted, t.id).toBeLessThanOrEqual(plan.budget * 1.1);
      expect(planEncounter({ theme: t.id, situation: 'camp', difficulty: 'medium', partySize: 4, partyLevel: 3, seed: 5, blocks: BUILTIN_BESTIARY })).toEqual(plan);
    }
    const easy = planEncounter({ theme: 'orcs', situation: 'camp', difficulty: 'easy', partySize: 4, partyLevel: 5, seed: 1, blocks: BUILTIN_BESTIARY });
    const deadly = planEncounter({ theme: 'orcs', situation: 'camp', difficulty: 'deadly', partySize: 4, partyLevel: 5, seed: 1, blocks: BUILTIN_BESTIARY });
    expect(deadly.rating.adjusted).toBeGreaterThan(easy.rating.adjusted);
    expect(deadly.entries.some((e) => e.role === 'leader')).toBe(true);
  });

  it('placements: an ambush hides in cover 20–35 ft away, a camp clusters round the fire', () => {
    const m = hexSceneMap(emptyMap('battle'), generateBattleScene('forest', 10, 3));
    const party = { x: m.width / 2, y: m.height / 2 };
    const amb = placeEncounter(m, 'ambush', 5, party, 9, new Set());
    expect(amb).toHaveLength(5);
    for (const s of amb) { const d = distance(hexAt(m, s), hexAt(m, party)); expect(d).toBeGreaterThanOrEqual(4); expect(d).toBeLessThanOrEqual(7); expect(s.hidden).toBe(true); }
    const camp = hexSceneMap(emptyMap('battle'), generateBattleScene('camp', 10, 3));
    const spots = placeEncounter(camp, 'camp', 4, { x: 0, y: 0 }, 1, new Set());
    for (const s of spots) expect(distance(hexAt(camp, s), { q: 0, r: 0 })).toBeLessThanOrEqual(3);
    expect(new Set(spots.map((s) => hexKey(hexAt(camp, s)))).size).toBe(4);
  });
});

describe('API: encounter generator', () => {
  const cid = 'campaign-b21';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.22', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
  let sinna: string;
  let me: { x: number; y: number } = { x: 0, y: 0 }; void me;
  const sheetOf = async () => ((await request('hannah', 'sheet', undefined, { token: sinna })).body as SheetPayload);
  const saveSheet = async (sheet: CharacterSheet) => {
    const cur = await sheetOf();
    expect((await request('hannah', 'sheet', { action: 'save', tokenId: sinna, sheet, expectedVersion: cur.version ?? 0 })).status).toBe(200);
  };
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



  it('the GM plans an orc band and places it as an ambush: hidden, on free hexes', async () => {
    await saveSheet(druid());
    const plan = await turn(scene.id, { action: 'encounter', op: 'plan', theme: 'orcs', situation: 'ambush', difficulty: 'hard', partySize: 1, partyLevel: 3, seed: 4 });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const entries = (plan.body as { plan: { entries: Array<{ templateId: string }> } }).plan.entries;
    expect(entries.length).toBeGreaterThan(0);
    const applied = await turn(scene.id, { action: 'encounter', op: 'apply', situation: 'ambush', seed: 4, entries });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const placed = enemiesOf(st(), scene.id);
    expect(placed).toHaveLength(entries.length);
    expect(placed.every((e) => effectsOf(st(), scene.id, `npc-${e.id}`).some((x) => x.key === 'hidden'))).toBe(true);
    expect(new Set(placed.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`)).size).toBe(placed.length);
    // players don't see hidden orcs (passive Perception 10 vs Stealth)
    const seen = ((await request('hannah', 'state')).body as PlayerPayload).scene!.figures ?? [];
    expect(seen.filter((f) => f.kind === 'enemy').length).toBeLessThanOrEqual(placed.length);
    expect((await request('hannah', 'scene-turn', { sceneId: scene.id, action: 'encounter', op: 'plan' })).status).toBe(403);
  });
});
