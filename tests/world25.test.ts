/** APEX 2.5: campaign time, weather sight, Dash choices, 1-ft slopes. */
import { describe, expect, it } from 'vitest';
import { changeWorldTime, effectiveClock, hourOf, lightingAt, nextAt, nowMinute, parseWorldTimeChange } from '../src/game/worldTime';
import { defaultClock } from '../src/game/sceneTurns';
import { sceneVision } from '../src/campaign/hexVision';
import { applyRelief, decodeTiles, generateBattleScene, heightLookup, hexCentre, hexSceneMap, smoothHeights, stepCost, validHexData } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';
import { ORIGIN, distance, hexKey, hexesInRange, neighbors } from '../src/game/hex';
import { farthestStep, moveMenu } from '../src/components/pcInteraction';

describe('world time', () => {
  it('runs from a start point, skips to the next dawn, lighting follows the hour', () => {
    const t0 = 1_000_000;
    let w = changeWorldTime(undefined, { minute: 22 * 60, run: true, rate: 60 }, t0);
    expect(nowMinute(w, t0 + 60_000)).toBeCloseTo(22 * 60 + 60);
    w = changeWorldTime(w, { skipTo: 6 }, t0 + 60_000);
    expect(hourOf(w.minute)).toBe(6);
    expect(w.minute).toBe(24 * 60 + 6 * 60); // the next morning
    expect(w.runningSince).toBe(t0 + 60_000);
    w = changeWorldTime(w, { run: false }, t0 + 120_000);
    expect(w.runningSince).toBeUndefined();
    expect(nextAt(4 * 60, 4)).toBe(28 * 60);
    expect([lightingAt(12), lightingAt(6), lightingAt(19), lightingAt(23)]).toEqual(['bright', 'dim', 'dim', 'dark']);
    expect(parseWorldTimeChange({ rate: 9999 })).toBe('Rate 1–720.');
  });
  it('scenes follow the time unless the GM set the lighting by hand', () => {
    const state = { worldTime: { minute: 23 * 60 } };
    expect(effectiveClock(state, defaultClock()).lighting).toBe('dark');
    expect(effectiveClock(state, { ...defaultClock(), lighting: 'bright', followTime: false }).lighting).toBe('bright');
    expect(effectiveClock({}, defaultClock()).lighting).toBe('bright'); // no campaign time: as before
  });
  it('fog limits sight to 30 ft, blindsight still works', () => {
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('blank', 12, 1));
    const at = hexCentre(map, { q: 0, r: 0 });
    const clock = { day: 1, phase: 'day' as const, lighting: 'bright' as const, version: 0 };
    const clear = sceneVision(map, clock, [{ at, darkvisionFt: 0 }]).size;
    const fog = sceneVision(map, { ...clock, weather: 'fog' }, [{ at, darkvisionFt: 0 }]);
    expect(fog.size).toBe(hexesInRange(ORIGIN, 6).length);
    expect(clear).toBeGreaterThan(fog.size);
    expect(sceneVision(map, { ...clock, weather: 'fog' }, [{ at, darkvisionFt: 0, blindFt: 60 }]).size).toBeGreaterThan(fog.size);
  });
});

describe('Dash choices', () => {
  const steps = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((cost, i) => ({ x: i, y: 0, cost }));
  it('within Dash range: Dash first, then as far as possible', () => {
    const menu = moveMenu(steps, 50, 30, { action: true, bonus: false, speedFt: 30 }, () => {}, () => {}, { x: 9, y: 0 });
    expect(menu.map((m) => m.icon)).toEqual(['💨', '👣']);
    expect(menu[0].label).toMatch(/Dash \(action\) and go there \(50 ft\)/);
    expect(menu[1].label).toMatch(/30 ft/);
  });
  it('Cunning Action offers the bonus-action Dash first; beyond reach: as far as a Dash gets', () => {
    const menu = moveMenu(steps, 50, 10, { action: true, bonus: true, speedFt: 30 }, () => {}, () => {}, { x: 9, y: 0 });
    expect(menu[0].label).toMatch(/bonus action, as far as possible \(40 ft\)/);
    expect(menu).toHaveLength(3);
    expect(farthestStep(steps, 12)?.cost).toBe(10);
    expect(moveMenu(steps, 50, 30, null, () => {}, () => {}, { x: 9, y: 0 }).map((m) => m.icon)).toEqual(['👣']);
  });
});

describe('1-ft slopes', () => {
  it('smoothing keeps walkable steps walkable, cliffs cliffs, and adds 1-ft ramps', () => {
    const base = applyRelief(generateBattleScene('wilderness', 10, 2), 'hills', 4, 5);
    expect(base.fine).toBeTruthy(); // generated relief comes with ramps
    expect(validHexData(base)).toBe(true);
    const h = heightLookup(hexSceneMap(emptyMap('battle'), base));
    for (const c of hexesInRange(ORIGIN, 10)) for (const n of neighbors(c)) if (distance(n, ORIGIN) <= 10) expect(Math.abs(h(hexKey(c)) - h(hexKey(n)))).toBeLessThanOrEqual(1 + 1e-9);
    const terr = applyRelief(generateBattleScene('wilderness', 10, 2), 'terraces', 3, 5);
    expect(terr.fine).toBeUndefined(); // terraces stay steps
    expect(smoothHeights({ ...terr }).heights).toBeTruthy();
  });
  it('step costs: ≤ 2 ft free, 3–5 ft up climbing, more a cliff', () => {
    const data = generateBattleScene('blank', 3, 1);
    const n = hexesInRange(ORIGIN, 3).length;
    const mk = (levels: string, fine: string) => hexSceneMap(emptyMap('battle'), { ...data, heights: levels.padEnd(n, '0'), fine: fine.padEnd(n, '0') });
    const keys = hexesInRange(ORIGIN, 3).map(hexKey);
    const tiles = decodeTiles(data);
    void tiles;
    // hex 0 = centre (0 ft); hex 1 next to it
    const cost = (levels: string, fine: string) => stepCost(mk(levels, fine))(keys[1], keys[0]);
    expect(cost('00', '02')).toBe(1); // 2 ft up: free
    expect(cost('00', '03')).toBe(2); // 3 ft up: climbing
    expect(cost('01', '00')).toBe(2); // 5 ft up
    expect(cost('01', '01')).toBeNull(); // 6 ft up: a cliff
  });
});
