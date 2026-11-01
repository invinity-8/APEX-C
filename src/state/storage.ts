/**
 * Lokale Speicherung (Demo-Modus). Nutzt localStorage des Browsers.
 * ACHTUNG: Das ist KEINE sichere Mehrspieler-Lösung – jeder mit Zugriff auf
 * diesen Browser sieht alles. Für echtes Online-Spiel siehe docs/SUPABASE.md.
 */
import { STATE_VERSION, type GameState } from '../game/types';

const KEY = 'apex.demo.state.v1';
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
    /* ignorieren */
  }
}

/** Prüft grob, ob ein JSON wie ein gültiger APEX-Spielstand aussieht. */
export function parseState(raw: string): GameState {
  const data = JSON.parse(raw);
  const required = ['config', 'day', 'hexes', 'tokens', 'teams', 'sites', 'events', 'knowledge', 'log'];
  if (!data || typeof data !== 'object') throw new Error('Keine gültige Datei.');
  for (const k of required) if (!(k in data)) throw new Error(`Feld "${k}" fehlt – kein APEX-Spielstand.`);
  if (data.version !== STATE_VERSION) throw new Error(`Version ${data.version} wird nicht unterstützt (erwartet ${STATE_VERSION}).`);
  return data as GameState;
}

export function downloadState(state: GameState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apex-tag${state.day}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Sitzung (nur Oberfläche, nicht Teil des Spielstands) ----------

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
    /* ignorieren */
  }
}
