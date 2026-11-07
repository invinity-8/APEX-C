/**
 * Hex scenes: every battle and region map uses the Arena engine – axial hex tiles with the Arena's
 * terrain types, painter, movement costs and path finding – with scene-specific content.
 *
 * Storage (inside the scene's map JSON, no migration): `hex = { radius, terrain }`, where `terrain`
 * has one character per hex in hexesInRange(ORIGIN, radius) order. '.' means "no hex" (outside the
 * playable shape). Scene coordinates stay positive pixels so the existing movement/placement
 * revision checks and the SQL bounds check keep working: hex (0,0) sits at the map centre.
 *
 * Pure functions – shared by the editor, the renderers and the server movement rules.
 */
import { ORIGIN, distance, fromPixel, hexKey, hexesInRange, hexCount, neighbors, parseKey, toPixel, type Axial, type HexKey } from '../game/hex.js';
import { dijkstra, pathTo } from '../game/movement.js';
import { generateArena } from '../game/mapgen.js';
import { hash2, valueNoise } from '../game/rng.js';
import { TERRAIN, type TerrainType } from '../game/terrain.js';
import type { MapNode, SceneMap } from './maps.js';

/** Same hex size as the Arena renderer (src/components/map/geometry.ts). */
export const SCENE_HEX_SIZE = 30;
export const MIN_HEX_RADIUS = 2;
export const MAX_HEX_RADIUS = 40;
const SQRT3 = Math.sqrt(3);

/** The parts of a scene map the hex rules need. */
export type HexMapLike = Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell'>;

export interface HexSceneData {
  radius: number;
  /** One code per hex, see TERRAIN_CODE. '.' = no hex. */
  terrain: string;
}

export const TERRAIN_CODE: Record<TerrainType, string> = { plains: 'p', road: 'd', forest: 'f', hills: 'h', mountain: 'm', river: 'r', water: 'w', ruins: 'u', magic: 'x' };
const CODE_TERRAIN: Record<string, TerrainType> = Object.fromEntries(Object.entries(TERRAIN_CODE).map(([t, c]) => [c, t as TerrainType]));
const VALID = new RegExp(`^[${Object.values(TERRAIN_CODE).join('')}.]+$`);

export function validHexData(v: unknown): v is HexSceneData {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const h = v as HexSceneData;
  return Number.isInteger(h.radius) && h.radius >= MIN_HEX_RADIUS && h.radius <= MAX_HEX_RADIUS && typeof h.terrain === 'string' && h.terrain.length === hexCount(h.radius) && VALID.test(h.terrain);
}

/** Pixel size of a hex scene: the whole hexagon plus a two-hex margin. */
export function hexSceneSize(radius: number): { width: number; height: number } {
  const s = SCENE_HEX_SIZE;
  return { width: Math.ceil(2 * (SQRT3 * s * (radius + 0.5) + 2 * s)), height: Math.ceil(2 * ((1.5 * radius + 1) * s + 2 * s)) };
}

const origin = (map: Pick<SceneMap, 'width' | 'height'>) => ({ x: map.width / 2, y: map.height / 2 });
/** Scene pixel → hex. */
export function hexAt(map: Pick<SceneMap, 'width' | 'height'>, p: { x: number; y: number }): Axial {
  const o = origin(map);
  return fromPixel(p.x - o.x, p.y - o.y, SCENE_HEX_SIZE);
}
/** Hex → scene pixel (hex centre). */
export function hexCentre(map: Pick<SceneMap, 'width' | 'height'>, h: Axial): { x: number; y: number } {
  const o = origin(map);
  const c = toPixel(h, SCENE_HEX_SIZE);
  return { x: Math.round((o.x + c.x) * 1000) / 1000, y: Math.round((o.y + c.y) * 1000) / 1000 };
}

export function decodeTerrain(data: HexSceneData): Map<HexKey, TerrainType> {
  const out = new Map<HexKey, TerrainType>();
  hexesInRange(ORIGIN, data.radius).forEach((h, i) => {
    const t = CODE_TERRAIN[data.terrain[i]];
    if (t) out.set(hexKey(h), t);
  });
  return out;
}
export function encodeTerrain(radius: number, terrainOf: (h: Axial) => TerrainType | null): HexSceneData {
  return { radius, terrain: hexesInRange(ORIGIN, radius).map((h) => { const t = terrainOf(h); return t ? TERRAIN_CODE[t] : '.'; }).join('') };
}
/** Sets terrain of single hexes (editor brush). Hexes outside the radius are ignored. */
export function paintHexes(data: HexSceneData, keys: HexKey[], terrain: TerrainType | null): HexSceneData {
  const index = new Map(hexesInRange(ORIGIN, data.radius).map((h, i) => [hexKey(h), i]));
  const chars = data.terrain.split('');
  for (const k of keys) { const i = index.get(k); if (i !== undefined) chars[i] = terrain ? TERRAIN_CODE[terrain] : '.'; }
  return { radius: data.radius, terrain: chars.join('') };
}

