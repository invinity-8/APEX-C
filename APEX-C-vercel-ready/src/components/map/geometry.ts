import { DIRECTIONS, add, hexKey, toPixel, type Axial, type HexKey } from '../../game/hex';
import { stringHash } from '../../game/rng';

export const HEX_SIZE = 30;

export const center = (h: Axial) => toPixel(h, HEX_SIZE);

/** Ecke i eines Hex (pointy top), i = 0..5. */
export function corner(cx: number, cy: number, size: number, i: number) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) };
}

/** Kante zum Nachbarn in Richtung d → die beiden Eckindizes. */
const EDGE: Array<[number, number]> = [
  [0, 1],
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2],
];

/**
 * Baut einen SVG-Pfad aus allen Kanten zwischen Feldern, die `inside` erfüllen,
 * und Nachbarn, die es nicht tun. Ideal für Arenarand und Zonengrenzen.
 */
export function boundaryPath(keys: Iterable<HexKey>, inside: (k: HexKey) => boolean, parse: (k: HexKey) => Axial): string {
  const parts: string[] = [];
  for (const k of keys) {
    if (!inside(k)) continue;
    const h = parse(k);
    const c = center(h);
    DIRECTIONS.forEach((d, i) => {
      if (inside(hexKey(add(h, d)))) return;
      const [a, b] = EDGE[i];
      const p1 = corner(c.x, c.y, HEX_SIZE, a);
      const p2 = corner(c.x, c.y, HEX_SIZE, b);
      parts.push(`M${p1.x.toFixed(1)},${p1.y.toFixed(1)}L${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
    });
  }
  return parts.join('');
}

/** Farbe leicht variieren, damit die Karte lebendig wirkt (deterministisch). */
export function shade(hex: string, key: string, amount = 0.07): string {
  const v = ((stringHash(key) % 1000) / 1000 - 0.5) * 2 * amount;
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + v))));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Versatz für mehrere Figuren auf einem Feld. */
export function stackLayout(n: number): { offsets: Array<{ x: number; y: number }>; r: number } {
  const s = HEX_SIZE;
  if (n <= 1) return { offsets: [{ x: 0, y: 0 }], r: s * 0.5 };
  if (n === 2) return { offsets: [{ x: -s * 0.33, y: 0 }, { x: s * 0.33, y: 0 }], r: s * 0.36 };
  if (n === 3)
    return {
      offsets: [{ x: 0, y: -s * 0.32 }, { x: -s * 0.33, y: s * 0.24 }, { x: s * 0.33, y: s * 0.24 }],
      r: s * 0.3,
    };
  return {
    offsets: [
      { x: -s * 0.3, y: -s * 0.28 },
      { x: s * 0.3, y: -s * 0.28 },
      { x: -s * 0.3, y: s * 0.3 },
      { x: s * 0.3, y: s * 0.3 },
    ],
    r: s * 0.27,
  };
}
