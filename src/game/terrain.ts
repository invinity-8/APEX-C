/**
 * Terrain types and their rules.
 * Adjust movement costs, colours and descriptions here without touching the UI.
 *
 * v0.2 added two terrain types (documented in README → "Rule changes"):
 *   - hills  (elevated terrain, 2 MP, good vantage points)
 *   - river  (fordable river, 3 MP; deep lakes remain impassable)
 */

export type TerrainType = 'plains' | 'road' | 'forest' | 'hills' | 'mountain' | 'river' | 'water' | 'ruins' | 'magic';

export interface TerrainDef {
  label: string;
  /** Movement points needed to enter this hex. `null` = impassable. */
  cost: number | null;
  /** Shown on the map as "difficult terrain". */
  difficult: boolean;
  /** Base paint colour (used for the legend and the painted map). */
  fill: string;
  /** Darker shade for relief and edges. */
  stroke: string;
  /** Highlight colour for painted gradients. */
  light: string;
  description: string;
}

export const TERRAIN: Record<TerrainType, TerrainDef> = {
  plains: {
    label: 'Grassland',
    cost: 1,
    difficult: false,
    fill: '#7b8a45',
    stroke: '#55612d',
    light: '#a3b061',
    description: 'Open grassland. A fast march, but little cover.',
  },
  road: {
    label: 'Via Arcana',
    cost: 0.5,
    difficult: false,
    fill: '#b59a64',
    stroke: '#7a6438',
    light: '#dcc48b',
    description: 'An enchanted imperial road. Its paving stones carry marchers forward – half cost.',
  },
  forest: {
    label: 'Forest',
    cost: 2,
    difficult: true,
    fill: '#2f5a33',
    stroke: '#1b3520',
    light: '#4f7f45',
    description: 'Dense pine and oak forest. Slow going, but excellent hiding places.',
  },
  hills: {
    label: 'Hills',
    cost: 2,
    difficult: true,
    fill: '#8a7b4c',
    stroke: '#5c5030',
    light: '#b3a46a',
    description: 'Rolling highlands. Tiring to cross, but they offer a view over the land.',
  },
  mountain: {
    label: 'Mountains',
    cost: 3,
    difficult: true,
    fill: '#77706a',
    stroke: '#4a4440',
    light: '#a8a19a',
    description: 'Rocky ridges and scree. Exhausting to traverse.',
  },
  river: {
    label: 'River',
    cost: 3,
    difficult: true,
    fill: '#2f6f8f',
    stroke: '#1d4a62',
    light: '#5fa3c4',
    description: 'A cold, fast-flowing river. It can be forded, but slowly and with effort.',
  },
  water: {
    label: 'Lake',
    cost: null,
    difficult: false,
    fill: '#1d4560',
    stroke: '#132f44',
    light: '#3a7398',
    description: 'Deep lakes and flooded basins. Impassable on foot.',
  },
  ruins: {
    label: 'Ruins',
    cost: 2,
    difficult: true,
    fill: '#8b7458',
    stroke: '#5d4b37',
    light: '#bba17c',
    description: 'Collapsed temples and villas of an imperial district. Rubble slows you; treasure tempts you.',
  },
  magic: {
    label: 'Arcane Anomaly',
    cost: 2,
    difficult: true,
    fill: '#4e3075',
    stroke: '#2e1a4a',
    light: '#8d5fd0',
    description: 'Concentrated willpower warps space here. Unpredictable.',
  },
};

export const TERRAIN_ORDER: TerrainType[] = ['plains', 'road', 'forest', 'hills', 'mountain', 'ruins', 'magic', 'river', 'water'];

export const isPassable = (t: TerrainType): boolean => TERRAIN[t].cost !== null;
