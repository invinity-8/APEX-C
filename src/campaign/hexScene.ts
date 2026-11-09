/**
 * Hex scenes: every battle and region map uses the Arena engine (axial hexes, chunked canvas painter,
 * path finding, wheel zoom) with scene-specific content and one of two tile sets:
 *  - region: the Arena terrain types at Arena scale – 3 miles per hex, 8 hexes per day at speed 30;
 *  - battle: 5-foot tiles (walls, trees, boulders, floors, water …) where line of sight matters.
 *
 * Storage (inside the scene's map JSON, no migration): `hex = { radius, terrain, set? }`, where
 * `terrain` has one character per hex in hexesInRange(ORIGIN, radius) order; '.' means "no hex".
 * Scene coordinates stay positive pixels: hex (0,0) sits at the map centre.
 *
 * Pure functions – shared by the editor, the renderers and the server movement/vision rules.
 */
import { ORIGIN, distance, fromPixel, hexKey, hexesInRange, hexCount, neighbors, parseKey, toPixel, type Axial, type HexKey } from '../game/hex.js';
import { dijkstra, pathTo } from '../game/movement.js';
import { generateArena } from '../game/mapgen.js';
import { hash2, valueNoise } from '../game/rng.js';
import { TERRAIN, TERRAIN_ORDER, type TerrainType } from '../game/terrain.js';
import type { MapNode, SceneMap } from './maps.js';

/** Same hex size as the Arena renderer (src/components/map/geometry.ts). */
export const SCENE_HEX_SIZE = 30;
export const MIN_HEX_RADIUS = 2;
export const MAX_HEX_RADIUS = 40;
/** Fixed scales: a battle hex is 5 feet; a region hex is 3 miles (24 miles = 8 hexes per day at speed 30). */
export const BATTLE_FEET_PER_HEX = 5;
export const REGION_MILES_PER_HEX = 3;
export const REGION_HEXES_PER_DAY_AT_30FT = 8;
/** Region maps default to the Arena's size (radius 12 = 469 hexes). */
export const REGION_DEFAULT_RADIUS = 12;
const SQRT3 = Math.sqrt(3);

export type TileSet = 'region' | 'battle';
export type BattleTile = 'grass' | 'dirt' | 'stone' | 'wood' | 'undergrowth' | 'rubble' | 'shallow' | 'deep' | 'tree' | 'boulder' | 'wall';
/** Tile ids are open strings: Arena terrain types, the original battle tiles and the library below. */
export type TileId = string;

/** How the generic painter draws a tile (src/components/map/tilePainter.ts). */
export type TileStyle =
  | 'flat' | 'grass' | 'tallgrass' | 'dots' | 'dunes' | 'waves' | 'cracks' | 'layers' | 'fields' | 'heath' | 'snow' | 'ice' | 'lava' | 'mud'
  | 'trees' | 'conifers' | 'palms' | 'deadwood' | 'savanna' | 'reeds' | 'bush' | 'hedge' | 'stump' | 'mushrooms'
  | 'peaks' | 'cliffs' | 'volcano' | 'crystals' | 'blight' | 'oasis'
  | 'houses' | 'city' | 'castle' | 'tents' | 'tower' | 'cave' | 'shrine' | 'bridge'
  | 'cobbles' | 'marble' | 'carpet' | 'planks' | 'palisade' | 'fence' | 'door' | 'pillar' | 'stairs' | 'statue' | 'pit' | 'stalagmite' | 'rockwall'
  | 'table' | 'crates' | 'barrels' | 'bed' | 'altar' | 'fire' | 'brazier' | 'web' | 'trap' | 'circle' | 'pine';

export interface TileDef {
  id: TileId;
  code: string;
  label: string;
  /** Cost multiplier to enter (null = impassable). */
  cost: number | null;
  /** Blocks line of sight beyond this hex. */
  blocksSight: boolean;
  fill: string;
  description: string;
  /** Library group in the editor palette. */
  group: string;
  /** Generic painter style (absent: Arena painter or the original battle painter). */
  style?: TileStyle;
  /** Accent colour for details. */
  accent?: string;
  /** Emits light (feet) – campfires, braziers, lava, glowing fungi. */
  light?: number;
}

const REGION_CODES: Record<TerrainType, string> = { plains: 'p', road: 'd', forest: 'f', hills: 'h', mountain: 'm', river: 'r', water: 'w', ruins: 'u', magic: 'x' };
export const TERRAIN_CODE = REGION_CODES;
const ARENA_GROUP: Record<TerrainType, string> = { plains: 'Open land', road: 'Open land', forest: 'Forests', hills: 'Hills & mountains', mountain: 'Hills & mountains', river: 'Water & coast', water: 'Water & coast', ruins: 'Settlements', magic: 'Volcanic & arcane' };
type Def = [id: string, code: string, label: string, cost: number | null, sight: boolean, fill: string, group: string, style: TileStyle, accent?: string, light?: number, description?: string];
const make = (d: Def): TileDef => ({ id: d[0], code: d[1], label: d[2], cost: d[3], blocksSight: d[4], fill: d[5], group: d[6], style: d[7], accent: d[8], light: d[9], description: d[10] ?? '' });

