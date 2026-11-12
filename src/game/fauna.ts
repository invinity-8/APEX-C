/**
 * APEX 2.3 – living biomes: ambient animals on battle maps (map nodes of kind 'fauna': a species and a count).
 * Purely decorative – they graze, hop, peck or circle in the sky in 3D and shy away from figures; they never take
 * part in combat (place a stat block from the enemy library for an animal that fights).
 */
import type { MapNode, SceneMap } from '../campaign/maps.js';
import { decodeTiles, hexCentre, type HexPreset } from '../campaign/hexScene.js';
import { ORIGIN, distance, hexKey, hexesInRange, type Axial } from './hex.js';

export type FaunaBehaviour = 'graze' | 'hop' | 'peck' | 'fly' | 'prowl';
export const FAUNA: Array<{ id: string; label: string; behaviour: FaunaBehaviour; size: string }> = [
  { id: 'sheep', label: 'Sheep', behaviour: 'graze', size: 'medium' }, { id: 'cow', label: 'Cows', behaviour: 'graze', size: 'large' }, { id: 'goat', label: 'Goats', behaviour: 'graze', size: 'medium' },
  { id: 'pig', label: 'Pigs', behaviour: 'graze', size: 'medium' }, { id: 'horse', label: 'Horses', behaviour: 'graze', size: 'large' }, { id: 'donkey', label: 'Donkeys', behaviour: 'graze', size: 'medium' },
  { id: 'deer', label: 'Deer', behaviour: 'graze', size: 'large' }, { id: 'bison', label: 'Bison', behaviour: 'graze', size: 'large' }, { id: 'zebra', label: 'Zebras', behaviour: 'graze', size: 'large' },
  { id: 'llama', label: 'Llamas', behaviour: 'graze', size: 'medium' }, { id: 'chicken', label: 'Chickens', behaviour: 'peck', size: 'tiny' }, { id: 'duck', label: 'Ducks / geese', behaviour: 'peck', size: 'tiny' },
  { id: 'swan', label: 'Swans', behaviour: 'peck', size: 'small' }, { id: 'rabbit', label: 'Rabbits / hares', behaviour: 'hop', size: 'tiny' }, { id: 'squirrel', label: 'Squirrels', behaviour: 'hop', size: 'tiny' },
  { id: 'frog', label: 'Frogs / toads', behaviour: 'hop', size: 'tiny' }, { id: 'hedgehog', label: 'Hedgehogs', behaviour: 'prowl', size: 'tiny' }, { id: 'housecat', label: 'Cats', behaviour: 'prowl', size: 'tiny' },
  { id: 'dog', label: 'Dogs', behaviour: 'prowl', size: 'small' }, { id: 'fox', label: 'Foxes', behaviour: 'prowl', size: 'small' }, { id: 'rat', label: 'Rats', behaviour: 'prowl', size: 'tiny' },
  { id: 'turtle', label: 'Turtles', behaviour: 'prowl', size: 'small' }, { id: 'raven', label: 'Crows / ravens (flying)', behaviour: 'fly', size: 'tiny' }, { id: 'eagle', label: 'Birds of prey (flying)', behaviour: 'fly', size: 'small' },
  { id: 'bat', label: 'Bats (flying)', behaviour: 'fly', size: 'tiny' }, { id: 'owl', label: 'Owls (flying)', behaviour: 'fly', size: 'tiny' }, { id: 'butterfly', label: 'Butterflies', behaviour: 'fly', size: 'tiny' },
  { id: 'moonhare', label: 'Moon hares (magical)', behaviour: 'hop', size: 'tiny' }, { id: 'wisp', label: 'Will-o’-wisps', behaviour: 'fly', size: 'tiny' },
];
export const faunaOf = (id: string | undefined) => FAUNA.find((f) => f.id === id);

/** What lives where: layouts get a few fitting groups when they are generated in the editor. */
export const LAYOUT_FAUNA: Partial<Record<HexPreset, Array<[string, number]>>> = {
  farmstead: [['sheep', 5], ['chicken', 4], ['cow', 2], ['raven', 3]], hamlet: [['chicken', 4], ['housecat', 1], ['dog', 1], ['pig', 2]],
  orchard: [['rabbit', 3], ['butterfly', 4], ['squirrel', 2]], graveyard: [['raven', 5], ['bat', 3]], manor: [['swan', 2], ['butterfly', 3], ['housecat', 1]],
  market: [['chicken', 3], ['housecat', 2], ['dog', 1]], streets: [['rat', 3], ['housecat', 1], ['raven', 2]], docks: [['duck', 3], ['rat', 2], ['raven', 3]],
  citygate: [['horse', 2], ['raven', 2]], forest: [['deer', 3], ['rabbit', 3], ['squirrel', 2], ['eagle', 1]], river: [['duck', 3], ['frog', 3], ['deer', 2]],
  swamp: [['frog', 5], ['butterfly', 3], ['wisp', 2]], cave: [['bat', 6]], crypt: [['rat', 4], ['bat', 3]], ruins: [['raven', 3], ['rabbit', 2]],
  winter: [['deer', 2], ['raven', 3]], desert: [['eagle', 2]], highlands: [['goat', 3], ['eagle', 1]], camp: [['horse', 2], ['dog', 1]], wilderness: [['deer', 2], ['rabbit', 3]],
};

/** Fauna markers for a freshly generated layout: each group on open, passable ground, away from the middle. */
export function faunaNodes(map: SceneMap, preset: HexPreset, seed: number): MapNode[] {
  const groups = LAYOUT_FAUNA[preset];
  if (!groups || !map.hex) return [];
  const tiles = decodeTiles(map.hex);
  const open = hexesInRange(ORIGIN, map.hex.radius).filter((h) => { const t = tiles.get(hexKey(h)); return !!t && t.cost !== null && !/deep|wall/.test(t.id) && distance(h, ORIGIN) >= 2; });
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const taken: Axial[] = [];
  return groups.flatMap(([species, count], i) => {
    const f = faunaOf(species);
    const free = open.filter((h) => taken.every((t) => distance(t, h) >= 3));
    if (!f || !free.length) return [];
    const at = free[Math.floor(rnd() * free.length)];
    taken.push(at);
    const p = hexCentre(map, at);
    return [{ id: `fauna-${i}-${Math.floor(rnd() * 1e6)}`, x: p.x, y: p.y, label: f.label, description: '', kind: 'fauna' as const, visible: true, width: 50, height: 50, targetScene: null, species, count }];
  });
}
