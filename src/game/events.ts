/**
 * Arena events: apply their effects to the game state.
 * New effect types: add them to types.ts (EventEffect) and handle them here.
 */
import { TERRAIN } from './terrain.js';
import { addLog } from './log.js';
import { T } from './text.js';
import type { ArenaEvent, GameState, Phase } from './types.js';

/** Mutates `state`. Returns false if the event cannot be triggered (any more). */
export function applyEvent(state: GameState, eventId: string): boolean {
  const ev = state.events[eventId];
  if (!ev || ev.status === 'done') return false;

  for (const effect of ev.effects) {
    switch (effect.type) {
      case 'setTerrain':
        for (const key of ev.hexes) {
          const tile = state.hexes[key];
          // Sites and occupied hexes are spared so nobody ends up "inside a lake".
          const occupied = Object.values(state.tokens).some((t) => `${t.pos.q},${t.pos.r}` === key);
          if (tile && !tile.siteId && !occupied) tile.terrain = effect.terrain;
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
  const terrainNote = ev.effects.find((e) => e.type === 'setTerrain');
  addLog(
    state,
    'event',
    T.logEvent(
      ev.name,
      ev.description,
      terrainNote && terrainNote.type === 'setTerrain' ? T.eventTerrainNote(ev.hexes.length, TERRAIN[terrainNote.terrain].label) : undefined,
    ),
    ev.announce ? 'all' : 'gm',
  );
  return true;
}

/** Does this event fire automatically when `phase` of `day` begins? */
export function firesAt(ev: ArenaEvent, day: number, phase: Phase): boolean {
  if (ev.status !== 'pending') return false;
  if (ev.trigger.type === 'day') return phase === 'day' && ev.trigger.day === day;
  if (ev.trigger.type === 'phase') return ev.trigger.day === day && ev.trigger.phase === phase;
  return false;
}
