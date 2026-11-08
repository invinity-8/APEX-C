/**
 * APEX 1.5: buffs and support spells on allies and yourself (Mage Armor, Barkskin, Longstrider, Haste, False Life,
 * Heroism, Lesser Restoration, Cure Wounds), AC and speed from effects, and which spells count as harmful.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { acWith, addEffect, conditionEffect, effectsOf, speedWith } from '../src/game/combatEffects';
import { supportive } from '../src/game/spellEffects';
import { harmful } from '../src/components/pcInteraction';
import { withSrdMechanics } from '../src/game/srdSpellMechanics';
import { emptySheet, type CharacterSheet } from '../src/game/sheet';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { PlayerPayload, SheetPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const bare = (name: string, level = 0) => ({ id: name.toLowerCase().replace(/ /g, '-'), name, level, prepared: true, source: '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });

describe('rules', () => {
  it('AC and speed from effects', () => {
    const mods = (m: object) => ({ mods: m });
    expect(acWith([mods({ acBase: 13 })], 11, 3)).toBe(16); // Mage Armor: 13 + Dex
    expect(acWith([mods({ acBase: 13 })], 18, 0)).toBe(18); // plate is better
    expect(acWith([mods({ acMin: 16 }), mods({ ac: 2 })], 12, 1)).toBe(18); // Barkskin, then Haste
    expect(speedWith([mods({ speed: 10 })], 30)).toBe(40);
    expect(speedWith([mods({ speedMult: 2 }), mods({ speed: 10 })], 30)).toBe(80);
    expect(speedWith([mods({ speedMult: 2 }), mods({ speedZero: true })], 30)).toBe(0);
  });

  it('support spells are not harmful; damage spells are', () => {
    for (const n of ['Mage Armor', 'Cure Wounds', 'Bless', 'False Life', 'Healing Word']) expect(harmful(withSrdMechanics(bare(n, 1))), n).toBe(false);
    for (const n of ['Fire Bolt', 'Fireball', 'Hold Person']) expect(harmful(withSrdMechanics(bare(n, 1))), n).toBe(true);
    expect(supportive(bare('Mage Armor', 1))).toBe(true);
    expect(supportive(bare('Bane', 1))).toBe(false);
  });
});

describe('API: buffs on allies and yourself', () => {
  const cid = 'campaign-b15';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.17', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
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

  it('Mage Armor and Longstrider on yourself; False Life gives temporary HP; Cure Wounds heals', async () => {
    await saveSheet(caster([bare('Mage Armor', 1), bare('Longstrider', 1), bare('False Life', 1), bare('Cure Wounds', 1)]));
    const ma = await cast('mage-armor', 1, [self]);
    expect(ma.status, JSON.stringify(ma.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).map((e) => e.key)).toContain('mage-armor');
    const ls = await cast('longstrider', 1, [self]);
    expect(ls.status, JSON.stringify(ls.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).find((e) => e.key === 'longstrider')?.mods.speed).toBe(10);
    const fl = await cast('false-life', 1);
    expect(fl.status, JSON.stringify(fl.body)).toBe(200);
    expect((fl.body as { message: string }).message).toMatch(/gains \d+ temporary hit points/);
    expect((await sheetOf()).sheet!.hitPoints!.temp).toBeGreaterThanOrEqual(5);
    const cw = await cast('cure-wounds', 2, [self]); // upcast: 2d8 + 4
    expect(cw.status, JSON.stringify(cw.body)).toBe(200);
    expect((await sheetOf()).sheet!.hitPoints!.current).toBeGreaterThanOrEqual(16);
  });

  it('Longstrider raises the movement allowance in a fight; Lesser Restoration ends poison', async () => {
    await saveSheet(caster([bare('Longstrider', 1), bare('Lesser Restoration', 2)]));
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'goblin', x: me.x + 6 * step, y: me.y })).status).toBe(200);
    expect((await turn(scene.id, { action: 'startInitiative' })).status).toBeLessThan(500);
    const before = ((await request('hannah', 'state')).body as PlayerPayload).scene!.movement;
    expect((await cast('longstrider', 1, [self])).status).toBe(200);
    const after = ((await request('hannah', 'state')).body as PlayerPayload).scene!.movement;
    expect(before?.mode).toBe('turn');
    expect(after!.allowance).toBe(before!.allowance + 10);
    const enc = st().sceneEncounters?.[scene.id];
    if (enc?.economy) delete enc.economy[`pc-${sinna}`]; // a new turn of Sinna's
    const s = st();
    addEffect(s, scene.id, `pc-${sinna}`, conditionEffect('poisoned', { actor: 'gm', name: 'GM' }, () => 'fx-p'));
    const lr = await cast('lesser-restoration', 2, [self]);
    expect(lr.status, JSON.stringify(lr.body)).toBe(200);
    expect(effectsOf(st(), scene.id, `pc-${sinna}`).some((e) => e.key === 'poisoned')).toBe(false);
  });

  it('a single-target buff needs a target; harmful spells still target enemies', async () => {
    await saveSheet(caster([bare('Mage Armor', 1)]));
    const none = await cast('mage-armor', 1);
    expect(none.status).toBe(422);
  });
});
