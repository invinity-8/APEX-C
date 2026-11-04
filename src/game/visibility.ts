import type { Equipment } from './equipment.js';
/**
 * Fog of War, player knowledge and filtered views.
 *
 * IMPORTANT: buildPlayerView() is the single place that decides what a player may see.
 * In online mode it runs on the server – a player's browser never receives the GameState.
 * Player views contain ONLY explored/visible hexes, so the arena outline, radius and
 * undiscovered terrain cannot be inferred from the data.
 */
import { DIRECTIONS, add, hexKey, hexesInRange, type Axial, type HexKey } from './hex.js';
import type { TerrainType } from './terrain.js';
import { zoneStatus, type ZoneStatus } from './zone.js';
import type {
  GameState,
  HexFeature,
  Item,
  Knowledge,
  LogEntry,
  Phase,
  ShrinkConfig,
  Sighting,
  Site,
  Token,
  TokenKind,
  WillPool,
  InventoryContainer,
  MarkerStyle,
  Announcement,
  BodyType,
} from './types.js';
import { containersOf } from './inventory.js';
import { redactItem } from './items/instance.js';
import type { CurrencyId } from './items/currency.js';
import { itemRulesOf, type ItemRules } from './items/rules.js';

// ---------------- Grundfunktionen ----------------

/** Vision radius including the temporary bonus and the day/night modifier. */
export function effectiveVision(t: Token, state?: Pick<GameState, 'phase' | 'config'>): number {
  const base = Math.max(0, t.visionRadius + t.visionBonus);
  const rule = state?.config.phases?.[state.phase ?? 'day'];
  if (!rule || rule.visionModifier === 0) return base;
  return Math.max(Math.min(base, rule.minVision), base + rule.visionModifier);
}

/** Hexes within a character's vision (no line of sight yet – see README "Known limitations"). */
export function visibleFrom(state: GameState, token: Token): Set<HexKey> {
  const result = new Set<HexKey>();
  for (const h of hexesInRange(token.pos, effectiveVision(token, state))) {
    const k = hexKey(h);
    if (state.hexes[k]) result.add(k);
  }
  return result;
}

export const emptyKnowledge = (): Knowledge => ({ explored: {}, sightings: {}, sites: [] });

/** Die Figur selbst + alle Gruppenmitglieder, die ihr Wissen teilen. */
export function groupOf(state: GameState, viewerId: string): Token[] {
  const viewer = state.tokens[viewerId];
  if (!viewer) return [];
  const others = Object.values(state.tokens).filter(
    (t) => t.id !== viewerId && t.kind === 'player' && t.teamId === viewer.teamId && t.sharesWithParty,
  );
  return [viewer, ...others];
}

/** Ein Rivalenteam ist für Spieler entdeckbar, sofern es nicht vom GM verborgen wurde. */
const teamDetectable = (state: GameState, teamId: string) => state.teams[teamId]?.visibility !== 'hidden';

/**
 * Aktualisiert das Wissen einer Spielerfigur anhand ihrer aktuellen Sicht.
 * Mutiert `state` – nur innerhalb von Commands auf einer Kopie aufrufen.
 */
export function revealFor(state: GameState, tokenId: string): void {
  const token = state.tokens[tokenId];
  if (!token || token.kind !== 'player') return;
  const k = (state.knowledge[tokenId] ??= emptyKnowledge());
  const visible = visibleFrom(state, token);

  for (const key of visible) {
    const tile = state.hexes[key];
    k.explored[key] = tile.terrain;
    if (tile.siteId) {
      const site = state.sites[tile.siteId];
      if (site && site.visibility !== 'hidden' && !k.sites.includes(site.id)) k.sites.push(site.id);
    }
  }
  // Geländeaufklärung und Teamentdeckung sind getrennt: Teams werden als Sichtung gespeichert.
  for (const other of Object.values(state.tokens)) {
    if (other.kind !== 'rival') continue;
    if (visible.has(hexKey(other.pos)) && teamDetectable(state, other.teamId)) {
      k.sightings[other.teamId] = { pos: { ...other.pos }, day: state.day };
    }
  }
}

