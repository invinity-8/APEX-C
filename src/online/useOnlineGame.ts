/**
 * Online backend: the shared campaign lives in Supabase; every change goes through /api/apex.
 *
 * Sync strategy
 *  - Supabase Realtime pushes only a tiny version counter (apex_campaign_heads, RLS-protected).
 *  - When the counter is newer than ours, we re-fetch our own filtered view from the server.
 *  - We also refresh on (re)subscribe, when the tab becomes visible, when the network
 *    comes back, and every 45 s as a safety net. Older responses never overwrite newer ones.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../game/commands';
import { buildGmView, type ViewModel } from '../game/visibility';
import type { CampaignPayload } from '../server/protocol';
import { withLookup, type Connection, type GameApi } from '../state/gameApi';
import { api, ApiError } from './api';
import { supabase } from './supabase';

const ACTIVE_KEY = 'apex.online.activeCharacter';

export interface OnlineGameResult {
  game: GameApi | null;
  payload: CampaignPayload | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
}

export function useOnlineGame(campaignId: string, email: string, signOut: () => void): OnlineGameResult {
  const [payload, setPayload] = useState<CampaignPayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [activeCharacter, setActiveState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });

  const versionRef = useRef(0);
  const activeRef = useRef(activeCharacter);
  activeRef.current = activeCharacter;
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const accept = useCallback((p: CampaignPayload, force = false) => {
    const sameChar = p.role === 'gm' || p.activeCharacter === activeRef.current || !activeRef.current;
    if (!force && sameChar && p.version < versionRef.current) return; // stale response
    versionRef.current = p.version;
    setPayload(p);
    setError(null);
    setLastSync(new Date());
    if (p.role === 'player' && p.activeCharacter && p.activeCharacter !== activeRef.current) {
      activeRef.current = p.activeCharacter;
      setActiveState(p.activeCharacter);
    }
  }, []);

  const refresh = useCallback((force = false) => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const run = (async () => {
      try {
        accept(await api.state(campaignId, activeRef.current ?? undefined), force);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, String(e));
        if (err.status === 401 || err.status === 403) setError(err);
        else setConnection('offline');
      } finally {
        inflight.current = null;
        if (again.current) {
          again.current = false;
          void refresh();
        }
      }
    })();
    inflight.current = run;
    return run;
  }, [accept, campaignId]);

  // Initial load
  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  // Realtime version pings
  useEffect(() => {
    const client = supabase();
    const channel = client
      .channel(`apex-head-${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'apex_campaign_heads', filter: `campaign_id=eq.${campaignId}` },
        (msg) => {
          const v = Number((msg.new as { version?: number } | null)?.version ?? 0);
          if (v > versionRef.current) void refresh();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          void refresh(); // catch up on anything missed while disconnected
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('offline');
        }
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [campaignId, refresh]);

  // Safety nets: visibility, network, periodic poll
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const onOnline = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const id = setInterval(() => void refresh(), 45_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(id);
    };
  }, [refresh]);

  const setActiveCharacter = useCallback(
    (id: string) => {
      activeRef.current = id;
      setActiveState(id);
      try {
        localStorage.setItem(ACTIVE_KEY, id);
      } catch {
        /* ignore */
      }
      void refresh(true);
    },
    [refresh],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
      setBusy(true);
      try {
        return { ok: true, value: await fn() };
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, String(e));
        if (err.status === 401) setError(err);
        if (err.code === 'conflict' || err.status === 409) void refresh(true);
        return { ok: false, error: err.message };
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const dispatch = useCallback(
    async (cmd: Command) => {
      const r = await run(() => api.command(campaignId, cmd, activeRef.current ?? undefined));
      if (r.ok) accept(r.value, true);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    [accept, campaignId, run],
  );

  const adminCall = useCallback(
    async (action: Record<string, unknown>) => {
      const r = await run(() => api.admin<CampaignPayload>(campaignId, action));
      if (!r.ok) return { ok: false, error: r.error };
      accept(r.value, true);
      return { ok: true };
    },
    [accept, campaignId, run],
  );

  const gmState = payload?.role === 'gm' ? payload.state : null;
  const view: ViewModel | null = useMemo(() => {
    if (!payload) return null;
    if (payload.role === 'gm') return payload.state ? buildGmView(payload.state) : null;
    return payload.view ? withLookup(payload.view) : null;
  }, [payload]);

  const game: GameApi | null =
    payload && view
      ? {
          mode: 'online',
          view,
          gmState,
          busy,
          dispatch,
          regenerate: (radius, seed) => adminCall({ action: 'initCampaign', radius, seed }),
          importState: async (text) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              return { ok: false, error: 'The file is not valid JSON.' };
            }
            return adminCall({ action: 'importState', state: parsed });
          },
          online: {
            email,
            campaignId,
            campaignName: payload.campaignName,
            characters: payload.role === 'player' ? payload.characters : [],
            activeCharacter: payload.role === 'player' ? payload.activeCharacter : null,
            setActiveCharacter,
            connection,
            version: payload.version,
            lastSync,
            refresh: () => void refresh(true),
            signOut,
            admin: async (action) => {
              const r = await run(() => api.admin(campaignId, action));
              if (!r.ok) throw new Error(r.error);
              return r.value;
            },
          },
        }
      : null;

  return { game, payload, error, loading: !payload && !error, refresh: () => void refresh(true) };
}
