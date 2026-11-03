/**
 * Online backend: the shared campaign lives in Supabase; every change goes through /api/apex.
 *
 * Synchronisation (bounded, see docs/ARCHITECTURE.md "Sync & failure handling")
 *  - Supabase Realtime broadcasts only a tiny version counter on a secret topic. A newer version
 *    triggers ONE refresh of our own filtered view.
 *  - Refreshes are single-flight (never two at once) and send the version we already have, so the
 *    server answers "unchanged" instead of the full state when nothing changed.
 *  - One sequential heartbeat (op=ping: version only). Normal: every 30 s (12 s without Realtime).
 *    After failures: exponential backoff with jitter up to 60 s. Paused while the tab is hidden or the
 *    device is offline. A ping never overlaps another ping.
 *  - Background sync never disables buttons. Only the action being saved is marked pending.
 *  - Every action carries a request id. If its response is lost (timeout, network), APEX asks the
 *    server whether that id was committed before allowing anything else – it is never re-sent blindly.
 *  - Older responses never overwrite newer ones; there is no local copy of the campaign.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTER_COMMANDS, type Command } from '../game/commands';
import { buildGmView, type ViewModel } from '../game/visibility';
import type { CampaignPayload, SheetPayload, UnchangedPayload } from '../server/protocol';
import { withLookup, type Connection, type DispatchResult, type GameApi, type OnlineControls, type SheetApi, type SheetResult } from '../state/gameApi';
import { api, ApiError, newRequestId } from './api';
import { supabase } from './supabase';

const ACTIVE_KEY = 'apex.online.activeCharacter';

/** Heartbeat timing (ms). Exported for tests/docs. */
export const SYNC_TIMING = {
  live: 30_000,
  noRealtime: 12_000,
  backoffBase: 4_000,
  backoffMax: 60_000,
  /** Consecutive failures after which the server counts as unavailable. */
  unavailableAfter: 3,
};

/** Next heartbeat delay: regular interval, or exponential backoff with ±25 % jitter after failures. */
export function nextBeatDelay(failures: number, realtimeLive: boolean, rand = Math.random): number {
  if (failures <= 0) return realtimeLive ? SYNC_TIMING.live : SYNC_TIMING.noRealtime;
  const base = Math.min(SYNC_TIMING.backoffMax, SYNC_TIMING.backoffBase * 2 ** (failures - 1));
  return Math.round(base * (0.75 + rand() * 0.5));
}

/** Which actions conflict with each other (only one of each kind may be in flight). */
export function actionKey(cmd: Command): string {
  switch (cmd.type) {
    case 'move':
    case 'place':
      return 'move';
    case 'advancePhase':
    case 'endDay':
    case 'setDay':
      return 'phase';
    default:
      return CHARACTER_COMMANDS.has(cmd.type) ? `char:${(cmd as { tokenId: string }).tokenId}` : `gm:${cmd.type}`;
  }
}

