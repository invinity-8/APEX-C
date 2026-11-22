/** APEX 2.11 – the Obelisk: tiers, proposals, records, the wipe, and a whole trial through the API. */
import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { rate } from '../src/game/encounters';
import { enemiesOf } from '../src/game/sceneCombat';
import { emptySheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import {
  afterClear, dangerFor, emptyRecord, fightOutcome, obeliskProposal, OBELISK_MAX, tierLevel, tierPlan, wipeInventory,
} from '../src/game/obelisk';
import { QUEST_BASE } from '../src/game/items/lootDraft';
import { CUBE_BASE } from '../src/game/items/cubeProgression';
import type { Item, Token } from '../src/game/types';
import { handleApi, resetSchemaCache } from '../src/server/api';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, name: id, kind: 'misc', description: '', quantity: 1, rev: 0, ...extra });

describe('APEX 2.11 – Obelisk tiers', () => {
  it('tier 1 is level 1, tier 150 is level 25; the fights grow with the tier', () => {
    expect(tierLevel(1)).toBe(1);
    expect(tierLevel(OBELISK_MAX)).toBe(25);
    expect(tierLevel(999)).toBe(25);
    const budget = (t: number) => { const p = tierPlan(t); return rate([], p.partySize, p.partyLevel) && p; };
    expect(budget(150)).toMatchObject({ partyLevel: 20, difficulty: 'deadly' });
    expect(tierPlan(150).partySize).toBeCloseTo(2);
    expect(tierPlan(10).loot).toBe('boss');
    expect(tierPlan(5).loot).toBe('elite');
    expect(tierPlan(7).loot).toBe('standard');
  });
  it('a proposal fits the tier – a level-1 hero never meets an ogre, tier 150 is a war band of giants', () => {
    for (const t of [1, 2, 3, 6, 12, 25, 50, 80, 110, 150]) for (const seed of [1, 77, 4242]) {
      const p = obeliskProposal(t, 1, seed, BUILTIN_BESTIARY);
      expect(p.plan.entries.length, `${t}/${seed}`).toBeGreaterThan(0);
      // never far over the budget (one cheapest creature may be needed at tier 1)
      expect(p.plan.rating.adjusted, `${t}/${seed}`).toBeLessThanOrEqual(Math.max(40, p.budget * 1.2));
    }
    const low = obeliskProposal(1, 1, 9, BUILTIN_BESTIARY);
    expect(low.plan.entries.every((e) => !/ogre|giant|dragon/i.test(e.templateId))).toBe(true);
    expect(obeliskProposal(150, 1, 9, BUILTIN_BESTIARY).plan.rating.adjusted).toBeGreaterThan(15000);
    // no farm animals at the Obelisk
    for (let seed = 0; seed < 40; seed++) for (const e of obeliskProposal(1 + (seed % 4), 1, seed, BUILTIN_BESTIARY).plan.entries) expect(e.templateId).not.toMatch(/^(sheep|cow|raven|goat|deer)$/);
  });
  it('a clear opens two more tiers (up to 150)', () => {
    expect(afterClear(emptyRecord(), 1)).toMatchObject({ unlocked: 3, best: 1, clears: 1 });
    expect(afterClear({ ...emptyRecord(), unlocked: 9, best: 8 }, 3)).toMatchObject({ unlocked: 9, best: 8 });
    expect(afterClear({ ...emptyRecord(), unlocked: 150 }, 149).unlocked).toBe(150);
  });
  it('the danger shown depends on the character level, not a printed level', () => {
    expect(dangerFor(1, 5)).toBe('trivial');
    expect(dangerFor(30, 5)).toBe('challenging');
    expect(dangerFor(150, 20)).toBe('deadly');
  });
  it('victory when no foe fights any more, defeat when every hero is down', () => {
    expect(fightOutcome({ foes: [{ hp: 0, defeated: true }, { hp: 5, morale: { surrendered: true } }], heroes: [{ current: 3 }] })).toBe('victory');
    expect(fightOutcome({ foes: [{ hp: 5 }], heroes: [{ current: 0 }] })).toBe('defeat');
    expect(fightOutcome({ foes: [{ hp: 5 }], heroes: [{ current: 0, wildShape: true }] })).toBeNull();
    expect(fightOutcome({ foes: [{ hp: 5 }, { hp: 0, defeated: true }], heroes: [{ current: 7 }] })).toBeNull();
    expect(fightOutcome({ foes: [{ hp: 5, side: 'ally' }], heroes: [{ current: 7 }] })).toBeNull();
  });
  it('a wipe takes the gear (and the equipment) but leaves quest items and the Cube', () => {
    const t = { id: 't', name: 'T', inventory: [item('sword'), item('quest', { baseId: QUEST_BASE, quest: {} }), item('cube', { baseId: CUBE_BASE }), item('potion')], equipment: { slots: { main1: 'sword' }, activeSet: 1, resting: false, restingKeep: [] } } as unknown as Token;
    const gone = wipeInventory(t);
    expect(gone.map((i) => i.id)).toEqual(['sword', 'potion']);
    expect(t.inventory.map((i) => i.id)).toEqual(['quest', 'cube']);
    expect(t.equipment?.slots.main1).toBeUndefined();
  });
});

