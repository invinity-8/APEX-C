/**
 * Fog of War, Wissen der Spieler und gefilterte Ansichten.
 *
 * WICHTIG: buildPlayerView() ist die einzige Stelle, an der entschieden wird,
 * was ein Spieler sehen darf. Im Online-Modus (Phase 2) läuft genau diese
 * Funktion auf dem Server – der Browser eines Spielers bekommt nie den GameState.
 */
import { hexKey, hexesInRange, type Axial, type HexKey } from './hex';
import type { TerrainType } from './terrain';
import { zoneStatus, type ZoneStatus } from './zone';
import type {
  GameState,
  Item,
  Knowledge,
  LogEntry,
  ShrinkConfig,
  Sighting,
  Site,
  Token,
  TokenKind,
  WillPool,
} from './types';

// ---------------- Grundfunktionen ----------------

export const effectiveVision = (t: Token): number => Math.max(0, t.visionRadius + t.visionBonus);

/** Felder im Sichtradius einer Figur (noch ohne Sichtlinien – siehe README "Erweiterungen"). */
export function visibleFrom(state: GameState, token: Token): Set<HexKey> {
  const result = new Set<HexKey>();
  for (const h of hexesInRange(token.pos, effectiveVision(token))) {
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
  /** null = unbekannt */
  terrain: TerrainType | null;
  fog: Fog;
  zone: ZoneStatus;
  siteId?: string;
}

export interface TokenDetails {
  movePoints: number;
  maxMovePoints: number;
  visionRadius: number;
  visionBonus: number;
  controllers: string[];
  sharesWithParty: boolean;
  will: WillPool;
  inventory: Item[];
}

export interface TokenView {
  id: string;
  name: string;
  kind: TokenKind;
  teamId: string;
  title: string;
  color: string;
  initials: string;
  pos: Axial;
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
  day: number;
  mapRadius: number;
  shrink: ShrinkConfig;
  hexes: HexView[];
  hexByKey: Record<HexKey, HexView>;
  tokens: TokenView[];
  teams: TeamView[];
  sites: SiteView[];
  trackers: TrackerView[];
  log: LogEntry[];
}

const detailsOf = (t: Token): TokenDetails => ({
  movePoints: t.movePoints,
  maxMovePoints: t.maxMovePoints,
  visionRadius: t.visionRadius,
  visionBonus: t.visionBonus,
  controllers: [...t.controllers],
  sharesWithParty: t.sharesWithParty,
  will: { ...t.will },
  inventory: t.inventory.map((i) => ({ ...i })),
});

const tokenView = (t: Token, withDetails: boolean): TokenView => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  teamId: t.teamId,
  title: t.title,
  color: t.color,
  initials: t.initials,
  pos: { ...t.pos },
  details: withDetails ? detailsOf(t) : undefined,
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
  }));
  const visibleToParty = new Set<HexKey>();
  for (const t of Object.values(state.tokens)) {
    if (t.kind === 'player') for (const k of visibleFrom(state, t)) visibleToParty.add(k);
  }
  return {
    role: 'gm',
    viewerId: null,
    day: state.day,
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
 * Bewusst NICHT enthalten: Seed, Gelände unerforschter Felder, versteckte Orte,
 * GM-Notizen, Rivalen außer Sicht, Events vor ihrem Eintreten, GM-Logeinträge.
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

  const hexes: HexView[] = Object.entries(state.hexes).map(([key, t]) => {
    const isVisible = visible.has(key);
    const remembered = explored[key];
    const terrain = isVisible ? t.terrain : (remembered ?? null);
    return {
      key,
      q: t.q,
      r: t.r,
      terrain,
      fog: isVisible ? 'visible' : remembered ? 'explored' : 'unexplored',
      zone: zoneStatus(state.config, state.day, t),
      siteId: t.siteId && siteIds.has(t.siteId) ? t.siteId : undefined,
    };
  });

  // Figuren: eigene Gruppe vollständig, Rivalen nur aktuell sichtbar bzw. vom GM enthüllt.
  const tokens: TokenView[] = [];
  for (const t of Object.values(state.tokens)) {
    if (groupIds.has(t.id)) tokens.push(tokenView(t, true));
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
    viewerId,
    day: state.day,
    mapRadius: state.config.mapRadius,
    shrink: { ...state.config.shrink },
    hexes,
    hexByKey: Object.fromEntries(hexes.map((h) => [h.key, h])),
    tokens,
    teams,
    sites,
    trackers: trackersOf(state),
    log: state.log.filter((e) => e.audience === 'all'),
  };
}
