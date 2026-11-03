/**
 * Small fetch wrapper for /api/apex. The session lives in an HttpOnly cookie that the browser
 * sends automatically (same origin); JavaScript never sees it. Every request carries the
 * X-APEX-CSRF header that the server requires for state-changing requests.
 */
import type { CharacterSheet } from '../game/sheet';
import type { AdminOverview, CampaignPayload, PublicProfile, SessionInfo, SheetPayload, UnchangedPayload, PartyVital } from '../server/protocol';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** Seconds the server asks us to wait (rate limits). */
    public retryAfter?: number,
    /** Extra fields of the error answer (e.g. the current sheet on a conflict). */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface RequestOptions {
  /** Abort after this many milliseconds (default 15 s; state-changing requests 25 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Random id for state-changing requests (idempotency – the server applies each id at most once). */
export const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;

async function request<T>(
  method: 'GET' | 'POST',
  op: string,
  query: Record<string, string | undefined> = {},
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const params = new URLSearchParams({ op });
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort('timeout'), opts.timeoutMs ?? (method === 'POST' ? 25_000 : 15_000));
  const onAbort = () => ctrl.abort('cancelled');
  opts.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(`/api/apex?${params}`, {
      method,
      credentials: 'same-origin',
      headers: { 'x-apex-csrf': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    if (ctrl.signal.reason === 'cancelled') throw new ApiError(0, 'Request cancelled.', 'cancelled');
    if (ctrl.signal.reason === 'timeout') throw new ApiError(0, 'The APEX server did not answer in time.', 'timeout');
    throw new ApiError(0, 'Cannot reach the APEX server. Check your connection.', 'network');
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = (json ?? {}) as { error?: string; code?: string; retryAfter?: number } & Record<string, unknown>;
    const fallback =
      res.status === 404 ? 'The APEX server (/api/apex) was not found on this deployment.' : `The APEX server answered with an error (${res.status}).`;
    throw new ApiError(res.status, err.error ?? fallback, err.code, typeof err.retryAfter === 'number' ? err.retryAfter : undefined, err);
  }
  return json as T;
}

export const api = {
  profiles: () => request<{ profiles: PublicProfile[] }>('GET', 'profiles'),
  login: (profile: string, password: string) => request<{ ok: true; profile: string }>('POST', 'login', {}, { profile, password }),
  setup: (code: string, password: string) => request<{ ok: true; profile: string }>('POST', 'setup', {}, { code, password }),
  logout: () => request<{ ok: true }>('POST', 'logout', {}, {}),
  changePassword: (current: string, next: string) => request<{ ok: true }>('POST', 'password', {}, { current, next }),
  health: () => request<import('../server/repo').HealthReport>('GET', 'health'),
  ping: (campaign: string, signal?: AbortSignal) => request<{ version: number; syncTopic: string }>('GET', 'ping', { campaign }, undefined, { timeoutMs: 10_000, signal }),
  session: () => request<SessionInfo>('GET', 'session'),
  /** since = version the client already has → the server answers {unchanged:true} instead of the full state. */
  state: (campaign: string, as?: string, since?: number, signal?: AbortSignal) =>
    request<CampaignPayload | UnchangedPayload>('GET', 'state', { campaign, as, since: since ? String(since) : undefined }, undefined, { signal }),
  command: (campaignId: string, command: unknown, requestId: string, as?: string, worldId?: string | null) =>
    request<CampaignPayload>('POST', 'command', {}, { campaignId, command, as, requestId, ...(worldId !== undefined ? { worldId } : {}) }),
  commandStatus: (requestId: string) =>
    request<{ state: 'ok' | 'failed' | 'pending' | 'unknown'; version: number | null; error: string | null }>('GET', 'command-status', { requestId }, undefined, { timeoutMs: 10_000 }),
  admin: <T = AdminOverview>(campaignId: string, action: Record<string, unknown>, opts?: RequestOptions) =>
    request<T>('POST', 'admin', {}, { campaignId, ...action }, opts),
  uploadPortrait: (tokenId: string, image: string) =>
    request<{ tokenId: string; portraitV: number; version: number }>('POST', 'portrait', {}, { tokenId, image }, { timeoutMs: 30_000 }),
  sheet: (tokenId: string) => request<SheetPayload>('GET', 'sheet', { token: tokenId }),
  party: () => request<{ members: PartyVital[] }>('GET', 'party'),
  saveSheet: (tokenId: string, sheet: CharacterSheet, expectedVersion: number, reason: 'edit' | 'import-merge' | 'import-replace' | 'import-levelup' = 'edit') =>
    request<SheetPayload>('POST', 'sheet', {}, { action: 'save', tokenId, sheet, expectedVersion, reason }),
  adjustSheet: (tokenId: string, target: 'hp' | 'hpTemp' | 'resource', delta: number, resourceId?: string) =>
    request<SheetPayload>('POST', 'sheet', {}, { action: 'adjust', tokenId, target, delta, resourceId }),
  /** APEX 0.7 – GM character archive (snapshots). */
  characterArchive: <T>(body: Record<string, unknown>) => request<T>('POST', 'character-archive', {}, body),
  /** APEX 0.7 – feedback reports (players: own + shared, GM: all). */
  feedbackList: () => request<{ feedback: import('../server/repo').FeedbackRow[] }>('GET', 'feedback'),
  feedback: <T>(body: Record<string, unknown>) => request<T>('POST', 'feedback', {}, body, { timeoutMs: 30_000 }),
};
