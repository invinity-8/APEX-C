import type { MapNode, SceneMap } from './maps';

export interface ForestOptions {
  seed: number;
  forestDensity: number;
  openGroundPercent: number;
  rockDensity: number;
  obstacleDensity: number;
  waterPercent: number;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function seededRandom(seed: number): () => number {
  let state = (Math.floor(Math.abs(seed)) >>> 0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates editable, grid-aligned forest features without changing the supplied map. */
export function generateForestFeatures(map: SceneMap, options: ForestOptions): MapNode[] {
  if (map.interval !== 'round') return [];
  const random = seededRandom(options.seed);
  const cell = Math.max(20, map.cell);
  const columns = Math.floor(map.width / cell);
  const rows = Math.floor(map.height / cell);
  const featureLimit = 180;
  const safeCenters = map.nodes.filter(node => node.kind === 'spawn').map(node => ({ x: node.x, y: node.y }));
  const manualNodes = map.nodes.filter(node => !node.generatedBy);
  if (!safeCenters.length) safeCenters.push({ x: map.width / 2, y: map.height / 2 });
  const forestDensity = clampPercent(options.forestDensity) / 100;
  const openGround = clampPercent(options.openGroundPercent) / 100;
  const rockDensity = clampPercent(options.rockDensity) / 100;
  const obstacleDensity = clampPercent(options.obstacleDensity) / 100;
  const waterPercent = clampPercent(options.waterPercent) / 100;
  const generated: MapNode[] = [];
  let sequence = 0;

  for (let row = 0; row < rows && generated.length < featureLimit; row++) {
    for (let column = 0; column < columns && generated.length < featureLimit; column++) {
      const x = column * cell;
      const y = row * cell;
      const centerX = x + cell / 2;
      const centerY = y + cell / 2;
      if (x + cell > map.width || y + cell > map.height) continue;
      if (safeCenters.some(center => Math.hypot(centerX - center.x, centerY - center.y) < cell * 1.6)) continue;
      // Keep player-placed objects intact and avoid hiding them beneath generated terrain.
      if (manualNodes.some(node => {
        const halfWidth = node.kind === 'location' || node.kind === 'label' || node.kind === 'spawn' ? cell * 0.45 : node.width / 2;
        const halfHeight = node.kind === 'location' || node.kind === 'label' || node.kind === 'spawn' ? cell * 0.45 : node.height / 2;
        return Math.abs(centerX - node.x) < halfWidth + cell * 0.35 && Math.abs(centerY - node.y) < halfHeight + cell * 0.35;
      })) continue;
      if (random() < openGround) continue;

      const roll = random();
      let proceduralFeature: NonNullable<MapNode['proceduralFeature']>;
      let label: string;
      let terrainCost = 1.5;
      let kind: MapNode['kind'] = 'area';
      if (roll < waterPercent) {
        proceduralFeature = 'water'; label = 'Shallow water'; terrainCost = 2;
      } else if (roll < waterPercent + rockDensity * (1 - waterPercent)) {
        proceduralFeature = 'rock'; label = 'Boulder'; terrainCost = 1.5;
      } else if (roll < waterPercent + rockDensity * (1 - waterPercent) + obstacleDensity * (1 - waterPercent - rockDensity * (1 - waterPercent))) {
        proceduralFeature = 'obstacle'; label = 'Fallen log'; kind = 'wall'; terrainCost = 1;
      } else if (random() < forestDensity) {
        proceduralFeature = 'tree'; label = 'Tree'; terrainCost = 1.5;
      } else continue;

      sequence++;
      const seedId = (Math.floor(Math.abs(options.seed)) >>> 0).toString(36);
      generated.push({
        id: `forest-${seedId}-${sequence}`,
        x, y,
        label,
        description: `Procedurally placed ${label.toLowerCase()}. You can move or edit this feature.`,
        kind,
        visible: true,
        width: cell * 0.7,
        height: cell * 0.7,
        targetScene: null,
        terrainCost,
        discoverable: false,
        proceduralFeature,
        generatedBy: 'forest-v1',
      });
    }
  }
  return generated;
}
