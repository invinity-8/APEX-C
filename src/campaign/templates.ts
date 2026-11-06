import { emptyMap, type MapNode, type SceneMap } from './maps.js';
export const SCENE_TEMPLATES = [
  { id: 'planetary-system', category: 'celestial', name: 'Blank planetary system' },
  { id: 'parchment-world', category: 'world', name: 'Blank parchment world map' },
  { id: 'connected-world', category: 'world', name: 'Connected-location travel map' },
  { id: 'hex-region', category: 'region', name: 'Blank hex exploration region' },
  { id: 'square-battle', category: 'battle', name: 'Blank square-grid battle map' },
  { id: 'hex-battle', category: 'battle', name: 'Blank hex battle map' },
  { id: 'image-battle', category: 'battle', name: 'Background-image battle map' },
] as const;
export function sceneTemplate(id: string, category: string): SceneMap | null {
  if (!SCENE_TEMPLATES.some(t => t.id === id && t.category === category)) return null;
  const map = emptyMap(category);
  const spawn: MapNode = { id: 'entry', x: 100, y: 100, label: 'Arrival', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null };
  map.nodes = [spawn];
  if (id === 'hex-battle') map.grid = 'hex';
  if (id === 'image-battle') map.grid = 'none';
  if (id === 'connected-world') {
    map.nodes.push({ ...spawn, id: 'town', x: 200, y: 250, kind: 'location', visible: true, label: 'Starting town' }, { ...spawn, id: 'landmark', x: 750, y: 400, kind: 'location', visible: true, label: 'Distant landmark' });
    map.routes.push({ id: 'road', from: 'town', to: 'landmark', distance: 12, hours: 4, visible: true });
  }
  return map;
}