/** Aktualisiert das Wissen aller Spielerfiguren. */
export function refreshAllKnowledge(state: GameState): void {
  for (const t of Object.values(state.tokens)) if (t.kind === 'player') revealFor(state, t.id);
}

// ---------------- Ansichten (ViewModel) ----------------

export type Fog = 'unexplored' | 'explored' | 'visible';

export interface HexView {
  key: HexKey;
  q: number;
  r: number;
  /** null = unknown (only used in the GM party-vision overlay; player views omit unknown hexes). */
  terrain: TerrainType | null;
  fog: Fog;
  zone: ZoneStatus;
  siteId?: string;
  elevation?: number;
  feature?: HexFeature;
  /** Bitmask of DIRECTIONS that lead outside the arena (bit i = DIRECTIONS[i]). Only for known hexes. */
  edges?: number;
}

export interface TokenDetails {
  movePoints: number;
  maxMovePoints: number;
  speedFt?: number;
  visionRadius: number;
  visionBonus: number;
  controllers: string[];
  sharesWithParty: boolean;
  will: WillPool;
  /** Private: only the character's own player and the GM receive the inventory. */
  inventory: Item[];
  containers?: InventoryContainer[];
  /** APEX 0.5: private like the inventory (owner + GM only). */
  equipment?: Equipment;
  /** APEX 0.6: magical currency (owner + GM only). */
  currency?: Partial<Record<CurrencyId, number>>;
  currencyRev?: number;
  /** APEX 0.7 (owner + GM): last transmutation result, pending postponed turn, paper-doll silhouette. */
  lastTransmute?: { rev: number; result: Partial<Record<CurrencyId, number>> };
  timeTwist?: { itemId: string; itemName: string; day: number; phase: Phase };
  bodyType?: BodyType;
}

export interface TokenView {
  id: string;
  name: string;
  kind: TokenKind;
  teamId: string;
  title: string;
  /** The tagline was set by hand (never regenerated from imported data). */
  titleCustom?: boolean;
  color: string;
  initials: string;
  pos: Axial;
  /** Cosmetic appearance (APEX 0.4). */
  accent?: string;
  marker?: MarkerStyle;
  /** Portrait version (> 0 = a portrait exists; load it via op=portrait). */
  portraitV?: number;
  /** Nur für eigene/freigegebene Figuren bzw. den GM. */
  details?: TokenDetails;
}

export interface TeamView {
  id: string;
  name: string;
  kind: 'party' | 'rival';
  color: string;
  emblem: string;
  motto: string;
  currentlyVisible: boolean;
  lastSeen?: Sighting;
}

export type SiteView = Omit<Site, 'gmNotes' | 'visibility'> & { gmNotes?: string; visibility?: Site['visibility'] };

export interface TrackerView {
  teamId: string;
  teamName: string;
  pos: Axial;
  radius: number;
  mode: 'approx' | 'exact';
  day: number;
}

export interface ViewModel {
  role: 'gm' | 'player';
  viewerId: string | null;
  /** Active world (null for saves without world metadata). Commands carry it to reject stale actions. */
  worldId: string | null;
  worldName: string | null;
  day: number;
  phase: Phase;
  /** Only known to the GM. Players get null so the map size cannot be inferred. */
  mapRadius: number | null;
  shrink: ShrinkConfig;
  hexes: HexView[];
  hexByKey: Record<HexKey, HexView>;
  tokens: TokenView[];
  teams: TeamView[];
  sites: SiteView[];
  trackers: TrackerView[];
  log: LogEntry[];
  /** Arena Announcements (public by definition; the newest 20). */
  announcements: Announcement[];
  /** APEX 0.6: effective itemisation caps (public rules, needed for derived stats). */
  itemRules: ItemRules;
}

/** Which neighbour directions of `h` lie outside the arena? */
export function edgeMask(state: GameState, h: Axial): number {
  let mask = 0;
  DIRECTIONS.forEach((d, i) => {
    if (!state.hexes[hexKey(add(h, d))]) mask |= 1 << i;
  });
  return mask;
}

