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
    // APEX 2.1 – asset library: farm & village, town & city, interiors and crypts (codes from Latin-1 letters)
    ['wheat', 'À', 'Wheat field', 2, false, '#b89a4a', 'Farm & village', 'fields', '#e0c060'],
    ['veggies', 'Á', 'Vegetable patch', 2, false, '#6a5236', 'Farm & village', 'fields', '#5c8a3a'],
    ['flowers', 'Â', 'Flower meadow', 1, false, '#6f8a45', 'Farm & village', 'heath', '#e070a0'],
    ['haystack', 'Ã', 'Haystack', null, true, '#8a6f4a', 'Farm & village', 'bush', '#e0c060'],
    ['well', 'Ä', 'Well', null, false, '#8a8580', 'Farm & village', 'pillar', '#5a5550'],
    ['cart', 'Å', 'Cart / wagon', null, false, '#8a6f4a', 'Farm & village', 'crates', '#7a5230'],
    ['woodpile', 'Æ', 'Woodpile', null, false, '#8a6f4a', 'Farm & village', 'crates', '#6a4422'],
    ['scarecrow', 'Ç', 'Scarecrow', null, false, '#b89a4a', 'Farm & village', 'statue', '#d8c48a'],
    ['trough', 'È', 'Water trough', null, false, '#8a6f4a', 'Farm & village', 'table', '#4f8fae'],
    ['beehives', 'É', 'Beehives', null, false, '#6f8a45', 'Farm & village', 'barrels', '#e0b040'],
    ['stonewall', 'Ê', 'Low stone wall', 2, false, '#6f8a45', 'Farm & village', 'fence', '#8a847a'],
    ['cottage', 'Ë', 'Cottage (thatch)', null, true, '#8a6f4a', 'Farm & village', 'houses', '#d8c48a'],
    ['barn', 'Ì', 'Barn', null, true, '#8a6f4a', 'Farm & village', 'houses', '#9a3a2a'],
    ['windmill', 'Í', 'Windmill', null, true, '#8a6f4a', 'Farm & village', 'tower', '#e8dcc0'],
    ['tent', 'Î', 'Tent', null, true, '#6f8a45', 'Farm & village', 'tents', '#c8b890'],
    ['signpost', 'Ï', 'Signpost', 1, false, '#8a6f4a', 'Farm & village', 'fence', '#7a5230'],
    ['orchard', 'Ð', 'Fruit tree', null, true, '#3a6a32', 'Nature', 'trees', '#c0392b'],
    ['birch', 'Ñ', 'Birch', null, true, '#5a7a3a', 'Nature', 'trees', '#e8e4d8'],
    ['deadtree', 'Ò', 'Dead tree', null, false, '#6a5a42', 'Nature', 'deadwood', '#4a3a2a'],
    ['log', 'Ó', 'Fallen log', 2, false, '#6f8a45', 'Nature', 'stump', '#6a4a2a'],
    ['rocks', 'Ô', 'Scattered stones', 1, false, '#7c7166', 'Rock & cave', 'dots', '#9a948a'],
    ['townhouse', 'Õ', 'Townhouse (stone)', null, true, '#8a8580', 'Town & city', 'city', '#9a3a2a'],
    ['timberhouse', 'Ö', 'Half-timbered house', null, true, '#8a8580', 'Town & city', 'houses', '#5a3a22'],
    ['shop', 'Ø', 'Shop front', null, true, '#8a8580', 'Town & city', 'houses', '#2d4f8f'],
    ['citywall', 'Ù', 'City wall', null, true, '#6a645c', 'Town & city', 'castle', '#8a847a'],
    ['tower', 'Ú', 'Round tower', null, true, '#6a645c', 'Town & city', 'tower', '#8a847a'],
    ['gate', 'Û', 'Gatehouse (open)', 1, false, '#8a8580', 'Town & city', 'door', '#6a645c'],
    ['stall', 'Ü', 'Market stall', null, false, '#8a8580', 'Town & city', 'tents', '#c0392b'],
    ['fountain', 'Ý', 'Fountain', null, false, '#8a8580', 'Town & city', 'shrine', '#6fb1e0'],
    ['lamppost', 'Þ', 'Street lamp', null, false, '#8a8580', 'Town & city', 'brazier', '#ffcf6b', 15],
    ['bench', 'ß', 'Bench', 2, false, '#8a8580', 'Town & city', 'table', '#7a5230'],
    ['planter', 'à', 'Flower planter', 2, false, '#8a8580', 'Town & city', 'bush', '#e070a0'],
    ['canalwater', 'á', 'Canal', null, false, '#2f5f7a', 'Town & city', 'waves', '#5a5550'],
    ['grate', 'â', 'Sewer grate', 1, false, '#6a645c', 'Town & city', 'cobbles', '#2a2622'],
    ['banner', 'ã', 'Banner pole', null, false, '#8a8580', 'Town & city', 'pillar', '#b3261e'],
    ['pier', 'ä', 'Pier', 1, false, '#7a5a3a', 'Water', 'bridge', '#24577a'],
    ['counter', 'å', 'Bar counter', null, false, '#8a5f36', 'Furniture & props', 'table', '#5a3a22'],
    ['bookshelf', 'æ', 'Bookshelf', null, true, '#8a5f36', 'Furniture & props', 'crates', '#7a2a2a'],
    ['chest', 'ç', 'Chest', null, false, '#8a5f36', 'Furniture & props', 'crates', '#d8b25a'],
    ['hearth', 'è', 'Fireplace', null, true, '#8d8a83', 'Furniture & props', 'fire', '#ff9a3a', 20],
    ['forge', 'é', 'Forge & anvil', null, false, '#5a544c', 'Furniture & props', 'brazier', '#ff9a3a', 10],
    ['weaponrack', 'ê', 'Weapon rack', null, false, '#8a5f36', 'Furniture & props', 'fence', '#c8ccd2'],
    ['throne', 'ë', 'Throne', null, false, '#7a2a2a', 'Furniture & props', 'statue', '#d8b25a'],
    ['sarcophagus', 'ì', 'Sarcophagus', null, false, '#5a544c', 'Furniture & props', 'altar', '#a8a090'],
    ['bones', 'í', 'Bones & skulls', 1, false, '#5a544c', 'Hazards', 'dots', '#e8dcc0'],
    ['cage', 'î', 'Cage', null, false, '#5a544c', 'Furniture & props', 'fence', '#3a3632'],
    ['gravestone', 'ï', 'Gravestones', 2, false, '#5f7a45', 'Farm & village', 'statue', '#9a948a'],
    ['urns', 'ð', 'Urns & pottery', null, false, '#8a8580', 'Furniture & props', 'barrels', '#b87333'],
    ['crystals', 'ñ', 'Crystal cluster', null, false, '#4a4a5a', 'Rock & cave', 'crystals', '#a0d8ff', 10],
    ['boat', 'ò', 'Rowing boat', 2, false, '#24577a', 'Water', 'bridge', '#7a5230'],
    ['ruinwall', 'ó', 'Broken wall', 2, false, '#7c7166', 'Structures', 'rockwall', '#8a847a'],
    ['bedroll', 'ô', 'Bedroll', 1, false, '#6f8a45', 'Farm & village', 'tents', '#5c7a2a'],
    ['lilies', 'õ', 'Lily pond', 2, false, '#4f8fae', 'Water', 'reeds', '#e070a0'],
    ['shrine', 'ö', 'Wayside shrine', null, false, '#6f8a45', 'Structures', 'shrine', '#d8b25a'],
    ['totem', 'ø', 'Tribal totem', null, false, '#8a6f4a', 'Structures', 'statue', '#b3261e'],
    ['dummy', 'ù', 'Training dummy', null, false, '#8a6f4a', 'Farm & village', 'statue', '#c8b890'],
    ['ladder', 'ú', 'Ladder', 1, false, '#8a8580', 'Structures', 'stairs', '#7a5230', undefined, 'Climb up or down one level at no extra cost.'],
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
  const codes = [...BY_CODE[tileSetOf(h)].keys()].map((c) => c.replace(/[\\\]^-]/g, '\\$&')).join('');
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