/** Deterministic relief for the painter (the Arena stores elevation; scenes derive it). */
export function sceneElevation(h: Axial, terrain: TerrainType): number {
  const base = { water: 0.08, river: 0.15, road: 0.3, plains: 0.32, ruins: 0.36, magic: 0.4, forest: 0.42, hills: 0.62, mountain: 0.85 }[terrain];
  return Math.max(0, Math.min(1, base + (hash2(h.q, h.r, 977) - 0.5) * 0.08));
}

// ---------------------------------------------------------------- creation

export type HexPreset = 'blank' | 'wilderness' | 'forest' | 'river' | 'ruins';
export const HEX_PRESETS: Array<{ id: HexPreset; label: string }> = [
  { id: 'wilderness', label: 'Wilderness (Arena generator)' },
  { id: 'forest', label: 'Forest clearing' },
  { id: 'river', label: 'River with ford' },
  { id: 'ruins', label: 'Old ruins' },
  { id: 'blank', label: 'Open grassland' },
];

/** Generates terrain with the Arena generator, then shapes it for the preset. Same seed → same map. */
export function generateHexScene(preset: HexPreset, radius: number, seed: number): HexSceneData {
  const r = Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, Math.round(radius)));
  if (preset === 'blank') return encodeTerrain(r, (h) => (valueNoise(h.q / 5, h.r / 5, seed) > 0.78 ? 'hills' : 'plains'));
  const arena = generateArena({ radius: r, seed, landmarkRadius: 0 });
  const base = (h: Axial): TerrainType => arena[hexKey(h)]?.terrain ?? 'plains';
  return encodeTerrain(r, (h) => {
    const n = valueNoise(h.q / 4 + 11, h.r / 4 - 7, seed);
    const d = distance(h, ORIGIN);
    switch (preset) {
      case 'wilderness':
        return base(h);
      case 'forest':
        if (d <= Math.max(1, Math.round(r / 4))) return n > 0.8 ? 'hills' : 'plains';
        return n > 0.32 ? 'forest' : n > 0.2 ? 'plains' : 'hills';
      case 'river': {
        // A river crosses the map; the ford (road) lies near the centre.
        const bend = Math.round(Math.sin((h.q + seed % 7) / 3) * 1.5);
        const onRiver = Math.abs(h.r + Math.round(h.q / 2) - bend) <= 0;
        if (onRiver) return Math.abs(h.q) <= 1 ? 'road' : 'river';
        if (h.q === 0 || h.q === -1) return Math.abs(h.r) <= 2 ? 'road' : n > 0.55 ? 'forest' : 'plains';
        return n > 0.6 ? 'forest' : n > 0.48 ? 'hills' : 'plains';
      }
      case 'ruins':
        if (d <= Math.max(2, Math.round(r / 3))) return n > 0.42 ? 'ruins' : n > 0.3 ? 'road' : 'plains';
        return n > 0.66 ? 'forest' : n > 0.55 ? 'hills' : 'plains';
    }
  });
}

/** A passable hex near the centre for the default spawn. */
export function centralPassableHex(data: HexSceneData): Axial {
  const terrain = decodeTerrain(data);
  const ok = (h: Axial) => { const t = terrain.get(hexKey(h)); return !!t && TERRAIN[t].cost !== null; };
  for (let d = 0; d <= data.radius; d++) for (const h of hexesInRange(ORIGIN, d)) if (distance(h, ORIGIN) === d && ok(h)) return h;
  return ORIGIN;
}

/** Builds a complete hex scene map (keeps the category's units and interval). */
export function hexSceneMap(base: SceneMap, data: HexSceneData, nodes: MapNode[] = []): SceneMap {
  const { width, height } = hexSceneSize(data.radius);
  return { ...base, width, height, grid: 'none', cell: Math.round(SQRT3 * SCENE_HEX_SIZE * 1000) / 1000, nodes, routes: [], hex: data };
}

/** New battle/region map: generated terrain and a spawn on a passable hex near the centre. */
export function newHexScene(base: SceneMap, preset: HexPreset, radius: number, seed: number): SceneMap {
  const data = generateHexScene(preset, radius, seed);
  const map = hexSceneMap(base, data);
  const spawn = hexCentre(map, centralPassableHex(data));
  map.nodes = [{ id: 'entry', x: spawn.x, y: spawn.y, label: 'Arrival', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null }];
  return map;
}

