/**
 * Hex scenes: battle/region maps use the Arena hex engine (terrain codes, Arena movement costs,
 * path finding, generator) – plus picture sampling and conversion of old drawn maps.
 */
import { describe, expect, it } from 'vitest';
import { emptyMap, parseMap, type SceneMap } from '../src/campaign/maps';
import {
  MAX_HEX_RADIUS,
  classifyColour,
  convertLegacyMap,
  decodeTerrain,
  encodeTerrain,
  encodeTiles,
  generateHexScene,
  hexAt,
  hexCentre,
  hexMovementCost,
  hexReach,
  hexSceneMap,
  newHexScene,
  paintHexes,
  resizeHexScene,
  sampleImageToHex,
  validHexData,
} from '../src/campaign/hexScene';
import { movementCost, snappedPoint } from '../src/campaign/sceneMovement';
import { sceneTemplate } from '../src/campaign/templates';
import { publicMap } from '../src/server/sceneRuntime';
import { hexCount, hexKey } from '../src/game/hex';

const plainsMap = (radius = 5): SceneMap => hexSceneMap(emptyMap('battle'), encodeTiles(radius, 'battle', () => 'grass'));
const east = (map: SceneMap, q: number, r = 0) => hexCentre(map, { q, r });

describe('hex scene data', () => {
  it('stores one terrain code per hex and survives parseMap and the player map', () => {
    const map = newHexScene(emptyMap('battle'), 'forest', 6, 42);
    expect(map.hex!.terrain).toHaveLength(hexCount(6));
    expect(validHexData(map.hex)).toBe(true);
    const parsed = parseMap(JSON.parse(JSON.stringify(map)))!;
    expect(parsed.hex).toEqual(map.hex);
    expect(publicMap(map)?.hex).toEqual(map.hex);
    expect(parseMap({ ...map, hex: { radius: 6, terrain: 'zz' } })).toBeNull();
    expect(parseMap({ ...map, hex: { radius: MAX_HEX_RADIUS + 1, terrain: 'p'.repeat(hexCount(MAX_HEX_RADIUS + 1)) } })).toBeNull();
  });

  it('generates deterministically with the Arena generator and different presets', () => {
    expect(generateHexScene('wilderness', 8, 7)).toEqual(generateHexScene('wilderness', 8, 7));
    expect(generateHexScene('wilderness', 8, 7)).not.toEqual(generateHexScene('wilderness', 8, 8));
    const forest = [...decodeTerrain(generateHexScene('forest', 9, 3)).values()];
    expect(forest.filter((t) => t === 'forest').length).toBeGreaterThan(forest.length / 3);
    const river = [...decodeTerrain(generateHexScene('river', 9, 3)).values()];
    expect(river).toContain('river');
    expect(river).toContain('road');
  });

  it('templates create hex maps with a spawn on a passable hex; old template ids still work', () => {
    for (const id of ['hex-forest', 'hex-river', 'hex-ruins', 'hex-wild', 'hex-battle', 'square-battle', 'image-battle']) {
      const map = sceneTemplate(id, 'battle', 5)!;
      expect(map.hex, id).toBeDefined();
      const spawn = map.nodes.find((n) => n.kind === 'spawn')!;
      expect(movementCost(map, spawn, spawn).ok, id).toBe(true);
    }
    expect(sceneTemplate('hex-region', 'region', 5)!.unit).toBe('miles');
    expect(sceneTemplate('connected-world', 'world')!.hex).toBeUndefined();
  });
});

