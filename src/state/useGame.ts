/**
 * Demo backend: keeps the game state in this browser, runs commands locally and saves automatically.
 * It never talks to the shared online campaign.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDemoState } from '../data/demo';
import { executeCommand, type Command } from '../game/commands';
import type { Actor, GameState } from '../game/types';
import { buildGmView, buildPlayerView } from '../game/visibility';
import type { GameApi, SheetApi } from './gameApi';
import { emptySheet, parseSheet } from '../game/sheet';
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

  const sheets = useDemoSheets(state);

  return {
    mode: 'demo',
    sheets,
    view,
    gmState: session.role === 'gm' ? state : null,
    busy: false,
    pending: [],
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

const SHEETS_KEY = 'apex.demo.sheets';

/** Demo character sheets: stored in this browser only (like the rest of the demo). */
function useDemoSheets(state: GameState): SheetApi {
  const [revision, setRevision] = useState(0);
  const read = (): Record<string, { data: unknown; version: number; updatedAt: string }> => {
    try {
      return JSON.parse(localStorage.getItem(SHEETS_KEY) ?? '{}');
    } catch {
      return {};
    }
  };
  const payload = (tokenId: string) => {
    const s = read()[tokenId];
    const p = s ? parseSheet(s.data) : null;
    return {
      tokenId,
      characterName: state.tokens[tokenId]?.name ?? tokenId,
      sheet: p?.ok ? p.sheet : emptySheet(),
      version: s?.version ?? 0,
      updatedAt: s?.updatedAt ?? null,
    };
  };
  const write = (tokenId: string, data: unknown, version: number) => {
    const all = read();
    all[tokenId] = { data, version, updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(SHEETS_KEY, JSON.stringify(all));
    } catch {
      /* storage full – ignored in the demo */
    }
    setRevision((r) => r + 1);
  };
  return {
    revision,
    party: async () =>
      Object.values(state.tokens)
        .filter((t) => t.kind === 'player')
        .map((t) => ({ tokenId: t.id, hp: payload(t.id).sheet.hitPoints ?? null })),
    load: async (tokenId) => ({ ok: true, sheet: payload(tokenId) }),
    save: async (tokenId, sheet, expectedVersion) => {
      const parsed = parseSheet(sheet);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const cur = payload(tokenId);
      if (cur.version !== expectedVersion) return { ok: false, error: 'Changed elsewhere.', conflict: cur };
      write(tokenId, parsed.sheet, expectedVersion + 1);
      return { ok: true, sheet: payload(tokenId) };
    },
    adjust: async (tokenId, target, delta, resourceId) => {
      const cur = payload(tokenId);
      const sh = cur.sheet;
      if (target === 'resource') {
        const r = sh.resources.find((x) => x.id === resourceId);
        if (!r) return { ok: false, error: 'This resource no longer exists.' };
        r.current = Math.max(0, Math.min(r.max ?? 100000, r.current + delta));
      } else if (sh.hitPoints) {
        if (target === 'hp') sh.hitPoints.current = Math.max(-sh.hitPoints.max, Math.min(sh.hitPoints.max, sh.hitPoints.current + delta));
        else sh.hitPoints.temp = Math.max(0, sh.hitPoints.temp + delta);
      }
      write(tokenId, sh, cur.version + 1);
      return { ok: true, sheet: payload(tokenId) };
    },
  };
}
