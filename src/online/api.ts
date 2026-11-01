/**
 * Small fetch wrapper for /api/apex. The session lives in an HttpOnly cookie that the browser
 * sends automatically (same origin); JavaScript never sees it. Every request carries the
 * X-APEX-CSRF header that the server requires for state-changing requests.
 */
import type { CharacterSheet } from '../game/sheet';
import type { AdminOverview, CampaignPayload, PublicProfile, SessionInfo, SheetPayload } from '../server/protocol';

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

async function request<T>(method: 'GET' | 'POST', op: string, query: Record<string, string | undefined> = {}, body?: unknown): Promise<T> {
  const params = new URLSearchParams({ op });
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  let res: Response;
  try {
    res = await fetch(`/api/apex?${params}`, {
      method,
      credentials: 'same-origin',
      headers: { 'x-apex-csrf': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the APEX server. Check your connection.', 'network');
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
  ping: (campaign: string) => request<{ version: number; syncTopic: string }>('GET', 'ping', { campaign }),
  session: () => request<SessionInfo>('GET', 'session'),
  state: (campaign: string, as?: string) => request<CampaignPayload>('GET', 'state', { campaign, as }),
  command: (campaignId: string, command: unknown, as?: string) => request<CampaignPayload>('POST', 'command', {}, { campaignId, command, as }),
  admin: <T = AdminOverview>(campaignId: string, action: Record<string, unknown>) => request<T>('POST', 'admin', {}, { campaignId, ...action }),
  sheet: (tokenId: string) => request<SheetPayload>('GET', 'sheet', { token: tokenId }),
  saveSheet: (tokenId: string, sheet: CharacterSheet, expectedVersion: number, reason: 'edit' | 'import-merge' | 'import-replace' = 'edit') =>
    request<SheetPayload>('POST', 'sheet', {}, { action: 'save', tokenId, sheet, expectedVersion, reason }),
  adjustSheet: (tokenId: string, target: 'hp' | 'hpTemp' | 'resource', delta: number, resourceId?: string) =>
    request<SheetPayload>('POST', 'sheet', {}, { action: 'adjust', tokenId, target, delta, resourceId }),
};