const detailsOf = (t: Token, withInventory = true, redact = false): TokenDetails => ({
  movePoints: t.movePoints,
  maxMovePoints: t.maxMovePoints,
  ...(t.speedFt ? { speedFt: t.speedFt } : {}),
  visionRadius: t.visionRadius,
  visionBonus: t.visionBonus,
  controllers: [...t.controllers],
  sharesWithParty: t.sharesWithParty,
  will: { ...t.will },
  inventory: withInventory ? t.inventory.map((i) => (redact ? redactItem({ ...i }) : structuredClone(i))) : [],
  containers: withInventory ? containersOf(t).map((c) => ({ ...c })) : undefined,
  equipment: withInventory && t.equipment ? structuredClone(t.equipment) : undefined,
  ...(withInventory ? { currency: { ...(t.currency ?? {}) }, currencyRev: t.currencyRev ?? 0 } : {}),
  ...(withInventory && t.lastTransmute ? { lastTransmute: structuredClone(t.lastTransmute) } : {}),
  ...(withInventory && t.timeTwist ? { timeTwist: { ...t.timeTwist } } : {}),
  ...(withInventory && t.bodyType ? { bodyType: t.bodyType } : {}),
});

const tokenView = (t: Token, withDetails: boolean, withInventory = true, redact = false): TokenView => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  teamId: t.teamId,
  title: t.title,
  ...(t.titleCustom ? { titleCustom: true } : {}),
  color: t.color,
  initials: t.initials,
  pos: { ...t.pos },
  ...(t.accent ? { accent: t.accent } : {}),
  ...(t.marker ? { marker: t.marker } : {}),
  ...(t.portrait ? { portraitV: t.portrait.v } : {}),
  details: withDetails ? detailsOf(t, withInventory, redact) : undefined,
});

/** Vollansicht für den Spielleiter. */
export function buildGmView(state: GameState): ViewModel {
  const hexes: HexView[] = Object.entries(state.hexes).map(([key, t]) => ({
    key,
    q: t.q,
    r: t.r,
    terrain: t.terrain,
    fog: 'visible',
    zone: zoneStatus(state.config, state.day, t),
    siteId: t.siteId,
    elevation: t.elevation,
    feature: t.feature,
    edges: edgeMask(state, t) || undefined,
  }));
  const visibleToParty = new Set<HexKey>();
  for (const t of Object.values(state.tokens)) {
    if (t.kind === 'player') for (const k of visibleFrom(state, t)) visibleToParty.add(k);
  }
  return {
    role: 'gm',
    viewerId: null,
    worldId: state.world?.id ?? null,
    worldName: state.world?.name ?? null,
    day: state.day,
    phase: state.phase,
    mapRadius: state.config.mapRadius,
    shrink: { ...state.config.shrink },
    hexes,
    hexByKey: Object.fromEntries(hexes.map((h) => [h.key, h])),
    tokens: Object.values(state.tokens).map((t) => tokenView(t, true)),
    teams: Object.values(state.teams).map((team) => ({
      id: team.id,
      name: team.name,
      kind: team.kind,
      color: team.color,
      emblem: team.emblem,
      motto: team.motto,
      currentlyVisible:
        team.kind === 'party' ||
        Object.values(state.tokens).some((t) => t.teamId === team.id && visibleToParty.has(hexKey(t.pos))),
    })),
    sites: Object.values(state.sites).map((s) => ({ ...s })),
    trackers: trackersOf(state),
    log: state.log.slice(),
    announcements: (state.announcements ?? []).slice(-20),
    itemRules: itemRulesOf(state),
  };
}

function trackersOf(state: GameState): TrackerView[] {
  return Object.values(state.teams)
    .filter((t) => t.tracking)
    .map((t) => ({
      teamId: t.id,
      teamName: t.name,
      pos: { ...t.tracking!.pos },
      radius: t.tracking!.radius,
      mode: t.tracking!.mode,
      day: t.tracking!.day,
    }));
}

/**
 * Gefilterte Ansicht für eine Spielerfigur. Enthält ausschließlich Informationen,
 * die diese Figur (bzw. ihre teilende Gruppe) kennen darf.
 * Deliberately NOT included: seed, map radius, unexplored hexes (not even their
 * coordinates), hidden sites, GM notes, rivals out of sight, events before they
 * happen, GM-only log entries.
 */
