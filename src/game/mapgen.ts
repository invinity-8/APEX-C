/**
 * Deterministic arena generation.
 * Same seed + same radius → exactly the same map.
 *
 * The generator works in layers so that the world forms large, coherent regions:
 *   1. Domain-warped noise fields for elevation, ridges and moisture (scaled in hexes,
 *      not relative to the radius – bigger maps get MORE regions, not bigger blobs).
 *   2. Percentile thresholds → stable proportions of lakes, mountain ranges, hills and forests.
 *   3. Rivers flow downhill from the highlands into lakes or out of the arena.
 *   4. Ruined imperial districts and magical anomalies as clusters.
 *   5. The central imperial landmark (golden eagle + labyrinth).
 *   6. Ancient roads, routed with a cost-aware path search from the labyrinth gates.
 *   7. Reachability guarantee: every passable hex can be reached from the centre.
 */
import { DIRECTIONS, ORIGIN, distance, hexKey, hexesInRange, neighbors, scale, toPixel, type Axial, type HexKey } from './hex.js';
import { dijkstra, pathTo } from './movement.js';
import { hash2, mulberry32, valueNoise } from './rng.js';
import { isPassable, type TerrainType } from './terrain.js';
import type { HexTile } from './types.js';

export interface MapGenOptions {
  radius: number;
  seed: number;
  /** Forced terrain (e.g. for sites). Never overwritten. */
  overrides?: Record<HexKey, TerrainType>;
  /** Radius of the central landmark (eagle + labyrinth). Defaults to a size suited to the map. */
  landmarkRadius?: number;
}

/** Default landmark radius: 1 for tiny test maps, up to 4 for the full arena. */
export const landmarkRadiusFor = (radius: number): number => Math.max(1, Math.min(4, Math.round(radius / 10) + 1));

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