export type HexPreset = 'blank' | 'wilderness' | 'forest' | 'river' | 'ruins' | 'dungeon' | 'camp' | 'cave' | 'highlands' | 'village' | 'swamp' | 'temple' | 'chasm' | 'desert' | 'winter'
  | 'farmstead' | 'hamlet' | 'orchard' | 'graveyard' | 'manor' | 'market' | 'streets' | 'docks' | 'citygate' | 'tavern' | 'crypt';
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
    { id: 'camp', label: 'Bandit camp (palisade, campfire, tents)' },
    { id: 'cave', label: 'Cave with stalagmites, fungi and pits' },
    { id: 'highlands', label: 'Highland pass (plateaus, stairs, cliffs)' },
    { id: 'village', label: 'Village square (houses, fences, well)' },
    { id: 'swamp', label: 'Swamp (bog, reeds, dead trees)' },
    { id: 'temple', label: 'Temple ruin (pillars, raised altar)' },
    { id: 'chasm', label: 'Chasm with a bridge' },
    { id: 'desert', label: 'Desert oasis (dunes, palms, water)' },
    { id: 'winter', label: 'Winter forest with a frozen lake' },
    // APEX 2.1 – rural and city layouts
    { id: 'farmstead', label: 'Rural · Farmstead (fields, barn, haystacks)' },
    { id: 'hamlet', label: 'Rural · Hamlet at a crossroads' },
    { id: 'orchard', label: 'Rural · Walled orchard with beehives' },
    { id: 'graveyard', label: 'Rural · Graveyard with a chapel' },
    { id: 'manor', label: 'Rural · Manor house and garden' },
    { id: 'market', label: 'City · Market square with fountain' },
    { id: 'streets', label: 'City · Streets, alleys and a canal' },
    { id: 'docks', label: 'City · Harbour docks and piers' },
    { id: 'citygate', label: 'City · City wall, towers and gate' },
    { id: 'tavern', label: 'Interior · Tavern (taproom, hearth, rooms)' },
    { id: 'crypt', label: 'Interior · Crypt (sarcophagi, bones, cages)' },
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
      default:
        return base(h);
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
  const themed = themedBattleScene(preset, r, seed, rnd, ground) ?? settlementScene(preset, r, seed, rnd, ground);
  if (themed) return themed;
  return encodeTiles(r, 'battle', (h) => (rnd(h, 11) > 0.97 ? 'boulder' : rnd(h, 12) > 0.93 ? 'undergrowth' : ground(h)));
}

