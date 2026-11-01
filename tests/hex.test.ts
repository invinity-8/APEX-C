import { describe, expect, it } from 'vitest';
import { distance, fromPixel, hexCount, hexKey, hexesInRange, neighbors, parseKey, ring, toPixel, ORIGIN } from '../src/game/hex';

describe('Hex geometry', () => {
  it('radius 12 has 469 hexes, radius 39 has 4,681', () => {
    expect(hexCount(12)).toBe(469);
    expect(hexesInRange(ORIGIN, 12)).toHaveLength(469);
    expect(hexCount(39)).toBe(4681);
    expect(hexesInRange(ORIGIN, 39)).toHaveLength(4681);
  });

  it('every hex has six neighbours at distance 1', () => {
    const n = neighbors({ q: 2, r: -1 });
    expect(n).toHaveLength(6);
    for (const h of n) expect(distance(h, { q: 2, r: -1 })).toBe(1);
    expect(new Set(n.map(hexKey)).size).toBe(6);
  });

  it('distance is symmetric and correct', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(distance({ q: -2, r: 5 }, { q: 1, r: -1 })).toBe(distance({ q: 1, r: -1 }, { q: -2, r: 5 }));
    expect(distance({ q: -2, r: 5 }, { q: 1, r: -1 })).toBe(6);
  });

  it('ring n has 6n hexes, all at distance n', () => {
    for (const n of [1, 2, 5]) {
      const r = ring(ORIGIN, n);
      expect(r).toHaveLength(6 * n);
      expect(r.every((h) => distance(h, ORIGIN) === n)).toBe(true);
    }
  });

  it('keys round-trip', () => {
    expect(parseKey(hexKey({ q: -7, r: 3 }))).toEqual({ q: -7, r: 3 });
  });

  it('pixel → hex is the inverse of hex → pixel (used for canvas hit testing)', () => {
    for (const h of hexesInRange(ORIGIN, 6)) {
      const p = toPixel(h, 30);
      expect(fromPixel(p.x + 7, p.y - 5, 30)).toEqual(h);
    }
  });
});
