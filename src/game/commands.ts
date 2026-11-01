/**
 * Commands: die EINZIGE Art, den Spielstand zu verändern.
 *
 * Jede Aktion (Bewegen, Tageswechsel, GM-Einstellungen …) ist ein Command.
 * executeCommand() prüft Berechtigungen, wendet Regeln an und liefert einen
 * NEUEN Spielstand zurück (der alte bleibt unverändert).
 *
 * Im Online-Modus (Phase 2) schickt der Browser nur noch Commands an den Server,
 * der genau diese Funktion ausführt. Dadurch können Spieler nicht schummeln.
 */
import { equals, hexKey, hexesInRange, type Axial, type HexKey } from './hex';
import { addLog } from './log';
import { findPath, type BlockCheck, type TerrainLookup } from './movement';
import { advanceDay } from './day';
import { applyEvent } from './events';
import { stringHash } from './rng';
import { TERRAIN } from './terrain';
import { groupOf, refreshAllKnowledge, revealFor, visibleFrom } from './visibility';
import { zoneStatus } from './zone';
import type { Actor, GameState, SiteVisibility, TeamStrategy, TeamVisibility } from './types';

export type Command =
  | { type: 'move'; tokenId: string; to: Axial }
  | { type: 'place'; tokenId: string; to: Axial }
  | { type: 'endDay' }
  | { type: 'setDay'; day: number }
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

/** Darf dieser Akteur die Figur bewegen? */
export function canControl(state: GameState, actor: Actor, tokenId: string): boolean {
  if (actor.role === 'gm') return true;
  const token = state.tokens[tokenId];
  if (!token || token.kind !== 'player') return false;
  return token.id === actor.tokenId || token.controllers.includes(actor.tokenId);
}

/** Welche Felder kennt der Akteur (für Spieler: erforscht oder sichtbar)? */
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
    return t && zoneStatus(state.config, state.day, t) === 'closed' ? 'Gesperrte Zone' : null;
  };
}

export type MoveCheck = { ok: true; path: Axial[]; cost: number } | { ok: false; reason: string };

/** Prüft eine Bewegung und erklärt verständlich, warum sie ggf. nicht geht. */
export function validateMove(state: GameState, actor: Actor, tokenId: string, to: Axial): MoveCheck {
  const token = state.tokens[tokenId];
  if (!token) return { ok: false, reason: 'Diese Figur existiert nicht.' };
  if (!canControl(state, actor, tokenId)) {
    return { ok: false, reason: `Du darfst ${token.name} nicht bewegen – nur deine eigene Figur.` };
  }
  const key = hexKey(to);
  const tile = state.hexes[key];
  if (!tile) return { ok: false, reason: 'Dieses Feld liegt außerhalb der Arena.' };
  if (equals(token.pos, to)) return { ok: false, reason: `${token.name} steht bereits hier.` };

  const lookup = knownLookup(state, actor);
  if (lookup(key) === undefined) {
    return { ok: false, reason: 'Unerforschtes Gelände – erkunde zuerst die Umgebung.' };
  }
  const def = TERRAIN[tile.terrain];
  if (def.cost === null) return { ok: false, reason: `${def.label} ist nicht passierbar.` };
  if (zoneStatus(state.config, state.day, to) === 'closed') {
    return { ok: false, reason: 'Dieses Feld liegt in der gesperrten Zone der schrumpfenden Arena.' };
  }

  const result = findPath(token.pos, to, lookup, zoneBlock(state));
  if (!result) {
    return {
      ok: false,
      reason:
        actor.role === 'gm'
          ? 'Es gibt keinen begehbaren Weg dorthin. (Tipp: "Frei platzieren" nutzen.)'
          : 'Es gibt keinen bekannten, begehbaren Weg dorthin.',
    };
  }
  if (result.cost > token.movePoints + 1e-9) {
    return {
      ok: false,
      reason: `Zu wenig Bewegungspunkte: Der Weg kostet ${fmt(result.cost)} BP, ${token.name} hat noch ${fmt(token.movePoints)} BP.`,
    };
  }
  return { ok: true, path: result.path, cost: result.cost };
}