/** Ground heights (5-ft levels) for a generated map. */
function withLevels(data: HexSceneData, level: (h: Axial) => number): HexSceneData {
  const heights = hexesInRange(ORIGIN, data.radius).map((h) => levelCode(level(h))).join('');
  return /^0+$/.test(heights) ? data : { ...data, heights };
}

/**
 * APEX 2.0 scenario presets – themed battle maps with ground heights (same seed → same map).
 */
function themedBattleScene(preset: HexPreset, r: number, seed: number, rnd: (h: Axial, salt: number) => number, ground: (h: Axial) => BattleTile): HexSceneData | null {
  const noise = (h: Axial, sx: number, salt = 0) => valueNoise(h.q / sx + salt, h.r / sx - salt, seed);
  const d0 = (h: Axial) => distance(h, ORIGIN);
  switch (preset) {
    case 'camp': {
      // a palisade ring with two gates, a campfire in the middle, tents (crates, beds), barrels, braziers at the gates
      const ring = Math.max(3, Math.round(r * 0.55));
      return encodeTiles(r, 'battle', (h) => {
        const d = d0(h);
        if (d === 0) return 'campfire';
        if (d === ring) return Math.abs(h.r) <= 0 || (h.q === 0 && h.r !== 0 && Math.abs(h.r) === ring) ? 'dirt' : rnd(h, 1) > 0.94 ? 'rubble' : 'palisade';
        if (d === ring + 1 && (h.r === 0 || (h.q === 0 && Math.abs(h.r) === ring + 1))) return 'brazier';
        if (d < ring) {
          const roll = rnd(h, 2);
          if (d === 2 && roll > 0.55) return roll > 0.8 ? 'bed' : 'crates';
          if (d === ring - 1 && roll > 0.82) return roll > 0.92 ? 'barrels' : 'table';
          return roll > 0.7 ? 'dirt' : 'grass';
        }
        return rnd(h, 3) > 0.88 ? 'tree' : rnd(h, 4) > 0.85 ? 'undergrowth' : ground(h);
      });
    }
    case 'cave': {
      const data = encodeTiles(r, 'battle', (h) => {
        const n = noise(h, 3.2, 7), d = d0(h);
        if (d >= r - 1 || n < 0.32) return 'cavewall';
        const roll = rnd(h, 5);
        if (n > 0.8 && roll > 0.6) return 'pit';
        if (roll > 0.93) return 'stalagmite';
        if (roll > 0.88) return 'mushrooms';
        if (roll > 0.8) return 'rubble';
        return roll > 0.97 ? 'web' : 'cavefloor';
      });
      return withLevels(data, (h) => Math.round(noise(h, 5, 3) * 3));
    }
    case 'highlands': {
      // two plateaus (15 and 25 ft) linked by stairs, a path through the valley
      const a = { q: -Math.round(r / 2), r: Math.round(r / 4) }, b = { q: Math.round(r / 2), r: -Math.round(r / 3) };
      const level = (h: Axial) => { const da = distance(h, a), db = distance(h, b); return da <= 3 ? 3 : db <= 3 ? 5 : db === 4 ? 3 : 0; };
      const data = encodeTiles(r, 'battle', (h) => {
        const lv = level(h), roll = rnd(h, 6);
        if (Math.abs(h.r + Math.round(h.q / 3)) <= 0 && lv === 0) return 'dirt';
        if (lv > 0 && roll > 0.9) return 'boulder';
        if (lv === 0 && roll > 0.9) return 'pine';
        return roll > 0.75 ? 'tallgrass' : 'grass';
      });
      return withLevels(data, (h) => {
        const lv = level(h), da = distance(h, a), db = distance(h, b);
        // stairs: one hex of each plateau steps down
        if (da === 4 && h.q === a.q + 4 - Math.abs(h.r - a.r)) return 1;
        if (db === 5 && h.r === b.r) return 1;
        if (da === 3 && h.r === a.r && h.q > a.q) return 2;
        return lv;
      });
    }
    case 'village': {
      const houses: Axial[] = [];
      for (let i = 0; i < 6; i++) { const ang = (i / 6) * Math.PI * 2 + hash2(i, 7, seed); const dist = Math.round(r * 0.6); houses.push({ q: Math.round(Math.cos(ang) * dist), r: Math.round(Math.sin(ang) * dist - Math.cos(ang) * dist / 2) }); }
      return encodeTiles(r, 'battle', (h) => {
        const d = d0(h);
        if (d === 0) return 'pillar'; // the well
        if (d <= 2) return 'cobbles';
        for (const [i, c] of houses.entries()) {
          const dh = distance(h, c);
          if (dh === 0) return 'table';
          if (dh === 1) return h.q === c.q && h.r === c.r + 1 ? 'door' : i % 2 ? 'wall' : 'palisade';
        }
        const roll = rnd(h, 8);
        if (roll > 0.94) return 'barrels';
        if (roll > 0.9) return 'fence';
        if (roll > 0.86) return 'tree';
        return d <= 4 && roll > 0.4 ? 'dirt' : 'grass';
      });
    }
    case 'swamp': {
      return encodeTiles(r, 'battle', (h) => {
        const n = noise(h, 3, 11), roll = rnd(h, 9);
        if (n > 0.66) return roll > 0.85 ? 'deep' : 'swampwater';
        if (n > 0.55) return 'mud';
        if (roll > 0.9) return 'stump';
        if (roll > 0.84) return 'tree';
        if (roll > 0.7) return 'bush';
        return roll > 0.45 ? 'undergrowth' : 'grass';
      });
    }
    case 'temple': {
      // a marble hall with two rows of pillars, a raised dais (10 ft) with the altar and statues, stairs up
      const hall = Math.max(4, Math.round(r * 0.65));
      const data = encodeTiles(r, 'battle', (h) => {
        const d = d0(h);
        if (d > hall) return rnd(h, 10) > 0.8 ? 'rubble' : rnd(h, 11) > 0.85 ? 'tree' : ground(h);
        if (d === hall) return h.q === 0 && h.r > 0 ? 'stairs' : rnd(h, 12) > 0.72 ? 'rubble' : 'wall';
        if (h.r === -hall + 1 && h.q === 0) return 'altar';
        if (h.r === -hall + 1 && Math.abs(h.q) === 2) return 'statue';
        if (Math.abs(h.q) === 2 && h.r % 2 === 0 && h.r > -hall + 2) return 'pillar';
        if (h.q === 0 && h.r === -hall + 3) return 'stairs';
        return rnd(h, 13) > 0.92 ? 'rubble' : h.q === 0 ? 'carpet' : 'marble';
      });
      return withLevels(data, (h) => (d0(h) < hall && h.r <= -hall + 2 ? 2 : d0(h) < hall && h.r === -hall + 3 && h.q === 0 ? 1 : 0));
    }
    case 'chasm': {
      // a deep chasm across the map (pits), a wooden bridge in the middle, rocky high banks
      const data = encodeTiles(r, 'battle', (h) => {
        const row = Math.abs(h.r + Math.round(h.q / 2));
        if (row <= 1) return Math.abs(h.q) <= 0 ? 'bridge' : 'pit';
        const roll = rnd(h, 14);
        if (roll > 0.9) return 'boulder';
        if (roll > 0.82) return 'rubble';
        return roll > 0.5 ? 'dirt' : 'grass';
      });
      return withLevels(data, (h) => (Math.abs(h.r + Math.round(h.q / 2)) <= 1 && h.q !== 0 ? 0 : 4));
    }
    case 'desert': {
      const data = encodeTiles(r, 'battle', (h) => {
        const d = d0(h), roll = rnd(h, 15);
        if (d <= 1) return 'shallow';
        if (d === 2) return roll > 0.6 ? 'tree' : 'grass';
        if (roll > 0.95) return 'boulder';
        return roll > 0.9 ? 'rubble' : 'sand';
      });
      return withLevels(data, (h) => (d0(h) <= 2 ? 0 : Math.round(noise(h, 2.5, 5) * 2)));
    }
    case 'winter': {
      const data = encodeTiles(r, 'battle', (h) => {
        const n = noise(h, 3.5, 13), roll = rnd(h, 16);
        if (d0(h) <= Math.max(2, Math.round(r / 3))) return 'ice';
        if (roll > 0.8 - n * 0.25) return 'pine';
        if (roll > 0.94) return 'boulder';
        return 'snow';
      });
      return withLevels(data, (h) => (d0(h) <= Math.max(2, Math.round(r / 3)) ? 0 : Math.round(noise(h, 4, 9) * 2)));
    }
    default:
      return null;
  }
}

