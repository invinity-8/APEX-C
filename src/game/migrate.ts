/**
 * Upgrades older save games to the current STATE_VERSION.
 * v1 (APEX 0.1) → v2: adds day/night phase and phase rules.
 */
import { DEFAULT_PHASE_RULES, STATE_VERSION, type GameState } from './types.js';

export function migrateState(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object') throw new Error('Not a valid save file.');
  const data = raw as Record<string, unknown>;
  const required = ['config', 'day', 'hexes', 'tokens', 'teams', 'sites', 'events', 'knowledge', 'log'];
  for (const k of required) if (!(k in data)) throw new Error(`Field "${k}" is missing – not an APEX save game.`);
  const version = Number(data.version);
  if (version > STATE_VERSION || version < 1 || !Number.isInteger(version)) {
    throw new Error(`Save version ${String(data.version)} is not supported (expected ≤ ${STATE_VERSION}).`);
  }
  const state = structuredClone(data) as unknown as GameState;
  if (version < 2) {
    state.phase = 'day';
    state.config.phases = structuredClone(DEFAULT_PHASE_RULES);
    for (const e of state.log) e.phase ??= 'day';
  }
  state.phase ??= 'day';
  state.config.phases ??= structuredClone(DEFAULT_PHASE_RULES);
  state.version = STATE_VERSION;
  return state;
}
