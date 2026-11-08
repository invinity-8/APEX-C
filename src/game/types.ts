import type { Equipment, ItemEquip } from './equipment.js';
import type { ItemRules, Rarity } from './items/rules.js';
import type { CurrencyId } from './items/currency.js';
import type { LootDraft } from './items/lootDraft.js';
import type { LootRoll } from './items/partyLoot.js';
import type { Merchant } from './items/merchant.js';
import type { BeastForm } from './beasts.js';
import type { CharacterCosmetics } from './cosmetics.js';
/**
 * Central game state structure.
 * Everything that is saved, exported or stored in Supabase is defined here.
 * The GameState contains the FULL truth (including secrets); players never
 * receive it, only a filtered view (see visibility.ts → buildPlayerView).
 */
import type { Axial, HexKey } from './hex.js';
import type { TerrainType } from './terrain.js';

/** v2: day/night phases, terrain elevation & landmark features. */
/** 3 (APEX 0.7): the legacy Willpower resource was removed (see migrate.ts). */
export const STATE_VERSION = 3;

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

export interface Item {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'tool' | 'consumable' | 'misc';
  description: string;
  quantity: number;
  /** APEX 0.3: inventory container id (missing = derived default, see inventory.ts). */
  container?: string;
  /** APEX 0.7: container the item came from before it was equipped (it returns there when unequipped). */
  prevContainer?: string;
  /** APEX 0.7: weight per unit in kilograms (overrides the base item's SRD weight; free-text items default to 0). */
  weightKg?: number;
  /** APEX 0.7: Bag of Holding contents while the bag is NOT in a character's inventory (tray / transfer). */
  held?: Item[];
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
  /** APEX 0.7: quest item details (`gmNotes` is stripped from player views). */
  quest?: { image?: string; gmNotes?: string };
  /** APEX 0.7: currency bundle from an approved loot draft (Arsenal tray only – giving it credits the purse). */
  grant?: { currency: CurrencyId; amount: number };
  /** Bound items cannot be transferred or traded. */
  bound?: boolean;
  /** GM restriction (quest item …): players cannot salvage or delete it. */
  locked?: boolean;
  /** APEX 0.7: unique item definition id (src/game/items/uniques.ts). */
  uniqueId?: string;
  /** APEX 0.7: activatable ability state of a unique item (spent until the GM recharges it). */
  charge?: { spent: boolean; spentDay?: number };
  /** Short, public item history (newest last, bounded) – never contains hidden modifier data. */
  history?: Array<{ day: number; text: string }>;
}

/** Player-authored generic items stay drafts until a GM approves them. */
export interface NarrativeItemRequest {
  id: string;
  name: string;
  description: string;
  notes?: string;
  quantity: number;
  weightKg?: number;
  container?: string;
  createdDay: number;
  status: 'pending' | 'approved' | 'rejected';
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
  /** APEX 0.7: id of the Bag of Holding item this container belongs to. */
  holding?: string;
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
  inventory: Item[];
  /** Pending and recently reviewed narrative-item requests; exposed only to this character's owner and GM. */
  itemRequests?: NarrativeItemRequest[];
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
  /** Server timestamp when active body armour was put on; Mage Armor ends after this point. */
  armorWornAt?: string;
  /** APEX 0.6: magical currency balances (server-authoritative) and their revision. */
  currency?: Partial<Record<CurrencyId, number>>;
  currencyRev?: number;
  /** APEX 0.7: outcome of the last Arcane Transmutation (shown to the owner once). */
  lastTransmute?: { rev: number; result: Partial<Record<CurrencyId, number>> };
  /** APEX 0.7: cosmetic rewards granted by the GM and the player's choice among them (never affects rules). */
  cosmetics?: CharacterCosmetics;
  /** APEX 0.7: GM-granted permanent Arcane Transmutation access (otherwise carrying the cube unlocks it). */
  cubeAccess?: boolean;
  /** APEX 0.9: earned Cube level, unspent Cube Fragments and GM adjustment marker. */
  cubeProgression?: { level: number; gmOverride?: boolean; legacyEntitlement?: boolean };
  /** APEX 0.7: Sneak mode – each step costs double movement points. Not invisibility: being unseen still needs a Stealth check. */
  sneaking?: boolean;
  /** APEX 0.7: player-uploaded pictures per Wild Shape form (private storage path + cache version; path never sent). */
  beastImages?: Record<string, { path: string; v: number }>;
  /** APEX 0.7: cosmetic paper-doll silhouette (never affects rules). */
  bodyType?: BodyType;
  /** APEX 0.7: Niri's Timetwister – a postponed turn waiting for the GM (bound to the character, not the item). */
  timeTwist?: { itemId: string; itemName: string; day: number; phase: Phase };
}