/** APEX 2.1 – rural and city layouts. Buildings are clusters of building hexes (each hex a wall block with a roof). */
function settlementScene(preset: HexPreset, r: number, seed: number, rnd: (h: Axial, salt: number) => number, ground: (h: Axial) => BattleTile): HexSceneData | null {
  const tiles = new Map<HexKey, TileId>();
  const levels = new Map<HexKey, number>();
  const inside = (h: Axial) => distance(h, ORIGIN) <= r;
  const set = (h: Axial, t: TileId, force = true) => { const k = hexKey(h); if (inside(h) && (force || !tiles.has(k))) tiles.set(k, t); };
  const free = (h: Axial) => inside(h) && !tiles.has(hexKey(h));
  const at = (i: number, salt: number) => hash2(i, salt, seed);
  const polar = (ang: number, dist: number): Axial => ({ q: Math.round(Math.cos(ang) * dist), r: Math.round(Math.sin(ang) * dist - (Math.cos(ang) * dist) / 2) });
  const blob = (c: Axial, rad: number, t: TileId) => { for (const h of hexesInRange(c, rad)) set(h, t); };
  /** A house of `size` hexes grown around c (compact, slightly irregular). */
  const house = (c: Axial, size: number, t: TileId, salt: number) => {
    const cells: Axial[] = [c];
    for (let i = 0; cells.length < size && i < 40; i++) { const from = cells[Math.floor(at(i, salt) * cells.length)]; const n = neighbors(from)[Math.floor(at(i, salt + 1) * 6)]; if (!cells.some((x) => x.q === n.q && x.r === n.r) && inside(n)) cells.push(n); }
    cells.forEach((h) => set(h, t));
    return cells;
  };
  const line = (a: Axial, b: Axial, t: TileId, force = true) => hexLine(a, b).forEach((h) => set(h, t, force));
  const ringAt = (c: Axial, rad: number) => hexesInRange(c, rad).filter((h) => distance(h, c) === rad);
  const scatter = (n: number, t: TileId, salt: number, ok: (h: Axial) => boolean = () => true) => {
    const all = hexesInRange(ORIGIN, r).filter((h) => free(h) && ok(h));
    for (let i = 0; i < n && all.length; i++) { const j = Math.floor(at(i, salt) * all.length); set(all[j], t); all.splice(j, 1); }
  };
  const fill = (fn: (h: Axial) => TileId) => encodeTiles(r, 'battle', (h) => tiles.get(hexKey(h)) ?? fn(h));
  const withLv = (data: HexSceneData) => (levels.size ? withLevels(data, (h) => levels.get(hexKey(h)) ?? 0) : data);
  const lawn = (h: Axial): TileId => (rnd(h, 41) > 0.93 ? 'flowers' : rnd(h, 42) > 0.88 ? 'tallgrass' : ground(h));
  switch (preset) {
    case 'farmstead': {
      const home = polar(at(1, 1) * 6.28, Math.round(r * 0.35)), barnAt = polar(at(1, 1) * 6.28 + 2.2, Math.round(r * 0.4));
      house(home, 4, 'cottage', 10); house(barnAt, 5, 'barn', 20);
      line(home, barnAt, 'dirt', false); line(home, polar(at(2, 2) * 6.28, r), 'dirt', false);
      // fields: two fenced plots of wheat and vegetables
      const fieldA = polar(at(1, 1) * 6.28 + 4.2, Math.round(r * 0.55)), fieldB = polar(at(1, 1) * 6.28 + 5.4, Math.round(r * 0.5));
      const plot = (c: Axial, rad: number, crop: TileId) => { for (const h of hexesInRange(c, rad)) if (free(h)) set(h, distance(h, c) === rad ? (rnd(h, 3) > 0.25 ? 'fence' : 'grass') : crop); };
      plot(fieldA, 2, 'wheat'); plot(fieldB, 2, 'veggies');
      set(fieldA, 'scarecrow');
      for (const h of ringAt(barnAt, 2).slice(0, 3)) if (free(h)) set(h, 'haystack');
      const yard = ringAt(home, 2).filter(free);
      [['well', 0], ['cart', 2], ['woodpile', 4], ['trough', 6], ['beehives', 8]].forEach(([t, i]) => { const h = yard[(i as number) % Math.max(1, yard.length)]; if (h && free(h)) set(h, t as TileId); });
      scatter(Math.round(r * 0.8), 'tree', 5, (h) => distance(h, ORIGIN) >= r - 1);
      scatter(Math.round(r * 0.5), 'stonewall', 6, (h) => distance(h, ORIGIN) === r - 2);
      return fill(lawn);
    }
    case 'hamlet': {
      // two dirt roads crossing in the middle, a well and a signpost, cottages and gardens around
      for (let i = -r; i <= r; i++) { set({ q: i, r: 0 }, 'dirt'); set({ q: 0, r: i }, 'dirt'); }
      set(ORIGIN, 'well'); set({ q: 1, r: -1 }, 'signpost');
      for (let i = 0; i < 6; i++) {
        const c = polar(i * 1.047 + 0.5 + at(i, 3) * 0.3, Math.round(r * (0.45 + at(i, 4) * 0.2)));
        if (!free(c)) continue;
        house(c, 3 + Math.floor(at(i, 5) * 3), at(i, 6) > 0.3 ? 'cottage' : 'timberhouse', 30 + i);
        for (const h of ringAt(c, 2)) if (free(h) && rnd(h, 7) > 0.6) set(h, rnd(h, 8) > 0.5 ? 'fence' : rnd(h, 9) > 0.5 ? 'veggies' : 'flowers');
      }
      scatter(3, 'cart', 11, (h) => distance(h, ORIGIN) <= 3); scatter(2, 'woodpile', 12); scatter(3, 'barrels', 13);
      scatter(Math.round(r * 0.9), 'orchard', 14, (h) => distance(h, ORIGIN) >= r - 1);
      scatter(Math.round(r * 0.6), 'tree', 15, (h) => distance(h, ORIGIN) >= r - 2);
      return fill(lawn);
    }
    case 'orchard': {
      for (const h of ringAt(ORIGIN, r - 1)) set(h, Math.abs(h.q) <= 0 && h.r > 0 ? 'dirt' : 'stonewall');
      for (const h of hexesInRange(ORIGIN, r - 2)) if ((h.q % 2 === 0) && ((h.r + h.q / 2) % 2 === 0) && free(h) && distance(h, ORIGIN) > 1) set(h, rnd(h, 16) > 0.15 ? 'orchard' : 'stump');
      house(polar(at(1, 17) * 6.28, Math.round(r * 0.3)), 3, 'cottage', 40);
      scatter(4, 'beehives', 18, (h) => distance(h, ORIGIN) < r - 2); scatter(2, 'cart', 19, (h) => distance(h, ORIGIN) < r - 2); scatter(3, 'crates', 20, (h) => distance(h, ORIGIN) < r - 2);
      return fill((h) => (distance(h, ORIGIN) >= r ? (rnd(h, 21) > 0.6 ? 'tree' : 'grass') : lawn(h)));
    }
    case 'graveyard': {
      for (const h of ringAt(ORIGIN, r - 1)) set(h, h.q === 0 && h.r > 0 ? 'gate' : rnd(h, 22) > 0.9 ? 'rubble' : 'stonewall');
      const chapel = { q: 0, r: -Math.round(r * 0.55) };
      house(chapel, 6, 'townhouse', 50); set({ q: chapel.q, r: chapel.r + 2 }, 'door');
      for (const h of hexesInRange(ORIGIN, r - 2)) if (free(h) && h.q % 2 === 0 && h.r > chapel.r + 2 && Math.abs(h.q) > 0) set(h, rnd(h, 23) > 0.2 ? 'gravestone' : 'sarcophagus');
      for (let i = -r; i < r; i++) set({ q: 0, r: i }, i >= chapel.r + 2 ? 'dirt' : tiles.get(hexKey({ q: 0, r: i })) ?? 'dirt', false);
      scatter(Math.round(r * 0.6), 'deadtree', 24, (h) => distance(h, ORIGIN) <= r - 2); scatter(3, 'bones', 25); scatter(2, 'statue', 26, (h) => distance(h, ORIGIN) <= r - 2);
      scatter(2, 'lamppost', 27, (h) => distance(h, ORIGIN) <= 2);
      return fill((h) => (distance(h, ORIGIN) >= r ? (rnd(h, 28) > 0.55 ? 'deadtree' : 'undergrowth') : rnd(h, 29) > 0.8 ? 'mud' : 'grass'));
    }
    case 'manor': {
      const hall = { q: 0, r: -Math.round(r * 0.5) };
      blob(hall, 1, 'townhouse'); set({ q: hall.q - 2, r: hall.r + 1 }, 'townhouse'); set({ q: hall.q + 2, r: hall.r - 1 }, 'townhouse'); set({ q: hall.q, r: hall.r + 2 }, 'door');
      for (const h of ringAt(ORIGIN, r - 1)) set(h, h.q === 0 && h.r > 0 ? 'gate' : 'hedge');
      line({ q: 0, r: hall.r + 3 }, { q: 0, r: r - 1 }, 'dirt', false);
      set({ q: 0, r: Math.round(r * 0.25) }, 'fountain');
      for (const h of ringAt({ q: 0, r: Math.round(r * 0.25) }, 2)) if (free(h)) set(h, rnd(h, 30) > 0.5 ? 'planter' : 'cobbles');
      for (const h of hexesInRange(ORIGIN, r - 2)) if (free(h) && Math.abs(h.q) >= 3 && rnd(h, 31) > 0.55) set(h, rnd(h, 32) > 0.5 ? 'hedge' : 'flowers');
      scatter(2, 'statue', 33, (h) => distance(h, ORIGIN) < r - 2); scatter(3, 'bench', 34, (h) => distance(h, ORIGIN) < r - 2);
      return fill((h) => (distance(h, ORIGIN) >= r ? (rnd(h, 35) > 0.5 ? 'tree' : 'grass') : 'grass'));
    }
    case 'market': {
      const sq = Math.max(3, Math.round(r * 0.45));
      set(ORIGIN, 'fountain');
      for (const h of ringAt(ORIGIN, Math.max(2, sq - 1))) if (rnd(h, 36) > 0.45) set(h, 'stall');
      // streets leaving the square in three directions
      for (const d of [0, 2, 4]) line(ORIGIN, polar(d * 1.047, r), 'cobbles', false);
      // houses around the square form the street walls
      for (const h of hexesInRange(ORIGIN, r)) {
        const d = distance(h, ORIGIN);
        if (d > sq && free(h)) set(h, rnd(h, 37) > 0.2 ? (['townhouse', 'timberhouse', 'shop'] as const)[Math.floor(rnd(h, 38) * 3)] : 'cobbles');
      }
      for (const h of ringAt(ORIGIN, sq)) if (rnd(h, 39) > 0.8) set(h, 'lamppost');
      scatter(5, 'crates', 40, (h) => distance(h, ORIGIN) <= sq); scatter(4, 'barrels', 41, (h) => distance(h, ORIGIN) <= sq); scatter(2, 'cart', 42, (h) => distance(h, ORIGIN) <= sq); scatter(2, 'bench', 43, (h) => distance(h, ORIGIN) <= sq); scatter(2, 'banner', 44, (h) => distance(h, ORIGIN) <= sq);
      return fill(() => 'cobbles');
    }
    case 'streets': {
      // a grid of lanes (every 4th row and column), blocks of houses between, a canal with a bridge
      const lane = (h: Axial) => ((h.q % 4) + 4) % 4 === 0 || ((h.r % 4) + 4) % 4 === 0;
      const canalRow = (h: Axial) => h.r + Math.round(h.q / 2) === 2;
      for (const h of hexesInRange(ORIGIN, r)) {
        if (canalRow(h)) { set(h, h.q === 0 || h.q === -4 || h.q === 4 ? 'bridge' : 'canalwater'); continue; }
        if (lane(h)) { set(h, rnd(h, 45) > 0.93 ? 'grate' : 'cobbles'); continue; }
        set(h, rnd(h, 46) > 0.12 ? (['townhouse', 'timberhouse', 'timberhouse', 'shop'] as const)[Math.floor(rnd(h, 47) * 4)] : rnd(h, 48) > 0.5 ? 'crates' : 'barrels');
      }
      for (const h of hexesInRange(ORIGIN, r)) if (lane(h) && !canalRow(h) && rnd(h, 49) > 0.94) set(h, 'lamppost');
      return fill(() => 'cobbles');
    }
    case 'docks': {
      // water on the far side, a stone quay, piers into the water, a warehouse row and cargo
      const shore = (h: Axial) => h.r + Math.round(h.q / 2);
      for (const h of hexesInRange(ORIGIN, r)) {
        const s0 = shore(h);
        if (s0 < -1) set(h, 'deep');
        else if (s0 === -1) set(h, 'canalwater');
        else if (s0 <= 1) set(h, 'cobbles');
      }
      for (const q of [-Math.round(r * 0.6), 0, Math.round(r * 0.6)]) for (let k = 0; k < 4; k++) { const h = { q, r: -1 - Math.round(q / 2) - k }; if (inside(h)) set(h, 'pier'); }
      for (const h of hexesInRange(ORIGIN, r)) if (shore(h) >= Math.round(r * 0.5) && free(h)) set(h, rnd(h, 50) > 0.25 ? (rnd(h, 51) > 0.5 ? 'townhouse' : 'barn') : 'cobbles');
      scatter(8, 'crates', 52, (h) => shore(h) >= 0 && shore(h) < r * 0.5); scatter(6, 'barrels', 53, (h) => shore(h) >= 0 && shore(h) < r * 0.5); scatter(2, 'cart', 54, (h) => shore(h) > 1 && shore(h) < r * 0.5);
      scatter(3, 'lamppost', 55, (h) => shore(h) === 1);
      return fill((h) => (shore(h) > 1 ? 'cobbles' : 'cobbles'));
    }
    case 'citygate': {
      // the wall runs across the map; towers every few hexes and a gatehouse in the middle
      const wallRow = (h: Axial) => h.r + Math.round(h.q / 2);
      for (const h of hexesInRange(ORIGIN, r)) {
        const w = wallRow(h);
        if (w === 0) set(h, h.q === 0 ? 'gate' : Math.abs(h.q) % 5 === 2 ? 'tower' : 'citywall');
        else if (w > 0 && w <= 2 && Math.abs(h.q) <= 1) set(h, 'cobbles');
        else if (w < 0 && Math.abs(h.q) <= 1) set(h, 'dirt');
        else if (w > Math.round(r * 0.5) && free(h)) set(h, rnd(h, 56) > 0.3 ? (['townhouse', 'timberhouse', 'shop'] as const)[Math.floor(rnd(h, 57) * 3)] : 'cobbles');
      }
      set({ q: -2, r: 2 }, 'banner'); set({ q: 2, r: 0 }, 'banner'); scatter(3, 'crates', 58, (h) => wallRow(h) > 0); scatter(2, 'cart', 59, (h) => wallRow(h) < -1);
      scatter(Math.round(r * 0.6), 'tent', 60, (h) => wallRow(h) < -2 && Math.abs(h.q) > 2);
      scatter(Math.round(r * 0.5), 'tree', 61, (h) => wallRow(h) < -2);
      return fill((h) => (wallRow(h) > 0 ? 'cobbles' : lawn(h)));
    }
    case 'tavern': {
      const hall = r - 1;
      for (const h of ringAt(ORIGIN, hall)) set(h, h.q === 0 && h.r === hall ? 'door' : 'wall');
      // a side room (bedrooms) behind an inner wall with a door
      const split = (h: Axial) => h.r + Math.round(h.q / 2);
      for (const h of hexesInRange(ORIGIN, hall - 1)) if (split(h) === -Math.round(hall * 0.45)) set(h, h.q === 0 ? 'door' : 'wall');
      for (const h of hexesInRange(ORIGIN, hall - 1)) if (free(h) && split(h) < -Math.round(hall * 0.45) && rnd(h, 62) > 0.65) set(h, rnd(h, 63) > 0.4 ? 'bed' : 'chest');
      // the bar along one side, a hearth on the opposite wall, tables
      for (let i = -2; i <= 2; i++) set({ q: Math.round(hall * 0.6), r: i - Math.round(hall * 0.3) }, 'counter');
      for (let i = -2; i <= 2; i++) set({ q: Math.round(hall * 0.6) + 1, r: i - Math.round(hall * 0.3) }, rnd({ q: i, r: 0 }, 64) > 0.4 ? 'barrels' : 'crates', false);
      set({ q: -hall + 1, r: Math.round(hall * 0.3) }, 'hearth');
      scatter(Math.round(hall * 1.4), 'table', 65, (h) => split(h) > -Math.round(hall * 0.45) + 1 && distance(h, ORIGIN) < hall - 1 && h.q < Math.round(hall * 0.6) - 1);
      scatter(1, 'bookshelf', 66, (h) => distance(h, ORIGIN) === hall - 1);
      return fill((h) => (distance(h, ORIGIN) > hall ? (rnd(h, 67) > 0.7 ? 'tree' : 'grass') : 'wood'));
    }
    case 'crypt': {
      const rooms: Array<{ c: Axial; r: number }> = [{ c: ORIGIN, r: 2 + Math.floor(r / 6) }];
      for (let i = 0; i < 5 + Math.floor(r / 3); i++) { const c = polar(at(i, 68) * 6.28, Math.round((0.35 + at(i, 69) * 0.5) * (r - 2))); rooms.push({ c, r: 1 + Math.round(r / 6) + Math.floor(at(i, 70) * 1.6) }); }
      const floor = new Set<HexKey>();
      for (const room of rooms) for (const h of hexesInRange(room.c, room.r)) if (inside(h)) floor.add(hexKey(h));
      for (let i = 1; i < rooms.length; i++) for (const h of hexLine(rooms[i - 1].c, rooms[i].c)) { floor.add(hexKey(h)); floor.add(hexKey(neighbors(h)[i % 6])); }
      for (const h of hexesInRange(ORIGIN, r)) if (!floor.has(hexKey(h))) set(h, 'wall');
      set(ORIGIN, 'altar'); for (const h of ringAt(ORIGIN, 2)) if (rnd(h, 71) > 0.6) set(h, 'pillar');
      for (const room of rooms.slice(1)) { if (free(room.c)) set(room.c, at(room.c.q + 9, room.c.r + 3) > 0.4 ? 'sarcophagus' : 'cage'); }
      scatter(6, 'bones', 72, (h) => floor.has(hexKey(h))); scatter(4, 'brazier', 73, (h) => floor.has(hexKey(h))); scatter(3, 'rubble', 74, (h) => floor.has(hexKey(h))); scatter(2, 'web', 75, (h) => floor.has(hexKey(h)));
      for (const h of hexesInRange(ORIGIN, 2)) levels.set(hexKey(h), 0);
      return withLv(fill(() => 'stone'));
    }
    default:
      return null;
  }
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