/** Region scale (3 mi per hex): the Arena terrain plus a wider overview library. Costs are Arena MP. */
const REGION_TILES: TileDef[] = [
  ...TERRAIN_ORDER.map((t) => ({ id: t, code: REGION_CODES[t], label: TERRAIN[t].label, cost: TERRAIN[t].cost, blocksSight: t === 'mountain', fill: TERRAIN[t].fill, description: TERRAIN[t].description, group: ARENA_GROUP[t] })),
  ...([
    ['steppe', 'e', 'Steppe', 1, false, '#a9a560', 'Open land', 'grass', '#c9c47a'],
    ['farmland', 'a', 'Farmland', 1, false, '#b8a85a', 'Open land', 'fields', '#8c7a3a'],
    ['savanna', 'v', 'Savanna', 1, false, '#bfa962', 'Open land', 'savanna', '#6f7a3a'],
    ['moor', 'o', 'Moor', 2, false, '#6f6a4a', 'Open land', 'heath', '#8a5a7a'],
    ['taiga', 'T', 'Pine forest', 2, false, '#2c4f3a', 'Forests', 'conifers', '#1c3a28'],
    ['jungle', 'J', 'Jungle', 3, false, '#2a6b35', 'Forests', 'palms', '#1d4f26'],
    ['deadwood', 'D', 'Dead forest', 2, false, '#5b5446', 'Forests', 'deadwood', '#3a332a'],
    ['cliffs', 'C', 'Cliffs', null, true, '#7a6f63', 'Hills & mountains', 'cliffs', '#4a4038'],
    ['canyon', 'K', 'Canyon', 3, false, '#a85d3a', 'Hills & mountains', 'layers', '#6e3520'],
    ['sea', 'Z', 'Open sea', null, false, '#173a5c', 'Water & coast', 'waves', '#5a8ab0'],
    ['coast', 'B', 'Beach & coast', 1, false, '#d6c48f', 'Water & coast', 'dots', '#b09a60'],
    ['swamp', 'M', 'Swamp', 3, false, '#4d5a3a', 'Water & coast', 'reeds', '#3a5a5a'],
    ['desert', 'Y', 'Desert', 2, false, '#d8b878', 'Desert & badlands', 'dots', '#b8955a'],
    ['dunes', 'N', 'Dunes', 3, false, '#e0be7a', 'Desert & badlands', 'dunes', '#b8904e'],
    ['badlands', 'L', 'Badlands / mesa', 2, false, '#b4643c', 'Desert & badlands', 'layers', '#7a3a20'],
    ['saltflat', 'F', 'Salt flat', 1, false, '#e6e0d2', 'Desert & badlands', 'cracks', '#b8b0a0'],
    ['oasis', 'O', 'Oasis', 1, false, '#4f9a6a', 'Desert & badlands', 'oasis', '#2f6f8f'],
    ['tundra', 'U', 'Tundra', 2, false, '#9fa79a', 'Cold lands', 'heath', '#c8d0c8'],
    ['snowfield', 'W', 'Snowfield', 2, false, '#e6edf2', 'Cold lands', 'snow', '#b8c8d8'],
    ['glacier', 'G', 'Glacier', 3, false, '#bcd6e6', 'Cold lands', 'ice', '#8ab0c8'],
    ['volcano', 'V', 'Volcano', null, true, '#4a3a34', 'Volcanic & arcane', 'volcano', '#e0602a', 40],
    ['lavafield', 'X', 'Lava field', null, false, '#5a2a1a', 'Volcanic & arcane', 'lava', '#ff8a2a', 20],
    ['ashlands', 'A', 'Ashlands', 2, false, '#5e5a56', 'Volcanic & arcane', 'dots', '#3a3836'],
    ['crystals', 'Q', 'Crystal field', 2, false, '#7fb6c9', 'Volcanic & arcane', 'crystals', '#d0f0ff', 10],
    ['blight', 'H', 'Blighted land', 2, false, '#5a4a5e', 'Volcanic & arcane', 'blight', '#9a6aa8'],
    ['village', 'i', 'Village', 1, false, '#9a8a5a', 'Settlements', 'houses', '#a0402a'],
    ['town', 'c', 'Town / city', 1, false, '#8c7c66', 'Settlements', 'city', '#8a3a2a'],
    ['castle', 'k', 'Castle', 1, true, '#8a8580', 'Settlements', 'castle', '#5a5550'],
    ['bridge', 'b', 'Bridge', 0.5, false, '#2f6f8f', 'Settlements', 'bridge', '#9a7a4a'],
    ['camp', 'q', 'Camp', 1, false, '#8a9a55', 'Settlements', 'tents', '#c8b890'],
    ['tower', 't', 'Watchtower', 1, true, '#7b8a45', 'Settlements', 'tower', '#6a6058'],
    ['cave', 'n', 'Cave entrance', 2, false, '#77706a', 'Settlements', 'cave', '#1a1816'],
    ['shrine', 's', 'Shrine', 1, false, '#7b8a45', 'Settlements', 'shrine', '#e8d4a6'],
  ] as Def[]).map(make),
];

