/** APEX 2.6: climbing cliffs and trees, jumping hazards with Athletics. */
import { describe, expect, it } from 'vitest';
import { TILESETS, generateBattleScene, hexCentre, hexMovementCost, hexSceneMap, pathChecks, stepCost } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';
import { ORIGIN, hexKey, hexesInRange } from '../src/game/hex';
import { rollPathChecks } from '../src/server/sceneTurns';

const code = (id: string) => TILESETS.battle.find((t) => t.id === id)!.code;
/** A blank map; `set` puts tiles / levels on single hexes. */
function mapWith(tiles: Record<string, string>, levels: Record<string, number> = {}) {
  const data = generateBattleScene('blank', 4, 1);
  const keys = hexesInRange(ORIGIN, 4).map(hexKey);
  const terrain = keys.map((k, i) => (tiles[k] ? code(tiles[k]) : data.terrain[i])).join('');
  const heights = keys.map((k) => String(levels[k] ?? 0)).join('');
  return hexSceneMap(emptyMap('battle'), { ...data, terrain, heights });
}

describe('climbing and jumping', () => {
  it('a cliff: impassable for plain walkers, climbable with Athletics (double the height), free with a climbing speed', () => {
    const map = mapWith({}, { '2,0': 3, '3,0': 3 });
    expect(stepCost(map)('2,0', '1,0')).toBeNull();
    expect(stepCost(map, undefined, { athletics: true })('2,0', '1,0')).toBe(1 + 6);
    expect(stepCost(map, undefined, { climb: true })('2,0', '1,0')).toBe(1);
    const r = hexMovementCost(map, hexCentre(map, { q: 0, r: 0 }), hexCentre(map, { q: 3, r: 0 }), { athletics: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pathChecks(map, r.path, { q: 0, r: 0 }, { athletics: true })).toEqual([{ at: 1, kind: 'climb', dc: 10, ft: 15 }]);
    expect(pathChecks(map, r.path, { q: 0, r: 0 }, { athletics: true, climb: true })).toEqual([]);
  });
  it('trees and walls: a climbing speed climbs them', () => {
    const map = mapWith({ '1,0': 'tree' });
    expect(stepCost(map)('1,0', '0,0')).toBeNull();
    expect(stepCost(map, undefined, { climb: true })('1,0', '0,0')).toBe(2);
    expect(hexMovementCost(map, hexCentre(map, ORIGIN), hexCentre(map, { q: 1, r: 0 }), { climb: true }).ok).toBe(true);
  });
  it('lava: jump 5 ft (DC 10) or 10 ft (DC 15), not wider, never ending in it', () => {
    const narrow = mapWith({ '1,0': 'lava', '1,-1': 'lava', '0,1': 'lava', '1,1': 'lava', '-1,1': 'lava' });
    const r = hexMovementCost(narrow, hexCentre(narrow, ORIGIN), hexCentre(narrow, { q: 2, r: 0 }), { athletics: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(pathChecks(narrow, r.path, ORIGIN, { athletics: true })).toEqual([{ at: 0, kind: 'jump', dc: 10, ft: 5, tile: 'lava' }]);
    expect(hexMovementCost(narrow, hexCentre(narrow, ORIGIN), hexCentre(narrow, { q: 1, r: 0 }), { athletics: true }).ok).toBe(false);
    const wide = mapWith(Object.fromEntries(hexesInRange(ORIGIN, 4).filter((h) => h.q >= 1 && h.q <= 3).map((h) => [hexKey(h), 'lava'])));
    const w = hexMovementCost(wide, hexCentre(wide, ORIGIN), hexCentre(wide, { q: 4, r: 0 }), { athletics: true });
    expect(w.ok && pathChecks(wide, w.path, ORIGIN, { athletics: true })).toMatch(/too wide/);
  });
  it('rolling the checks: success goes on, failure stops at the cliff foot or in the hazard', () => {
    const checks = [{ at: 1, kind: 'climb' as const, dc: 10, ft: 15 }, { at: 3, kind: 'jump' as const, dc: 15, ft: 10, tile: 'lava' }];
    expect(rollPathChecks(checks, 100, 'Ayla').stop).toBeNull();
    expect(rollPathChecks(checks, -100, 'Ayla')).toMatchObject({ stop: 1 });
    expect(rollPathChecks([checks[1]], -100, 'Ayla')).toMatchObject({ stop: 4, fell: 'lava' });
    expect(rollPathChecks(checks, -100, 'Ayla', 1).stop).toBeNull(); // stopped earlier (opportunity attack)
  });
});
