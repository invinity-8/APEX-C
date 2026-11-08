/**
 * Movement rules – completely independent of the UI.
 * Path finding: Dijkstra over passable hexes, cost = terrain of the hex being entered.
 * Uses a binary heap so that maps with ~5,000 hexes stay fast.
 */
import { equals, hexKey, neighbors, parseKey, type Axial, type HexKey } from './hex.js';
import { TERRAIN, type TerrainType } from './terrain.js';

/** Returns the (known) terrain of a hex, or undefined if unknown / outside the arena. */
export type TerrainLookup = (key: HexKey) => TerrainType | undefined;
/** Returns a reason why a hex is blocked, or null. */
export type BlockCheck = (key: HexKey) => string | null;

/** Cost to enter a hex. null = cannot be entered. */
export function enterCost(terrain: TerrainType | undefined): number | null {
  if (terrain === undefined) return null;
  return TERRAIN[terrain].cost;
}

export interface ReachInfo {
  cost: number;
  prev: HexKey | null;
}

/** Minimal binary min-heap keyed by cost. */
class MinHeap {
  private items: Array<{ key: HexKey; cost: number }> = [];
  get size() {
    return this.items.length;
  }
  push(key: HexKey, cost: number) {
    const a = this.items;
    a.push({ key, cost });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { key: HexKey; cost: number } | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Generic Dijkstra over hex keys. `costOf` returns the cost to ENTER a hex, or null if blocked.
 * Passing `goal` stops early once the goal is settled.
 */
export function dijkstra(
  startKey: HexKey,
  /** Cost of entering `key` (from `from`: height steps between hexes, APEX 1.8). */
  costOf: (key: HexKey, from?: HexKey) => number | null,
  budget = Infinity,
  goal?: HexKey,
): Map<HexKey, ReachInfo> {
  const best = new Map<HexKey, ReachInfo>([[startKey, { cost: 0, prev: null }]]);
  const done = new Set<HexKey>();
  const heap = new MinHeap();
  heap.push(startKey, 0);

  while (heap.size) {
    const { key, cost: base } = heap.pop()!;
    if (done.has(key)) continue;
    if (base > best.get(key)!.cost + 1e-9) continue;
    done.add(key);
    if (goal !== undefined && key === goal) break;

    for (const n of neighbors(parseKey(key))) {
      const nk = hexKey(n);
      if (done.has(nk)) continue;
      const c = costOf(nk, key);
      if (c === null) continue;
      const total = base + c;
      if (total > budget + 1e-9) continue;
      const prev = best.get(nk);
      if (!prev || total < prev.cost - 1e-9) {
        best.set(nk, { cost: total, prev: key });
        heap.push(nk, total);
      }
    }
  }
  return best;
}

/**
 * All hexes reachable with `budget` movement points (including the start with cost 0).
 * With budget = Infinity this is a full Dijkstra search.
 */
export function reachable(
  start: Axial,
  budget: number,
  lookup: TerrainLookup,
  blocked: BlockCheck = () => null,
  goal?: HexKey,
): Map<HexKey, ReachInfo> {
  return dijkstra(hexKey(start), (k) => (blocked(k) ? null : enterCost(lookup(k))), budget, goal);
}

/** Reconstructs the path (without the start hex) from a reachable() map. */
export function pathTo(map: Map<HexKey, ReachInfo>, goal: HexKey): Axial[] | null {
  if (!map.has(goal)) return null;
  const path: Axial[] = [];
  let cur: HexKey | null = goal;
  while (cur) {
    const info: ReachInfo = map.get(cur)!;
    if (info.prev === null) break;
    path.unshift(parseKey(cur));
    cur = info.prev;
  }
  return path;
}

export interface PathResult {
  path: Axial[];
  cost: number;
}

/** Cheapest path without a movement point limit. */
export function findPath(start: Axial, goal: Axial, lookup: TerrainLookup, blocked?: BlockCheck): PathResult | null {
  if (equals(start, goal)) return { path: [], cost: 0 };
  const goalKey = hexKey(goal);
  const map = reachable(start, Infinity, lookup, blocked, goalKey);
  const path = pathTo(map, goalKey);
  if (!path) return null;
  return { path, cost: map.get(goalKey)!.cost };
}
