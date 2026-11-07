import { emptyMap, type MapNode, type SceneMap } from './maps.js';
import { newHexScene, type HexPreset } from './hexScene.js';

/**
 * Starter templates. Battle and region maps are always Arena-style hex maps (hexScene.ts); celestial
 * and world maps stay route/overview maps. Older template ids keep working through the API and now
 * produce hex maps as well.
 */
export const SCENE_TEMPLATES = [
  { id: 'planetary-system', category: 'celestial', name: 'Blank planetary system' },
  { id: 'parchment-world', category: 'world', name: 'Blank parchment world map' },
  { id: 'connected-world', category: 'world', name: 'Connected-location travel map' },
  { id: 'hex-forest', category: 'battle', name: 'Forest clearing (hex)' },
  { id: 'hex-river', category: 'battle', name: 'River with ford (hex)' },
  { id: 'hex-ruins', category: 'battle', name: 'Old ruins (hex)' },
  { id: 'hex-wild', category: 'battle', name: 'Wilderness – Arena generator (hex)' },
  { id: 'hex-battle', category: 'battle', name: 'Open grassland (hex)' },
  { id: 'hex-region', category: 'region', name: 'Wilderness region (hex)' },
  { id: 'hex-region-forest', category: 'region', name: 'Forested region (hex)' },
  { id: 'hex-region-blank', category: 'region', name: 'Open region (hex)' },
] as const;
const LEGACY: Record<string, string> = { 'square-battle': 'hex-battle', 'image-battle': 'hex-battle' };
const HEX: Record<string, { preset: HexPreset; radius: number }> = {
  'hex-forest': { preset: 'forest', radius: 9 },
  'hex-river': { preset: 'river', radius: 9 },
  'hex-ruins': { preset: 'ruins', radius: 9 },
  'hex-wild': { preset: 'wilderness', radius: 10 },
  'hex-battle': { preset: 'blank', radius: 8 },
  'hex-region': { preset: 'wilderness', radius: 14 },
  'hex-region-forest': { preset: 'forest', radius: 14 },
  'hex-region-blank': { preset: 'blank', radius: 12 },
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
