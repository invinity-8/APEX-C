/**
 * React-Hook, der den Spielstand hält, Commands ausführt und automatisch speichert.
 * Für den Online-Modus (Phase 2) wird nur dieser Hook ausgetauscht:
 * dispatch() schickt den Command dann an Supabase statt ihn lokal auszuführen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoState } from '../data/demo';
import { executeCommand, type Command, type CommandResult } from '../game/commands';
import type { Actor, GameState } from '../game/types';
import { buildGmView, buildPlayerView, type ViewModel } from '../game/visibility';
import { clearState, loadSession, loadState, parseState, saveSession, saveState, type Session } from './storage';

export interface GameApi {
  /** Voller Spielstand – NUR für GM-Werkzeuge verwenden. */
  state: GameState;
  view: ViewModel;
  session: Session;
  actor: Actor;
  savedAt: Date | null;
  dispatch: (cmd: Command) => CommandResult;
  setSession: (s: Session) => void;
  reset: (opts?: { radius?: number; seed?: number }) => void;
  importJson: (text: string) => void;
}

const firstPlayer = (s: GameState) => Object.values(s.tokens).find((t) => t.kind === 'player')?.id ?? '';

export function useGame(): GameApi {
  const [state, setState] = useState<GameState>(() => loadState() ?? createDemoState());
  const [session, setSessionState] = useState<Session>(() => {
    const s = loadSession();
    return s ?? { role: 'gm', viewerId: '' };
  });
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Spielerfigur muss existieren (z. B. nach Import/Reset).
  const viewerId = state.tokens[session.viewerId]?.kind === 'player' ? session.viewerId : firstPlayer(state);
  const actor: Actor = useMemo(
    () => (session.role === 'gm' ? { role: 'gm' } : { role: 'player', tokenId: viewerId }),
    [session.role, viewerId],
  );

  const view = useMemo(
    () => (session.role === 'gm' ? buildGmView(state) : buildPlayerView(state, viewerId)),
    [state, session.role, viewerId],
  );

  // Automatisch speichern (leicht verzögert, damit schnelle Klicks nicht bremsen).
  useEffect(() => {
    const id = setTimeout(() => {
      if (saveState(state)) setSavedAt(new Date());
    }, 250);
    return () => clearTimeout(id);
  }, [state]);

  useEffect(() => saveSession({ ...session, viewerId }), [session, viewerId]);

  const dispatch = useCallback(
    (cmd: Command) => {
      const res = executeCommand(stateRef.current, actor, cmd);
      if (res.ok) {
        stateRef.current = res.state;
        setState(res.state);
      }
      return res;
    },
    [actor],
  );

  const reset = useCallback((opts?: { radius?: number; seed?: number }) => {
    clearState();
    const fresh = createDemoState(opts);
    stateRef.current = fresh;
    setState(fresh);
  }, []);

  const importJson = useCallback((text: string) => {
    const imported = parseState(text); // wirft bei ungültiger Datei
    stateRef.current = imported;
    setState(imported);
  }, []);

  return {
    state,
    view,
    session: { ...session, viewerId },
    actor,
    savedAt,
    dispatch,
    setSession: setSessionState,
    reset,
    importJson,
  };
}