export function generateArena(opts: MapGenOptions): Record<HexKey, HexTile> {
  const { radius, seed, overrides = {} } = opts;
  const landmarkR = Math.min(opts.landmarkRadius ?? landmarkRadiusFor(radius), Math.max(0, radius - 2));
  const rand = mulberry32(seed);
  const cells = hexesInRange(ORIGIN, radius);
  const tiles: Record<HexKey, HexTile> = {};

  // ---------- 1) Noise fields ----------
  const elev = new Map<HexKey, number>();
  const mount = new Map<HexKey, number>();
  const moist = new Map<HexKey, number>();
  for (const h of cells) {
    const p = toPixel(h, 1);
    // Domain warping bends the regions into organic shapes.
    const wx = p.x + (valueNoise(p.x / 23 + 11, p.y / 23 + 5, seed + 101, 2) - 0.5) * 16;
    const wy = p.y + (valueNoise(p.x / 23 + 71, p.y / 23 + 29, seed + 202, 2) - 0.5) * 16;
    const e = valueNoise(wx / 18 + 50, wy / 18 + 50, seed, 4);
    const ridge = 1 - Math.abs(2 * valueNoise(wx / 12 + 300, wy / 12 + 300, seed + 3, 3) - 1);
    const k = hexKey(h);
    elev.set(k, e);
    mount.set(k, 0.55 * e + 0.45 * ridge);
    moist.set(k, valueNoise(wx / 15 + 200, wy / 15 + 10, seed + 7, 3));
  }
  const eVals = [...elev.values()];
  const mVals = [...mount.values()];
  const wVals = [...moist.values()];
  const eMin = Math.min(...eVals);
  const eMax = Math.max(...eVals);
  const lakeT = quantile(eVals, 0.07);
  const mountainT = quantile(mVals, 0.915);
  const hillsT = quantile(mVals, 0.8);
  const highT = quantile(eVals, 0.4);
  const forestT = quantile(wVals, 0.6);

  // ---------- 2) Base biomes ----------
  for (const h of cells) {
    const k = hexKey(h);
    const e = elev.get(k)!;
    const m = mount.get(k)!;
    let terrain: TerrainType = 'plains';
    if (e <= lakeT) terrain = 'water';
    else if (m >= mountainT && e >= highT) terrain = 'mountain';
    else if (m >= hillsT) terrain = 'hills';
    else if (moist.get(k)! >= forestT) terrain = 'forest';
    tiles[k] = { q: h.q, r: h.r, terrain, elevation: Math.round(((e - eMin) / (eMax - eMin || 1)) * 100) / 100 };
  }

  const inLandmark = (h: Axial) => distance(h, ORIGIN) <= landmarkR + 1;
  const set = (key: HexKey, t: TerrainType) => {
    if (tiles[key] && !(key in overrides)) tiles[key].terrain = t;
  };
  const randomHex = (minD: number, maxD: number, ok: (t: HexTile) => boolean): HexTile | null => {
    for (let tries = 0; tries < 200; tries++) {
      const t = tiles[hexKey(cells[Math.floor(rand() * cells.length)])];
      const d = distance(t, ORIGIN);
      if (d >= minD && d <= maxD && ok(t)) return t;
    }
    return null;
  };

  // ---------- 3) Rivers ----------
  const riverCount = Math.max(1, Math.round(radius / 10));
  for (let i = 0; i < riverCount; i++) {
    const src = randomHex(landmarkR + 4, radius, (t) => t.terrain === 'mountain' || t.terrain === 'hills');
    if (!src) continue;
    let cur: Axial = src;
    const seen = new Set<HexKey>([hexKey(cur)]);
    for (let step = 0; step < radius * 3; step++) {
      const options = neighbors(cur)
        .map((n) => ({ n, k: hexKey(n) }))
        .filter(({ k }) => !seen.has(k));
      if (!options.length) break;
      const out = options.find(({ k }) => !tiles[k]);
      if (out) break; // the river leaves the arena
      let best = options[0];
      let bestE = Infinity;
      for (const o of options) {
        const v = elev.get(o.k)! + hash2(o.n.q, o.n.r, seed + 17 + i) * 0.015;
        if (v < bestE) {
          bestE = v;
          best = o;
        }
      }
      const curE = elev.get(hexKey(cur))!;
      if (inLandmark(best.n)) break;
      if (tiles[best.k].terrain === 'water') break; // reached a lake
      if (bestE > curE + 0.01 && step > 2) {
        // Local basin: the river pools into a small lake.
        for (const n of [cur, ...neighbors(cur)]) {
          const nk = hexKey(n);
          if (tiles[nk] && !inLandmark(n) && rand() < 0.6) set(nk, 'water');
        }
        break;
      }
      seen.add(best.k);
      if (tiles[best.k].terrain !== 'mountain') set(best.k, 'river');
      cur = best.n;
    }
  }

  // ---------- 4) Ruined imperial districts ----------
  const districts: Axial[] = [];
  const districtCount = Math.max(2, Math.round(radius / 7));
  for (let i = 0; i < districtCount; i++) {
    const c = randomHex(landmarkR + 4, Math.max(landmarkR + 5, Math.floor(radius * 0.88)), (t) =>
      ['plains', 'forest', 'hills'].includes(t.terrain),
    );
    if (!c) continue;
    districts.push({ q: c.q, r: c.r });
    const size = radius >= 25 ? 2 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2);
    for (const h of hexesInRange(c, size)) {
      const k = hexKey(h);
      const t = tiles[k];
      if (!t || inLandmark(h) || ['water', 'mountain', 'river'].includes(t.terrain)) continue;
      if (rand() < 0.85 - 0.45 * (distance(h, c) / size)) set(k, 'ruins');
    }
  }

  // ---------- 5) Magical anomalies ----------
  const magicCount = Math.max(2, Math.round(radius / 8));
  for (let i = 0; i < magicCount; i++) {
    const c = randomHex(Math.floor(radius * 0.3), radius, (t) => t.terrain !== 'water');
    if (!c) continue;
    const size = 1 + Math.floor(rand() * 2);
    for (const h of hexesInRange(c, size)) {
      const k = hexKey(h);
      if (!tiles[k] || inLandmark(h) || tiles[k].terrain === 'water') continue;
      if (rand() < 0.9 - 0.3 * (distance(h, c) / size)) set(k, 'magic');
    }
  }

  // ---------- 6) Central landmark: Aquila Aurea + labyrinth ----------
  for (const h of hexesInRange(ORIGIN, landmarkR + 1)) {
    const k = hexKey(h);
    if (!tiles[k]) continue;
    const d = distance(h, ORIGIN);
    if (d <= landmarkR) {
      tiles[k].terrain = 'plains';
      tiles[k].feature = d === 0 ? 'eagle' : d === 1 && landmarkR >= 2 ? 'plaza' : 'labyrinth';
    } else if (!isPassable(tiles[k].terrain) || tiles[k].terrain === 'river') {
      tiles[k].terrain = 'plains'; // keep the outer ring of the landmark walkable
    }
  }

  // ---------- 7) Ancient roads ----------
  const roadCost = (k: HexKey): number | null => {
    const t = tiles[k];
    if (!t) return null;
    switch (t.terrain) {
      case 'road':
        return 0.3;
      case 'plains':
        return 1;
      case 'ruins':
        return 1.4;
      case 'forest':
        return 2.2;
      case 'hills':
        return 2.6;
      case 'magic':
        return 3;
      case 'river':
        return 4; // bridges are possible but expensive
      case 'mountain':
        return 8;
      default:
        return null;
    }
  };
  const buildRoad = (from: Axial, to: Axial) => {
    const goal = hexKey(to);
    const map = dijkstra(hexKey(from), roadCost, Infinity, goal);
    const path = pathTo(map, goal);
    if (!path) return;
    for (const h of [from, ...path]) if (!inLandmark(h) || distance(h, ORIGIN) > landmarkR) set(hexKey(h), 'road');
  };
  const gateDirs = radius >= 20 ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];
  const gates = gateDirs.map((i) => scale(DIRECTIONS[i], landmarkR + 1));
  for (const [n, i] of gateDirs.entries()) {
    const edge = scale(DIRECTIONS[i], radius);
    // Every second road on large maps leads to a ruined district instead of the arena edge.
    const target = radius >= 20 && n % 2 === 1 && districts.length ? districts[n % districts.length] : edge;
    if (tiles[hexKey(target)] && roadCost(hexKey(target)) !== null) buildRoad(gates[n], target);
    else buildRoad(gates[n], edge);
  }
  for (const d of districts) {
    const nearest = gates.reduce((a, b) => (distance(a, d) <= distance(b, d) ? a : b));
    if (radius >= 20) buildRoad(nearest, d);
  }

  // ---------- 8) Forced terrain ----------
  for (const [key, t] of Object.entries(overrides)) if (tiles[key]) tiles[key].terrain = t;

  // ---------- 9) Reachability: unreachable islands become lakes ----------
  const reachableSet = floodFill(tiles, hexKey(ORIGIN));
  for (const [key, t] of Object.entries(tiles)) {
    if (isPassable(t.terrain) && !reachableSet.has(key) && !(key in overrides)) t.terrain = 'water';
  }

  return tiles;
}

/** All hexes reachable on foot from the start (no movement point limit). */
export function floodFill(tiles: Record<HexKey, HexTile>, start: HexKey): Set<HexKey> {
  const seen = new Set<HexKey>([start]);
  const queue: HexKey[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const t = tiles[queue[i]];
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
