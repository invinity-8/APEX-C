/** APEX 2.4: the extended built-in enemy library – valid stat blocks, unique ids, a 3D model for every creature. */
import { describe, expect, it } from 'vitest';
import { BUILTIN_BESTIARY, parseStatBlock } from '../src/game/bestiary';
import { creatureFor } from '../src/components/map/creatures3d';

describe('extended bestiary', () => {
  it('130+ built-ins with unique ids that all pass the stat-block validation', () => {
    expect(BUILTIN_BESTIARY.length).toBeGreaterThanOrEqual(130);
    const ids = BUILTIN_BESTIARY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BUILTIN_BESTIARY) {
      const r = parseStatBlock(b);
      expect(r.ok, `${b.id}: ${r.ok ? '' : r.error}`).toBe(true);
      if (r.ok) { expect(r.block.attacks.length, b.id).toBe(b.attacks.length); expect(r.block.areas?.length ?? 0, b.id).toBe(b.areas?.length ?? 0); }
    }
  });
  it('every non-humanoid creature finds a 3D model by its name', () => {
    // humanoid-shaped undead and constructs use the figure kit
    const FIGURES = ['skeleton', 'zombie', 'ghoul', 'ghast', 'wight', 'mummy', 'shadow', 'ogre-zombie', 'animated-armor'];
    const missing = BUILTIN_BESTIARY.filter((b) => !/^humanoid|^giant/.test(b.type) && !FIGURES.includes(b.id) && !b.creature && !creatureFor(`${b.id} ${b.name}`)).map((b) => b.id);
    expect(missing).toEqual([]);
  });
});

import { sceneVision, lineOfSight } from '../src/campaign/hexVision';
import { generateBattleScene, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';
describe('flying vision', () => {
  it('a high flyer looks over a tree line; on the ground it blocks', () => {
    const blocks = (k: string) => k === '1,0';
    expect(lineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, blocks)).toBe(false);
    expect(lineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, blocks, () => 0, { a: 1, b: 0 })).toBe(false); // 5 ft: still below the crowns
    expect(lineOfSight({ q: 0, r: 0 }, { q: 2, r: 0 }, blocks, () => 0, { a: 8, b: 0 })).toBe(true); // 40 ft up
  });
  it('sees more of a forest map from 60 ft than on the ground', () => {
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('forest', 10, 7));
    const at = hexCentre(map, { q: 0, r: 0 });
    const clock = { day: 1, phase: 'day' as const, lighting: 'dim' as const, version: 0 };
    const ground = sceneVision(map, clock, [{ at, darkvisionFt: 0 }]);
    const air = sceneVision(map, clock, [{ at, darkvisionFt: 0, altFt: 60 }]);
    expect(air.size).toBeGreaterThan(ground.size * 1.3);
    for (const k of ground) expect(air.has(k)).toBe(true);
  });
});
