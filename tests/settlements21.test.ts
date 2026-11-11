import { describe, expect, it } from 'vitest';
import { decodeTiles, generateBattleScene, PRESETS, TILESETS, validHexData, type HexPreset } from '../src/campaign/hexScene';

const NEW: HexPreset[] = ['farmstead', 'hamlet', 'orchard', 'graveyard', 'manor', 'market', 'streets', 'docks', 'citygate', 'tavern', 'crypt'];

describe('APEX 2.1 – asset library and settlement layouts', () => {
  it('the battle tile library has well over 100 tiles with unique codes and ids', () => {
    const t = TILESETS.battle;
    expect(t.length).toBeGreaterThanOrEqual(100);
    expect(new Set(t.map((x) => x.code)).size).toBe(t.length);
    expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
    for (const x of t) expect([...x.code].length).toBe(1);
  });
  it('every rural / city / interior preset is listed and generates valid, playable maps for several sizes and seeds', () => {
    for (const p of NEW) {
      expect(PRESETS.battle.some((x) => x.id === p), p).toBe(true);
      for (const radius of [6, 9, 12]) for (const seed of [1, 42, 777]) {
        const data = generateBattleScene(p, radius, seed);
        expect(validHexData(data), `${p} r${radius} s${seed}`).toBe(true);
        const tiles = [...decodeTiles(data).values()];
        const open = tiles.filter((t) => t.cost !== null).length / tiles.length;
        expect(open, `${p} r${radius} s${seed} passable share`).toBeGreaterThan(0.25);
      }
    }
  });
  it('same seed → same map, another seed → another map (where the layout is randomised)', () => {
    for (const p of ['farmstead', 'hamlet', 'market', 'crypt'] as HexPreset[]) {
      expect(generateBattleScene(p, 10, 5)).toEqual(generateBattleScene(p, 10, 5));
      expect(generateBattleScene(p, 10, 5).terrain).not.toBe(generateBattleScene(p, 10, 6).terrain);
    }
  });
  it('the layouts use the new library (buildings, market stalls, piers, towers, gravestones …)', () => {
    const has = (p: HexPreset, ids: string[]) => { const set = new Set([...decodeTiles(generateBattleScene(p, 10, 3)).values()].map((t) => t.id)); for (const id of ids) expect(set.has(id), `${p}: ${id}`).toBe(true); };
    has('farmstead', ['cottage', 'barn', 'wheat', 'veggies', 'haystack', 'scarecrow']);
    has('market', ['fountain', 'stall']);
    has('docks', ['pier', 'deep']);
    has('citygate', ['citywall', 'tower', 'gate']);
    has('graveyard', ['gravestone', 'stonewall']);
    has('tavern', ['counter', 'hearth', 'table']);
    has('crypt', ['altar', 'bones']);
  });
});
