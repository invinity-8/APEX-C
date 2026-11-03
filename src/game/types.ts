import type { Equipment, ItemEquip } from './equipment.js';
import type { ItemRules, Rarity } from './items/rules.js';
import type { CurrencyId } from './items/currency.js';
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
  /** APEX 0.5: manually defined equipment properties (see equipment.ts). */
  equip?: ItemEquip;
  /** APEX 0.6: base item template id from the item pool (src/game/items/bases.ts). */
  baseId?: string;
  /** APEX 0.6: rarity of generated items (missing = plain/free-text item). */
  rarity?: Rarity;
  itemLevel?: number;
  /** false = unidentified: the modifiers exist server-side but are hidden from players until identified. */
  identified?: boolean;
  /** Rolled modifiers (server-generated only). */
  mods?: RolledMod[];
  /** Modifier repository version the mods were rolled with. */
  modVersion?: number;
  /** Where the item came from (GM grant, merchant, trade …). */
  source?: ItemOrigin;
  /** Bound items cannot be transferred or traded. */
  bound?: boolean;
  /** GM restriction (quest item …): players cannot salvage or delete it. */
  locked?: boolean;
  /** Short, public item history (newest last, bounded) – never contains hidden modifier data. */
  history?: Array<{ day: number; text: string }>;
}

/** One rolled modifier on an item instance (APEX 0.6). */
export interface RolledMod {
  modId: string;
  tier: number;
  value: number;
}

export interface ItemOrigin {
  kind: 'gm' | 'merchant' | 'trade' | 'transfer' | 'loot' | 'legacy';
  label?: string;
  day?: number;
}

/** A place in a character's inventory (Backpack, Pockets … or custom). */
export interface InventoryContainer {
  id: string;
  name: string;
}

/** Cosmetic map marker shapes (APEX 0.4). */
export type MarkerStyle = 'medallion' | 'gem' | 'hexagon' | 'crest';
export const MARKER_STYLES: readonly MarkerStyle[] = ['medallion', 'gem', 'hexagon', 'crest'];

export interface Token {
  id: string;
  name: string;
  kind: TokenKind;
  teamId: string;
  /** Character title / tagline shown under the name (e.g. "Will-Weaver"). */
  title: string;
  /** APEX 0.7: the tagline was set by hand – imports and defaults never overwrite it. */
  titleCustom?: boolean;
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
  /** APEX 0.4 – cosmetic only (never used for permissions or rules). */
  accent?: string;
  marker?: MarkerStyle;
  /** Portrait in private storage; v changes with every upload (cache busting). Path is never sent to clients. */
  portrait?: { path: string; v: number };
  /** APEX 0.5: walking speed in feet the daily movement points are derived from (set by the GM). */
  speedFt?: number;
  /** APEX 0.5: equipped items (references into `inventory`), weapon sets, resting preset. */
  equipment?: Equipment;
  /** APEX 0.6: magical currency balances (server-authoritative) and their revision. */
  currency?: Partial<Record<CurrencyId, number>>;
  currencyRev?: number;
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

/**
 * Event lifecycle (APEX 0.4 – GM approval):
 *  pending   scheduled, not due yet (or manual-only)
 *  awaiting  due – prepared by the system, waiting for the GM's decision; NO effect has been applied
 *  postponed GM postponed it; becomes awaiting again at `postponedTo`
 *  done      approved and applied exactly once
 *  rejected  GM rejected it; no effect, never fires again
 */
export type EventStatus = 'pending' | 'awaiting' | 'postponed' | 'done' | 'rejected';

export interface ArenaEvent {
  id: string;
  name: string;
  description: string;
  trigger: EventTrigger;
  hexes: HexKey[];
  effects: EventEffect[];
  status: EventStatus;
  /** Wird die Ankündigung den Spielern gezeigt? */
  announce: boolean;
  /** 'auto' = from the campaign setup, 'custom' = created by the GM. */
  source?: 'auto' | 'custom';
  /** When the event became due (awaiting). */
  dueAt?: { day: number; phase: Phase };
  postponedTo?: { day: number; phase: Phase };
  /** When the GM approved / rejected it. */
  decidedAt?: { day: number; phase: Phase; decision: 'approved' | 'rejected' };
}

export type AnnouncementCategory = 'general' | 'warning' | 'death' | 'world' | 'custom';

/** Arena Announcement – shown as a cinematic overlay on every player's screen. Public by definition. */
export interface Announcement {
  id: string;
  category: AnnouncementCategory;
  title: string;
  text: string;
  createdAt: string;
  day: number;
  phase: Phase;
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

/** Identity of the active world (APEX 0.3+). Older saves have none. */
export interface WorldMeta {
  id: string;
  name: string;
  createdAt: string;
}

export interface GameState {
  version: number;
  world?: WorldMeta;
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
  /** APEX 0.4: Arena Announcements (newest last, bounded). */
  announcements?: Announcement[];
  /** APEX 0.6: GM overrides of the itemisation caps (see src/game/items/rules.ts). */
  itemRules?: Partial<ItemRules>;
  /** APEX 0.6: GM Arsenal – generated items waiting to be handed out (GM-only). */
  arsenal?: { staged: Item[] };
  /** APEX 0.6: item audit trail (GM-only, bounded). */
  itemAudit?: ItemAuditEntry[];
  nextAuditId?: number;
}

export interface ItemAuditEntry {
  id: number;
  day: number;
  phase: Phase;
  /** 'GM' or the acting character's name. */
  by: string;
  action: 'generate' | 'give' | 'discard' | 'revoke' | 'currency' | 'lock' | 'identify' | 'reroll' | 'salvage' | 'combine';
  tokenId?: string;
  itemId?: string;
  itemName?: string;
  detail: string;
}

/** Who performs an action? */
export type Actor = { role: 'gm' } | { role: 'player'; tokenId: string };
