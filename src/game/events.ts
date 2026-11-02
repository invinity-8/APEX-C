/**
 * Arena events (APEX 0.4 – the GM has the final word).
 *
 * Rules
 *  - When an event becomes due (its day/phase begins, or a postponed date is reached) the system only
 *    marks it `awaiting` and notes it in the GM log. NO effect is applied.
 *  - Effects are applied only by an explicit GM approval (`decideEvent` approve, or a manual trigger of an
 *    eligible event) – exactly once; the event becomes `done`.
 *  - Reject: no effect, the event never fires again. Postpone: becomes `awaiting` again at the next phase or day.
 *  - Advancing day/night never applies, discards or regenerates awaiting events; they stay awaiting until decided.
 *    An event approved later takes effect at the moment of approval (e.g. a movement-point change applies to the
 *    current points, not retroactively at dawn).
 * New effect types: add them to types.ts (EventEffect) and handle them in applyEvent / previewEvent.
 */
import { TERRAIN } from './terrain.js';
import { addLog } from './log.js';
import { T } from './text.js';
import type { Announcement, AnnouncementCategory, ArenaEvent, GameState, Phase } from './types.js';

const occupied = (state: GameState, key: string) => Object.values(state.tokens).some((t) => `${t.pos.q},${t.pos.r}` === key);

/** Can the GM trigger / approve this event now? */
export const eventEligible = (ev: ArenaEvent | undefined) => !!ev && (ev.status === 'pending' || ev.status === 'awaiting' || ev.status === 'postponed');

/** Applies the effects (after GM approval). Mutates `state`. Returns false if the event cannot be triggered. */
export function applyEvent(state: GameState, eventId: string): boolean {
  const ev = state.events[eventId];
  if (!eventEligible(ev)) return false;

  for (const effect of ev.effects) {
    switch (effect.type) {
      case 'setTerrain':
        for (const key of ev.hexes) {
          const tile = state.hexes[key];
          // Sites and occupied hexes are spared so nobody ends up "inside a lake".
          if (tile && !tile.siteId && !occupied(state, key)) tile.terrain = effect.terrain;
        }
        break;
      case 'revealSite': {
        const site = state.sites[effect.siteId];
        if (site) site.visibility = 'public';
        break;
      }
      case 'modifyMovePoints':
        for (const t of Object.values(state.tokens)) {
          if (t.kind === 'player') t.movePoints = Math.max(0, t.movePoints + effect.amount);
        }
        break;
    }
  }
  ev.status = 'done';
  ev.decidedAt = { day: state.day, phase: state.phase, decision: 'approved' };
  delete ev.postponedTo;
  const terrainNote = ev.effects.find((e) => e.type === 'setTerrain');
  addLog(
    state,
    'event',
    T.logEvent(ev.name, ev.description, terrainNote && terrainNote.type === 'setTerrain' ? T.eventTerrainNote(ev.hexes.length, TERRAIN[terrainNote.terrain].label) : undefined),
    ev.announce ? 'all' : 'gm',
  );
  if (ev.announce) addAnnouncement(state, { category: 'world', title: ev.name, text: ev.description });
  return true;
}

/** Is this event (scheduled or postponed) due when `phase` of `day` begins? */
export function firesAt(ev: ArenaEvent, day: number, phase: Phase): boolean {
  if (ev.status === 'postponed' && ev.postponedTo) {
    return day > ev.postponedTo.day || (day === ev.postponedTo.day && (phase === ev.postponedTo.phase || phase === 'night'));
  }
  if (ev.status !== 'pending') return false;
  if (ev.trigger.type === 'day') return phase === 'day' && ev.trigger.day === day;
  if (ev.trigger.type === 'phase') return ev.trigger.day === day && ev.trigger.phase === phase;
  return false;
}

/** Marks due events as awaiting the GM's decision (idempotent – an awaiting event is never prepared twice). */
export function markDueEvents(state: GameState): void {
  for (const ev of Object.values(state.events)) {
    if (!firesAt(ev, state.day, state.phase)) continue;
    ev.status = 'awaiting';
    ev.dueAt = { day: state.day, phase: state.phase };
    delete ev.postponedTo;
    addLog(state, 'gm', T.logEventAwaiting(ev.name), 'gm');
  }
}

export function rejectEvent(state: GameState, eventId: string): boolean {
  const ev = state.events[eventId];
  if (!eventEligible(ev)) return false;
  ev.status = 'rejected';
  ev.decidedAt = { day: state.day, phase: state.phase, decision: 'rejected' };
  delete ev.postponedTo;
  addLog(state, 'gm', T.logEventRejected(ev.name), 'gm');
  return true;
}

export function postponeEvent(state: GameState, eventId: string, until: 'nextPhase' | 'nextDay'): boolean {
  const ev = state.events[eventId];
  if (!eventEligible(ev)) return false;
  ev.status = 'postponed';
  ev.postponedTo =
    until === 'nextDay' ? { day: state.day + 1, phase: 'day' } : state.phase === 'day' ? { day: state.day, phase: 'night' } : { day: state.day + 1, phase: 'day' };
  addLog(state, 'gm', T.logEventPostponed(ev.name), 'gm');
  return true;
}

export interface EventPreview {
  /** Hexes whose terrain would change (sites and occupied hexes are spared). */
  terrainChanges: number;
  terrainTo: string | null;
  spared: number;
  /** Characters affected (standing on affected hexes, or all players for movement effects). */
  characters: string[];
  sites: string[];
  movePoints: number | null;
}

/** What approving the event would change – for the GM's review (pure). */
export function previewEvent(state: GameState, ev: ArenaEvent): EventPreview {
  const p: EventPreview = { terrainChanges: 0, terrainTo: null, spared: 0, characters: [], sites: [], movePoints: null };
  const chars = new Set<string>();
  for (const e of ev.effects) {
    if (e.type === 'setTerrain') {
      p.terrainTo = TERRAIN[e.terrain].label;
      for (const key of ev.hexes) {
        const tile = state.hexes[key];
        if (!tile) continue;
        if (tile.siteId || occupied(state, key)) p.spared++;
        else if (tile.terrain !== e.terrain) p.terrainChanges++;
        for (const t of Object.values(state.tokens)) {
          const near = Math.abs(t.pos.q - tile.q) + Math.abs(t.pos.r - tile.r) + Math.abs(-t.pos.q - t.pos.r + tile.q + tile.r) <= 2;
          if (near && t.kind === 'player') chars.add(t.name);
        }
      }
    } else if (e.type === 'revealSite') {
      const site = state.sites[e.siteId];
      if (site) p.sites.push(site.name);
    } else if (e.type === 'modifyMovePoints') {
      p.movePoints = (p.movePoints ?? 0) + e.amount;
      for (const t of Object.values(state.tokens)) if (t.kind === 'player') chars.add(t.name);
    }
  }
  p.characters = [...chars];
  return p;
}

export const ANNOUNCEMENT_LIMIT = 50;

export function addAnnouncement(state: GameState, a: { category: AnnouncementCategory; title: string; text: string }, now = new Date()): Announcement {
  const list = (state.announcements ??= []);
  const ann: Announcement = {
    id: `ann-${state.day}-${list.length}-${now.getTime().toString(36)}`,
    category: a.category,
    title: a.title.trim().slice(0, 80),
    text: a.text.trim().slice(0, 500),
    createdAt: now.toISOString(),
    day: state.day,
    phase: state.phase,
  };
  list.push(ann);
  if (list.length > ANNOUNCEMENT_LIMIT) list.splice(0, list.length - ANNOUNCEMENT_LIMIT);
  return ann;
}