export const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Führt einen Command aus. Der übergebene Zustand wird nie verändert. */
export function executeCommand(prev: GameState, actor: Actor, cmd: Command): CommandResult {
  const gmOnly = cmd.type !== 'move';
  if (gmOnly && actor.role !== 'gm') return fail(prev, 'Nur der Spielleiter darf das.');

  const state: GameState = structuredClone(prev);

  switch (cmd.type) {
    case 'move': {
      const check = validateMove(state, actor, cmd.tokenId, cmd.to);
      if (!check.ok) return fail(prev, check.reason);
      const token = state.tokens[cmd.tokenId];
      // Schritt für Schritt bewegen, damit auch unterwegs aufgeklärt wird.
      for (const step of check.path) {
        token.pos = { ...step };
        revealFor(state, token.id);
      }
      token.movePoints = Math.max(0, token.movePoints - check.cost);
      addLog(
        state,
        'move',
        `${token.name} zieht ${check.path.length} Feld${check.path.length === 1 ? '' : 'er'} weit (−${fmt(check.cost)} BP, Rest ${fmt(token.movePoints)}).`,
        token.kind === 'player' ? 'all' : 'gm',
      );
      break;
    }
    case 'place': {
      const token = state.tokens[cmd.tokenId];
      if (!token) return fail(prev, 'Diese Figur existiert nicht.');
      if (!state.hexes[hexKey(cmd.to)]) return fail(prev, 'Dieses Feld liegt außerhalb der Arena.');
      token.pos = { ...cmd.to };
      addLog(state, 'gm', `GM platziert ${token.name} frei auf (${cmd.to.q}|${cmd.to.r}).`, 'gm');
      break;
    }
    case 'endDay':
      advanceDay(state);
      break;
    case 'setDay':
      state.day = clamp(Math.round(cmd.day), 1, 999);
      addLog(state, 'gm', `GM setzt den Arenatag auf ${state.day}.`, 'gm');
      break;
    case 'adjustMovePoints': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, 'Diese Figur existiert nicht.');
      t.movePoints = clamp(t.movePoints + cmd.delta, 0, 99);
      break;
    }
    case 'adjustMaxMovePoints': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, 'Diese Figur existiert nicht.');
      t.maxMovePoints = clamp(t.maxMovePoints + cmd.delta, 0, 99);
      break;
    }
    case 'adjustVisionRadius': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, 'Diese Figur existiert nicht.');
      t.visionRadius = clamp(t.visionRadius + cmd.delta, 0, 12);
      break;
    }
    case 'adjustVisionBonus': {
      const t = state.tokens[cmd.tokenId];
      if (!t) return fail(prev, 'Diese Figur existiert nicht.');
      t.visionBonus = clamp(t.visionBonus + cmd.delta, -t.visionRadius, 12);
      break;
    }
    case 'toggleShare': {
      const t = state.tokens[cmd.tokenId];
      if (!t || t.kind !== 'player') return fail(prev, 'Nur Spielerfiguren können Wissen teilen.');
      t.sharesWithParty = !t.sharesWithParty;
      break;
    }
    case 'toggleController': {
      const t = state.tokens[cmd.tokenId];
      if (!t || t.kind !== 'player') return fail(prev, 'Nur Spielerfiguren haben Steuerrechte.');
      if (cmd.controllerId === t.id) return fail(prev, 'Eine Figur steuert sich immer selbst.');
      t.controllers = t.controllers.includes(cmd.controllerId)
        ? t.controllers.filter((c) => c !== cmd.controllerId)
        : [...t.controllers, cmd.controllerId];
      break;
    }
    case 'setTeamVisibility': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, 'Dieses Team existiert nicht.');
      team.visibility = cmd.visibility;
      addLog(state, 'gm', `Sichtbarkeit von ${team.name}: ${cmd.visibility}.`, 'gm');
      break;
    }
    case 'setTeamStrategy': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, 'Dieses Team existiert nicht.');
      team.strategy = cmd.strategy;
      break;
    }
    case 'setTracking': {
      const team = state.teams[cmd.teamId];
      if (!team) return fail(prev, 'Dieses Team existiert nicht.');
      if (cmd.mode === 'none') {
        team.tracking = null;
        addLog(state, 'gm', `Spur von ${team.name} verloren.`, 'gm');
        break;
      }
      const leader = Object.values(state.tokens).find((t) => t.teamId === team.id);
      if (!leader) return fail(prev, 'Dieses Team hat keine Figur auf der Karte.');
      let pos = { ...leader.pos };
      let radius = 0;
      if (cmd.mode === 'approx') {
        // Ungenauer Marker: zufällig, aber reproduzierbar, innerhalb von 2 Feldern um die echte Position.
        radius = 2;
        const options = hexesInRange(leader.pos, radius).filter((h) => state.hexes[hexKey(h)]);
        pos = options[stringHash(`${team.id}:${state.day}`) % options.length];
      }
      team.tracking = { mode: cmd.mode, pos, radius, day: state.day };
      addLog(
        state,
        'event',
        cmd.mode === 'exact'
          ? `🔴 Die Gruppe hat die Spur von ${team.name} aufgenommen – genaue Position markiert.`
          : `🔴 Die Gruppe spürt ${team.name} ungefähr auf – irgendwo im markierten Bereich.`,
      );
      break;
    }
    case 'setSiteVisibility': {
      const site = state.sites[cmd.siteId];
      if (!site) return fail(prev, 'Dieser Ort existiert nicht.');
      site.visibility = cmd.visibility;
      if (cmd.visibility === 'public') addLog(state, 'event', `📜 Ein neuer Ort wird bekannt: ${site.name}.`);
      break;
    }
    case 'triggerEvent':
      if (!applyEvent(state, cmd.eventId)) return fail(prev, 'Dieses Event wurde bereits ausgelöst.');
      break;
    case 'setShrink':
      if (cmd.enabled !== undefined) state.config.shrink.enabled = cmd.enabled;
      if (cmd.mode !== undefined) state.config.shrink.mode = cmd.mode;
      break;
  }

  refreshAllKnowledge(state);
  return { ok: true, state };
}
