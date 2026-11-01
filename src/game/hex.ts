/**
 * Hex-Geometrie mit axialen Koordinaten (q, r).
 * Die dritte Würfelkoordinate ergibt sich aus s = -q - r.
 * Ausrichtung der Felder: "pointy top" (Spitze oben).
 * Referenz: https://www.redblobgames.com/grids/hexagons/
 */

export interface Axial {
  q: number;
  r: number;
}

/** Eindeutiger Schlüssel eines Feldes, z. B. "3,-2". */
export type HexKey = string;

export const hexKey = (h: Axial): HexKey => `${h.q},${h.r}`;

export function parseKey(key: HexKey): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export const ORIGIN: Axial = { q: 0, r: 0 };

/** Die sechs Nachbarrichtungen, im Uhrzeigersinn ab Osten. */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const add = (a: Axial, b: Axial): Axial => ({ q: a.q + b.q, r: a.r + b.r });
export const scale = (a: Axial, k: number): Axial => ({ q: a.q * k, r: a.r * k });
export const equals = (a: Axial, b: Axial): boolean => a.q === b.q && a.r === b.r;

export function neighbors(h: Axial): Axial[] {
  return DIRECTIONS.map((d) => add(h, d));
}

/** Anzahl Schritte zwischen zwei Feldern. */
export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Alle Felder mit genau Abstand `radius` zum Zentrum. */
export function ring(center: Axial, radius: number): Axial[] {
  if (radius === 0) return [center];
  const result: Axial[] = [];
  let h = add(center, scale(DIRECTIONS[4], radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      result.push(h);
      h = add(h, DIRECTIONS[side]);
    }
  }
  return result;
}

/** Alle Felder mit Abstand <= radius (inkl. Zentrum). */
export function hexesInRange(center: Axial, radius: number): Axial[] {
  const result: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) result.push({ q: center.q + q, r: center.r + r });
  }
  return result;
}

/** Anzahl Felder einer sechseckigen Karte: 3r(r+1)+1. Radius 12 → 469. */
export const hexCount = (radius: number): number => 3 * radius * (radius + 1) + 1;

// ---------- Pixel-Umrechnung (pointy top) ----------

const SQRT3 = Math.sqrt(3);

export function toPixel(h: Axial, size: number): { x: number; y: number } {
  return {
    x: size * (SQRT3 * h.q + (SQRT3 / 2) * h.r),
    y: size * (1.5 * h.r),
  };
}

/** Eckpunkte eines Hex als SVG-points-String. */
export function hexCorners(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Rounds fractional axial coordinates to the nearest hex (cube rounding). */
export function axialRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // Avoid "-0" keys.
  return { q: rq + 0, r: rr + 0 };
}

/** Inverse of toPixel: which hex contains the pixel (x, y)? */
export function fromPixel(x: number, y: number, size: number): Axial {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return axialRound(q, r);
}
