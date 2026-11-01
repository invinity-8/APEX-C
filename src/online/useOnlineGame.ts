/**
 * Online backend: the shared campaign lives in Supabase; every change goes through /api/apex.
 *
 * Sync strategy
 *  - Supabase Realtime pushes only a tiny version counter (apex_campaign_heads, RLS-protected).
 *  - When the counter is newer than ours, we re-fetch our own filtered view from the server.
 *  - A heartbeat (/api/apex?op=ping, every 25 s; every 8 s while realtime is down) keeps presence
 *    fresh and detects missed pings by comparing versions.
 *  - We also refresh on (re)subscribe, when the tab becomes visible and when the network comes back.
 *    Older responses never overwrite newer ones.
 *  - There is no local copy of the campaign: if the server is unreachable the UI says so and nothing is saved.
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
  const [realtime, setRealtime] = useState<'live' | 'connecting' | 'down'>('connecting');
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
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
    setApiOk(true);
    setSyncError(null);
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
        else {
          setApiOk(false);
          setSyncError(err.message);
        }
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
          setRealtime('live');
          void refresh(); // catch up on anything missed while disconnected
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtime('down'); // supabase-js retries on its own; the heartbeat polls meanwhile
        }
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [campaignId, refresh]);

  // Heartbeat: presence + missed-update detection + server reachability
  const beat = useCallback(async () => {
    try {
      const { version } = await api.ping(campaignId);
      setApiOk(true);
      if (version !== versionRef.current) void refresh(true);
      else setSyncError(null);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, String(e));
      if (err.status === 401 || err.status === 403) setError(err);
      else {
        setApiOk(false);
        setSyncError(err.message);
      }
    }
  }, [campaignId, refresh]);

  useEffect(() => {
    const every = realtime === 'live' && apiOk !== false ? 25_000 : 8_000;
    const id = setInterval(() => document.visibilityState === 'visible' && void beat(), every);
    return () => clearInterval(id);
  }, [beat, realtime, apiOk]);

  // Safety nets: tab visible again, network back
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => {
      setApiOk(false);
      setSyncError('this device is offline');
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const connection: Connection = apiOk === false ? 'offline' : realtime === 'live' && apiOk ? 'live' : apiOk && realtime === 'down' ? 'degraded' : 'connecting';

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
        if (err.status === 0 || err.status >= 500) {
          setApiOk(false);
          setSyncError(err.message);
          return { ok: false, error: `${err.message} Your action was NOT saved.` };
        }
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
            syncError,
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
