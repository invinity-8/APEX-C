/**
 * APEX 1.8 (3D stage 1): ground heights per hex – stored with the map, steps and cliffs for movement, high ground
 * and hills for line of sight, the server's reach check.
 */
import { describe, expect, it } from 'vitest';
import { emptyMap, parseMap, type SceneMap } from '../src/campaign/maps';
import { encodeTiles, heightLookup, hexCentre, hexMovementCost, hexReach, hexSceneMap, setHeights, validHexData } from '../src/campaign/hexScene';
import { lineOfSight, sightRules } from '../src/campaign/hexVision';
import { hexKey } from '../src/game/hex';

const flat = (): SceneMap => hexSceneMap(emptyMap('battle'), encodeTiles(8, 'battle', () => 'grass'));
const withHeights = (m: SceneMap, cells: Array<[number, number, number]>): SceneMap => {
  let hex = m.hex!;
  for (const [q, r, lv] of cells) hex = setHeights(hex, [hexKey({ q, r })], () => lv);
  return { ...m, hex };
};

describe('ground heights', () => {
  it('are stored compactly, validated and survive parseMap; flattening removes them', () => {
    const m = withHeights(flat(), [[1, 0, 1], [2, 0, 3]]);
    expect(m.hex!.heights).toMatch(/^[0-9a-z]+$/);
    expect(validHexData(m.hex)).toBe(true);
    expect(validHexData({ ...m.hex!, heights: 'x' })).toBe(false);
    const parsed = parseMap(JSON.parse(JSON.stringify(m)))!;
    expect(heightLookup(parsed)('2,0')).toBe(3);
    expect(setHeights(m.hex!, ['1,0', '2,0'], () => 0).heights).toBeUndefined();
  });

  it('steps cost 5 ft extra going up, cliffs block walking; flat maps are unchanged', () => {
    const c = (m: SceneMap, q: number, r: number) => hexCentre(m, { q, r });
    const f = flat();
    expect(hexMovementCost(f, c(f, 0, 0), c(f, 2, 0))).toMatchObject({ ok: true, cost: 10 });
    // a stair: 0 → 1 → 2 costs 10 + 10 going up, 10 coming down
    const stair = withHeights(flat(), [[1, 0, 1], [2, 0, 2]]);
    const up = hexMovementCost(stair, c(stair, 0, 0), c(stair, 2, 0));
    expect(up).toMatchObject({ ok: true, cost: 20 });
    expect(hexMovementCost(stair, c(stair, 2, 0), c(stair, 0, 0))).toMatchObject({ ok: true, cost: 10 });
    // a 10-ft cliff all around a plateau hex: walkers can't get up there
    const ring: Array<[number, number, number]> = [[0, 0, 2]];
    const plateau = withHeights(flat(), ring);
    expect(hexMovementCost(plateau, c(plateau, 2, 0), c(plateau, 0, 0)).ok).toBe(false);
    expect(hexReach(plateau, c(plateau, 2, 0), 30).has('0,0')).toBe(false);
  });

  it('a hill between two creatures blocks sight; from high ground you look over it', () => {
    const m = withHeights(flat(), [[2, 0, 3]]);
    const s = sightRules(m);
    expect(lineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }, s.blocks, s.height)).toBe(false);
    expect(lineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }, s.blocks)).toBe(true); // flat rules ignore it
    const tower = withHeights(m, [[0, 0, 6]]);
    const t = sightRules(tower);
    expect(lineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }, t.blocks, t.height)).toBe(true);
    // a single step (one level) does not block
    const step = withHeights(flat(), [[2, 0, 1]]);
    const st = sightRules(step);
    expect(lineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }, st.blocks, st.height)).toBe(true);
  });
});