/** Battle scale (5 ft per hex). Cost ×2 = difficult terrain; null = blocks movement. */
const BATTLE_TILES: TileDef[] = [
  { id: 'grass', code: 'G', label: 'Grass', cost: 1, blocksSight: false, fill: '#6f8a45', description: 'Open ground.', group: 'Ground' },
  { id: 'dirt', code: 'D', label: 'Dirt path', cost: 1, blocksSight: false, fill: '#8a6f4a', description: 'Trodden earth.', group: 'Ground' },
  { id: 'stone', code: 'S', label: 'Stone floor', cost: 1, blocksSight: false, fill: '#8d8a83', description: 'Flagstones.', group: 'Floors' },
  { id: 'wood', code: 'W', label: 'Wooden floor', cost: 1, blocksSight: false, fill: '#8a5f36', description: 'Planks.', group: 'Floors' },
  { id: 'undergrowth', code: 'U', label: 'Undergrowth', cost: 2, blocksSight: false, fill: '#4f6e35', description: 'Difficult terrain.', group: 'Nature' },
  { id: 'rubble', code: 'R', label: 'Rubble', cost: 2, blocksSight: false, fill: '#7c7166', description: 'Difficult terrain.', group: 'Rock & cave' },
  { id: 'shallow', code: 'A', label: 'Shallow water', cost: 2, blocksSight: false, fill: '#4f8fae', description: 'Difficult terrain.', group: 'Water' },
  { id: 'deep', code: 'X', label: 'Deep water', cost: null, blocksSight: false, fill: '#24577a', description: 'Too deep to wade.', group: 'Water' },
  { id: 'tree', code: 'T', label: 'Tree', cost: null, blocksSight: true, fill: '#2d5a2e', description: 'A trunk: blocks movement and sight.', group: 'Nature' },
  { id: 'boulder', code: 'B', label: 'Boulder', cost: null, blocksSight: false, fill: '#77736c', description: 'Blocks movement; you can see past it.', group: 'Rock & cave' },
  { id: 'wall', code: 'H', label: 'Stone wall', cost: null, blocksSight: true, fill: '#4a4540', description: 'Blocks movement and sight.', group: 'Structures' },
  ...([
    ['sand', 'Y', 'Sand', 1, false, '#d6bd85', 'Ground', 'dots', '#b09a60'],
    ['mud', 'M', 'Mud', 2, false, '#5e4a33', 'Ground', 'mud', '#4a3a26'],
    ['snow', 'N', 'Deep snow', 2, false, '#e8eef2', 'Ground', 'snow', '#b8c8d8'],
    ['ice', 'I', 'Ice', 2, false, '#bcd6e6', 'Ground', 'ice', '#8ab0c8'],
    ['cavefloor', 'C', 'Cave floor', 1, false, '#5a544c', 'Rock & cave', 'dots', '#3a3630'],
    ['cobbles', 'K', 'Cobblestones', 1, false, '#8a8580', 'Floors', 'cobbles', '#5a5550'],
    ['marble', 'Q', 'Marble tiles', 1, false, '#d8d2c6', 'Floors', 'marble', '#a8a090'],
    ['carpet', 'P', 'Carpet', 1, false, '#7a2a2a', 'Floors', 'carpet', '#c8a050'],
    ['tallgrass', 'L', 'Tall grass', 1, false, '#8a9a4f', 'Nature', 'tallgrass', '#b0b860'],
    ['bush', 'J', 'Thick bush', 2, true, '#3f6a32', 'Nature', 'bush', '#2a4f22'],
    ['hedge', 'E', 'Hedge', null, true, '#355a2c', 'Nature', 'hedge', '#244020'],
    ['pine', 'F', 'Pine tree', null, true, '#2a4f38', 'Nature', 'pine', '#1a3a26'],
    ['stump', 'O', 'Tree stump', 2, false, '#6f8a45', 'Nature', 'stump', '#7a5a36'],
    ['mushrooms', 'Z', 'Glowing fungi', 1, false, '#4a4a5a', 'Nature', 'mushrooms', '#7ae0d0', 10],
    ['swampwater', 'V', 'Swamp water', 2, false, '#4a5a3a', 'Water', 'reeds', '#3a5a5a'],
    ['bridge', 'b', 'Wooden bridge', 1, false, '#24577a', 'Water', 'bridge', '#9a6a3c'],
    ['cavewall', 'c', 'Cave wall', null, true, '#3a3632', 'Rock & cave', 'rockwall', '#5a544c'],
    ['pit', 'p', 'Pit / chasm', null, false, '#141210', 'Rock & cave', 'pit', '#3a3430'],
    ['stalagmite', 'g', 'Stalagmite', null, false, '#5a544c', 'Rock & cave', 'stalagmite', '#8a8478'],
    ['palisade', 'w', 'Wooden wall', null, true, '#6a4a2a', 'Structures', 'palisade', '#4a321c'],
    ['fence', 'f', 'Fence', null, false, '#6f8a45', 'Structures', 'fence', '#7a5a36'],
    ['door', 'd', 'Door', 1, true, '#7a5230', 'Structures', 'door', '#3a2814', undefined, 'Closed door: you can pass, but not see through.'],
    ['pillar', 'i', 'Pillar', null, true, '#8d8a83', 'Structures', 'pillar', '#c8c2b6'],
    ['stairs', 's', 'Stairs', 2, false, '#8d8a83', 'Structures', 'stairs', '#5a5650'],
    ['statue', 't', 'Statue', null, false, '#8d8a83', 'Structures', 'statue', '#b8b2a6'],
    ['table', 'e', 'Table', 2, false, '#8a5f36', 'Furniture & props', 'table', '#6a4422'],
    ['crates', 'k', 'Crates', null, false, '#8a5f36', 'Furniture & props', 'crates', '#a87a46'],
    ['barrels', 'r', 'Barrels', null, false, '#8a5f36', 'Furniture & props', 'barrels', '#6a4a2a'],
    ['bed', 'a', 'Bed', 2, false, '#8a5f36', 'Furniture & props', 'bed', '#c8c0a8'],
    ['altar', 'l', 'Altar', null, false, '#8d8a83', 'Furniture & props', 'altar', '#e8d4a6'],
    ['campfire', 'h', 'Campfire', null, false, '#6f8a45', 'Furniture & props', 'fire', '#ff9a3a', 20],
    ['brazier', 'z', 'Brazier', null, false, '#8d8a83', 'Furniture & props', 'brazier', '#ff9a3a', 20],
    ['lava', 'v', 'Lava', null, false, '#5a2a1a', 'Hazards', 'lava', '#ff8a2a', 15],
    ['web', 'q', 'Spider web', 2, false, '#5a544c', 'Hazards', 'web', '#e8e8e8'],
    ['trap', 'x', 'Trap / spikes', 2, false, '#8d8a83', 'Hazards', 'trap', '#6a6660'],
    ['circle', 'm', 'Magic circle', 1, false, '#4a3a5e', 'Hazards', 'circle', '#c8a0ff', 10],
  ] as Def[]).map(make),
];
export const TILESETS: Record<TileSet, TileDef[]> = { region: REGION_TILES, battle: BATTLE_TILES };
const BY_CODE: Record<TileSet, Map<string, TileDef>> = { region: new Map(REGION_TILES.map((t) => [t.code, t])), battle: new Map(BATTLE_TILES.map((t) => [t.code, t])) };
const BY_ID: Record<TileSet, Map<string, TileDef>> = { region: new Map(REGION_TILES.map((t) => [t.id, t])), battle: new Map(BATTLE_TILES.map((t) => [t.id, t])) };
export const tileDef = (set: TileSet, id: string): TileDef | undefined => BY_ID[set].get(id);

