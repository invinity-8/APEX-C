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
 *  - Events become due at the dawn of a day (trigger 'day') or at a specific phase (trigger 'phase').
 *    Due events wait for the GM's approval (see events.ts) – no effect is applied automatically.
 */
import { markDueEvents } from './events.js';
import { addLog } from './log.js';
import { T } from './text.js';
import { refreshAllKnowledge } from './visibility.js';
import { affectedRings, safeRadius, zoneStatus } from './zone.js';
import type { GameState } from './types.js';

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
      addLog(state, 'warning', T.logShrink(cfg.shrink.mode === 'closed'));
      addLog(state, 'gm', T.logShrinkGm(radius), 'gm');
    } else {
      const nextRadius = safeRadius(cfg, state.day + cfg.shrink.warningDays);
      if (nextRadius < radius) {
        addLog(state, 'warning', T.logShrinkWarning);
        addLog(state, 'gm', T.logShrinkWarningGm(nextRadius), 'gm');
      }
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

/** Due events are only PREPARED (awaiting GM approval) – never applied automatically. */
function fireEvents(state: GameState): void {
  markDueEvents(state);
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
