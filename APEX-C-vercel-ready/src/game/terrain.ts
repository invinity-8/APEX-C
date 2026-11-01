/**
 * Geländetypen und ihre Regeln.
 * Hier kannst du Bewegungskosten, Farben und Beschreibungen anpassen,
 * ohne die Oberfläche anfassen zu müssen.
 */

export type TerrainType = 'plains' | 'road' | 'forest' | 'mountain' | 'water' | 'ruins' | 'magic';

export interface TerrainDef {
  label: string;
  /** Bewegungspunkte, um dieses Feld zu betreten. `null` = nicht passierbar. */
  cost: number | null;
  /** Wird auf der Karte als "schwieriges Gelände" markiert. */
  difficult: boolean;
  fill: string;
  stroke: string;
  description: string;
}

export const TERRAIN: Record<TerrainType, TerrainDef> = {
  plains: {
    label: 'Ebene',
    cost: 1,
    difficult: false,
    fill: '#6b6a3c',
    stroke: '#7d7b47',
    description: 'Offenes Grasland. Schneller Marsch, aber kaum Deckung.',
  },
  road: {
    label: 'Via Arcana',
    cost: 0.5,
    difficult: false,
    fill: '#a08a5c',
    stroke: '#c9ad6e',
    description: 'Verzauberte Römerstraße. Die Pflastersteine tragen Marschierende voran – halbe Kosten.',
  },
  forest: {
    label: 'Wald',
    cost: 2,
    difficult: true,
    fill: '#2f4a2b',
    stroke: '#3e5f38',
    description: 'Dichter Pinienwald. Langsam, aber gute Verstecke.',
  },
  mountain: {
    label: 'Gebirge',
    cost: 3,
    difficult: true,
    fill: '#6e6a66',
    stroke: '#8d8883',
    description: 'Felsgrate und Geröll. Sehr anstrengend zu durchqueren.',
  },
  water: {
    label: 'Wasser',
    cost: null,
    difficult: false,
    fill: '#1c3a52',
    stroke: '#26506f',
    description: 'Tiefe Seen und Kanäle. Zu Fuß nicht passierbar.',
  },
  ruins: {
    label: 'Ruinen',
    cost: 2,
    difficult: true,
    fill: '#7a6450',
    stroke: '#97806a',
    description: 'Eingestürzte Tempel und Villen. Schutt verlangsamt, Schätze locken.',
  },
  magic: {
    label: 'Magische Zone',
    cost: 2,
    difficult: true,
    fill: '#4b2e6b',
    stroke: '#7a4fb0',
    description: 'Gebündelte Willenskraft verzerrt den Raum. Unberechenbar.',
  },
};

export const TERRAIN_ORDER: TerrainType[] = ['plains', 'road', 'forest', 'mountain', 'ruins', 'magic', 'water'];

export const isPassable = (t: TerrainType): boolean => TERRAIN[t].cost !== null;