/** The parts of a scene map the hex rules need. */
export type HexMapLike = Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell'>;

export interface HexSceneData {
  radius: number;
  /** One code per hex (see TILESETS). '.' = no hex. */
  terrain: string;
  /** Tile set; absent = region (Arena terrain). */
  set?: 'battle';
  /**
   * APEX 1.8 – ground height per hex in 5-ft levels, one code per hex like `terrain` ('0'–'9', 'a'–'z' = 0–35).
   * Absent = flat (every older map). Steps of one level are stairs (climbing up costs extra), two or more are cliffs.
   */
  heights?: string;
}
export const MAX_LEVEL = 35;
const LEVEL_CODES = '0123456789abcdefghijklmnopqrstuvwxyz';
export const levelCode = (n: number) => LEVEL_CODES[Math.max(0, Math.min(MAX_LEVEL, Math.round(n)))];
export const levelOf = (c: string | undefined) => Math.max(0, LEVEL_CODES.indexOf(c ?? '0'));
/** Ground height (levels of 5 ft) per hex; 0 everywhere on flat maps. */
export function heightLookup(map: Pick<SceneMap, 'hex'>): (k: HexKey) => number {
  const data = map.hex;
  if (!data?.heights) return () => 0;
  const index = new Map(hexesInRange(ORIGIN, data.radius).map((h, i) => [hexKey(h), i]));
  const hs = data.heights;
  return (k) => { const i = index.get(k); return i === undefined ? 0 : levelOf(hs[i]); };
}
/** Raises / lowers / sets the ground of single hexes (editor height brush). */
export function setHeights(data: HexSceneData, keys: HexKey[], level: (current: number) => number): HexSceneData {
  const n = data.terrain.length;
  const chars = (data.heights ?? '0'.repeat(n)).split('');
  const index = new Map(hexesInRange(ORIGIN, data.radius).map((h, i) => [hexKey(h), i]));
  for (const k of keys) { const i = index.get(k); if (i !== undefined) chars[i] = levelCode(level(levelOf(chars[i]))); }
  const heights = chars.join('');
  if (/^0+$/.test(heights)) { const { heights: _drop, ...flat } = data; void _drop; return flat; }
  return { ...data, heights };
}
export const tileSetOf = (data: Pick<HexSceneData, 'set'> | undefined): TileSet => (data?.set === 'battle' ? 'battle' : 'region');

export function validHexData(v: unknown): v is HexSceneData {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const h = v as HexSceneData;
  if (h.set !== undefined && h.set !== 'battle') return false;
  const codes = [...BY_CODE[tileSetOf(h)].keys()].join('');
  if (h.heights !== undefined && (typeof h.heights !== 'string' || h.heights.length !== h.terrain.length || !/^[0-9a-z]+$/.test(h.heights))) return false;
  return Number.isInteger(h.radius) && h.radius >= MIN_HEX_RADIUS && h.radius <= MAX_HEX_RADIUS && typeof h.terrain === 'string' && h.terrain.length === hexCount(h.radius) && new RegExp(`^[${codes}.]+$`).test(h.terrain);
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

/** Hex → tile definition. */
export function decodeTiles(data: HexSceneData): Map<HexKey, TileDef> {
  const set = BY_CODE[tileSetOf(data)];
  const out = new Map<HexKey, TileDef>();
  hexesInRange(ORIGIN, data.radius).forEach((h, i) => {
    const t = set.get(data.terrain[i]);
    if (t) out.set(hexKey(h), t);
  });
  return out;
}
/** Region maps: hex → Arena terrain type. */
export function decodeTerrain(data: HexSceneData): Map<HexKey, TileId> {
  return new Map([...decodeTiles(data)].map(([k, t]) => [k, t.id]));
}
export function encodeTiles(radius: number, set: TileSet, tileOf: (h: Axial) => TileId | null): HexSceneData {
  const byId = BY_ID[set];
  const terrain = hexesInRange(ORIGIN, radius).map((h) => { const t = tileOf(h); return (t && byId.get(t)?.code) || '.'; }).join('');
  return set === 'battle' ? { radius, terrain, set: 'battle' } : { radius, terrain };
}
export function encodeTerrain(radius: number, terrainOf: (h: Axial) => TerrainType | null): HexSceneData {
  return encodeTiles(radius, 'region', terrainOf);
}
/** Sets the tile of single hexes (editor brush). Hexes outside the radius are ignored. */
export function paintHexes(data: HexSceneData, keys: HexKey[], tile: TileId | null): HexSceneData {
  const code = tile ? BY_ID[tileSetOf(data)].get(tile)?.code : '.';
  if (!code) return data;
  const index = new Map(hexesInRange(ORIGIN, data.radius).map((h, i) => [hexKey(h), i]));
  const chars = data.terrain.split('');
  for (const k of keys) { const i = index.get(k); if (i !== undefined) chars[i] = code; }
  return { ...data, terrain: chars.join('') };
}

/** Deterministic relief for the Arena painter (the Arena stores elevation; scenes derive it). */
export function sceneElevation(h: Axial, terrain: TerrainType): number {
  const base = { water: 0.08, river: 0.15, road: 0.3, plains: 0.32, ruins: 0.36, magic: 0.4, forest: 0.42, hills: 0.62, mountain: 0.85 }[terrain];
  return Math.max(0, Math.min(1, base + (hash2(h.q, h.r, 977) - 0.5) * 0.08));
}

// ---------------------------------------------------------------- creation

export type HexPreset = 'blank' | 'wilderness' | 'forest' | 'river' | 'ruins' | 'dungeon';
export const PRESETS: Record<TileSet, Array<{ id: HexPreset; label: string }>> = {
  region: [
    { id: 'wilderness', label: 'Wilderness (Arena generator)' },
    { id: 'forest', label: 'Forested region' },
    { id: 'river', label: 'River valley with ford' },
    { id: 'ruins', label: 'Ruined district' },
    { id: 'blank', label: 'Open grassland' },
  ],
  battle: [
    { id: 'forest', label: 'Forest clearing' },
    { id: 'river', label: 'Stream with ford' },
    { id: 'ruins', label: 'Ruined building' },
    { id: 'dungeon', label: 'Dungeon rooms & corridors' },
    { id: 'blank', label: 'Open field' },
  ],
};
export const HEX_PRESETS = PRESETS.region;

/** Region terrain with the Arena generator, shaped for the preset. Same seed → same map. */
export function generateHexScene(preset: HexPreset, radius: number, seed: number): HexSceneData {
  const r = clampRadius(radius);
  if (preset === 'blank' || preset === 'dungeon') return encodeTerrain(r, (h) => (valueNoise(h.q / 5, h.r / 5, seed) > 0.78 ? 'hills' : 'plains'));
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
        if (riverRow(h, seed)) return Math.abs(h.q) <= 1 ? 'road' : 'river';
        if (h.q === 0 || h.q === -1) return Math.abs(h.r) <= 2 ? 'road' : n > 0.55 ? 'forest' : 'plains';
        return n > 0.6 ? 'forest' : n > 0.48 ? 'hills' : 'plains';
      }
      case 'ruins':
        if (d <= Math.max(2, Math.round(r / 3))) return n > 0.42 ? 'ruins' : n > 0.3 ? 'road' : 'plains';
        return n > 0.66 ? 'forest' : n > 0.55 ? 'hills' : 'plains';
    }
  });
}

