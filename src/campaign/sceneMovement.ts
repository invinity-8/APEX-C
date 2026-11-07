import { distance, fromPixel, toPixel } from '../game/hex.js';
import type { MapNode, SceneMap } from './maps.js';
import { hexAt, hexCentre, hexMovementCost } from './hexScene.js';
export interface Point { x: number; y: number }
export function snappedPoint(map: SceneMap, p: Point): Point {
  if (map.hex) return hexCentre(map, hexAt(map, p));
  if (map.grid === 'square') return { x: (Math.floor(p.x / map.cell) + .5) * map.cell, y: (Math.floor(p.y / map.cell) + .5) * map.cell };
  if (map.grid === 'hex') return toPixel(fromPixel(p.x, p.y, map.cell / 2), map.cell / 2);
  return p;
}
/** Segment clipping, including boundaries, prevents jumping over thin walls. */
export function segmentRectangle(a: Point, b: Point, r: Pick<MapNode, 'x' | 'y' | 'width' | 'height'>): [number, number] | null {
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, r.x, r.x + r.width], [a.y, b.y - a.y, r.y, r.y + r.height]]) {
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return null; continue; }
    const t1 = (min - start) / delta, t2 = (max - start) / delta;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return null;
  }
  return [lo, hi];
}
export function movementCost(map: SceneMap, start: Point, end: Point): { ok: true; cost: number } | { ok: false; error: string } {
  if (map.hex) {
    // Arena rules: cheapest path over passable hexes, cost = terrain of each entered hex × units per hex.
    const r = hexMovementCost(map, start, end);
    return r.ok ? { ok: true, cost: r.cost } : r;
  }
  if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || end.x < 0 || end.y < 0 || end.x > map.width || end.y > map.height) return { ok: false, error: 'Destination is outside the map.' };
  if (map.nodes.some(n => n.kind === 'wall' && segmentRectangle(start, end, n))) return { ok: false, error: 'The path is blocked.' };
  let cells = Math.hypot(end.x - start.x, end.y - start.y) / map.cell;
  if (map.grid === 'square') cells = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / map.cell;
  else if (map.grid === 'hex') cells = distance(fromPixel(start.x, start.y, map.cell / 2), fromPixel(end.x, end.y, map.cell / 2));
  const terrain = map.nodes.filter(n => n.kind === 'area' && (n.terrainCost ?? 1) > 1).map(n => ({ interval: segmentRectangle(start, end, n), cost: n.terrainCost ?? 1 })).filter(n => n.interval !== null);
  const breaks = [...new Set([0, 1, ...terrain.flatMap(n => n.interval!)])].sort((a, b) => a - b);
  let multiplier = 0;
  for (let i = 1; i < breaks.length; i++) {
    const midpoint = (breaks[i - 1] + breaks[i]) / 2;
    multiplier += (breaks[i] - breaks[i - 1]) * Math.max(1, ...terrain.filter(n => n.interval![0] <= midpoint && n.interval![1] >= midpoint).map(n => n.cost));
  }
  return { ok: true, cost: Math.round(cells * map.unitsPerCell * multiplier * 1e6) / 1e6 };
}
