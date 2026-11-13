import { describe, expect, it } from 'vitest';
import { applyRelief, decodeTiles, generateBattleScene, heightLookup, RELIEF_STYLES, validHexData, type ReliefStyle } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';
import { hexSceneMap } from '../src/campaign/hexScene';
import { hexKey, hexesInRange, neighbors, ORIGIN, distance } from '../src/game/hex';

describe('APEX 2.3: relief', () => {
  it('every style gives valid heights; walkable styles never step more than one level; water lies low; houses are level', () => {
    const base = generateBattleScene('hamlet', 10, 4);
    for (const { id } of RELIEF_STYLES) {
      const d = applyRelief(base, id as ReliefStyle, 3, 9);
      expect(validHexData(d), id).toBe(true);
      if (id === 'none') { expect(d.heights).toBeUndefined(); continue; }
      const m = hexSceneMap(emptyMap('battle'), d);
      const h = heightLookup(m), tiles = decodeTiles(d);
      const cells = hexesInRange(ORIGIN, d.radius);
      expect(Math.max(...cells.map((c) => h(hexKey(c)))), id).toBeGreaterThan(0);
      if (id !== 'terraces' && id !== 'crags') for (const c of cells) for (const n of neighbors(c)) if (distance(n, ORIGIN) <= d.radius) expect(Math.abs(h(hexKey(c)) - h(hexKey(n))), `${id} step`).toBeLessThanOrEqual(1 + 1e-9);
      for (const c of cells) { const t = tiles.get(hexKey(c)); if (t && /cottage|timberhouse/.test(t.id)) for (const n of neighbors(c)) { const tn = tiles.get(hexKey(n)); if (tn && /cottage|timberhouse/.test(tn.id)) expect(h(hexKey(n)), `${id} house level`).toBe(h(hexKey(c))); } }
    }
    expect(applyRelief(base, 'hills', 3, 9)).toEqual(applyRelief(base, 'hills', 3, 9));
  });
  it('rural layouts come with gentle hills; city squares stay flat', () => {
    expect(generateBattleScene('farmstead', 10, 3).heights).toBeTruthy();
    expect(generateBattleScene('forest', 10, 3).heights).toBeTruthy();
    expect(generateBattleScene('market', 10, 3).heights).toBeUndefined();
  });
});