const riverRow = (h: Axial, seed: number) => h.r + Math.round(h.q / 2) - Math.round(Math.sin((h.q + (seed % 7)) / 3) * 1.5);

/** 5-foot battle tiles. Same seed → same map. */
export function generateBattleScene(preset: HexPreset, radius: number, seed: number): HexSceneData {
  const r = clampRadius(radius);
  const rnd = (h: Axial, salt: number) => hash2(h.q * 7 + salt, h.r * 13 - salt, seed);
  const ground = (h: Axial): BattleTile => (valueNoise(h.q / 3 + 5, h.r / 3, seed) > 0.72 ? 'dirt' : 'grass');
  if (preset === 'dungeon') {
    const rooms: Array<{ c: Axial; r: number }> = [{ c: ORIGIN, r: 2 }];
    for (let i = 0; i < 8; i++) {
      const c = { q: Math.round((hash2(i, 1, seed) - 0.5) * 2 * (r - 3)), r: Math.round((hash2(i, 2, seed) - 0.5) * 2 * (r - 3)) };
      if (distance(c, ORIGIN) <= r - 3) rooms.push({ c, r: 1 + Math.floor(hash2(i, 3, seed) * 2.5) });
    }
    const floor = new Set<HexKey>();
    for (const room of rooms) for (const h of hexesInRange(room.c, room.r)) floor.add(hexKey(h));
    for (let i = 1; i < rooms.length; i++) for (const h of hexLine(rooms[i - 1].c, rooms[i].c)) floor.add(hexKey(h));
    return encodeTiles(r, 'battle', (h) => (floor.has(hexKey(h)) ? (rnd(h, 4) > 0.93 ? 'rubble' : 'stone') : 'wall'));
  }
  if (preset === 'ruins') {
    const half = Math.max(2, Math.round(r / 2.5));
    return encodeTiles(r, 'battle', (h) => {
      const d = distance(h, ORIGIN);
      if (d === half) return rnd(h, 1) > 0.78 ? 'rubble' : h.q === 0 || h.r === 0 ? 'stone' : 'wall';
      if (d < half) return rnd(h, 2) > 0.85 ? 'rubble' : d === 1 && rnd(h, 3) > 0.6 ? 'wall' : 'stone';
      if (rnd(h, 5) > 0.95) return 'boulder';
      return rnd(h, 6) > 0.9 ? 'undergrowth' : ground(h);
    });
  }
  if (preset === 'river') {
    return encodeTiles(r, 'battle', (h) => {
      const row = riverRow(h, seed);
      if (Math.abs(h.q) <= 1 && Math.abs(row) <= 1) return row === 0 ? 'shallow' : 'stone';
      if (row === 0) return 'deep';
      if (Math.abs(row) === 1) return 'shallow';
      if (rnd(h, 7) > 0.9) return 'tree';
      return rnd(h, 8) > 0.85 ? 'undergrowth' : ground(h);
    });
  }
  if (preset === 'forest') {
    const clearing = Math.max(1, Math.round(r / 3));
    return encodeTiles(r, 'battle', (h) => {
      const d = distance(h, ORIGIN);
      if (d <= clearing) return rnd(h, 9) > 0.9 ? 'undergrowth' : 'grass';
      const dense = valueNoise(h.q / 4, h.r / 4 + 3, seed);
      const roll = rnd(h, 10);
      if (roll < 0.18 + dense * 0.25) return 'tree';
      if (roll < 0.45 + dense * 0.2) return 'undergrowth';
      if (roll > 0.97) return 'boulder';
      return ground(h);
    });
  }
  return encodeTiles(r, 'battle', (h) => (rnd(h, 11) > 0.97 ? 'boulder' : rnd(h, 12) > 0.93 ? 'undergrowth' : ground(h)));
}

function clampRadius(radius: number) {
  return Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, Math.round(radius)));
}

