import { emptyMap, type MapNode, type SceneMap } from './maps.js';
import { REGION_DEFAULT_RADIUS, newHexScene, type HexPreset } from './hexScene.js';

/**
 * Starter templates. Battle and region maps are always Arena-style hex maps (hexScene.ts); celestial
 * and world maps stay route/overview maps. Older template ids keep working through the API and now
 * produce hex maps as well.
 */
export const SCENE_TEMPLATES = [
  { id: 'planetary-system', category: 'celestial', name: 'Blank planetary system' },
  { id: 'parchment-world', category: 'world', name: 'Blank parchment world map' },
  { id: 'connected-world', category: 'world', name: 'Connected-location travel map' },
  { id: 'hex-forest', category: 'battle', name: 'Forest clearing (5-ft hexes)' },
  { id: 'hex-river', category: 'battle', name: 'Stream with ford (5-ft hexes)' },
  { id: 'hex-ruins', category: 'battle', name: 'Ruined building (5-ft hexes)' },
  { id: 'hex-dungeon', category: 'battle', name: 'Dungeon rooms & corridors (5-ft hexes)' },
  { id: 'hex-battle', category: 'battle', name: 'Open field (5-ft hexes)' },
  { id: 'hex-region', category: 'region', name: 'Wilderness region – Arena generator (3-mi hexes)' },
  { id: 'hex-region-forest', category: 'region', name: 'Forested region (3-mi hexes)' },
  { id: 'hex-region-blank', category: 'region', name: 'Open region (3-mi hexes)' },
] as const;
const LEGACY: Record<string, string> = { 'square-battle': 'hex-battle', 'image-battle': 'hex-battle', 'hex-wild': 'hex-forest' };
const HEX: Record<string, { preset: HexPreset; radius: number }> = {
  // Battle maps: 5 ft per hex – radius 10 ≈ 100 ft across.
  'hex-forest': { preset: 'forest', radius: 10 },
  'hex-river': { preset: 'river', radius: 10 },
  'hex-ruins': { preset: 'ruins', radius: 10 },
  'hex-dungeon': { preset: 'dungeon', radius: 12 },
  'hex-battle': { preset: 'blank', radius: 8 },
  // Region maps: Arena size (radius 12 = 469 hexes, 3 mi each).
  'hex-region': { preset: 'wilderness', radius: REGION_DEFAULT_RADIUS },
  'hex-region-forest': { preset: 'forest', radius: REGION_DEFAULT_RADIUS },
  'hex-region-blank': { preset: 'blank', radius: REGION_DEFAULT_RADIUS },
};

/** Default for a new battle/region draft without a chosen template. */
export const defaultTemplateFor = (category: string): string | null => (category === 'battle' ? 'hex-battle' : category === 'region' ? 'hex-region-blank' : null);

export function sceneTemplate(requested: string, category: string, seed = 1): SceneMap | null {
  const id = LEGACY[requested] ?? requested;
  if (!SCENE_TEMPLATES.some(t => t.id === id && t.category === category)) return null;
  const map = emptyMap(category);
  const hex = HEX[id];
  if (hex) return newHexScene(map, hex.preset, hex.radius, seed >>> 0);
  const spawn: MapNode = { id: 'entry', x: 100, y: 100, label: 'Arrival', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null };
  map.nodes = [spawn];
  if (id === 'connected-world') {
    map.nodes.push({ ...spawn, id: 'town', x: 200, y: 250, kind: 'location', visible: true, label: 'Starting town' }, { ...spawn, id: 'landmark', x: 750, y: 400, kind: 'location', visible: true, label: 'Distant landmark' });
    map.routes.push({ id: 'road', from: 'town', to: 'landmark', distance: 12, hours: 4, visible: true });
  }
  return map;
}
