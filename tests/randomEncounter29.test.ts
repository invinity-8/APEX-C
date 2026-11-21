/** APEX 2.9: random encounter creator – proposals and quest characters placed with the party. */
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/campaign/hexScene';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { THEMES, rate } from '../src/game/encounters';
import { proposeEncounter, SITES_FOR, SITE_CHOICES } from '../src/game/randomEncounter';

const base = { site: 'any' as const, theme: 'any', situation: 'any' as const, difficulty: 'medium' as const, partySize: 4, partyLevel: 3, blocks: BUILTIN_BESTIARY };

describe('random encounter proposals', () => {
  it('every band has creatures from the library and fitting settings that exist', () => {
    for (const t of THEMES) {
      for (const id of [...t.leaders, ...t.troops, ...(t.support ?? [])]) expect(BUILTIN_BESTIARY.some((b) => b.id === id), `${t.id}: ${id}`).toBe(true);
      for (const s of SITES_FOR[t.id] ?? []) expect(PRESETS.battle.some((p) => p.id === s), `${t.id}: ${s}`).toBe(true);
      expect(SITES_FOR[t.id]?.length, t.id).toBeGreaterThan(0);
    }
  });
  it('deterministic, within the XP budget, named after band and setting', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = proposeEncounter({ ...base, seed });
      expect(proposeEncounter({ ...base, seed })).toEqual(p);
      expect(p.plan.entries.length).toBeGreaterThan(0);
      expect(SITE_CHOICES.some((x) => x.id === p.site)).toBe(true);
      expect(rate(p.plan.entries.map((e) => e.xp), 4, 3).adjusted).toBeLessThanOrEqual(p.plan.budget * 1.1);
      expect(p.name).toContain(THEMES.find((t) => t.id === p.theme)!.label);
    }
  });
  it('a chosen band gets a fitting setting; a chosen setting a fitting band; choices are kept', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(SITES_FOR.pirates).toContain(proposeEncounter({ ...base, theme: 'pirates', seed }).site);
      const p = proposeEncounter({ ...base, site: 'spiderlair', seed });
      expect(p.site).toBe('spiderlair');
      expect(p.theme).toBe('spiders');
    }
    const fixed = proposeEncounter({ ...base, site: 'bridge', theme: 'undead', situation: 'siege', seed: 3 });
    expect([fixed.site, fixed.theme, fixed.situation]).toEqual(['bridge', 'undead', 'siege']);
    // a bigger, deadlier fight for a bigger party
    const small = proposeEncounter({ ...base, theme: 'orcs', difficulty: 'easy', partySize: 2, seed: 5 });
    const big = proposeEncounter({ ...base, theme: 'orcs', difficulty: 'deadly', partySize: 6, partyLevel: 5, seed: 5 });
    expect(big.plan.budget).toBeGreaterThan(small.plan.budget);
    expect(big.radius).toBeGreaterThanOrEqual(small.radius);
  });
});