/** Hexes on the straight line between two hexes (inclusive). */
export function hexLine(a: Axial, b: Axial, nudge = 1e-6): Axial[] {
  const n = distance(a, b);
  if (n === 0) return [a];
  const out: Axial[] = [];
  const as = -a.q - a.r, bs = -b.q - b.r;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = a.q + nudge + (b.q - a.q) * t, r = a.r + nudge + (b.r - a.r) * t, s = as - 2 * nudge + (bs - as) * t;
    let rq = Math.round(q), rr = Math.round(r);
    const rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    out.push({ q: rq + 0, r: rr + 0 });
  }
  return out;
}

/** A passable hex near the centre for the default spawn. */
export function centralPassableHex(data: HexSceneData): Axial {
  const tiles = decodeTiles(data);
  const ok = (h: Axial) => { const t = tiles.get(hexKey(h)); return !!t && t.cost !== null; };
  for (let d = 0; d <= data.radius; d++) for (const h of hexesInRange(ORIGIN, d)) if (distance(h, ORIGIN) === d && ok(h)) return h;
  return ORIGIN;
}

/** Builds a complete hex scene map. Scale is fixed by the tile set (5 ft or 3 mi per hex). */
export function hexSceneMap(base: SceneMap, data: HexSceneData, nodes: MapNode[] = []): SceneMap {
  const { width, height } = hexSceneSize(data.radius);
  const battle = tileSetOf(data) === 'battle';
  return { ...base, width, height, grid: 'none', cell: Math.round(SQRT3 * SCENE_HEX_SIZE * 1000) / 1000, unit: battle ? 'feet' : 'miles', unitsPerCell: battle ? BATTLE_FEET_PER_HEX : REGION_MILES_PER_HEX, nodes, routes: [], hex: data };
}

/** New battle/region map: generated tiles and a spawn on a passable hex near the centre. */
export function newHexScene(base: SceneMap, preset: HexPreset, radius: number, seed: number, set: TileSet = base.unit === 'feet' ? 'battle' : 'region'): SceneMap {
  const data = set === 'battle' ? generateBattleScene(preset, radius, seed) : generateHexScene(preset, radius, seed);
  const map = hexSceneMap(base, data);
  const spawn = hexCentre(map, centralPassableHex(data));
  map.nodes = [{ id: 'entry', x: spawn.x, y: spawn.y, label: 'Arrival', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null }];
  return map;
}

/**
 * Converts an old drawn map (before hex scenes) into a hex scene. Trees, rocks, obstacles, water and
 * walls drawn as objects become tiles; spawn, locations and labels keep their relative position.
 */
export function convertLegacyMap(map: SceneMap): SceneMap {
  const set: TileSet = map.unit === 'feet' ? 'battle' : 'region';
  const radius = clampRadius(Math.max(map.width, map.height) / Math.max(10, map.cell) / 2);
  const target = hexSceneMap(map, { radius, terrain: '', ...(set === 'battle' ? { set: 'battle' as const } : {}) });
  const sx = map.width / target.width, sy = map.height / target.height;
  const inside = (p: { x: number; y: number }, n: MapNode) => p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height;
  const pick: Record<string, Record<TileSet, TileId>> = {
    tree: { battle: 'tree', region: 'forest' }, rock: { battle: 'boulder', region: 'hills' }, obstacle: { battle: 'rubble', region: 'ruins' },
    water: { battle: 'deep', region: 'water' }, wall: { battle: 'wall', region: 'mountain' }, rough: { battle: 'undergrowth', region: 'hills' }, open: { battle: 'grass', region: 'plains' },
  };
  const data = encodeTiles(radius, set, (h) => {
    const c = hexCentre(target, h);
    const p = { x: c.x * sx, y: c.y * sy };
    const hits = map.nodes.filter((n) => (n.kind === 'wall' || n.kind === 'area') && inside(p, n));
    if (hits.some((n) => n.proceduralFeature === 'water')) return pick.water[set];
    if (hits.some((n) => n.kind === 'wall' && !n.proceduralFeature)) return pick.wall[set];
    const feature = hits.find((n) => n.proceduralFeature)?.proceduralFeature;
    if (feature) return pick[feature][set];
    if (hits.some((n) => (n.terrainCost ?? 1) > 1)) return pick.rough[set];
    return pick.open[set];
  });
  const kept = map.nodes
    .filter((n) => n.kind === 'spawn' || n.kind === 'location' || n.kind === 'label')
    .map((n) => ({ ...n, ...hexCentre(target, clampHex(hexAt(target, { x: n.x / sx, y: n.y / sy }), radius)) }));
  return withPassableMarkers(hexSceneMap(map, data, kept));
}

/** Region-terrain battle maps (created before the 5-ft tile set) → battle tiles. */
export function convertToBattleTiles(map: SceneMap, seed = 1): SceneMap {
  if (!map.hex || tileSetOf(map.hex) === 'battle') return map;
  const old = decodeTerrain(map.hex);
  const data = encodeTiles(map.hex.radius, 'battle', (h) => {
    const roll = hash2(h.q, h.r, seed);
    switch (old.get(hexKey(h))) {
      case undefined: return null;
      case 'forest': return roll < 0.35 ? 'tree' : roll < 0.75 ? 'undergrowth' : 'grass';
      case 'mountain': return 'wall';
      case 'hills': return roll < 0.25 ? 'boulder' : 'rubble';
      case 'water': return 'deep';
      case 'river': return 'shallow';
      case 'road': return 'dirt';
      case 'ruins': return roll < 0.3 ? 'wall' : roll < 0.65 ? 'rubble' : 'stone';
      case 'magic': return 'stone';
      default: return 'grass';
    }
  });
  return withPassableMarkers({ ...hexSceneMap(map, data, map.nodes) });
}