/**
 * Converts an existing square/free-form battle or region map into a hex scene. Trees, rocks,
 * obstacles and water drawn as objects become terrain; walls become mountains; spawn, locations and
 * labels keep their relative position (snapped to the nearest hex). Nothing is deleted on the
 * server until the GM saves the converted draft.
 */
export function convertLegacyMap(map: SceneMap): SceneMap {
  const radius = Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, Math.round(Math.max(map.width, map.height) / Math.max(10, map.cell) / 2)));
  const target = hexSceneMap(map, { radius, terrain: '' });
  const sx = map.width / target.width, sy = map.height / target.height;
  const toOld = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
  const inside = (p: { x: number; y: number }, n: MapNode) => p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height;
  const objectTerrain: Record<string, TerrainType> = { tree: 'forest', rock: 'hills', obstacle: 'ruins', water: 'water' };
  const data = encodeTerrain(radius, (h) => {
    const p = toOld(hexCentre(target, h));
    const hits = map.nodes.filter((n) => (n.kind === 'wall' || n.kind === 'area') && inside(p, n));
    if (hits.some((n) => n.proceduralFeature === 'water')) return 'water';
    if (hits.some((n) => n.kind === 'wall' && !n.proceduralFeature)) return 'mountain';
    const feature = hits.find((n) => n.proceduralFeature)?.proceduralFeature;
    if (feature) return objectTerrain[feature];
    if (hits.some((n) => (n.terrainCost ?? 1) > 1)) return 'hills';
    return 'plains';
  });
  const kept = map.nodes
    .filter((n) => n.kind === 'spawn' || n.kind === 'location' || n.kind === 'label')
    .map((n) => {
      const p = hexCentre(target, clampHex(hexAt(target, { x: n.x / sx, y: n.y / sy }), radius));
      return { ...n, x: p.x, y: p.y };
    });
  const result = hexSceneMap(map, data, kept);
  const spawn = result.nodes.find((n) => n.kind === 'spawn');
  if (spawn && !passable(result, hexAt(result, spawn))) {
    const p = hexCentre(result, centralPassableHex(data));
    spawn.x = p.x; spawn.y = p.y;
  }
  return result;
}

function clampHex(h: Axial, radius: number): Axial {
  const d = distance(h, ORIGIN);
  if (d <= radius) return h;
  const f = radius / d;
  return fromPixel(toPixel(h, 1).x * f, toPixel(h, 1).y * f, 1);
}

// ---------------------------------------------------------------- movement

export function terrainLookup(map: HexMapLike): (k: HexKey) => TerrainType | undefined {
  const t = map.hex ? decodeTerrain(map.hex) : new Map<HexKey, TerrainType>();
  return (k) => t.get(k);
}
export function passable(map: HexMapLike, h: Axial): boolean {
  const t = terrainLookup(map)(hexKey(h));
  return !!t && TERRAIN[t].cost !== null;
}

/** Movement on a hex scene: cheapest path by Arena terrain costs × units per hex. */
export function hexMovementCost(map: HexMapLike, start: { x: number; y: number }, end: { x: number; y: number }): { ok: true; cost: number; to: { x: number; y: number }; path: Axial[] } | { ok: false; error: string } {
  const lookup = terrainLookup(map);
  const goal = hexAt(map, end);
  const goalTerrain = lookup(hexKey(goal));
  if (!goalTerrain) return { ok: false, error: 'Destination is outside the map.' };
  if (TERRAIN[goalTerrain].cost === null) return { ok: false, error: `${TERRAIN[goalTerrain].label} cannot be entered.` };
  const from = hexAt(map, start);
  const costOf = (k: HexKey) => { const t = lookup(k); return t ? TERRAIN[t].cost : null; };
  const reach = dijkstra(hexKey(from), costOf, Infinity, hexKey(goal));
  const info = reach.get(hexKey(goal));
  if (!info) return { ok: false, error: 'No passable path to that hex.' };
  return { ok: true, cost: Math.round(info.cost * map.unitsPerCell * 1e6) / 1e6, to: hexCentre(map, goal), path: pathTo(reach, hexKey(goal)) ?? [] };
}

/** Hexes reachable with a remaining budget (in feet or miles) – the gold movement area. */
export function hexReach(map: HexMapLike, start: { x: number; y: number }, budgetUnits: number): Map<HexKey, { cost: number; prev: HexKey | null }> {
  const lookup = terrainLookup(map);
  const costOf = (k: HexKey) => { const t = lookup(k); return t ? TERRAIN[t].cost : null; };
  return dijkstra(hexKey(hexAt(map, start)), costOf, Math.max(0, budgetUnits / map.unitsPerCell));
}

