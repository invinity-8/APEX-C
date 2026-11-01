/**
 * Arena-Events: wenden ihre Effekte auf den Spielstand an.
 * Neue Effekt-Typen: in types.ts (EventEffect) ergänzen und hier behandeln.
 */
import { TERRAIN } from './terrain';
import { addLog } from './log';
import type { GameState } from './types';

/** Mutiert `state`. Gibt false zurück, wenn das Event nicht (mehr) auslösbar ist. */
export function applyEvent(state: GameState, eventId: string): boolean {
  const ev = state.events[eventId];
  if (!ev || ev.status === 'done') return false;

  for (const effect of ev.effects) {
    switch (effect.type) {
      case 'setTerrain':
        for (const key of ev.hexes) {
          const tile = state.hexes[key];
          // Orte und besetzte Felder bleiben verschont, damit niemand "im Wasser" steht.
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
    `⚡ ${ev.name}: ${ev.description}${terrainNote && terrainNote.type === 'setTerrain' ? ` (${ev.hexes.length} Felder → ${TERRAIN[terrainNote.terrain].label})` : ''}`,
    ev.announce ? 'all' : 'gm',
  );
  return true;
}
