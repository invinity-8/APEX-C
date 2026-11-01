/**
 * Bewegungsregeln – komplett unabhängig von der Oberfläche.
 * Wegfindung: Dijkstra über passierbare Felder, Kosten = Gelände des Zielfeldes.
 */
import { equals, hexKey, neighbors, parseKey, type Axial, type HexKey } from './hex';
import { TERRAIN, type TerrainType } from './terrain';

/** Liefert das (bekannte) Gelände eines Feldes oder undefined, wenn unbekannt/außerhalb. */
export type TerrainLookup = (key: HexKey) => TerrainType | undefined;
/** Liefert einen Grund, warum ein Feld gesperrt ist, oder null. */
export type BlockCheck = (key: HexKey) => string | null;

/** Kosten, um ein Feld zu betreten. null = nicht betretbar. */
export function enterCost(terrain: TerrainType | undefined): number | null {
  if (terrain === undefined) return null;
  return TERRAIN[terrain].cost;
}

export interface ReachInfo {
  cost: number;
  prev: HexKey | null;
}

/**
 * Alle Felder, die mit `budget` Bewegungspunkten erreichbar sind (inkl. Start mit Kosten 0).
 * Ohne `budget` (Infinity) ist das eine vollständige Dijkstra-Suche.
 */
export function reachable(
  start: Axial,
  budget: number,
  lookup: TerrainLookup,
  blocked: BlockCheck = () => null,
): Map<HexKey, ReachInfo> {
  const startKey = hexKey(start);
  const best = new Map<HexKey, ReachInfo>([[startKey, { cost: 0, prev: null }]]);
  const done = new Set<HexKey>();
  const frontier: HexKey[] = [startKey];

  while (frontier.length) {
    // Feld mit den geringsten Kosten wählen (bei max. ~500 Feldern völlig ausreichend schnell).
    let bestIdx = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (best.get(frontier[i])!.cost < best.get(frontier[bestIdx])!.cost) bestIdx = i;
    }
    const key = frontier.splice(bestIdx, 1)[0];
    if (done.has(key)) continue;
    done.add(key);
    const base = best.get(key)!.cost;

    for (const n of neighbors(parseKey(key))) {
      const nk = hexKey(n);
      if (done.has(nk)) continue;
      const c = enterCost(lookup(nk));
      if (c === null || blocked(nk)) continue;
      const total = base + c;
      if (total > budget + 1e-9) continue;
      const prev = best.get(nk);
      if (!prev || total < prev.cost - 1e-9) {
        best.set(nk, { cost: total, prev: key });
        frontier.push(nk);
      }
    }
  }
  return best;
}

/** Rekonstruiert den Pfad (ohne Startfeld) aus einer reachable()-Map. */
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

/** Günstigster Pfad ohne Bewegungspunkt-Limit. */
export function findPath(
  start: Axial,
  goal: Axial,
  lookup: TerrainLookup,
  blocked?: BlockCheck,
): PathResult | null {
  if (equals(start, goal)) return { path: [], cost: 0 };
  const map = reachable(start, Infinity, lookup, blocked);
  const path = pathTo(map, hexKey(goal));
  if (!path) return null;
  return { path, cost: map.get(hexKey(goal))!.cost };
}
