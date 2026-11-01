/** Small fetch wrapper for /api/apex. Attaches the current Supabase access token. */
import type { AdminOverview, CampaignPayload, SessionInfo } from '../server/protocol';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** Seconds the server asks us to wait (rate limits). */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  op: string,
  query: Record<string, string | undefined> = {},
  body?: unknown,
  anonymous = false,
): Promise<T> {
  let token: string | undefined;
  if (!anonymous) {
    const { data } = await supabase().auth.getSession();
    token = data.session?.access_token;
    if (!token) throw new ApiError(401, 'Please sign in.', 'unauthenticated');
  }
  const params = new URLSearchParams({ op });
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  let res: Response;
  try {
    res = await fetch(`/api/apex?${params}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
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
    const err = (json ?? {}) as { error?: string; code?: string; retryAfter?: number };
    const fallback =
      res.status === 404 ? 'The APEX server (/api/apex) was not found on this deployment.' : `The APEX server answered with an error (${res.status}).`;
    throw new ApiError(res.status, err.error ?? fallback, err.code, typeof err.retryAfter === 'number' ? err.retryAfter : undefined);
  }
  return json as T;
}

export const api = {
  requestCode: (email: string, profile?: string) => request<{ sent: boolean; message: string; retryAfter?: number }>('POST', 'request-code', {}, { email, profile }, true),
  health: () => request<import('../server/repo').HealthReport>('GET', 'health', {}, undefined, true),
  ping: (campaign: string, profile?: string) => request<{ version: number }>('GET', 'ping', { campaign, profile }),
  session: () => request<SessionInfo>('GET', 'session'),
  state: (campaign: string, as?: string, profile?: string) => request<CampaignPayload>('GET', 'state', { campaign, as, profile }),
  command: (campaignId: string, command: unknown, as?: string, profile?: string) =>
    request<CampaignPayload>('POST', 'command', {}, { campaignId, command, as, profile }),
  admin: <T = AdminOverview>(campaignId: string, action: Record<string, unknown>) => request<T>('POST', 'admin', {}, { campaignId, ...action }),
};
