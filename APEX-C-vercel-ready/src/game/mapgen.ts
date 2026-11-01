/**
 * Deterministische Arena-Generierung.
 * Gleicher Seed + gleicher Radius → exakt dieselbe Karte.
 */
import { DIRECTIONS, ORIGIN, add, distance, hexKey, hexesInRange, neighbors, scale, toPixel, type HexKey } from './hex';
import { mulberry32, valueNoise } from './rng';
import { isPassable, type TerrainType } from './terrain';
import type { HexTile } from './types';

export interface MapGenOptions {
  radius: number;
  seed: number;
  /** Erzwungenes Gelände (z. B. für Orte). Wird nie überschrieben. */
  overrides?: Record<HexKey, TerrainType>;
  /** Radius des freien Startgebiets um das Zentrum. */
  startAreaRadius?: number;
}

export function generateArena(opts: MapGenOptions): Record<HexKey, HexTile> {
  const { radius, seed, overrides = {}, startAreaRadius = 2 } = opts;
  const rand = mulberry32(seed);
  const tiles: Record<HexKey, HexTile> = {};

  // 1) Grundlandschaft aus zwei Rauschfeldern: Höhe und Feuchtigkeit.
  for (const h of hexesInRange(ORIGIN, radius)) {
    const p = toPixel(h, 1);
    const d = distance(h, ORIGIN) / radius;
    const elev = valueNoise(p.x / 4.2 + 50, p.y / 4.2 + 50, seed) + 0.05 * d;
    const moist = valueNoise(p.x / 3.4 + 200, p.y / 3.4 + 10, seed + 7);
    let terrain: TerrainType = 'plains';
    if (elev > 0.68) terrain = 'mountain';
    else if (elev < 0.35) terrain = 'water';
    else if (moist > 0.6) terrain = 'forest';
    tiles[hexKey(h)] = { q: h.q, r: h.r, terrain };
  }

  const set = (key: HexKey, t: TerrainType) => {
    if (tiles[key] && !(key in overrides)) tiles[key].terrain = t;
  };

  // 2) Magische Zonen: ein paar Blasen gebündelter Willenskraft.
  const magicCount = Math.max(2, Math.round(radius / 4));
  for (let i = 0; i < magicCount; i++) {
    const dir = DIRECTIONS[Math.floor(rand() * 6)];
    const side = DIRECTIONS[Math.floor(rand() * 6)];
    const dist = Math.round(radius * (0.4 + rand() * 0.4));
    const center = add(scale(dir, dist), scale(side, Math.floor(rand() * 3)));
    for (const h of hexesInRange(center, 1)) if (rand() < 0.85) set(hexKey(h), 'magic');
  }

  // 3) Verstreute Ruinen.
  for (const t of Object.values(tiles)) {
    if ((t.terrain === 'plains' || t.terrain === 'forest') && rand() < 0.035) set(hexKey(t), 'ruins');
  }

  // 4) Drei verzauberte Straßen (Viae) vom Zentrum nach außen – sie überbrücken auch Wasser.
  for (const dirIndex of [0, 2, 4]) {
    for (let step = startAreaRadius + 1; step <= radius; step++) {
      set(hexKey(scale(DIRECTIONS[dirIndex], step)), 'road');
    }
  }

  // 5) Freies Startgebiet in der Mitte.
  for (const h of hexesInRange(ORIGIN, startAreaRadius)) set(hexKey(h), 'plains');

  // 6) Erzwungenes Gelände anwenden.
  for (const [key, t] of Object.entries(overrides)) if (tiles[key]) tiles[key].terrain = t;

  // 7) Erreichbarkeit sichern: unerreichbare Inseln werden zu Wasser.
  const reachable = floodFill(tiles, hexKey(ORIGIN));
  for (const [key, t] of Object.entries(tiles)) {
    if (isPassable(t.terrain) && !reachable.has(key) && !(key in overrides)) t.terrain = 'water';
  }

  return tiles;
}

/** Alle vom Start aus zu Fuß erreichbaren Felder (ohne Bewegungspunkt-Limit). */
export function floodFill(tiles: Record<HexKey, HexTile>, start: HexKey): Set<HexKey> {
  const seen = new Set<HexKey>([start]);
  const queue: HexKey[] = [start];
  while (queue.length) {
    const key = queue.shift()!;
    const t = tiles[key];
    for (const n of neighbors(t)) {
      const nk = hexKey(n);
      const nt = tiles[nk];
      if (nt && !seen.has(nk) && isPassable(nt.terrain)) {
        seen.add(nk);
        queue.push(nk);
      }
    }
  }
  return seen;
}
