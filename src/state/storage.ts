/**
 * Local storage (demo mode only). Uses the browser's localStorage.
 * WARNING: this is NOT a secure multiplayer solution – anyone with access to this
 * browser sees everything. The online mode stores the campaign in Supabase instead.
 */
import { migrateState } from '../game/migrate';
import type { GameState } from '../game/types';

/** v0.2 uses a new key: the larger default arena should not be replaced by an old v0.1 save. */
const KEY = 'apex.demo.state.v2';
const SESSION_KEY = 'apex.demo.session.v1';

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseState(raw);
  } catch {
    return null;
  }
}

export function saveState(state: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Checks that a JSON text looks like an APEX save and upgrades older versions. */
export function parseState(raw: string): GameState {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  return migrateState(data);
}

export function downloadState(state: GameState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apex-day${state.day}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Demo session (UI only, not part of the game state) ----------

export interface Session {
  role: 'gm' | 'player';
  viewerId: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
