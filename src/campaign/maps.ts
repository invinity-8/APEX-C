import { validHexData, type HexSceneData } from './hexScene.js';
import { validMood, validPalette, type SceneMood, type ScenePalette } from './palette.js';
export type ProceduralFeature = 'tree' | 'rock' | 'obstacle' | 'water';
export interface MapNode { id: string; x: number; y: number; label: string; description: string; kind: 'location' | 'spawn' | 'label' | 'wall' | 'area' | 'light' | 'enemies'; visible: boolean; width: number; height: number; targetScene: string | null; terrainCost?: number; discoverable?: boolean; proceduralFeature?: ProceduralFeature; generatedBy?: 'forest-v1'; /** Light markers (battle maps): radius in feet. */ lightFt?: number; /** APEX 2.1 – enemy spawn markers (GM only): the enemy group spawned here. */ group?: string }
export interface MapRoute { id: string; from: string; to: string; hours: number; distance: number; visible: boolean }
export interface SceneMap {
  width: number; height: number; grid: 'square' | 'hex' | 'none'; cell: number;
  unitsPerCell: number; unit: 'feet' | 'miles'; interval: 'gm' | 'route' | 'hour' | 'round';
  nodes: MapNode[]; routes: MapRoute[]; gmNotes: string;
  backgroundAsset: string | null; playerBackgroundAsset: string | null; revealBackground: boolean;
  /** Battle and region maps: Arena hex terrain (src/campaign/hexScene.ts). Absent on older maps. */
  hex?: HexSceneData;
  /** Optional colour scheme that recolours the tiles (palette.ts). */
  palette?: ScenePalette;
  /** APEX 2.1 – 3D mood (light, sky, fog); absent = the time of day. */
  mood?: SceneMood;
}
export function emptyMap(category: string): SceneMap {
  return { width: 1200, height: 800, grid: category === 'battle' ? 'square' : category === 'region' ? 'hex' : 'none', cell: 50,
    unitsPerCell: category === 'battle' ? 5 : 1, unit: category === 'battle' ? 'feet' : 'miles',
    interval: category === 'battle' ? 'round' : category === 'region' ? 'hour' : category === 'world' ? 'route' : 'gm', nodes: [], routes: [], gmNotes: '', backgroundAsset: null, playerBackgroundAsset: null, revealBackground: false };
}
export function parseMap(value: unknown): SceneMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as SceneMap;
  const num = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const text = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max;
  if (!num(v.width, 100, 5000) || !num(v.height, 100, 5000) || !num(v.cell, 10, 500) || !num(v.unitsPerCell, .01, 10000) || !['square', 'hex', 'none'].includes(v.grid) || !['feet', 'miles'].includes(v.unit) || !['gm', 'route', 'hour', 'round'].includes(v.interval) || !text(v.gmNotes, 20000) || !Array.isArray(v.nodes) || v.nodes.length > 300 || !Array.isArray(v.routes) || v.routes.length > 600) return null;
  const ids = new Set<string>();
  for (const id of [v.backgroundAsset, v.playerBackgroundAsset]) if (id != null && (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return null;
  if (v.revealBackground !== undefined && typeof v.revealBackground !== 'boolean') return null;
  if (v.hex !== undefined && !validHexData(v.hex)) return null;
  if (v.palette !== undefined && !validPalette(v.palette)) return null;
  if (v.mood !== undefined && !validMood(v.mood)) return null;
  const nodes: MapNode[] = [];
  for (const n of v.nodes) {
    if (!n || !text(n.id, 64) || !/^[\w-]{1,64}$/.test(n.id) || ids.has(n.id) || !num(n.x, 0, v.width) || !num(n.y, 0, v.height) || !text(n.label, 120) || !text(n.description, 2000) || !['location', 'spawn', 'label', 'wall', 'area', 'light', 'enemies'].includes(n.kind) || typeof n.visible !== 'boolean' || !num(n.width, 1, v.width) || !num(n.height, 1, v.height) || (n.targetScene !== null && (typeof n.targetScene !== 'string' || !/^[0-9a-f-]{36}$/i.test(n.targetScene)))) return null;
    if (n.terrainCost !== undefined && !num(n.terrainCost, 1, 10)) return null;
    if (n.discoverable !== undefined && typeof n.discoverable !== 'boolean') return null;
    if (n.proceduralFeature !== undefined && !['tree', 'rock', 'obstacle', 'water'].includes(n.proceduralFeature)) return null;
    if (n.generatedBy !== undefined && n.generatedBy !== 'forest-v1') return null;
    if (n.generatedBy && !n.proceduralFeature) return null;
    if (n.lightFt !== undefined && !num(n.lightFt, 5, 120)) return null;
    if (n.group !== undefined && (typeof n.group !== 'string' || !/^[a-z0-9-]{2,40}$/.test(n.group))) return null;
    ids.add(n.id); nodes.push({ id: n.id, x: n.x, y: n.y, label: n.label, description: n.description, kind: n.kind, visible: n.visible, width: n.width, height: n.height, targetScene: n.targetScene, terrainCost: n.terrainCost ?? 1, discoverable: n.discoverable ?? false, ...(n.proceduralFeature ? { proceduralFeature: n.proceduralFeature } : {}), ...(n.generatedBy ? { generatedBy: n.generatedBy } : {}), ...(n.lightFt !== undefined ? { lightFt: n.lightFt } : {}), ...(n.group ? { group: n.group } : {}) });
  }
  const routes: MapRoute[] = []; const routeIds = new Set<string>();
  for (const r of v.routes) {
    if (!r || !text(r.id, 64) || !/^[\w-]{1,64}$/.test(r.id) || routeIds.has(r.id) || !ids.has(r.from) || !ids.has(r.to) || r.from === r.to || !num(r.hours, 0, 1e6) || !num(r.distance, 0, 1e6) || typeof r.visible !== 'boolean') return null;
    routeIds.add(r.id); routes.push({ id: r.id, from: r.from, to: r.to, hours: r.hours, distance: r.distance, visible: r.visible });
  }
  return { width: v.width, height: v.height, grid: v.grid, cell: v.cell, unitsPerCell: v.unitsPerCell, unit: v.unit, interval: v.interval, gmNotes: v.gmNotes, nodes, routes, backgroundAsset: v.backgroundAsset ?? null, playerBackgroundAsset: v.playerBackgroundAsset ?? null, revealBackground: v.revealBackground ?? false, ...(v.palette ? { palette: { colors: [...v.palette.colors], strength: v.palette.strength } } : {}), ...(v.mood ? { mood: v.mood } : {}), ...(v.hex ? { hex: { radius: v.hex.radius, terrain: v.hex.terrain, ...(v.hex.set === 'battle' ? { set: 'battle' as const } : {}), ...(v.hex.heights ? { heights: v.hex.heights } : {}) } } : {}) };
}

/** Explicit time conversion: 600 six-second rounds in one hour; no conversion to legacy daily MP. */
export function regionMilesPerHour(speedFeetPerRound: number, terrainCost = 1): number {
  if (!Number.isFinite(speedFeetPerRound) || speedFeetPerRound <= 0 || !Number.isFinite(terrainCost) || terrainCost < 1) return 0;
  return speedFeetPerRound * 600 / 5280 / terrainCost;
}