describe('hex movement (server rule)', () => {
  it('snaps to hex centres and charges Arena terrain costs per entered hex', () => {
    const map = plainsMap();
    expect(snappedPoint(map, { x: east(map, 2).x + 7, y: east(map, 2).y - 5 })).toEqual(east(map, 2));
    expect(movementCost(map, east(map, 0), east(map, 3))).toEqual({ ok: true, cost: 15 });
    map.hex = paintHexes(map.hex!, [hexKey({ q: 1, r: 0 }), hexKey({ q: 2, r: 0 })], 'undergrowth');
    // Undergrowth costs 2 per hex (difficult terrain), so the path bends around it when cheaper.
    const r = hexMovementCost(map, east(map, 0), east(map, 3));
    expect(r.ok && r.cost).toBe(20);
  });

  it('blocks impassable destinations and walls of water', () => {
    const map = plainsMap(3);
    map.hex = paintHexes(map.hex!, [hexKey({ q: 2, r: 0 })], 'wall');
    expect(movementCost(map, east(map, 0), east(map, 2))).toEqual({ ok: false, error: 'Wall cannot be entered.' });
    expect(movementCost(map, east(map, 0), { x: 1, y: 1 })).toMatchObject({ ok: false });
    // Ring of water around the centre: nothing outside can be reached.
    const ring = ['1,0', '1,-1', '0,-1', '-1,0', '-1,1', '0,1'];
    map.hex = paintHexes(map.hex!, ring, 'deep');
    expect(movementCost(map, east(map, 0), east(map, 3))).toEqual({ ok: false, error: 'No passable path to that hex.' });
  });

  it('reach area follows the remaining feet like the Arena reach', () => {
    const map = plainsMap();
    const reach = hexReach(map, east(map, 0), 10);
    expect(reach.has('2,0')).toBe(true);
    expect(reach.has('3,0')).toBe(false);
  });
});

describe('picture import and conversion', () => {
  it('classifies typical map colours', () => {
    expect(classifyColour(25, 60, 110)).toBe('water');
    expect(classifyColour(35, 75, 40)).toBe('forest');
    expect(classifyColour(130, 150, 75)).toBe('plains');
    expect(classifyColour(150, 145, 140)).toBe('mountain');
  });

  it('samples a picture into terrain (left half lake, right half forest)', () => {
    const w = 200, h = 200, px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px.set(x < w / 2 ? [25, 60, 110, 255] : [35, 75, 40, 255], i);
    }
    const data = sampleImageToHex(px, w, h, 4, false);
    const t = decodeTerrain(data);
    expect(t.get('-3,0')).toBe('water');
    expect(t.get('3,0')).toBe('forest');
    expect(t.size).toBe(hexCount(4));
  });

  it('converts an old drawn battle map into 5-ft tiles: trees, deep water, the spawn is kept', () => {
    const old = emptyMap('battle');
    old.nodes = [
      { id: 'entry', x: 600, y: 400, label: 'Arrival', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null },
      { id: 'tree', x: 0, y: 0, label: 'Tree', description: '', kind: 'wall', visible: true, width: 400, height: 800, targetScene: null, proceduralFeature: 'tree', generatedBy: 'forest-v1' },
      { id: 'lake', x: 900, y: 0, label: 'Water', description: '', kind: 'area', visible: true, width: 300, height: 800, targetScene: null, proceduralFeature: 'water', generatedBy: 'forest-v1' },
    ];
    const map = convertLegacyMap(old);
    expect(map.hex).toBeDefined();
    expect(map.nodes.map((n) => n.id)).toEqual(['entry']);
    const t = decodeTerrain(map.hex!);
    const left = hexAt(map, { x: map.width * 0.15, y: map.height / 2 });
    const right = hexAt(map, { x: map.width * 0.85, y: map.height / 2 });
    expect(t.get(hexKey(left))).toBe('tree');
    expect(t.get(hexKey(right))).toBe('deep');
    expect(movementCost(map, map.nodes[0], map.nodes[0]).ok).toBe(true);
    expect(parseMap(map)).not.toBeNull();
  });

  it('resizing keeps terrain and markers on their hexes', () => {
    const map = newHexScene(emptyMap('battle'), 'forest', 6, 9);
    const bigger = resizeHexScene(map, 8);
    expect(decodeTerrain(bigger.hex!).get('1,1')).toBe(decodeTerrain(map.hex!).get('1,1'));
    expect(hexAt(bigger, bigger.nodes[0])).toEqual(hexAt(map, map.nodes[0]));
  });
});
