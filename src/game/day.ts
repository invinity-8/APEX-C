/**
 * Tageswechsel: Bewegungspunkte zurücksetzen, Schrumpfzone, Events, Log.
 */
import { applyEvent } from './events';
import { addLog } from './log';
import { refreshAllKnowledge } from './visibility';
import { affectedRings, safeRadius, zoneStatus } from './zone';
import type { GameState } from './types';

/** Mutiert `state` (auf einer Kopie aufrufen). */
export function advanceDay(state: GameState): void {
  const before = affectedRings(state.config.shrink, state.day);
  state.day += 1;
  addLog(state, 'day', `☀ Tag ${state.day} bricht an. Alle Bewegungspunkte sind wiederhergestellt.`);

  for (const t of Object.values(state.tokens)) {
    t.movePoints = t.maxMovePoints;
    t.visionBonus = 0;
  }

  // Arenaschrumpfung
  const cfg = state.config;
  if (cfg.shrink.enabled) {
    const after = affectedRings(cfg.shrink, state.day);
    const radius = safeRadius(cfg, state.day);
    if (after > before) {
      addLog(
        state,
        'warning',
        `🜂 Die Arena zieht sich zusammen: Alles jenseits von Ring ${radius} ist nun ${cfg.shrink.mode === 'closed' ? 'gesperrt' : 'Todeszone'}.`,
      );
    } else {
      const nextRadius = safeRadius(cfg, state.day + cfg.shrink.warningDays);
      if (nextRadius < radius) {
        addLog(state, 'warning', `⚠ Warnung der Spielmacher: Bald wird alles jenseits von Ring ${nextRadius} gefährlich.`);
      }
    }
    for (const t of Object.values(state.tokens)) {
      const z = zoneStatus(cfg, state.day, t.pos);
      if (z === 'danger' || z === 'closed') {
        addLog(
          state,
          'warning',
          `☠ ${t.name} befindet sich in der Todeszone! ${cfg.shrink.consequence}`,
          t.kind === 'player' ? 'all' : 'gm',
        );
      }
    }
  }

  // Tagesgebundene Events
  for (const ev of Object.values(state.events)) {
    if (ev.status === 'pending' && ev.trigger.type === 'day' && ev.trigger.day === state.day) {
      applyEvent(state, ev.id);
    }
  }

  refreshAllKnowledge(state);
}
