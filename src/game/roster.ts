/**
 * Renames the v0.2 placeholder characters in an EXISTING saved campaign to the real roster,
 * keeping positions, movement points, knowledge (Fog of War), inventory and permissions.
 * Used by the GM action "Convert old characters". Pure function – returns a new state.
 */
import type { GameState } from './types';

export const LEGACY_ROSTER: Record<string, { id: string; name: string; initials: string }> = {
  livia: { id: 'sinna', name: 'Sinna', initials: 'SI' },
  marcus: { id: 'aster', name: 'Aster', initials: 'AS' },
  nyx: { id: 'elwin', name: 'Elwin', initials: 'EL' },
  cassius: { id: 'javi', name: 'Javi', initials: 'JA' },
};

export function needsRosterUpdate(state: GameState): boolean {
  return Object.keys(LEGACY_ROSTER).some((id) => state.tokens[id]?.kind === 'player');
}

export function applyRoster(prev: GameState): GameState {
  const state = structuredClone(prev);
  const rename = (id: string) => (state.tokens[id]?.kind === 'player' || prev.tokens[id]?.kind === 'player' ? (LEGACY_ROSTER[id]?.id ?? id) : id);
  const tokens: GameState['tokens'] = {};
  for (const [id, t] of Object.entries(state.tokens)) {
    const r = t.kind === 'player' ? LEGACY_ROSTER[id] : undefined;
    const nt = r ? { ...t, id: r.id, name: r.name, initials: r.initials } : { ...t };
    nt.controllers = t.controllers.map(rename);
    tokens[nt.id] = nt;
  }
  state.tokens = tokens;
  const knowledge: GameState['knowledge'] = {};
  for (const [id, k] of Object.entries(state.knowledge)) knowledge[LEGACY_ROSTER[id]?.id ?? id] = k;
  state.knowledge = knowledge;
  return state;
}