function withPassableMarkers(map: SceneMap): SceneMap {
  if (!map.hex) return map;
  const keys = map.nodes.filter((n) => n.kind === 'spawn' || n.kind === 'location').map((n) => hexKey(hexAt(map, n))).filter((k) => !passable(map, parseKey(k)));
  if (keys.length) map.hex = paintHexes(map.hex, keys, tileSetOf(map.hex) === 'battle' ? 'grass' : 'plains');
  return map;
}

function clampHex(h: Axial, radius: number): Axial {
  const d = distance(h, ORIGIN);
  if (d <= radius) return h;
  const f = radius / d;
  return fromPixel(toPixel(h, 1).x * f, toPixel(h, 1).y * f, 1);
}

// ---------------------------------------------------------------- movement

export function tileLookup(map: Pick<SceneMap, 'hex'>): (k: HexKey) => TileDef | undefined {
  const t = map.hex ? decodeTiles(map.hex) : new Map<HexKey, TileDef>();
  return (k) => t.get(k);
}
export function terrainLookup(map: Pick<SceneMap, 'hex'>): (k: HexKey) => TileId | undefined {
  const t = tileLookup(map);
  return (k) => t(k)?.id;
}
export function passable(map: Pick<SceneMap, 'hex'>, h: Axial): boolean {
  const t = tileLookup(map)(hexKey(h));
  return !!t && t.cost !== null;
}

/**
 * Cost of one step (in hexes): the tile cost, +1 for climbing one level up (a 5-ft step counts double); two or more
 * levels up or down are a cliff that walkers can't take. Flat maps: the tile cost only.
 */
export function stepCost(map: Pick<SceneMap, 'hex'>, lookup = tileLookup(map), opts: MoveMode = {}): (k: HexKey, from?: HexKey) => number | null {
  const height = map.hex?.heights ? heightLookup(map) : null;
  return (k, from) => {
    const tile = lookup(k);
    if (!tile) return null;
    // APEX 1.9 – flying: over difficult ground, water, trees and boulders, steps and cliffs; walls still block
    if (opts.fly) return tile.id === 'wall' ? null : 1;
    const c = tile.cost;
    if (c === null || !height || from === undefined) return c;
    const dh = height(k) - height(from);
    // climbing speed: cliffs are climbable at normal cost (going up and down)
    if (opts.climb) return c;
    // APEX 2.0: jumping down a cliff is possible (falling damage from 10 ft); paths prefer stairs (+1 per jump)
    if (dh <= -2) return c + 1;
    if (dh > 1) return null;
    return dh === 1 ? c + 1 : c;
  };
}
/** Drops of two or more levels along a walked path (jumping down a cliff): the fall in feet per jump. */
export function pathDrops(map: Pick<SceneMap, 'hex'>, path: Axial[], from?: Axial): number[] {
  if (!map.hex?.heights) return [];
  const h = heightLookup(map);
  const out: number[] = [];
  const pts = from ? [from, ...path] : path;
  for (let i = 1; i < pts.length; i++) { const d = h(hexKey(pts[i - 1])) - h(hexKey(pts[i])); if (d >= 2) out.push(d * 5); }
  return out;
}
/** How a creature moves: flying (in the air) or with a climbing speed. */
export interface MoveMode { fly?: boolean; climb?: boolean }

/** Movement on a hex scene: cheapest path by tile costs × units per hex (5 ft or 3 mi). */
export function hexMovementCost(map: HexMapLike, start: { x: number; y: number }, end: { x: number; y: number }, mode: MoveMode = {}): { ok: true; cost: number; to: { x: number; y: number }; path: Axial[]; steps: Array<{ x: number; y: number; cost: number }> } | { ok: false; error: string } {
  const lookup = tileLookup(map);
  const goal = hexAt(map, end);
  const goalTile = lookup(hexKey(goal));
  if (!goalTile) return { ok: false, error: 'Destination is outside the map.' };
  if (goalTile.cost === null && !(mode.fly && goalTile.id !== 'wall')) return { ok: false, error: `${goalTile.label} cannot be entered.` };
  const from = hexAt(map, start);
  const reach = dijkstra(hexKey(from), stepCost(map, lookup, mode), Infinity, hexKey(goal));
  const info = reach.get(hexKey(goal));
  if (!info) return { ok: false, error: 'No passable path to that hex.' };
  const path = pathTo(reach, hexKey(goal)) ?? [];
  // every entered hex with the cumulative cost (feet / miles) – for previews, animation and interrupted moves
  const steps = path.map((h) => ({ ...hexCentre(map, h), cost: Math.round((reach.get(hexKey(h))?.cost ?? 0) * map.unitsPerCell * 1e6) / 1e6 }));
  return { ok: true, cost: Math.round(info.cost * map.unitsPerCell * 1e6) / 1e6, to: hexCentre(map, goal), path, steps };
}

/** Hexes reachable with a remaining budget (in feet or miles) – the gold movement area. */
export function hexReach(map: HexMapLike, start: { x: number; y: number }, budgetUnits: number, mode: MoveMode = {}): Map<HexKey, { cost: number; prev: HexKey | null }> {
  const lookup = tileLookup(map);
  return dijkstra(hexKey(hexAt(map, start)), stepCost(map, lookup, mode), Math.max(0, budgetUnits / map.unitsPerCell));
}

// ---------------------------------------------------------------- image import

