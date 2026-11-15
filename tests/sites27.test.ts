/** APEX 2.7: encounter sites (new battle layouts) and the random encounter proposal. */
import { describe, expect, it } from 'vitest';
import { PRESETS, centralPassableHex, decodeTiles, generateBattleScene, hexCentre, hexMovementCost, hexSceneMap, validHexData, type HexPreset } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';
import { ORIGIN, distance, hexKey, hexesInRange } from '../src/game/hex';

export const SITES: HexPreset[] = ['bridge', 'gorge', 'tradingpost', 'crossroads', 'watchtower', 'mine', 'battlefield', 'stonecircle', 'shipwreck', 'lavafield', 'waterfall', 'caravan', 'lakeshore', 'spiderlair'];

describe('encounter sites', () => {
  it('14 new sites are listed and generate valid, playable, deterministic maps', () => {
    for (const p of SITES) {
      expect(PRESETS.battle.some((x) => x.id === p), p).toBe(true);
      for (const radius of [7, 10, 13]) for (const seed of [1, 42, 777]) {
        const data = generateBattleScene(p, radius, seed);
        expect(validHexData(data), `${p} r${radius} s${seed}`).toBe(true);
        expect(generateBattleScene(p, radius, seed)).toEqual(data);
        const tiles = decodeTiles(data);
        const open = [...tiles.values()].filter((t) => t.cost !== null).length / tiles.size;
        expect(open, `${p} r${radius} s${seed} passable share`).toBeGreaterThan(0.3);
        // from the party's start, most of the open ground can be walked to (no sealed-off map)
        const map = hexSceneMap(emptyMap('battle'), data);
        const start = centralPassableHex(data);
        const far = hexesInRange(ORIGIN, radius).filter((h) => tiles.get(hexKey(h))?.cost !== null && distance(h, start) >= radius - 2);
        const reachable = far.filter((h) => hexMovementCost(map, hexCentre(map, start), hexCentre(map, h), { athletics: true }).ok).length;
        expect(reachable / Math.max(1, far.length), `${p} r${radius} s${seed} reachable edge`).toBeGreaterThan(0.5);
      }
    }
  }, 60_000);
  it('the sites show what they are', () => {
    const has = (p: HexPreset, id: string) => [...decodeTiles(generateBattleScene(p, 10, 3)).values()].some((t) => t.id === id);
    expect(has('bridge', 'bridge') && has('bridge', 'deep')).toBe(true);
    expect(has('tradingpost', 'shop') && has('tradingpost', 'palisade')).toBe(true);
    expect(generateBattleScene('gorge', 10, 3).heights).toBeTruthy();
    expect(has('mine', 'cavewall') && has('mine', 'cart')).toBe(true);
    expect(has('stonecircle', 'pillar') && has('lavafield', 'lava') && has('shipwreck', 'boat') && has('spiderlair', 'web') && has('caravan', 'cart') && has('lakeshore', 'pier') && has('watchtower', 'tower')).toBe(true);
  });
});
