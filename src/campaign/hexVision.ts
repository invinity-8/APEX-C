/**
 * Scene vision (server-side; players only receive what they see or have seen).
 *
 * Region maps (3 mi per hex) follow the Arena: by day 2 hexes (+1 on hills, +2 on a mountain),
 * at night 1 hex; mountains block the view behind them.
 *
 * Battle maps (5 ft per hex) follow line of sight: walls and tree trunks block sight, so a character
 * cannot see around a corner. Lighting per scene:
 *   bright – up to 120 ft;   dim – up to 60 ft;
 *   dark   – only darkvision (from the character sheet, e.g. "Darkvision 60 ft"), the adjacent hexes,
 *            and hexes lit by light markers (torches, braziers …) that the character can see.
 * Light itself is blocked by walls.
 */
import { ORIGIN, distance, hexKey, hexesInRange, parseKey, type Axial, type HexKey } from '../game/hex.js';
import { decodeTiles, heightLookup, hexAt, hexLine, tileLookup, tileSetOf } from './hexScene.js';
import type { SceneMap } from './maps.js';

export type Lighting = 'bright' | 'dim' | 'dark';
/** Scene-local time and light – independent of the Arena's day/night. */
export interface SceneClock {
  day: number;
  phase: 'day' | 'night';
  lighting: Lighting;
  version: number;
}
export const defaultSceneClock = (): SceneClock => ({ day: 1, phase: 'day', lighting: 'bright', version: 0 });

export const BRIGHT_SIGHT_FT = 120;
export const DIM_SIGHT_FT = 60;
export const DEFAULT_LIGHT_FT = 30;
/** APEX 2.4 – how high (in 5-ft levels) trees and walls block sight for someone looking from the air. */
export const OBSTACLE_LEVELS = 3;

export interface Viewer {
  at: { x: number; y: number };
  /** Darkvision range in feet (0 = none). */
  darkvisionFt: number;
  /** APEX 2.4 – flying altitude in feet: sees over trees and walls, and farther in bright and dim light. */
  altFt?: number;
}

type Blocks = (k: HexKey) => boolean;

/** True if nothing between a and b blocks sight (two slightly offset lines: grazing a corner is allowed). */
export function lineOfSight(a: Axial, b: Axial, blocks: Blocks, height?: (k: HexKey) => number, eye = { a: 0, b: 0 }): boolean {
  // APEX 1.8 – heights: eyes one level (5 ft) above the ground (+ flying altitude); ground higher than the line between
  // them blocks (a step of one level doesn't, a cliff or a hill top does)
  const ha = (height ? height(hexKey(a)) : 0) + 1 + eye.a, hb = (height ? height(hexKey(b)) : 0) + 1 + eye.b;
  // APEX 2.4 – from the air (an eye above the ground) a blocking tile (tree, wall) only blocks up to OBSTACLE_LEVELS
  // above its ground: a high flyer looks over the forest and walls down onto what lies behind
  const aloft = eye.a > 0 || eye.b > 0;
  const clear = (nudge: number) => {
    const line = hexLine(a, b, nudge);
    const n = line.length - 1;
    return line.slice(1, -1).every((h, i) => {
      const k = hexKey(h), g = height ? height(k) : 0, at = ha + ((hb - ha) * (i + 1)) / n;
      if (blocks(k) && (!aloft || at <= g + OBSTACLE_LEVELS)) return false;
      return !height || g <= at;
    });
  };
  return clear(1e-6) || clear(-1e-6);
}
/** Sight rules of a map: blocking tiles and (when the map has them) ground heights. */
export function sightRules(map: Pick<SceneMap, 'hex'>): { blocks: Blocks; height?: (k: HexKey) => number } {
  const tiles = tileLookup(map);
  return { blocks: (k) => !!tiles(k)?.blocksSight, ...(map.hex?.heights ? { height: heightLookup(map) } : {}) };
}

/** Darkvision in feet from a sheet text such as "Darkvision 60 ft." (0 if absent). */
export function darkvisionFeet(text: string | undefined): number {
  const m = /darkvision\s*(\d{1,3})/i.exec(text ?? '');
  return m ? Math.min(300, Number(m[1])) : 0;
}

