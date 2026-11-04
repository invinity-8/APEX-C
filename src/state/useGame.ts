/**
 * Demo backend: keeps the game state in this browser, runs commands locally and saves automatically.
 * It never talks to the shared online campaign.
 */
import { applyDamage, applyHealing, convertSorcery, revert, setTempHp, transform } from '../game/abilities';
import { findBeast } from '../game/beastCatalog';
import { SEEDED_COMMANDS } from '../game/items/loot';
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
      // Demo mode runs the rules locally; it plays the server's role and supplies the random seed itself.
      const c = SEEDED_COMMANDS.has(cmd.type) ? ({ ...cmd, seed: crypto.getRandomValues(new Uint32Array(1))[0] } as Command) : cmd;
      const res = executeCommand(stateRef.current, actor, c);
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
    ability: async (tokenId, body) => {
      // Demo mode plays the server: the same pure rules as /api/apex?op=sheet.
      const cur = payload(tokenId);
      if (body.expectedVersion !== cur.version) return { ok: false, error: 'Changed elsewhere.', conflict: cur };
      const amount = Math.max(0, Math.floor(Number(body.amount) || 0));
      const form = typeof body.formId === 'string' ? findBeast(state.customBeasts, body.formId) : undefined;
      const r =
        body.action === 'wildShape'
          ? form
            ? transform(cur.sheet, form)
            : ({ ok: false, error: 'Unknown beast form.' } as const)
          : body.action === 'revert'
            ? revert(cur.sheet)
            : body.action === 'damage'
              ? applyDamage(cur.sheet, amount)
              : body.action === 'heal'
                ? applyHealing(cur.sheet, amount)
                : body.action === 'tempHp'
                  ? setTempHp(cur.sheet, body.mode as 'grant' | 'replace' | 'remove', amount)
                  : convertSorcery(cur.sheet, body.direction as 'toSlot' | 'toPoints', Number(body.level));
      if (!r.ok) return { ok: false, error: r.error };
      write(tokenId, r.sheet, cur.version + 1);
      return { ok: true, sheet: { ...payload(tokenId), message: r.message } };
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