const ACTION_LABEL: Record<string, string> = { move: 'Move', phase: 'Time change', world: 'World change', 'gm:decideEvent': 'Event decision', 'gm:createEvent': 'Custom event', 'gm:announce': 'Announcement' };
const isUnchanged = (p: CampaignPayload | UnchangedPayload): p is UnchangedPayload => 'unchanged' in p && p.unchanged === true;
const transient = (e: ApiError) => e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OnlineGameResult {
  game: GameApi | null;
  payload: CampaignPayload | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * @param initialTopic secret Realtime topic from the session (refreshed by the heartbeat).
 * @param initialCharacter the profile's character, selected first.
 */
export function useOnlineGame(
  campaignId: string,
  profileName: string,
  initialTopic: string,
  signOut: () => void,
  initialCharacter?: string,
): OnlineGameResult {
  const [syncTopic, setSyncTopic] = useState(initialTopic);
  const [sheetRevision, setSheetRevision] = useState(0);
  const [payload, setPayload] = useState<CampaignPayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [realtime, setRealtime] = useState<'live' | 'connecting' | 'down'>('connecting');
  const [failures, setFailures] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [unknownAction, setUnknownAction] = useState<{ label: string; requestId: string } | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [activeCharacter, setActiveState] = useState<string | null>(() => {
    if (initialCharacter) return initialCharacter;
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });

  const versionRef = useRef(0);
  /** Active world id as last received – sent with every command (stale-world protection). */
  const worldRef = useRef<string | null | undefined>(undefined);
  const [worldNotice, setWorldNotice] = useState<string | null>(null);
  const activeRef = useRef(activeCharacter);
  activeRef.current = activeCharacter;
  const failuresRef = useRef(0);
  const realtimeRef = useRef(realtime);
  realtimeRef.current = realtime;
  const topicRef = useRef(syncTopic);
  topicRef.current = syncTopic;
  const pendingRef = useRef(new Set<string>());
  const unknownRef = useRef(unknownAction);
  unknownRef.current = unknownAction;
  const lastSyncAt = useRef(0);
  const inflight = useRef<{ promise: Promise<void>; ctrl: AbortController } | null>(null);
  const again = useRef<'none' | 'normal' | 'force'>('none');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inflight.current?.ctrl.abort();
    };
  }, []);

  const markOk = useCallback(() => {
    failuresRef.current = 0;
    setFailures(0);
    setSyncError(null);
    lastSyncAt.current = Date.now();
    setLastSync(new Date());
  }, []);

  const markFailure = useCallback((e: ApiError) => {
    if (e.code === 'cancelled') return;
    if (e.status === 401 || e.status === 403) {
      setError(e);
      return;
    }
    failuresRef.current += 1;
    setFailures(failuresRef.current);
    setSyncError(e.message);
  }, []);

  const accept = useCallback(
    (p: CampaignPayload, force = false) => {
      const sameChar = p.role === 'gm' || p.activeCharacter === activeRef.current || !activeRef.current;
      if (!force && sameChar && p.version < versionRef.current) return; // stale response – never overwrite newer state
      versionRef.current = p.version;
      const wid = p.role === 'gm' ? (p.state?.world?.id ?? null) : (p.view?.worldId ?? null);
      const wname = p.role === 'gm' ? (p.state?.world?.name ?? null) : (p.view?.worldName ?? null);
      if (worldRef.current !== undefined && wid !== worldRef.current && (p.role === 'gm' ? p.state : p.view)) {
        setWorldNotice(`The Game Master switched to the world “${wname ?? 'Unnamed'}”.`);
      }
      worldRef.current = wid;
      setPayload(p);
      setError(null);
      markOk();
      if (p.role === 'player' && p.activeCharacter && p.activeCharacter !== activeRef.current) {
        activeRef.current = p.activeCharacter;
        setActiveState(p.activeCharacter);
      }
    },
    [markOk],
  );

  /** Single-flight refresh. force = full download (ignores the version shortcut). */
  const refresh = useCallback(
    (force = false): Promise<void> => {
      if (inflight.current) {
        if (force || again.current === 'none') again.current = force ? 'force' : 'normal';
        return inflight.current.promise;
      }
      const ctrl = new AbortController();
      setSyncing(true);
      const promise = (async () => {
        try {
          const since = force ? undefined : versionRef.current || undefined;
          const res = await api.state(campaignId, activeRef.current ?? undefined, since, ctrl.signal);
          if (!mounted.current) return;
          if (isUnchanged(res)) markOk();
          else accept(res, force);
        } catch (e) {
          if (mounted.current) markFailure(e instanceof ApiError ? e : new ApiError(0, String(e)));
        } finally {
          inflight.current = null;
          if (mounted.current) setSyncing(false);
          const next = again.current;
          again.current = 'none';
          if (next !== 'none' && mounted.current) void refresh(next === 'force');
        }
      })();
      inflight.current = { promise, ctrl };
      return promise;
    },
    [accept, campaignId, markFailure, markOk],
  );

  // Initial load
  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  /** After a lost response: ask the server whether the request id was committed (bounded, no re-send). */
  const verifyOutcome = useCallback(
    async (requestId: string): Promise<'ok' | 'failed' | 'unknown'> => {
      for (const wait of [1_000, 2_500, 5_000, 10_000]) {
        await sleep(wait);
        try {
          const s = await api.commandStatus(requestId);
          if (s.state === 'ok') return 'ok';
          if (s.state === 'failed') return 'failed';
          if (s.state === 'unknown') return 'failed'; // never arrived → nothing was changed, safe to try again
          // 'pending' → still being processed, ask again
        } catch {
          /* server still unreachable – keep waiting */
        }
      }
      return 'unknown';
    },
    [],
  );

  // Heartbeat: one sequential loop with backoff; never overlapping, paused while hidden/offline.
  const beat = useCallback(async () => {
    try {
      const { version, syncTopic: topic } = await api.ping(campaignId);
      markOk();
      if (topic && topic !== topicRef.current) setSyncTopic(topic);
      if (version !== versionRef.current) void refresh();
      if (realtimeRef.current !== 'live') setSheetRevision((r) => r + 1); // no live pings → re-check sheets on each beat
      const u = unknownRef.current;
      if (u) {
        const s = await api.commandStatus(u.requestId).catch(() => null);
        if (s && s.state !== 'pending') {
          setUnknownAction(null);
          if (s.state === 'ok') void refresh(true);
        }
      }
    } catch (e) {
      markFailure(e instanceof ApiError ? e : new ApiError(0, String(e)));
    }
  }, [campaignId, markFailure, markOk, refresh]);

  const beatRef = useRef(beat);
  beatRef.current = beat;
  const wake = useRef<() => void>(() => undefined);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let stopped = false;
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };
    const tick = async () => {
      if (stopped) return;
      if (running) return; // never overlap
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return schedule(5_000);
      running = true;
      try {
        await beatRef.current();
      } finally {
        running = false;
        if (!stopped) schedule(nextBeatDelay(failuresRef.current, realtimeRef.current === 'live'));
      }
    };
    wake.current = () => {
      if (!running && Date.now() - lastSyncAt.current > 5_000) schedule(0);
    };
    schedule(nextBeatDelay(0, false));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [campaignId]);

  // Realtime: version pings on the campaign's secret broadcast topic (handed out by the server).
  useEffect(() => {
    const client = supabase();
    const channel = client
      .channel(syncTopic, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'version' }, (msg) => {
        const v = Number((msg.payload as { version?: number } | undefined)?.version ?? 0);
        if (v > versionRef.current) void refresh();
      })
      .on('broadcast', { event: 'sheet' }, () => setSheetRevision((r) => r + 1))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtime('live');
          void refresh(); // cheap: answered with "unchanged" unless something was missed
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtime('down'); // supabase-js retries on its own; the heartbeat covers the gap
        }
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [campaignId, refresh, syncTopic]);

  // Safety nets: tab visible again, network back (throttled through the heartbeat).
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && wake.current();
    const onOnline = () => wake.current();
    const onOffline = () => setSyncError('this device is offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

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

  /**
   * Runs one state-changing request with a request id. Only `key` is marked pending.
   * A lost response is verified on the server before the result is reported.
   */
  const perform = useCallback(
    async <T,>(key: string, label: string, call: (requestId: string) => Promise<T>, onOk: (v: T) => void): Promise<DispatchResult> => {
      if (pendingRef.current.has(key)) return { ok: false, error: `${label} is still being saved – please wait a moment.` };
      if (unknownRef.current) return { ok: false, error: `APEX is still checking whether “${unknownRef.current.label}” was saved. Please wait.` };
      pendingRef.current.add(key);
      setPending([...pendingRef.current]);
      const requestId = newRequestId();
      try {
        try {
          const v = await call(requestId);
          onOk(v);
          return { ok: true, value: v };
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(0, String(e));
          if (err.status === 401) setError(err);
          if (!transient(err) && err.code !== 'in_progress') {
            if (err.code === 'conflict' || err.code === 'world_changed' || err.status === 409) void refresh(true);
            return { ok: false, error: err.message };
          }
          // Response lost or server overloaded: the action may or may not have been saved. Verify, never re-send.
          markFailure(err);
          setUnknownAction({ label, requestId });
          const outcome = await verifyOutcome(requestId);
          if (outcome === 'unknown') {
            return { ok: false, error: `The server did not confirm “${label}”. APEX keeps checking – do not repeat it yet.` };
          }
          setUnknownAction(null);
          if (outcome === 'ok') {
            await refresh(true);
            return { ok: true };
          }
          return { ok: false, error: `${err.message} “${label}” was NOT saved – you can try again.` };
        }
      } finally {
        pendingRef.current.delete(key);
        if (mounted.current) setPending([...pendingRef.current]);
      }
    },
    [markFailure, refresh, verifyOutcome],
  );

  const dispatch = useCallback(
    (cmd: Command) => {
      const key = actionKey(cmd);
      return perform(
        key,
        ACTION_LABEL[key] ?? 'This action',
        (requestId) => api.command(campaignId, cmd, requestId, activeRef.current ?? undefined, worldRef.current),
        (p) => accept(p, true),
      );
    },
    [accept, campaignId, perform],
  );

  /** World-replacing admin actions (new arena, import): idempotent, pending key 'world'. */
  const worldAction = useCallback(
    (action: Record<string, unknown>) =>
      perform(
        'world',
        ACTION_LABEL.world,
        (requestId) => api.admin<unknown>(campaignId, { ...action, requestId }, { timeoutMs: 45_000 }),
        (p) => {
          if (p && typeof p === 'object' && 'role' in p) accept(p as CampaignPayload, true);
        },
      ),
    [accept, campaignId, perform],
  );

  const uploadPortrait = useCallback(
    async (tokenId: string, dataUrl: string) => {
      try {
        await api.uploadPortrait(tokenId, dataUrl);
        await refresh(true);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    [refresh],
  );

  const sheetCall = useCallback(async (fn: () => Promise<SheetPayload>): Promise<SheetResult> => {
    try {
      return { ok: true, sheet: await fn() };
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, String(e));
      if (err.status === 401) setError(err);
      const conflict = err.details?.current as SheetPayload | undefined;
      return { ok: false, error: transient(err) ? `${err.message} Your change was NOT confirmed – please check the sheet before trying again.` : err.message, conflict };
    }
  }, []);
  const sheets: SheetApi = useMemo(
    () => ({
      revision: sheetRevision,
      load: (tokenId) => sheetCall(() => api.sheet(tokenId)),
      save: (tokenId, sheet, expectedVersion, reason) => sheetCall(() => api.saveSheet(tokenId, sheet, expectedVersion, reason)),
      adjust: (tokenId, target, delta, resourceId) => sheetCall(() => api.adjustSheet(tokenId, target, delta, resourceId)),
      party: () => api.party().then((r) => r.members, () => []),
    }),
    [sheetCall, sheetRevision],
  );

  const connection: Connection = unknownAction
    ? 'unknown'
    : failures >= SYNC_TIMING.unavailableAfter
      ? 'unavailable'
      : failures > 0
        ? 'reconnecting'
        : pending.length
          ? 'pending'
          : syncing || !lastSync
            ? 'syncing'
            : 'connected';

  const adminRaw = useCallback((action: Record<string, unknown>) => api.admin(campaignId, action), [campaignId]);
  const changePassword = useCallback(async (current: string, next: string) => {
    try {
      await api.changePassword(current, next);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, []);
  const refreshForce = useCallback(() => void refresh(true), [refresh]);

  // Stable identities: consumers' effects must not re-run on every render (this caused the
  // production request storm of 2026-11-01, see docs/INCIDENT_2026-11-01.md).
  const online: OnlineControls | undefined = useMemo(
    () =>
      payload
        ? {
            profileName,
            changePassword,
            campaignId,
            campaignName: payload.campaignName,
            characters: payload.role === 'player' ? payload.characters : [],
            activeCharacter: payload.role === 'player' ? payload.activeCharacter : null,
            setActiveCharacter,
            connection,
            realtimeLive: realtime === 'live',
            unknownAction: unknownAction?.label ?? null,
            syncError,
            worldNotice,
            clearWorldNotice: () => setWorldNotice(null),
            version: payload.version,
            lastSync,
            refresh: refreshForce,
            signOut,
            admin: adminRaw,
            worldAction,
            characterArchive: api.characterArchive,
            feedbackList: () => api.feedbackList().then((r) => r.feedback),
            feedback: api.feedback,
          }
        : undefined,
    [worldNotice, worldAction, payload, profileName, changePassword, campaignId, setActiveCharacter, connection, realtime, unknownAction, syncError, lastSync, refreshForce, signOut, adminRaw],
  );

  const gmState = payload?.role === 'gm' ? payload.state : null;
  const view: ViewModel | null = useMemo(() => {
    if (!payload) return null;
    if (payload.role === 'gm') return payload.state ? buildGmView(payload.state) : null;
    return payload.view ? withLookup(payload.view) : null;
  }, [payload]);

  const busy = pending.some((k) => k === 'move' || k === 'phase' || k === 'world');
  const game: GameApi | null = useMemo(
    () =>
      payload && view && online
        ? {
            mode: 'online',
            view,
            gmState,
            busy,
            pending,
            dispatch,
            regenerate: (radius, seed) => worldAction({ action: 'initCampaign', radius, seed }),
            importState: async (text) => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(text);
              } catch {
                return { ok: false, error: 'The file is not valid JSON.' };
              }
              return worldAction({ action: 'importState', state: parsed });
            },
            sheets,
            uploadPortrait,
            online,
          }
        : null,
    [payload, view, online, gmState, busy, pending, dispatch, worldAction, sheets, uploadPortrait],
  );

  return { game, payload, error, loading: !payload && !error, refresh: refreshForce };
}
