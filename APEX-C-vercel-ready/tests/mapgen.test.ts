import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { floodFill, generateArena } from '../src/game/mapgen';
import { isPassable } from '../src/game/terrain';
import { hexKey } from '../src/game/hex';

describe('Arena-Generierung', () => {
  it('ist deterministisch (gleicher Seed → gleiche Karte)', () => {
    const a = generateArena({ radius: 12, seed: 42 });
    const b = generateArena({ radius: 12, seed: 42 });
    expect(a).toEqual(b);
    const c = generateArena({ radius: 12, seed: 43 });
    expect(c).not.toEqual(a);
  });

  it('enthält alle Geländearten und ein freies Zentrum', () => {
    const tiles = generateArena({ radius: 12, seed: 1337 });
    const types = new Set(Object.values(tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'mountain', 'water', 'ruins', 'magic', 'road']) expect(types).toContain(t);
    expect(tiles['0,0'].terrain).toBe('plains');
  });

  it('alle passierbaren Felder sind vom Zentrum aus erreichbar', () => {
    const tiles = generateArena({ radius: 12, seed: 1337 });
    const reach = floodFill(tiles, '0,0');
    for (const [k, t] of Object.entries(tiles)) if (isPassable(t.terrain)) expect(reach.has(k)).toBe(true);
  });

  it('Demo-Stand: Orte und Figuren stehen auf passierbaren Feldern', () => {
    const s = createDemoState();
    expect(Object.keys(s.hexes)).toHaveLength(469);
    for (const t of Object.values(s.tokens)) expect(isPassable(s.hexes[hexKey(t.pos)].terrain)).toBe(true);
    for (const site of Object.values(s.sites)) expect(s.hexes[hexKey(site.pos)].siteId).toBe(site.id);
  });

  it('Kartengröße ist konfigurierbar', () => {
    expect(Object.keys(createDemoState({ radius: 8 }).hexes)).toHaveLength(217);
  });
});
