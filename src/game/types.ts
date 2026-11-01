/**
 * Zentrale Datenstruktur des Spielstands.
 * Alles, was gespeichert, exportiert oder später in Supabase abgelegt wird,
 * ist hier definiert. Der GameState enthält die VOLLE Wahrheit (inkl. Geheimnisse);
 * Spieler bekommen nie den GameState, sondern nur eine gefilterte PlayerView
 * (siehe visibility.ts → buildPlayerView).
 */
import type { Axial, HexKey } from './hex';
import type { TerrainType } from './terrain';

export const STATE_VERSION = 1;

// ---------------- Karte ----------------

export interface HexTile {
  q: number;
  r: number;
  terrain: TerrainType;
  /** Optionaler Ort auf diesem Feld. */
  siteId?: string;
}

export interface ShrinkConfig {
  enabled: boolean;
  /** Ab diesem Tag ist der äußerste Ring betroffen. */
  startDay: number;
  /** Alle wie viele Tage ein weiterer Ring betroffen ist. */
  intervalDays: number;
  /** Ringe pro Schrumpfschritt. */
  ringsPerStep: number;
  /** "danger": betretbar, aber gefährlich. "closed": nicht mehr betretbar. */
  mode: 'danger' | 'closed';
  /** Wie viele Tage vorher gewarnt wird. */
  warningDays: number;
  /** Freitext für Konsequenzen (z. B. Schaden), wird im Log genannt. */
  consequence: string;
}

export interface GameConfig {
  mapRadius: number;
  seed: number;
  defaultMovePoints: number;
  defaultVisionRadius: number;
  shrink: ShrinkConfig;
}

// ---------------- Figuren & Teams ----------------

export type TokenKind = 'player' | 'rival';

export interface WillPool {
  current: number;
  max: number;
}

export interface Item {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'tool' | 'consumable' | 'will-vessel' | 'misc';
  description: string;
  quantity: number;
  /** Nur für Willensgefäße: gespeicherte Willenskraft. */
  willCharge?: number;
  willCapacity?: number;
}

export interface Token {
  id: string;
  name: string;
  kind: TokenKind;
  teamId: string;
  /** Kurzbeschreibung, z. B. Klasse/Herkunft. */
  title: string;
  color: string;
  initials: string;
  pos: Axial;
  movePoints: number;
  maxMovePoints: number;
  visionRadius: number;
  /** Temporärer Sichtbonus (z. B. Turm bestiegen). Wird bei Tageswechsel zurückgesetzt. */
  visionBonus: number;
  /** Zusätzliche Spielerfiguren, die diese Figur steuern dürfen (vom GM erteilt). */
  controllers: string[];
  /** Nur Spieler: Teilt diese Figur Sicht & Wissen mit dem Rest der Gruppe? */
  sharesWithParty: boolean;
  will: WillPool;
  inventory: Item[];
}

export type TeamVisibility = 'auto' | 'hidden' | 'revealed';
export type TeamStrategy = 'manual' | 'patrol' | 'forage' | 'flee' | 'pursue' | 'rest';

export interface TrackingMarker {
  mode: 'approx' | 'exact';
  /** Angezeigter Mittelpunkt (bei 'approx' bewusst ungenau). */
  pos: Axial;
  /** Unsicherheitsradius in Feldern (0 bei 'exact'). */
  radius: number;
  day: number;
}

export interface Team {
  id: string;
  name: string;
  kind: 'party' | 'rival';
  color: string;
  emblem: string;
  motto: string;
  personality: string;
  /** 0–10 */
  aggression: number;
  goals: string[];
  resources: string[];
  strategy: TeamStrategy;
  /** auto = sichtbar, wenn im Sichtfeld; hidden = nie (z. B. Tarnung); revealed = immer. */
  visibility: TeamVisibility;
  tracking: TrackingMarker | null;
}

// ---------------- Orte ----------------

export type SiteVisibility = 'public' | 'onSight' | 'hidden';

export interface Site {
  id: string;
  name: string;
  type: 'start' | 'camp' | 'ruin' | 'shrine' | 'tower' | 'cache';
  pos: Axial;
  description: string;
  /** Nur für den GM sichtbare Notizen. */
  gmNotes: string;
  visibility: SiteVisibility;
  status: 'intact' | 'looted' | 'destroyed' | 'occupied';
  rewards: string[];
  interactions: string[];
}

// ---------------- Events ----------------

export type EventTrigger = { type: 'day'; day: number } | { type: 'manual' };

export type EventEffect =
  | { type: 'setTerrain'; terrain: TerrainType }
  | { type: 'revealSite'; siteId: string }
  | { type: 'modifyMovePoints'; amount: number };

export interface ArenaEvent {
  id: string;
  name: string;
  description: string;
  trigger: EventTrigger;
  hexes: HexKey[];
  effects: EventEffect[];
  status: 'pending' | 'done';
  /** Wird die Ankündigung den Spielern gezeigt? */
  announce: boolean;
}

// ---------------- Wissen (Fog of War) ----------------

export interface Sighting {
  pos: Axial;
  day: number;
}

/** Was eine einzelne Spielerfigur weiß. */
export interface Knowledge {
  /** Erforschte Felder → zuletzt gesehenes Gelände. */
  explored: Record<HexKey, TerrainType>;
  /** Entdeckte Rivalenteams → letzte Sichtung. */
  sightings: Record<string, Sighting>;
  /** Entdeckte Orte. */
  sites: string[];
}

// ---------------- Log ----------------

export interface LogEntry {
  id: number;
  day: number;
  kind: 'day' | 'move' | 'event' | 'system' | 'gm' | 'warning';
  text: string;
  /** 'gm' = nur der Spielleiter sieht diesen Eintrag. */
  audience: 'all' | 'gm';
}

// ---------------- Gesamtzustand ----------------

export interface GameState {
  version: number;
  config: GameConfig;
  day: number;
  hexes: Record<HexKey, HexTile>;
  tokens: Record<string, Token>;
  teams: Record<string, Team>;
  sites: Record<string, Site>;
  events: Record<string, ArenaEvent>;
  knowledge: Record<string, Knowledge>;
  log: LogEntry[];
  nextLogId: number;
}

/** Wer führt eine Aktion aus? */
export type Actor = { role: 'gm' } | { role: 'player'; tokenId: string };
