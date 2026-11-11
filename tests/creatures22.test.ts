/** APEX 2.2: creature kit, mounts, wings, sculpted hair – every part builds, names map to sensible models. */
import { describe, expect, it } from 'vitest';
import { CREATURES, buildCreature, creatureFor } from '../src/components/map/creatures3d';
import { buildLowPoly } from '../src/components/map/lowpoly';
import { CREATURE_KINDS, parseCreature } from '../src/game/creatures';
import { DEFAULT_LOOK, FIGURE_PARTS, parseLook } from '../src/game/figure';
import { BUILTIN_BESTIARY, parseStatBlock } from '../src/game/bestiary';

describe('creature kit', () => {
  it('the pure id list and the 3D builders match; every model builds with a height and wings for flyers', () => {
    expect(CREATURE_KINDS.slice().sort()).toEqual(Object.keys(CREATURES).sort());
    expect(CREATURE_KINDS.length).toBeGreaterThanOrEqual(70);
    for (const k of CREATURE_KINDS) {
      const m = buildCreature(k, undefined, true)!;
      expect(m, k).toBeTruthy();
      expect(m.height, k).toBeGreaterThan(0.3);
      expect(m.group.children.length, k).toBeGreaterThan(0);
      if (['eagle', 'bat', 'pegasus', 'griffon', 'dragon', 'wyvern'].includes(k)) expect(m.wings.length, k).toBe(2);
    }
  });
  it('names and types of common monsters pick the right model; humanoids pick none', () => {
    const pick = (t: string) => creatureFor(t)?.kind ?? null;
    expect(pick('Young Red Dragon dragon')).toBe('dragon');
    expect(creatureFor('Adult Blue Dragon dragon')?.tint).toBe('blue');
    expect(pick('Wyvern dragon')).toBe('wyvern');
    expect(pick('Beholder aberration')).toBe('beholder');
    expect(pick('Owlbear monstrosity')).toBe('owlbear');
    expect(pick('Hippogriff monstrosity')).toBe('hippogriff');
    expect(pick('Griffon monstrosity')).toBe('griffon');
    expect(pick('Dire Wolf beast')).toBe('wardog');
    expect(pick('Wolf beast')).toBe('wolf');
    expect(pick('Brown bear beast')).toBe('bear');
    expect(pick('Giant bat beast')).toBe('bat');
    expect(pick('Blood hawk beast')).toBe('eagle');
    expect(pick('Gelatinous Cube ooze')).toBe('cube');
    expect(pick('Black Pudding ooze')).toBe('ooze');
    expect(pick('Fire Elemental elemental')).toBe('fire');
    expect(pick('Stone Golem construct')).toBe('golem');
    expect(pick('Ghost undead')).toBe('ghost');
    expect(pick('Mimic monstrosity')).toBe('mimic');
    expect(pick('Riding Horse beast')).toBe('horse');
    expect(pick('Warhorse beast')).toBe('warhorse');
    expect(pick('Some aberration')).toBe('mouther');
    for (const h of ['Bandit humanoid', 'Cultist humanoid', 'Orc humanoid', 'Thug humanoid', 'Goblin humanoid', 'Skeleton undead']) expect(pick(h), h).toBeNull();
  });
  it('explicit creature choices are validated; stat blocks keep a valid one and drop an invalid one', () => {
    expect(parseCreature({ kind: 'dragon', tint: 'gold' })).toEqual({ kind: 'dragon', tint: 'gold' });
    expect(parseCreature({ kind: 'ooze', tint: '#AA3300' })).toEqual({ kind: 'ooze', tint: '#aa3300' });
    expect(parseCreature({ kind: 'tarrasque' })).toBeNull();
    expect(parseCreature({ kind: 'dragon', tint: 'plaid' })).toBeNull();
    const base = { ...BUILTIN_BESTIARY.find((b) => b.id === 'wolf')!, id: 'shadow-wolf' };
    const ok = parseStatBlock({ ...base, creature: { kind: 'hellhound' } });
    expect(ok.ok && ok.block.creature).toEqual({ kind: 'hellhound' });
    const bad = parseStatBlock({ ...base, creature: { kind: 'nope' } });
    expect(bad.ok && bad.block.creature).toBeUndefined();
  });
});

describe('figure kit 2.2: hair, beards, wings, mounts', () => {
  it('every hairstyle, beard, back item and mount builds; riders sit higher than walkers', () => {
    expect(FIGURE_PARTS.hair.length).toBeGreaterThanOrEqual(28);
    for (const hair of FIGURE_PARTS.hair) for (const hat of ['none', 'helmet', 'hood']) expect(buildLowPoly({ ...DEFAULT_LOOK, hair, hat } as never).height, `${hair}/${hat}`).toBeGreaterThan(1);
    for (const beard of FIGURE_PARTS.beard) expect(buildLowPoly({ ...DEFAULT_LOOK, beard }).height).toBeGreaterThan(1);
    for (const back of FIGURE_PARTS.back) expect(buildLowPoly({ ...DEFAULT_LOOK, back }).height).toBeGreaterThan(1);
    const walk = buildLowPoly(DEFAULT_LOOK).height;
    for (const mount of FIGURE_PARTS.mount.filter((m) => m !== 'none')) {
      expect(CREATURE_KINDS, mount).toContain(mount);
      const r = buildLowPoly({ ...DEFAULT_LOOK, mount });
      expect(r.height, mount).toBeGreaterThan(walk);
    }
    expect(buildLowPoly({ ...DEFAULT_LOOK, mount: 'pegasus' }).wings?.length).toBe(2);
    // saved looks from 2.1 (no mount) stay valid
    const { mount: _m, ...old } = DEFAULT_LOOK; void _m;
    expect(parseLook(old)?.mount).toBe('none');
  });
});