/** A light somewhere on the map (carried torch); light markers and glowing tiles are read from the map. */
export interface CarriedLight { x: number; y: number; ft: number }

/** Hexes the viewers can see right now. */
export function sceneVision(map: Pick<SceneMap, 'width' | 'height' | 'hex' | 'nodes'>, clock: SceneClock, viewers: Viewer[], carried: CarriedLight[] = []): Set<HexKey> {
  const seen = new Set<HexKey>();
  if (!map.hex) return seen;
  const tiles = tileLookup(map);
  const battle = tileSetOf(map.hex) === 'battle';
  const inMap = (k: HexKey) => !!tiles(k);
  const blocks: Blocks = (k) => !!tiles(k)?.blocksSight;
  const heights = map.hex.heights ? heightLookup(map) : undefined;

  // Battle: hexes lit by light markers (each light is blocked by walls, too).
  const lit = new Set<HexKey>();
  if (battle && clock.lighting !== 'bright') {
    const sources: Array<{ at: ReturnType<typeof hexAt>; ft: number }> = [
      ...map.nodes.filter((n) => n.kind === 'light').map((n) => ({ at: hexAt(map, n), ft: n.lightFt ?? DEFAULT_LIGHT_FT })),
      ...carried.map((c) => ({ at: hexAt(map, c), ft: c.ft })),
      ...[...decodeTiles(map.hex)].filter(([, t]) => t.light).map(([k, t]) => ({ at: parseKey(k), ft: t.light! })),
    ];
    for (const { at, ft } of sources) {
      const r = Math.round(ft / 5);
      for (const h of hexesInRange(at, r)) if (inMap(hexKey(h)) && lineOfSight(at, h, blocks, heights)) lit.add(hexKey(h));
    }
  }

  for (const v of viewers) {
    const at = hexAt(map, v.at);
    const own = tiles(hexKey(at));
    if (!own) continue;
    let radius: number;
    let viewBlocks = blocks;
    if (battle) {
      radius = clock.lighting === 'bright' ? BRIGHT_SIGHT_FT / 5 : clock.lighting === 'dim' ? DIM_SIGHT_FT / 5 : Math.max(1, Math.round(v.darkvisionFt / 5));
      if (clock.lighting !== 'dark' && v.altFt) radius += Math.round(v.altFt / 5); // the view widens with height
    } else {
      const day = clock.phase === 'day';
      radius = day ? 2 + (own.id === 'hills' ? 1 : own.id === 'mountain' ? 2 : 0) : 1;
      if (own.id === 'mountain') viewBlocks = () => false; // a mountain top overlooks the ranges around it
    }
    const maxLit = battle && clock.lighting !== 'bright' ? BRIGHT_SIGHT_FT / 5 : radius;
    for (const h of hexesInRange(at, Math.max(radius, maxLit))) {
      const k = hexKey(h);
      if (!inMap(k) || seen.has(k)) continue;
      const d = distance(at, h);
      if (d > radius && !lit.has(k)) continue;
      const eye = battle && v.altFt ? { a: v.altFt / 5, b: 0 } : undefined;
      if (d <= 1 || lineOfSight(at, h, viewBlocks, battle ? heights : undefined, eye)) seen.add(k);
    }
  }
  return seen;
}

/** Fog string for the player map: per hex 'v' visible, 'e' explored (remembered), '.' unknown. */
export function fogString(radius: number, visible: Set<HexKey>, explored: Set<HexKey>): string {
  return hexesInRange(ORIGIN, radius).map((h) => { const k = hexKey(h); return visible.has(k) ? 'v' : explored.has(k) ? 'e' : '.'; }).join('');
}
/** Masks the terrain string to what the player knows. */
export function maskTerrain(terrain: string, fog: string): string {
  let out = '';
  for (let i = 0; i < terrain.length; i++) out += fog[i] === '.' ? '.' : terrain[i];
  return out;
}
export const fogKeys = (radius: number, fog: string, mark: 'v' | 'e') => hexesInRange(ORIGIN, radius).filter((_, i) => fog[i] === mark).map(hexKey);
export { parseKey };