/** Reference colours for sampling a picture into tiles (several per tile). */
const PALETTES: Record<TileSet, Array<[TileId, number, number, number]>> = {
  region: [
    ['plains', 123, 138, 69], ['plains', 150, 170, 90], ['plains', 105, 130, 70], ['plains', 190, 195, 120],
    ['forest', 47, 90, 51], ['forest', 30, 60, 35], ['forest', 60, 105, 55],
    ['hills', 138, 123, 76], ['hills', 160, 140, 95], ['hills', 120, 100, 60],
    ['mountain', 119, 112, 106], ['mountain', 160, 155, 150], ['mountain', 80, 75, 72], ['mountain', 225, 225, 230],
    ['river', 47, 111, 143], ['river', 90, 150, 190], ['river', 120, 175, 210],
    ['water', 29, 69, 96], ['water', 20, 45, 80], ['water', 40, 90, 150],
    ['road', 181, 154, 100], ['road', 210, 190, 140], ['road', 200, 170, 120],
    ['ruins', 139, 116, 88], ['ruins', 110, 95, 85],
    ['magic', 78, 48, 117], ['magic', 140, 90, 190],
  ],
  battle: [
    ['grass', 111, 138, 69], ['grass', 140, 165, 85], ['grass', 95, 125, 60],
    ['dirt', 138, 111, 74], ['dirt', 170, 140, 100], ['dirt', 200, 175, 130],
    ['stone', 141, 138, 131], ['stone', 175, 170, 160], ['stone', 205, 200, 190],
    ['wood', 138, 95, 54], ['wood', 160, 115, 70],
    ['undergrowth', 79, 110, 53], ['undergrowth', 70, 95, 45],
    ['rubble', 124, 113, 102],
    ['shallow', 79, 143, 174], ['shallow', 120, 175, 210],
    ['deep', 36, 87, 122], ['deep', 20, 45, 80],
    ['tree', 45, 90, 46], ['tree', 25, 55, 30],
    ['boulder', 119, 115, 108],
    ['wall', 74, 69, 64], ['wall', 40, 38, 36], ['wall', 15, 15, 15],
  ],
};
export function classifyColour(r: number, g: number, b: number, set: TileSet = 'region'): TileId {
  let best: TileId = PALETTES[set][0][0], bestD = Infinity;
  for (const [t, pr, pg, pb] of PALETTES[set]) {
    // "Redmean" weighting – cheap and close enough to perceived colour distance.
    const rm = (r + pr) / 2, dr = r - pr, dg = g - pg, db = b - pb;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * Samples an RGBA picture (PNG/JPG or a rendered PDF page) into hex tiles. The picture is fitted into
 * the hexagon's bounding box; each hex averages five sample points.
 */
export function sampleImageToHex(pixels: Uint8ClampedArray, imgW: number, imgH: number, radius: number, cropToImage = true, set: TileSet = 'region'): HexSceneData {
  const r = clampRadius(radius);
  const box = { w: SQRT3 * SCENE_HEX_SIZE * (2 * r + 1), h: SCENE_HEX_SIZE * (3 * r + 2) };
  const k = Math.min(imgW / box.w, imgH / box.h);
  const ox = imgW / 2, oy = imgH / 2;
  const s = SCENE_HEX_SIZE * 0.45;
  const offsets = [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]];
  return encodeTiles(r, set, (h) => {
    const c = toPixel(h, SCENE_HEX_SIZE);
    let R = 0, G = 0, B = 0, n = 0;
    for (const [dx, dy] of offsets) {
      const x = Math.floor(ox + (c.x + dx) * k), y = Math.floor(oy + (c.y + dy) * k);
      if (x < 0 || y < 0 || x >= imgW || y >= imgH) continue;
      const i = (y * imgW + x) * 4;
      if (pixels[i + 3] < 32) continue; // transparent
      R += pixels[i]; G += pixels[i + 1]; B += pixels[i + 2]; n++;
    }
    if (!n) return cropToImage ? null : set === 'battle' ? 'grass' : 'plains';
    return classifyColour(R / n, G / n, B / n, set);
  });
}

/** Neighbouring hexes of a key (editor brush). */
export const neighbourKeys = (k: HexKey) => neighbors(parseKey(k)).map(hexKey);

/** Changes the hexagon radius; tiles and markers keep their hex (markers outside are pulled inside). */
export function resizeHexScene(map: SceneMap, radius: number): SceneMap {
  if (!map.hex) return map;
  const r = clampRadius(radius);
  const set = tileSetOf(map.hex);
  const old = decodeTerrain(map.hex);
  const fill: TileId = set === 'battle' ? 'grass' : 'plains';
  const data = encodeTiles(r, set, (h) => old.get(hexKey(h)) ?? (distance(h, ORIGIN) > map.hex!.radius ? fill : null));
  const next = hexSceneMap(map, data, []);
  next.nodes = map.nodes.map((n) => ({ ...n, ...hexCentre(next, clampHex(hexAt(map, n), r)) }));
  return next;
}

/** Replaces the tiles but keeps markers on their hexes (a marker on impassable ground gets open ground). */
export function replaceTerrain(map: SceneMap, data: HexSceneData): SceneMap {
  const next = hexSceneMap(map, data, []);
  next.nodes = map.nodes.map((n) => ({ ...n, ...hexCentre(next, clampHex(hexAt(map, n), data.radius)) }));
  return withPassableMarkers(next);
}

/**
 * Arrival area: the 16 passable hexes closest to the spawn (≈ a 4 × 4 area), in a stable order
 * (breadth-first from the spawn, then by key). Arriving characters take the first free slots.
 */
export const SPAWN_SLOTS = 16;
export function spawnSlots(map: HexMapLike, spawn: { x: number; y: number }, count = SPAWN_SLOTS): Axial[] {
  const lookup = tileLookup(map);
  const start = hexAt(map, spawn);
  const ok = (k: HexKey) => { const t = lookup(k); return !!t && t.cost !== null; };
  const out: Axial[] = [];
  const seen = new Set<HexKey>([hexKey(start)]);
  let frontier = [start];
  while (frontier.length && out.length < count) {
    for (const h of frontier) if (ok(hexKey(h)) && out.length < count) out.push(h);
    const next: Axial[] = [];
    for (const h of frontier) for (const n of neighbors(h)) { const k = hexKey(n); if (!seen.has(k) && lookup(k)) { seen.add(k); next.push(n); } }
    frontier = next.sort((a, b) => a.r - b.r || a.q - b.q);
  }
  return out;
}
