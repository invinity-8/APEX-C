/**
 * Demo backend: keeps the game state in this browser, runs commands locally and saves automatically.
 * It never talks to the shared online campaign.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoState } from '../data/demo';
import { executeCommand, type Command } from '../game/commands';
import type { Actor, GameState } from '../game/types';
import { buildGmView, buildPlayerView } from '../game/visibility';
import type { GameApi } from './gameApi';
import { clearState, loadSession, loadState, parseState, saveSession, saveState, type Session } from './storage';

const firstPlayer = (s: GameState) => Object.values(s.tokens).find((t) => t.kind === 'player')?.id ?? '';

export function useDemoGame(): GameApi {
  const [state, setState] = useState<GameState>(() => loadState() ?? createDemoState());
  const [session, setSessionState] = useState<Session>(() => loadSession() ?? { role: 'gm', viewerId: '' });
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // The perspective character must exist (e.g. after import/reset).
  const viewerId = state.tokens[session.viewerId]?.kind === 'player' ? session.viewerId : firstPlayer(state);
  const actor: Actor = useMemo(() => (session.role === 'gm' ? { role: 'gm' } : { role: 'player', tokenId: viewerId }), [session.role, viewerId]);

  const view = useMemo(
    () => (session.role === 'gm' ? buildGmView(state) : buildPlayerView(state, viewerId)),
    [state, session.role, viewerId],
  );

  // Save automatically (slightly delayed so that quick clicks stay smooth).
  useEffect(() => {
    const id = setTimeout(() => {
      if (saveState(state)) setSavedAt(new Date());
    }, 250);
    return () => clearTimeout(id);
  }, [state]);

  useEffect(() => saveSession({ ...session, viewerId }), [session, viewerId]);

  const dispatch = useCallback(
    async (cmd: Command) => {
      const res = executeCommand(stateRef.current, actor, cmd);
      if (res.ok) {
        stateRef.current = res.state;
        setState(res.state);
        return { ok: true };
      }
      return { ok: false, error: res.error };
    },
    [actor],
  );

  const replace = (s: GameState) => {
    stateRef.current = s;
    setState(s);
  };

  const players = useMemo(
    () => Object.values(state.tokens).filter((t) => t.kind === 'player').map((t) => ({ id: t.id, name: t.name })),
    [state.tokens],
  );

  return {
    mode: 'demo',
    view,
    gmState: session.role === 'gm' ? state : null,
    busy: false,
    dispatch,
    regenerate: async (radius, seed) => {
      clearState();
      replace(createDemoState({ radius, seed }));
      return { ok: true };
    },
    importState: async (text) => {
      try {
        replace(parseState(text));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    demo: {
      session: { ...session, viewerId },
      setSession: setSessionState,
      players,
      savedAt,
      reset: () => {
        clearState();
        replace(createDemoState());
      },
    },
  };
}