export type BodyType = 'masculine' | 'feminine';
export const BODY_TYPES: readonly BodyType[] = ['masculine', 'feminine'];

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
  /** APEX 0.7: server time after which the announcement is never shown as a popup (history only). */
  expiresAt?: string;
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

/** Live narrative message scoped to one published scene. */
export interface SceneAnnouncement { id: string; sceneId: string; title: string; text: string; createdAt: string }
export interface SceneEncounterParticipant { id: string; name: string; initiative: number; visible: boolean; tokenId?: string; /** Initiative modifier (tie-breaker: higher first). */ bonus?: number }
export interface SceneEncounter {
  id: string; sceneId: string; title: string; round: number; turnIndex: number; version: number;
  status: 'active' | 'ended'; participants: SceneEncounterParticipant[];
  /** Increases whenever the active turn changes; movement budgets are per turn (scene motion epoch). */
  turnSerial?: number;
  /** tokenId → turnSerial of the last attack (one attack per turn). */
  attacked?: Record<string, number>;
  /** Participant id → what it used in its current turn (action, bonus action, Dash …), see sceneActions.ts. */
  economy?: Record<string, import('./sceneActions.js').TurnBudget>;
  /** Participant id → turn serial when its reaction was used; cleared when its own turn starts. */
  reactions?: Record<string, number>;
  /** Characters of the current block (consecutive characters act together) that already ended their part. */
  blockDone?: string[];
}

/** Scene-local time and light (independent of the Arena day/night). */
export interface SceneClockState { day: number; phase: 'day' | 'night'; lighting: 'bright' | 'dim' | 'dark'; version: number }

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
  /** APEX 0.7: GM-defined Wild Shape forms (in addition to the SRD beasts). */
  customBeasts?: BeastForm[];
  /** GM-only: the Arsenal tray and (APEX 0.7) the current loot draft. */
  arsenal?: { staged: Item[]; draft?: LootDraft };
  /** APEX 0.7: party loot rolls (Need / Distribute / Pass) – open ones and the recent history. */
  lootRolls?: LootRoll[];
  /** Scene-bound campaign announcements; bounded and filtered to the viewer's assigned scene. */
  sceneAnnouncements?: SceneAnnouncement[];
  /** One current/recent initiative tracker per scene. */
  sceneEncounters?: Record<string, SceneEncounter>;
  /** Scene-local clocks (region day/night, battle lighting). Never touched by the Arena. */
  sceneClocks?: Record<string, SceneClockState>;
  /** Scene enemies (GM-placed), carried lights and the bounded combat log, per scene. */
  sceneEnemies?: Record<string, import('./sceneCombat.js').SceneEnemy[]>;
  sceneLights?: Record<string, string[]>;
  sceneCombatLog?: Record<string, import('./sceneCombat.js').CombatLogEntry[]>;
  /** APEX 1.6 – short-lived visual combat events per scene (floating numbers, streaks, bursts). */
  sceneFx?: Record<string, import('./sceneFx.js').SceneFx[]>;
  /** APEX 1.9 – altitude above the ground per scene and creature (flying). */
  sceneAltitude?: Record<string, Record<string, import('./altitude.js').Altitude>>;
  /** APEX 1.2: the GM's own creatures and elites (built-in SRD creatures are not stored). */
  enemyLibrary?: import('./bestiary.js').StatBlock[];
  /** Open reaction prompts per scene (opportunity attacks) – valid during the turn they were offered in. */
  sceneReactions?: Record<string, import('./sceneActions.js').ReactionOffer[]>;
  /** APEX 1.3: conditions and buffs per scene and participant id. */
  sceneEffects?: Record<string, Record<string, import('./combatEffects.js').SceneEffect[]>>;
  /** APEX 1.3: concentration per scene and participant id. */
  sceneConcentration?: Record<string, Record<string, import('./combatEffects.js').Concentration>>;
  /** APEX 1.3: attacks waiting for a defensive reaction (Shield) per scene. */
  scenePendingHits?: Record<string, import('./sceneActions.js').PendingHit[]>;
  /** APEX 1.3: readied actions per scene and participant id. */
  sceneReadied?: Record<string, Record<string, import('./sceneActions.js').ReadiedAction>>;
  /** Moves paused by opportunity attacks per scene (they continue after the reactions are decided). */
  scenePendingMoves?: Record<string, import('./sceneActions.js').PendingMove[]>;
  /** APEX 0.7: the GM Merchant (stock, prices, gold). */
  merchant?: Merchant;
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
  action: 'generate' | 'give' | 'discard' | 'revoke' | 'currency' | 'lock' | 'identify' | 'reroll' | 'salvage' | 'combine' | 'augment' | 'ascend' | 'transmute' | 'activate' | 'draft' | 'trade';
  tokenId?: string;
  itemId?: string;
  itemName?: string;
  detail: string;
}

/** Who performs an action? */
export type Actor = { role: 'gm' } | { role: 'player'; tokenId: string };

