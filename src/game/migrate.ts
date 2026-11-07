/**
 * Upgrades older save games to the current STATE_VERSION.
 * v1 (APEX 0.1) → v2: adds day/night phase and phase rules.
 * v2 → v3 (APEX 0.7): removes the legacy Willpower resource (token.will, will-vessel items) – see stripLegacy().
 */
import { DEFAULT_PHASE_RULES, STATE_VERSION, type GameState } from './types.js';
import { estimateWeightKg } from './items/weightGuess.js';
import { migrateCubeProgression } from './items/cubeProgression.js';

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
  stripLegacy(state);
  migrateCubeProgression(state);
  state.version = STATE_VERSION;
  return state;
}

/**
 * Legacy reader (APEX 0.7): removes the obsolete Willpower resource from a state IN PLACE and reports whether it
 * changed anything. Every other character field, item and resource is left untouched:
 *  - token.will is dropped;
 *  - "will-vessel" items become ordinary "misc" items (name, description, notes, quantity kept), their willCharge /
 *    willCapacity fields are dropped.
 * Used for every state the server reads (live state, snapshots, archives, imports) and for demo saves, so states
 * that are written again never contain Willpower. Archives in the database are not rewritten – they are cleaned
 * when they are read.
 */
export function stripLegacy(state: GameState): boolean {
  let changed = false;
  for (const t of Object.values(state.tokens ?? {})) {
    const tok = t as unknown as Record<string, unknown>;
    if ('will' in tok) {
      delete tok.will;
      changed = true;
    }
    for (const i of (t.inventory ?? []) as unknown as Array<Record<string, unknown>>) {
      if (i.kind === 'will-vessel') {
        i.kind = 'misc';
        changed = true;
      }
      if ('willCharge' in i || 'willCapacity' in i) {
        delete i.willCharge;
        delete i.willCapacity;
        changed = true;
      }
      // APEX 0.7: free-text items (imports, hand-written) get a rough weight estimate once; base items keep the SRD
      // weight of their base, explicit weights are never touched.
      if (i.weightKg === undefined && !i.baseId && typeof i.name === 'string') {
        i.weightKg = estimateWeightKg(i.name);
        changed = true;
      }
    }
  }
  if (changed && typeof state.version === 'number' && state.version < STATE_VERSION) state.version = STATE_VERSION;
  return changed;
}