describe('APEX 2.11 – a trial through the API', () => {
  const cid = 'campaign-obelisk';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.21', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const user = (key: string) => repo.profileList.find((p) => p.key === key)!;
  const st = () => repo.states.get(cid)!.state;
  const ob = (who: string, body: Record<string, unknown>) => request(who, 'obelisk', body);
  let hero: string;
  const sheetHp = async () => ((await repo.loadSheet(cid, hero))!.data as { hitPoints: { current: number; max: number } }).hitPoints;
  const setHp = async (current: number) => { const row = (await repo.loadSheet(cid, hero))!; await repo.saveSheet(cid, hero, { ...(row.data as object), hitPoints: { ...(row.data as { hitPoints: object }).hitPoints, current } }, row.version, 'test'); };

  beforeEach(async () => {
    resetSchemaCache(); repo = new MemoryRepo(); cookies = {};
    repo.campaigns.push({ id: cid, slug: 'main', name: 'Campaign' }); seedProfiles(repo, cid);
    repo.states.set(cid, { state: createDemoState({ radius: 12, seed: 5 }), version: 1 });
    for (const key of ['gm', 'hannah']) {
      await activate(repo, cid, key, `${key}-test-password`);
      cookies[key] = (await request(key, 'login', { profile: key, password: `${key}-test-password` })).cookies![0].split(';')[0];
    }
    hero = user('hannah').tokenIds[0];
    await repo.saveSheet(cid, hero, { ...emptySheet(), details: [{ id: 'l', label: 'Level', value: '3' }], hitPoints: { current: 17, max: 30, temp: 2 }, resources: [{ id: 'r', name: 'Spell Slots (1st)', current: 0, max: 3 }] }, 0, 'test');
    const t = st().tokens[hero];
    t.inventory = [item('ob-sword'), item('ob-letter', { baseId: QUEST_BASE, quest: {} })];
  });

  it('enter tier 1, fall, lose the gear, get an item back from the GM, accept the wipe, win, open tiers 2 and 3', async () => {
    // only tier 1 is open
    expect((await ob('hannah', { action: 'start', tokenId: hero, tier: 2 })).status).toBe(403);
    const status0 = (await request('hannah', 'obelisk')).body as { characters: Array<{ tokenId: string; level: number; record: { unlocked: number } }> };
    expect(status0.characters).toEqual([expect.objectContaining({ tokenId: hero, level: 3, record: expect.objectContaining({ unlocked: 1 }) })]);
    const before = (await repo.sceneRuntime.assignment(cid, user('hannah').userId))?.scene_id ?? null;
    const started = await ob('hannah', { action: 'start', tokenId: hero, tier: 1 });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const run = (started.body as { run: { sceneId: string } }).run;
    // a real scene: the player is there, enemies stand, initiative runs, the AI is on
    expect((await repo.sceneRuntime.assignment(cid, user('hannah').userId))?.scene_id).toBe(run.sceneId);
    expect(enemiesOf(st(), run.sceneId).length).toBeGreaterThan(0);
    expect(st().sceneEncounters?.[run.sceneId]?.status).toBe('active');
    expect(st().sceneAi?.[run.sceneId]?.on).toBe(true);
    // the Obelisk's creatures know no fear: a lone foe does not break and run
    expect(enemiesOf(st(), run.sceneId).every((e) => e.fearless)).toBe(true);
    expect(fightOutcome({ foes: [{ hp: 5, morale: { broken: true } }], heroes: [{ current: 9 }] })).toBe('victory'); // (outside the Obelisk a panicked foe counts as beaten)
    // full strength for the trial
    expect(await sheetHp()).toMatchObject({ current: 30, max: 30 });
    // a second trial cannot start; the player's state does not carry the GM's Obelisk records
    expect((await ob('hannah', { action: 'start', tokenId: hero, tier: 1 })).status).toBe(409);
    expect(JSON.stringify((await request('hannah', 'state')).body)).not.toContain('"obelisk"');
    // everybody rolled initiative – the hero and the enemies
    const enc = st().sceneEncounters![run.sceneId];
    expect(enc.participants.some((p) => p.id === `pc-${hero}`)).toBe(true);
    expect(enc.participants.some((p) => p.id.startsWith('npc-'))).toBe(true);
    // on an enemy's turn a beat lets the AI act (the player's client calls it, the server steers the enemy)
    enc.turnIndex = enc.participants.findIndex((p) => p.id.startsWith('npc-')); enc.turnSerial = (enc.turnSerial ?? 0) + 1;
    const beat = await ob('hannah', { action: 'tick' });
    expect(beat.status).toBe(200);
    expect((beat.body as { ai: { idle: boolean } }).ai.idle).toBe(false);
    expect(JSON.stringify(beat.body)).not.toContain('morale'); // the hidden morale rolls stay with the GM
    // the hero falls
    await setHp(0);
    const fell = await ob('hannah', { action: 'tick' });
    expect(fell.body).toMatchObject({ outcome: 'defeat', lost: 1 });
    expect(st().tokens[hero].inventory.map((i) => i.id)).toEqual(['ob-letter']);
    // the campaign hit points and slots are back, the player is back where they were, the scene is archived and forgotten
    expect(await sheetHp()).toMatchObject({ current: 17, max: 30 });
    expect(((await repo.loadSheet(cid, hero))!.data as { resources: Array<{ current: number }> }).resources[0].current).toBe(0);
    expect((await repo.sceneRuntime.assignment(cid, user('hannah').userId))?.scene_id ?? null).toBe(before);
    expect(before).not.toBe(run.sceneId);
    expect((await repo.sceneCatalog.get(cid, run.sceneId))?.archived).toBe(true);
    expect(st().sceneEnemies?.[run.sceneId]).toBeUndefined();
    // the GM is alerted and gives the sword back
    const o = st().obelisk!;
    expect(o.alerts?.[0]).toMatchObject({ tokenId: hero, tier: 1, count: 1 });
    expect((await ob('hannah', { action: 'restore', tokenId: hero, lossId: o.alerts![0].lossId, itemId: 'ob-sword' })).status).toBe(400);
    expect((await ob('gm', { action: 'restore', tokenId: hero, lossId: o.alerts![0].lossId, itemId: 'ob-sword' })).status).toBe(200);
    expect(st().tokens[hero].inventory.map((i) => i.id).sort()).toEqual(['ob-letter', 'ob-sword']);
    // no new trial before the wipe is accepted
    expect((await ob('hannah', { action: 'start', tokenId: hero, tier: 1 })).status).toBe(409);
    expect((await ob('hannah', { action: 'acceptWipe', tokenId: hero })).status).toBe(200);
    // the second try: every foe falls → victory, loot, tiers 2 and 3 open, the level stays
    const again = await ob('hannah', { action: 'start', tokenId: hero, tier: 1 });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const s2 = (again.body as { run: { sceneId: string } }).run.sceneId;
    for (const e of enemiesOf(st(), s2)) { e.hp = 0; e.defeated = true; }
    const won = await ob('hannah', { action: 'tick' });
    expect(won.body).toMatchObject({ outcome: 'victory', tier: 1 });
    expect(st().tokens[hero].inventory.some((i) => i.source?.label === 'Obelisk tier 1') || ((won.body as { loot?: string[] }).loot ?? []).length > 0).toBe(true);
    const status1 = (await request('hannah', 'obelisk')).body as { characters: Array<{ level: number; record: { unlocked: number; best: number; deaths: number; last?: { outcome: string }; losses?: unknown } }>; run: unknown };
    expect(status1.run).toBeNull();
    expect(status1.characters[0]).toMatchObject({ level: 3, record: { unlocked: 3, best: 1, deaths: 1, last: { outcome: 'victory' } } });
    expect(status1.characters[0].record.losses).toBeUndefined(); // the GM's restore list stays with the GM
  });

  it('keystones: the GM hands them out and decides whether a trial costs one; withdrawing needs strength', async () => {
    expect((await ob('hannah', { action: 'required', on: true })).status).toBe(400);
    expect((await ob('gm', { action: 'required', on: true })).status).toBe(200);
    expect((await ob('hannah', { action: 'start', tokenId: hero, tier: 1 })).status).toBe(409);
    expect((await ob('gm', { action: 'keystones', tokenId: hero, delta: 2 })).status).toBe(200);
    expect((await ob('hannah', { action: 'start', tokenId: hero, tier: 1 })).status).toBe(200);
    expect(st().obelisk!.records[hero].keystones).toBe(1);
    // badly hurt: no way out but through
    await setHp(10);
    expect((await ob('hannah', { action: 'withdraw' })).status).toBe(409);
    await setHp(25);
    const left = await ob('hannah', { action: 'withdraw' });
    expect(left.body).toMatchObject({ outcome: 'withdrawn' });
    expect(st().tokens[hero].inventory.length).toBe(2);
    expect(st().obelisk!.records[hero].unlocked).toBe(1);
    // the GM can open tiers by hand
    expect((await ob('gm', { action: 'unlock', tokenId: hero, unlocked: 40 })).status).toBe(200);
    expect(st().obelisk!.records[hero].unlocked).toBe(40);
  });
});