export function buildPlayerView(state: GameState, viewerId: string): ViewModel {
  const group = groupOf(state, viewerId);
  const groupIds = new Set(group.map((t) => t.id));

  // Wissen der Gruppe zusammenführen.
  const explored: Record<HexKey, TerrainType> = {};
  const sightings: Record<string, Sighting> = {};
  const knownSites = new Set<string>();
  for (const t of group) {
    const k = state.knowledge[t.id] ?? emptyKnowledge();
    Object.assign(explored, k.explored);
    for (const [teamId, s] of Object.entries(k.sightings)) {
      if (!sightings[teamId] || sightings[teamId].day <= s.day) sightings[teamId] = s;
    }
    k.sites.forEach((id) => knownSites.add(id));
  }
  const visible = new Set<HexKey>();
  for (const t of group) for (const k of visibleFrom(state, t)) visible.add(k);

  // Orte: öffentlich oder entdeckt (und nicht nachträglich versteckt).
  const sites: SiteView[] = Object.values(state.sites)
    .filter((s) => s.visibility === 'public' || (s.visibility === 'onSight' && knownSites.has(s.id)))
    .map(({ gmNotes: _gm, visibility: _v, ...rest }) => ({ ...rest, pos: { ...rest.pos } }));
  const siteIds = new Set(sites.map((s) => s.id));

  const hexes: HexView[] = [];
  for (const [key, t] of Object.entries(state.hexes)) {
    const isVisible = visible.has(key);
    const remembered = explored[key];
    if (!isVisible && !remembered) continue; // unknown hexes are never sent
    const hv: HexView = {
      key,
      q: t.q,
      r: t.r,
      terrain: isVisible ? t.terrain : remembered,
      fog: isVisible ? 'visible' : 'explored',
      zone: zoneStatus(state.config, state.day, t),
    };
    if (t.siteId && siteIds.has(t.siteId)) hv.siteId = t.siteId;
    if (t.elevation !== undefined) hv.elevation = t.elevation;
    if (t.feature) hv.feature = t.feature;
    const edges = edgeMask(state, t);
    if (edges) hv.edges = edges;
    hexes.push(hv);
  }

  // Figuren: eigene Gruppe vollständig, Rivalen nur aktuell sichtbar bzw. vom GM enthüllt.
  const tokens: TokenView[] = [];
  for (const t of Object.values(state.tokens)) {
    // Party members' movement/Will stay shared, but inventories are private to their owner.
    if (groupIds.has(t.id)) tokens.push(tokenView(t, true, t.id === viewerId, true));
    else if (t.kind === 'rival') {
      const team = state.teams[t.teamId];
      const seen = team?.visibility === 'revealed' || (team?.visibility === 'auto' && visible.has(hexKey(t.pos)));
      if (seen) tokens.push(tokenView(t, false));
    }
  }
  const visibleTeamIds = new Set(tokens.map((t) => t.teamId));

  const viewer = state.tokens[viewerId];
  const teams: TeamView[] = Object.values(state.teams)
    .filter(
      (team) =>
        (viewer && team.id === viewer.teamId) ||
        sightings[team.id] ||
        visibleTeamIds.has(team.id) ||
        team.tracking,
    )
    .map((team) => ({
      id: team.id,
      name: team.name,
      kind: team.kind,
      color: team.color,
      emblem: team.emblem,
      motto: team.motto,
      currentlyVisible: visibleTeamIds.has(team.id),
      lastSeen: sightings[team.id] ? { pos: { ...sightings[team.id].pos }, day: sightings[team.id].day } : undefined,
    }));

  return {
    role: 'player',
    worldId: state.world?.id ?? null,
    worldName: state.world?.name ?? null,
    viewerId,
    day: state.day,
    phase: state.phase,
    mapRadius: null,
    shrink: { ...state.config.shrink },
    hexes,
    hexByKey: Object.fromEntries(hexes.map((h) => [h.key, h])),
    tokens,
    teams,
    sites,
    trackers: trackersOf(state),
    log: state.log.filter((e) => e.audience === 'all'),
    announcements: (state.announcements ?? []).slice(-20),
    itemRules: itemRulesOf(state),
  };
}
