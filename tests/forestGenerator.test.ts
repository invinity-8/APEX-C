import { describe, expect, it } from 'vitest';
import { emptyMap, parseMap } from '../src/campaign/maps';
import { generateForestFeatures } from '../src/campaign/forestGenerator';
import { publicMap } from '../src/server/sceneRuntime';

describe('forest content generation', () => {
  it('is deterministic for a seed and leaves the input map unchanged', () => {
    const map = emptyMap('battle');
    const before = structuredClone(map);
    const options = { seed: 1234, forestDensity: 70, openGroundPercent: 25, rockDensity: 15, obstacleDensity: 10, waterPercent: 8 };
    const first = generateForestFeatures(map, options);
    expect(generateForestFeatures(map, options)).toEqual(first);
    expect(map).toEqual(before);
    expect(new Set(first.map(n => n.id)).size).toBe(first.length);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every(n => n.generatedBy === 'forest-v1' && n.proceduralFeature && n.x % map.cell === 0 && n.y % map.cell === 0)).toBe(true);
  });

  it('preserves hand-placed objects and reserves spawn areas', () => {
    const map = emptyMap('battle');
    map.nodes = [
      { id: 'spawn', x: 600, y: 400, label: 'Entry', description: '', kind: 'spawn', visible: false, width: 50, height: 50, targetScene: null },
      { id: 'manual', x: 100, y: 100, label: 'Cover', description: '', kind: 'wall', visible: true, width: 100, height: 100, targetScene: null },
      { id: 'generated-old', x: 200, y: 200, label: 'Tree', description: '', kind: 'area', visible: true, width: 35, height: 35, targetScene: null, proceduralFeature: 'tree', generatedBy: 'forest-v1' },
    ];
    const features = generateForestFeatures(map, { seed: 5, forestDensity: 100, openGroundPercent: 0, rockDensity: 0, obstacleDensity: 0, waterPercent: 0 });
    expect(features.every(n => n.id !== 'manual' && n.id !== 'spawn')).toBe(true);
    expect(features.some(n => n.x === 100 && n.y === 100)).toBe(false);
    expect(features.every(n => Math.hypot(n.x + map.cell / 2 - 600, n.y + map.cell / 2 - 400) >= map.cell * 1.6)).toBe(true);
    expect(features.some(n => n.x === 200 && n.y === 200)).toBe(true);
  });

  it('limits generation to round based maps and caps large layouts', () => {
    const regional = emptyMap('region');
    expect(generateForestFeatures(regional, { seed: 1, forestDensity: 100, openGroundPercent: 0, rockDensity: 0, obstacleDensity: 0, waterPercent: 0 })).toEqual([]);
    const battle = emptyMap('battle'); battle.width = 5000; battle.height = 5000;
    expect(generateForestFeatures(battle, { seed: 1, forestDensity: 100, openGroundPercent: 0, rockDensity: 0, obstacleDensity: 0, waterPercent: 0 })).toHaveLength(180);
  });

  it('round trips features through map validation and strips editor provenance from players', () => {
    const map = emptyMap('battle');
    map.nodes = generateForestFeatures(map, { seed: 2, forestDensity: 100, openGroundPercent: 100, rockDensity: 0, obstacleDensity: 0, waterPercent: 0 });
    expect(map.nodes).toHaveLength(0);
    map.nodes = [{ id: 'forest', x: 0, y: 0, label: 'Tree', description: '', kind: 'area', visible: true, width: 30, height: 30, targetScene: null, proceduralFeature: 'tree', generatedBy: 'forest-v1' }];
    expect(parseMap(map)?.nodes[0]).toMatchObject({ proceduralFeature: 'tree', generatedBy: 'forest-v1' });
    const playerMap = publicMap(map);
    expect(playerMap?.nodes[0]).toMatchObject({ proceduralFeature: 'tree' });
    expect(playerMap?.nodes[0]).not.toHaveProperty('generatedBy');
  });
});
