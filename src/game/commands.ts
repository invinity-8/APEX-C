/**
 * Commands: the ONLY way to change the game state.
 *
 * Every action (moving, advancing time, GM settings …) is a command.
 * executeCommand() checks permissions, applies the rules and returns a NEW
 * game state (the previous one is never mutated).
 *
 * In online mode the browser only sends commands to the server, which runs
 * exactly this function. Players therefore cannot cheat.
 */
import { equals, hexKey, hexesInRange, type Axial, type HexKey } from './hex.js';
import { addLog } from './log.js';
import { findPath, type BlockCheck, type TerrainLookup } from './movement.js';
import { advanceDay, advancePhase } from './day.js';
import { applyEvent } from './events.js';
import { stringHash } from './rng.js';
import { TERRAIN } from './terrain.js';
import { T, fmt, phaseName } from './text.js';
import { groupOf, refreshAllKnowledge, revealFor, visibleFrom } from './visibility.js';
import { zoneStatus } from './zone.js';
import type { Actor, GameState, Phase, SiteVisibility, TeamStrategy, TeamVisibility } from './types.js';

export { fmt };

export type Command =
  | { type: 'move'; tokenId: string; to: Axial }
  | { type: 'place'; tokenId: string; to: Axial }
  | { type: 'endDay' }
  | { type: 'advancePhase' }
  | { type: 'setDay'; day: number; phase?: Phase }
  | { type: 'adjustMovePoints'; tokenId: string; delta: number }
  | { type: 'adjustMaxMovePoints'; tokenId: string; delta: number }
  | { type: 'adjustVisionRadius'; tokenId: string; delta: number }
  | { type: 'adjustVisionBonus'; tokenId: string; delta: number }
  | { type: 'toggleShare'; tokenId: string }
  | { type: 'toggleController'; tokenId: string; controllerId: string }
  | { type: 'setTeamVisibility'; teamId: string; visibility: TeamVisibility }
  | { type: 'setTeamStrategy'; teamId: string; strategy: TeamStrategy }
  | { type: 'setTracking'; teamId: string; mode: 'none' | 'approx' | 'exact' }
  | { type: 'setSiteVisibility'; siteId: string; visibility: SiteVisibility }
  | { type: 'triggerEvent'; eventId: string }
  | { type: 'setShrink'; enabled?: boolean; mode?: 'danger' | 'closed' };

export type CommandResult =
  | { ok: true; state: GameState; message?: string }
  | { ok: false; state: GameState; error: string };

const fail = (state: GameState, error: string): CommandResult => ({ ok: false, state, error });

/** May this actor move the character? */
export function canControl(state: GameState, actor: Actor, tokenId: string): boolean {
  if (actor.role === 'gm') return true;
  const token = state.tokens[tokenId];
  if (!token || token.kind !== 'player') return false;
  return token.id === actor.tokenId || token.controllers.includes(actor.tokenId);
}

/** Which hexes does the actor know (players: explored or visible)? */
export function knownLookup(state: GameState, actor: Actor): TerrainLookup {
  if (actor.role === 'gm') return (k) => state.hexes[k]?.terrain;
  const known = new Set<HexKey>();
  for (const t of groupOf(state, actor.tokenId)) {
    Object.keys(state.knowledge[t.id]?.explored ?? {}).forEach((k) => known.add(k));
    visibleFrom(state, t).forEach((k) => known.add(k));
  }
  return (k) => (known.has(k) ? state.hexes[k]?.terrain : undefined);
}

export function zoneBlock(state: GameState): BlockCheck {
  return (k) => {
    const t = state.hexes[k];
    return t && zoneStatus(state.config, state.day, t) === 'closed' ? T.closedZoneShort : null;
  };
}

export type MoveCheck = { ok: true; path: Axial[]; cost: number } | { ok: false; reason: string };

