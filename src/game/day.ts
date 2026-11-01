/**
 * Time progression: Day 1 → Night 1 → Day 2 → Night 2 → …
 *
 * Rules (documented in README → "Day & night"):
 *  - Only the GM advances the phase.
 *  - Movement points are restored at DAWN (start of every Day phase), never at nightfall.
 *    Points left over from the day can still be spent during the night.
 *  - Temporary vision bonuses expire at dawn.
 *  - Night applies the configured vision modifier (default −1, minimum 1).
 *  - The shrinking arena is evaluated only at dawn, based on the day number,
 *    so one day can never cause a double shrink step.
 *  - Events can fire at the dawn of a day (trigger 'day') or at a specific phase (trigger 'phase').
 */
import { applyEvent, firesAt } from './events';
import { addLog } from './log';
import { T } from './text';
import { refreshAllKnowledge } from './visibility';
import { affectedRings, safeRadius, zoneStatus } from './zone';
import type { GameState } from './types';

/** Day phase → night of the same day. Mutates `state`. */
function beginNight(state: GameState): void {
  state.phase = 'night';
  addLog(state, 'day', T.logNightfall(state.day));
  fireEvents(state);
  refreshAllKnowledge(state);
}

/** Night phase → dawn of the next day. Mutates `state`. */
function beginDay(state: GameState): void {
  const before = affectedRings(state.config.shrink, state.day);
  state.day += 1;
  state.phase = 'day';
  addLog(state, 'day', T.logDawn(state.day));

  for (const t of Object.values(state.tokens)) {
    t.movePoints = t.maxMovePoints;
    t.visionBonus = 0;
  }

  const cfg = state.config;
  if (cfg.shrink.enabled) {
    const after = affectedRings(cfg.shrink, state.day);
    const radius = safeRadius(cfg, state.day);
    if (after > before) {
      addLog(state, 'warning', T.logShrink(radius, cfg.shrink.mode === 'closed'));
    } else {
      const nextRadius = safeRadius(cfg, state.day + cfg.shrink.warningDays);
      if (nextRadius < radius) addLog(state, 'warning', T.logShrinkWarning(nextRadius));
    }
    for (const t of Object.values(state.tokens)) {
      const z = zoneStatus(cfg, state.day, t.pos);
      if (z === 'danger' || z === 'closed') {
        addLog(state, 'warning', T.logDeathZone(t.name, cfg.shrink.consequence), t.kind === 'player' ? 'all' : 'gm');
      }
    }
  }

  fireEvents(state);
  refreshAllKnowledge(state);
}

function fireEvents(state: GameState): void {
  for (const ev of Object.values(state.events)) {
    if (firesAt(ev, state.day, state.phase)) applyEvent(state, ev.id);
  }
}

/** Advances exactly one phase. Mutates `state` (call on a copy). */
export function advancePhase(state: GameState): void {
  if (state.phase === 'day') beginNight(state);
  else beginDay(state);
}

/** Skips to the dawn of the next day (passing through the night if necessary). */
export function advanceDay(state: GameState): void {
  if (state.phase === 'day') beginNight(state);
  beginDay(state);
}
