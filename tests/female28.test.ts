/** APEX 2.8: every model also as a woman – presets, library choice, per-figure choice, creature variants. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneMap } from '../src/campaign/maps';
import { BUILTIN_BESTIARY, parseStatBlock } from '../src/game/bestiary';
import { autoLook, FIGURE_PRESETS, femaleLook, lookAsSex, lookFromPreset, maleLook, parseLook, parseSex } from '../src/game/figure';
import { enemiesOf } from '../src/game/sceneCombat';
import { executeCommand } from '../src/game/commands';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { SceneDefinition } from '../src/server/scenes';
import type { SceneSnapshot } from '../src/server/sceneRuntime';
import { creatureAsSex } from '../src/components/map/world3d';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

describe('figure presets in both versions', () => {
  it('every preset (heroes, NPCs, monsters) has a woman and a man – valid, deterministic, no beard on the women', () => {
    for (const p of FIGURE_PRESETS) for (const seed of [1, 99, 123456]) {
      const f = lookFromPreset(p, seed, 'female'), m = lookFromPreset(p, seed, 'male');
      expect(f.sex, p.id).toBe('female');
      expect(m.sex, p.id).toBe('male');
      expect(f.beard, p.id).toBe('none');
      expect(parseLook(f), p.id).toEqual(f);
      expect(parseLook(m), p.id).toEqual(m);
      expect(lookFromPreset(p, seed, 'female')).toEqual(f);
      // the version is the preset's own: same gear and colours as the default figure of the same seed
      const d = lookFromPreset(p, seed, d0(p.look.sex));
      expect([f.main, f.off, f.torso === d.torso || !!p.female?.torso]).toEqual([d.main, d.off, true]);
    }
  });
  it('presets that were always men now have a woman with her own touches (and the heroines a man)', () => {
    const preset = (id: string) => FIGURE_PRESETS.find((p) => p.id === id)!;
    const wizard = lookFromPreset(preset('wizard'), 5, 'female');
    expect([wizard.hair, wizard.beard, wizard.hat, wizard.main]).toEqual(['flowing', 'none', 'wizard', 'staff']);
    expect(lookFromPreset(preset('knight'), 5, 'female')).toMatchObject({ sex: 'female', hat: 'greathelm', hair: 'braid' });
    expect(lookFromPreset(preset('noble'), 5, 'female')).toMatchObject({ torso: 'dress', extra: 'necklace' });
    expect(lookFromPreset(preset('ogre'), 5, 'female')).toMatchObject({ sex: 'female', body: 'ogre', mouth: 'tusks' });
    expect(lookFromPreset(preset('skeleton'), 5, 'female')).toMatchObject({ sex: 'female', body: 'skeleton', hair: 'long' });
    expect(lookFromPreset(preset('witch'), 5, 'male')).toMatchObject({ sex: 'male', beard: 'long', hat: 'wizard' });
    expect(lookFromPreset(preset('shieldmaiden'), 5, 'male')).toMatchObject({ sex: 'male', beard: 'braided', off: 'roundshield' });
  });
  it('mixed gives men and women across a group; auto keeps the old behaviour', () => {
    const knight = FIGURE_PRESETS.find((p) => p.id === 'knight')!;
    const sexes = new Set(Array.from({ length: 20 }, (_, i) => lookFromPreset(knight, i * 37 + 1, 'mixed').sex));
    expect([...sexes].sort()).toEqual(['female', 'male']);
    // without a choice the knight preset stays as it always was
    expect(new Set(Array.from({ length: 20 }, (_, i) => lookFromPreset(knight, i * 37 + 1).sex))).toEqual(new Set(['male']));
    const bandits = Array.from({ length: 20 }, (_, i) => autoLook('Bandit humanoid', `b-${i}`, undefined, 'female')!);
    expect(bandits.every((b) => b.sex === 'female' && b.beard === 'none')).toBe(true);
    expect(autoLook('Orc warrior', 'x', undefined, 'male')!.sex).toBe('male');
  });
  it('a saved figure turns into the woman or the man of itself', () => {
    const base = lookFromPreset(FIGURE_PRESETS.find((p) => p.id === 'cleric')!, 3);
    expect(base.beard).toBe('full');
    const f = femaleLook(base);
    expect(f).toMatchObject({ sex: 'female', beard: 'none', hair: 'bob', torso: base.torso, main: base.main, primary: base.primary });
    expect(maleLook(f).sex).toBe('male');
    expect(lookAsSex(base, 'female', 't1').sex).toBe('female');
    expect(lookAsSex(base, undefined, 't1')).toBe(base);
    const mixed = new Set(Array.from({ length: 12 }, (_, i) => lookAsSex(base, 'mixed', `tok-${i}`).sex));
    expect(mixed.size).toBe(2);
  });
  it('creature models: the female / male animal; young ones stay young, a variant in the name wins over “mixed”', () => {
    expect(creatureAsSex({ kind: 'lion' }, 'female', 'a')).toEqual({ kind: 'lion', variant: 'female' });
    expect(creatureAsSex({ kind: 'lion', variant: 'young' as const }, 'female', 'a').variant).toBe('young');
    expect(creatureAsSex({ kind: 'lion', variant: 'female' as const }, 'mixed', 'a').variant).toBe('female');
    expect(creatureAsSex({ kind: 'lion', variant: 'female' as const }, 'male', 'a').variant).toBe('male');
    expect(new Set(Array.from({ length: 12 }, (_, i) => creatureAsSex({ kind: 'wolf' }, 'mixed', `w${i}`).variant))).toEqual(new Set(['male', 'female']));
  });
  it('stat blocks keep the choice; invalid values are dropped', () => {
    expect(parseSex('mixed')).toBe('mixed');
    expect(parseSex('other')).toBeNull();
    const orc = BUILTIN_BESTIARY.find((b) => b.id === 'orc')!;
    const ok = parseStatBlock({ ...orc, sex: 'female' });
    expect(ok.ok && ok.block.sex).toBe('female');
    const bad = parseStatBlock({ ...orc, sex: 'robot' });
    expect(bad.ok && bad.block.sex).toBeUndefined();
  });
});
const d0 = (s: string | undefined) => (s === 'female' ? 'female' : 'male') as 'female' | 'male';

describe('API: women and men on the battle map', () => {
  const cid = 'campaign-fem28';
  let repo: MemoryRepo;
  let cookies: Record<string, string>;
  const request = async (profile: string, op: string, body?: unknown, query: Record<string, string> = {}) =>
    handleApi({ method: body === undefined ? 'GET' : 'POST', op, body: body ?? null, query, ip: '203.0.113.21', headers: { host: 'apex.test', origin: 'https://apex.test', 'x-apex-csrf': '1', cookie: cookies[profile] } }, repo);
  const turn = (sceneId: string, body: Record<string, unknown>, who = 'gm') => request(who, 'scene-turn', { sceneId, ...body });
  const st = () => repo.states.get(cid)!.state;
  let scene: SceneDefinition;
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
    scene = ((await request('gm', 'scenes', { action: 'publish', id: created.scene.id, revision: created.scene.revision, map: meta })).body as { scene: SceneDefinition }).scene;
  });

  it('the library choice and the per-figure choice reach the 3D figures; only the GM may change them', async () => {
    const orc = BUILTIN_BESTIARY.find((b) => b.id === 'orc')!;
    const saved = executeCommand(st(), { role: 'gm' }, { type: 'enemyLibrarySave', block: { ...orc, source: 'custom', sex: 'mixed' } });
    expect(saved.ok).toBe(true);
    if (saved.ok) repo.states.get(cid)!.state = saved.state;
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc', x: 400, y: 300 })).status).toBe(200);
    expect((await turn(scene.id, { action: 'enemyAdd', templateId: 'orc', x: 460, y: 300 })).status).toBe(200);
    const [a, b] = enemiesOf(st(), scene.id);
    const figures = async () => ((await request('gm', 'scene-runtime', undefined, { focus: scene.id })).body as SceneSnapshot).figures!;
    expect((await figures()).filter((f) => f.kind === 'enemy').map((f) => f.sex)).toEqual(['mixed', 'mixed']);
    expect((await turn(scene.id, { action: 'npcSex', enemyId: a.id, sex: 'female' }, 'hannah')).status).toBe(403);
    expect((await turn(scene.id, { action: 'npcSex', enemyId: a.id, sex: 'robot' })).status).toBe(400);
    expect((await turn(scene.id, { action: 'npcSex', enemyId: a.id, sex: 'female' })).status).toBe(200);
    expect(enemiesOf(st(), scene.id)[0].sex).toBe('female');
    expect((await figures()).find((f) => f.id === a.id)!.sex).toBe('female');
    expect((await figures()).find((f) => f.id === b.id)!.sex).toBe('mixed');
    expect((await turn(scene.id, { action: 'npcSex', enemyId: a.id, sex: null })).status).toBe(200);
    expect(enemiesOf(st(), scene.id)[0].sex).toBeUndefined();
    expect((await turn(scene.id, { action: 'npcSex', enemyId: 'nope', sex: 'male' })).status).not.toBe(200);
  });
});
