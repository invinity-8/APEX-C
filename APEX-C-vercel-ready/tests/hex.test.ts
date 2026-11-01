import { describe, expect, it } from 'vitest';
import { distance, hexCount, hexKey, hexesInRange, neighbors, parseKey, ring, ORIGIN } from '../src/game/hex';

describe('Hex-Geometrie', () => {
  it('Radius 12 ergibt 469 Felder', () => {
    expect(hexCount(12)).toBe(469);
    expect(hexesInRange(ORIGIN, 12)).toHaveLength(469);
  });

  it('jedes Feld hat sechs Nachbarn mit Abstand 1', () => {
    const n = neighbors({ q: 2, r: -1 });
    expect(n).toHaveLength(6);
    for (const h of n) expect(distance(h, { q: 2, r: -1 })).toBe(1);
    expect(new Set(n.map(hexKey)).size).toBe(6);
  });

  it('Distanz ist symmetrisch und korrekt', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(distance({ q: -2, r: 5 }, { q: 1, r: -1 })).toBe(distance({ q: 1, r: -1 }, { q: -2, r: 5 }));
    expect(distance({ q: -2, r: 5 }, { q: 1, r: -1 })).toBe(6);
  });

  it('Ring n hat 6n Felder, alle mit Abstand n', () => {
    for (const n of [1, 2, 5]) {
      const r = ring(ORIGIN, n);
      expect(r).toHaveLength(6 * n);
      expect(r.every((h) => distance(h, ORIGIN) === n)).toBe(true);
    }
  });

  it('Schlüssel lassen sich hin- und zurückwandeln', () => {
    expect(parseKey(hexKey({ q: -7, r: 3 }))).toEqual({ q: -7, r: 3 });
  });
});