/** Validates a move and explains in plain words why it is not possible. */
export function validateMove(state: GameState, actor: Actor, tokenId: string, to: Axial): MoveCheck {
  const token = state.tokens[tokenId];
  if (!token) return { ok: false, reason: T.noSuchToken };
  if (!canControl(state, actor, tokenId)) {
    return { ok: false, reason: T.notYourToken(token.name) };
  }
  const key = hexKey(to);
  const tile = state.hexes[key];
  if (!tile) return { ok: false, reason: T.outsideArena };
  if (equals(token.pos, to)) return { ok: false, reason: T.alreadyHere(token.name) };

  const lookup = knownLookup(state, actor);
  if (lookup(key) === undefined) {
    return { ok: false, reason: T.unexplored };
  }
  const def = TERRAIN[tile.terrain];
  if (def.cost === null) return { ok: false, reason: T.impassable(def.label) };
  if (zoneStatus(state.config, state.day, to) === 'closed') {
    return { ok: false, reason: T.closedZone };
  }

  const result = findPath(token.pos, to, lookup, zoneBlock(state));
  if (!result) {
    return {
      ok: false,
      reason: actor.role === 'gm' ? T.noPathGm : T.noPathPlayer,
    };
  }
  if (result.cost > token.movePoints + 1e-9) {
    return { ok: false, reason: T.notEnoughMp(result.cost, token.name, token.movePoints) };
  }
  return { ok: true, path: result.path, cost: result.cost };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Executes a command. The given state is never mutated. */
export function executeCommand(prev: GameState, actor: Actor, cmd: Command): CommandResult {
  const gmOnly = cmd.type !== 'move';
  if (gmOnly && actor.role !== 'gm') return fail(prev, T.gmOnly);

  const state: GameState = structuredClone(prev);

  switch (cmd.type) {
    case 'move': {
      const check = validateMove(state, actor, cmd.tokenId, cmd.to);
      if (!check.ok) return fail(prev, check.reason);
      const token = state.tokens[cmd.tokenId];
      // Move step by step so that terrain along the way is revealed too.
      for (const step of check.path) {
        token.pos = { ...step };
        revealFor(state, token.id);
      }
      token.movePoints = Math.max(0, token.movePoints - check.cost);
      addLog(
        state,
        'move',
        T.logMove(token.name, check.path.length, check.cost, token.movePoints),
        token.kind === 'player' ? 'all' : 'gm',
      );
      break;
    }
    case 'place': {
      const token = state.tokens[cmd.tokenId];
      if (!token) return fail(prev, T.noSuchToken);
      if (!state.hexes[hexKey(cmd.to)]) return fail(prev, T.outsideArena);
      token.pos = { ...cmd.to };
      addLog(state, 'gm', T.logPlace(token.name, cmd.to.q, cmd.to.r), 'gm');
      break;
    }
    case 'endDay':
      advanceDay(state);
      break;
    case 'advancePhase':
      advancePhase(state);
      break;
    case 'setDay':
      // Correction tool: changes only the clock, without dawn/nightfall effects.
      state.day = clamp(Math.round(cmd.day), 1, 999);
      if (cmd.phase) state.phase = cmd.phase;
      addLog(state, 'gm', T.logSetDay(phaseName(state.phase, state.day)), 'gm');
      break;
    case 'adjustMovePoints': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.movePoints = clamp(t.movePoints + cmd.delta, 0, 99);
      break;
    }
    case 'adjustMaxMovePoints': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.maxMovePoints = clamp(t.maxMovePoints + cmd.delta, 0, 99);
      break;
    }
    case 'adjustVisionRadius': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.visionRadius = clamp(t.visionRadius + cmd.delta, 0, 12);
      break;
    }
    case 'adjustVisionBonus': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, T.noSuchToken);
      t.visionBonus = clamp(t.visionBonus + cmd.delta, -t.visionRadius, 12);
      break;
    }
    case 'toggleShare': {
      const t = state.tokens[cmd.tokenId];
      if (!t || t.kind !== 'player') return fail(prev, T.onlyPlayersShare);
      t.sharesWithParty = !t.sharesWithParty;
      break;
    }
    case 'toggleController': {
      const t = state.tokens[cmd.tokenId];
      if (!t || t.kind !== 'player') return fail(prev, T.onlyPlayersControllers);
      if (cmd.controllerId === t.id) return fail(prev, T.controlsItself);
      if (state.tokens[cmd.controllerId]?.kind !== 'player') return fail(prev, T.noSuchToken);
      t.controllers = t.controllers.includes(cmd.controllerId)
        ? t.controllers.filter((c) => c !== cmd.controllerId)
        : [...t.controllers, cmd.controllerId];
      break;
    }
    case 'setTeamVisibility': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, T.noSuchTeam);
      team.visibility = cmd.visibility;
      addLog(state, 'gm', T.logTeamVisibility(team.name, cmd.visibility), 'gm');
      break;
    }
    case 'setTeamStrategy': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, T.noSuchTeam);
      team.strategy = cmd.strategy;
      break;
    }
    case 'setTracking': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, T.noSuchTeam);
      if (cmd.mode === 'none') {
        team.tracking = null;
        addLog(state, 'gm', T.logTrackLost(team.name), 'gm');
        break;
      }
      const leader = Object.values(state.tokens).find((t) => t.teamId === team.id);
      if (!leader) return fail(prev, T.teamNotOnMap);
      let pos = { ...leader.pos };
      let radius = 0;
      if (cmd.mode === 'approx') {
        // Approximate marker: random but reproducible, within 2 hexes of the true position.
        radius = 2;
        const options = hexesInRange(leader.pos, radius).filter((h) => state.hexes[hexKey(h)]);
        pos = options[stringHash(`${team.id}:${state.day}`) % options.length];
      }
      team.tracking = { mode: cmd.mode, pos, radius, day: state.day };
      addLog(
        state,
        'event',
        cmd.mode === 'exact'
          ? T.logTrackExact(team.name)
          : T.logTrackApprox(team.name),
      );
      break;
    }
    case 'setSiteVisibility': {
      const site = state.sites[cmd.siteId];
      if (!site) return fail(prev, T.noSuchSite);
      site.visibility = cmd.visibility;
      if (cmd.visibility === 'public') addLog(state, 'event', T.logSitePublic(site.name));
      break;
    }
    case 'triggerEvent':
      if (!state.events[cmd.eventId]) return fail(prev, T.noSuchEvent);
      if (!applyEvent(state, cmd.eventId)) return fail(prev, T.eventDone);
      break;
    case 'setShrink':
      if (cmd.enabled !== undefined) state.config.shrink.enabled = cmd.enabled;
      if (cmd.mode !== undefined) state.config.shrink.mode = cmd.mode;
      break;
  }

  refreshAllKnowledge(state);
  return { ok: true, state };
}