describe('APEX 2.11 – sculpted heads', () => {
  it('one smooth head mesh with a face: brow, sockets, nose and chin stand out where they should', async () => {
    const { faceAt, headGeometry } = await import('../src/components/map/head3d');
    const f = { w: 0.8, h: 1, d: 0.95, jaw: 0.78, brow: 0.055, cheek: 0.03, nose: 0.16, noseW: 1, noseLen: 1, hook: 0, crook: 0, lips: 0.018, chin: 0.05, gaunt: 0, chubby: 0 };
    const len = (x: number, y: number) => { const z = Math.sqrt(1 - x * x - y * y); return faceAt(f, x, y, z).length(); };
    expect(len(0, -0.24)).toBeGreaterThan(len(0.2, -0.24)); // the nose tip stands out
    expect(len(0.31, 0.035)).toBeLessThan(len(0.31, 0.2)); // the eye sits in a socket under the brow
    const back = faceAt(f, 0, 0, -1).length(), front = faceAt(f, 0, 0, 1).length();
    expect(front).toBeGreaterThan(back * 0.9);
    const g = headGeometry(f, 0.1);
    expect(g.attributes.normal).toBeTruthy();
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new (await import('three')).Vector3());
    expect(size.y).toBeGreaterThan(size.x * 1.1); // taller than wide – no ball heads
  });
});
