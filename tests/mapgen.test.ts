import { describe, expect, it } from 'vitest';
import { DEFAULT_RADIUS, MAX_RADIUS, createDemoState } from '../src/data/demo';
import { buildPlayerView } from '../src/game/visibility';
import { floodFill, generateArena } from '../src/game/mapgen';
import { isPassable } from '../src/game/terrain';
import { ORIGIN, distance, hexKey, neighbors } from '../src/game/hex';

describe('Arena generation', () => {
  it('is deterministic (same seed → same map)', () => {
    const a = generateArena({ radius: 12, seed: 42 });
    const b = generateArena({ radius: 12, seed: 42 });
    expect(a).toEqual(b);
    const c = generateArena({ radius: 12, seed: 43 });
    expect(c).not.toEqual(a);
  });

  it('contains every core terrain type and a walkable centre', () => {
    const tiles = generateArena({ radius: 12, seed: 1337 });
    const types = new Set(Object.values(tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'mountain', 'water', 'ruins', 'magic', 'road']) expect(types).toContain(t);
    expect(tiles['0,0'].terrain).toBe('plains');
  });

  it('the full arena has rivers, hills and coherent biome regions', () => {
    const tiles = generateArena({ radius: 39, seed: 1337 });
    const list = Object.values(tiles);
    expect(list).toHaveLength(4681);
    const types = new Set(list.map((t) => t.terrain));
    for (const t of ['river', 'hills', 'mountain', 'forest', 'water', 'ruins', 'magic', 'road']) expect(types).toContain(t);
    // Coherence: most hexes share their terrain with the majority of their neighbours.
    let same = 0;
    let total = 0;
    for (const t of list) {
      for (const n of neighbors(t)) {
        const nt = tiles[hexKey(n)];
        if (!nt) continue;
        total++;
        if (nt.terrain === t.terrain) same++;
      }
    }
    expect(same / total).toBeGreaterThan(0.6);
  });

  it('every passable hex is reachable from the centre', () => {
    for (const radius of [12, 39]) {
      const tiles = generateArena({ radius, seed: 1337 });
      const reach = floodFill(tiles, '0,0');
      for (const [k, t] of Object.entries(tiles)) if (isPassable(t.terrain)) expect(reach.has(k)).toBe(true);
    }
  });

  it('the centre holds the Aquila Aurea surrounded by the labyrinth', () => {
    const tiles = generateArena({ radius: 39, seed: 7 });
    expect(tiles['0,0'].feature).toBe('eagle');
    const lab = Object.values(tiles).filter((t) => t.feature === 'labyrinth');
    expect(lab.length).toBeGreaterThan(30);
    for (const t of lab) expect(distance(t, ORIGIN)).toBeLessThanOrEqual(4);
  });

  it('demo state: default arena is radius 39 and sites/characters stand on passable hexes', () => {
    const s = createDemoState();
    expect(s.config.mapRadius).toBe(DEFAULT_RADIUS);
    expect(Object.keys(s.hexes)).toHaveLength(4681);
    for (const t of Object.values(s.tokens)) expect(isPassable(s.hexes[hexKey(t.pos)].terrain)).toBe(true);
    for (const site of Object.values(s.sites)) expect(s.hexes[hexKey(site.pos)].siteId).toBe(site.id);
  });

  it('map size is configurable (small maps for testing)', () => {
    expect(Object.keys(createDemoState({ radius: 8 }).hexes)).toHaveLength(217);
    expect(Object.keys(createDemoState({ radius: 12 }).hexes)).toHaveLength(469);
  });

  it('maximum arena radius 78: valid, reachable, sites placed, default unchanged, clamped above', () => {
    expect(MAX_RADIUS).toBe(78);
    expect(DEFAULT_RADIUS).toBe(39);
    const s = createDemoState({ radius: 78, seed: 1337 });
    expect(Object.keys(s.hexes)).toHaveLength(18487);
    const reach = floodFill(s.hexes, '0,0');
    for (const [k, t] of Object.entries(s.hexes)) if (isPassable(t.terrain)) expect(reach.has(k)).toBe(true);
    for (const t of Object.values(s.tokens)) expect(isPassable(s.hexes[hexKey(t.pos)].terrain)).toBe(true);
    for (const site of Object.values(s.sites)) expect(s.hexes[hexKey(site.pos)].siteId).toBe(site.id);
    // the shrinking zone scales with the radius
    expect(s.config.shrink.ringsPerStep).toBeGreaterThanOrEqual(6);
    // payload budgets (Vercel response limit is 4.5 MB): full state well below, fresh player view tiny
    expect(JSON.stringify(s).length).toBeLessThan(1_500_000);
    expect(JSON.stringify(buildPlayerView(s, 'sinna')).length).toBeLessThan(100_000);
    expect(createDemoState({ radius: 200 }).config.mapRadius).toBe(78);
  }, 30_000);
});