// ---------------------------------------------------------------- image import

/** Reference colours for sampling a picture into terrain (several per terrain). */
const PALETTE: Array<[TerrainType, number, number, number]> = [
  ['plains', 123, 138, 69], ['plains', 150, 170, 90], ['plains', 105, 130, 70], ['plains', 190, 195, 120],
  ['forest', 47, 90, 51], ['forest', 30, 60, 35], ['forest', 60, 105, 55],
  ['hills', 138, 123, 76], ['hills', 160, 140, 95], ['hills', 120, 100, 60],
  ['mountain', 119, 112, 106], ['mountain', 160, 155, 150], ['mountain', 80, 75, 72], ['mountain', 225, 225, 230],
  ['river', 47, 111, 143], ['river', 90, 150, 190], ['river', 120, 175, 210],
  ['water', 29, 69, 96], ['water', 20, 45, 80], ['water', 40, 90, 150],
  ['road', 181, 154, 100], ['road', 210, 190, 140], ['road', 200, 170, 120],
  ['ruins', 139, 116, 88], ['ruins', 110, 95, 85],
  ['magic', 78, 48, 117], ['magic', 140, 90, 190],
];
export function classifyColour(r: number, g: number, b: number): TerrainType {
  let best: TerrainType = 'plains', bestD = Infinity;
  for (const [t, pr, pg, pb] of PALETTE) {
    // "Redmean" weighting – cheap and close enough to perceived colour distance.
    const rm = (r + pr) / 2, dr = r - pr, dg = g - pg, db = b - pb;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * Samples an RGBA picture (PNG/JPG or a rendered PDF page) into hex terrain. The picture is fitted
 * into the hexagon's bounding box; each hex averages five sample points. Hexes outside the picture
 * become '.' when `cropToImage` is set, otherwise grassland.
 */
export function sampleImageToHex(pixels: Uint8ClampedArray, imgW: number, imgH: number, radius: number, cropToImage = true): HexSceneData {
  const r = Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, Math.round(radius)));
  const box = { w: SQRT3 * SCENE_HEX_SIZE * (2 * r + 1), h: SCENE_HEX_SIZE * (3 * r + 2) };
  const k = Math.min(imgW / box.w, imgH / box.h);
  const ox = imgW / 2, oy = imgH / 2;
  const s = SCENE_HEX_SIZE * 0.45;
  const offsets = [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]];
  return encodeTerrain(r, (h) => {
    const c = toPixel(h, SCENE_HEX_SIZE);
    let R = 0, G = 0, B = 0, n = 0;
    for (const [dx, dy] of offsets) {
      const x = Math.floor(ox + (c.x + dx) * k), y = Math.floor(oy + (c.y + dy) * k);
      if (x < 0 || y < 0 || x >= imgW || y >= imgH) continue;
      const i = (y * imgW + x) * 4;
      if (pixels[i + 3] < 32) continue; // transparent
      R += pixels[i]; G += pixels[i + 1]; B += pixels[i + 2]; n++;
    }
    if (!n) return cropToImage ? null : 'plains';
    return classifyColour(R / n, G / n, B / n);
  });
}

/** Neighbouring hexes of a key (re-exported for the editor brush). */
export const neighbourKeys = (k: HexKey) => neighbors(parseKey(k)).map(hexKey);

/** Changes the hexagon radius; terrain and markers keep their hex (markers outside are pulled inside). */
export function resizeHexScene(map: SceneMap, radius: number): SceneMap {
  if (!map.hex) return map;
  const r = Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, Math.round(radius)));
  const old = decodeTerrain(map.hex);
  const data = encodeTerrain(r, (h) => old.get(hexKey(h)) ?? (distance(h, ORIGIN) > map.hex!.radius ? 'plains' : null));
  const next = hexSceneMap(map, data, []);
  next.nodes = map.nodes.map((n) => ({ ...n, ...hexCentre(next, clampHex(hexAt(map, n), r)) }));
  return next;
}

/** Replaces the terrain but keeps markers on their hexes (a marker on impassable terrain gets grassland). */
export function replaceTerrain(map: SceneMap, data: HexSceneData): SceneMap {
  const next = hexSceneMap(map, data, []);
  next.nodes = map.nodes.map((n) => ({ ...n, ...hexCentre(next, clampHex(hexAt(map, n), data.radius)) }));
  const keys = next.nodes.filter((n) => n.kind === 'spawn' || n.kind === 'location').map((n) => hexKey(hexAt(next, n))).filter((k) => !passable(next, parseKey(k)));
  if (keys.length) next.hex = paintHexes(data, keys, 'plains');
  return next;
}
