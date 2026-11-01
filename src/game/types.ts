/**
 * Central game state structure.
 * Everything that is saved, exported or stored in Supabase is defined here.
 * The GameState contains the FULL truth (including secrets); players never
 * receive it, only a filtered view (see visibility.ts → buildPlayerView).
 */
import type { Axial, HexKey } from './hex.js';
import type { TerrainType } from './terrain.js';

/** v2: day/night phases, terrain elevation & landmark features. */
export const STATE_VERSION = 2;

// ---------------- Map ----------------

/** Landmark decoration drawn on top of the terrain. Does not change movement rules. */
export type HexFeature = 'eagle' | 'plaza' | 'labyrinth';

export interface HexTile {
  q: number;
  r: number;
  terrain: TerrainType;
  /** 0..1 relative height, used for relief shading. */
  elevation?: number;
  feature?: HexFeature;
  /** Optional site on this hex. */
  siteId?: string;
}

// ---------------- Time ----------------

export type Phase = 'day' | 'night';

export interface PhaseRule {
  /** Added to every character's vision radius during this phase. */
  visionModifier: number;
  /** Vision never drops below this value because of the phase modifier. */
  minVision: number;
}

export interface PhaseRules {
  day: PhaseRule;
  night: PhaseRule;
}

export const DEFAULT_PHASE_RULES: PhaseRules = {
  day: { visionModifier: 0, minVision: 0 },
  night: { visionModifier: -1, minVision: 1 },
};

export interface ShrinkConfig {
  enabled: boolean;
  /** From the dawn of this day on, the outermost ring(s) are affected. */
  startDay: number;
  /** Every how many days another step is applied. */
  intervalDays: number;
  /** Rings per shrink step. */
  ringsPerStep: number;
  /** "danger": passable but dangerous. "closed": can no longer be entered. */
  mode: 'danger' | 'closed';
  /** How many days in advance players are warned. */
  warningDays: number;
  /** Free text describing the consequence (e.g. damage), mentioned in the log. */
  consequence: string;
}

export interface GameConfig {
  mapRadius: number;
  seed: number;
  defaultMovePoints: number;
  defaultVisionRadius: number;
  shrink: ShrinkConfig;
  phases: PhaseRules;
}

// ---------------- Characters & teams ----------------

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
  /** APEX 0.3: inventory container id (missing = derived default, see inventory.ts). */
  container?: string;
  /** Free-text notes of the owner. */
  notes?: string;
  /** Revision counter – edits must name the revision they are based on (no silent overwrites). */
  rev?: number;
}

/** A place in a character's inventory (Backpack, Pockets … or custom). */
export interface InventoryContainer {
  id: string;
  name: string;
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
  /** APEX 0.3: inventory containers (missing = the default set, see inventory.ts). */
  containers?: InventoryContainer[];
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

/**
 * 'day'   – fires at the dawn of the given day (backwards compatible with v0.1).
 * 'phase' – fires when the given day/phase begins (e.g. Night 2).
 */
export type EventTrigger = { type: 'day'; day: number } | { type: 'phase'; day: number; phase: Phase } | { type: 'manual' };

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
  /** Phase at the time of the entry (missing in v0.1 saves → treated as 'day'). */
  phase?: Phase;
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
  phase: Phase;
  hexes: Record<HexKey, HexTile>;
  tokens: Record<string, Token>;
  teams: Record<string, Team>;
  sites: Record<string, Site>;
  events: Record<string, ArenaEvent>;
  knowledge: Record<string, Knowledge>;
  log: LogEntry[];
  nextLogId: number;
}

/** Who performs an action? */
export type Actor = { role: 'gm' } | { role: 'player'; tokenId: string };
