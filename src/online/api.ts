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
  journalImage: (id: string) => request<{ url:string; mime:string; expiresIn:number }>('GET','journal-images',{ id }),
  journalImageUpload: (entryId:string,image:string,thumbnail:string) => request<{ id:string }>('POST','journal-images',{}, { entryId,image,thumbnail }),
  sanctuary: () => request<import('../server/sanctuary').SanctuarySettings>('GET', 'sanctuary'),
  sanctuarySave: (settings: import('../server/sanctuary').SanctuarySettings) => request<import('../server/sanctuary').SanctuarySettings>('POST', 'sanctuary', {}, settings),
  sceneTravelState: (sceneId: string) => request<import('../server/sceneTravel').TravelSnapshot>('GET', 'scene-travel', { sceneId }),
  sceneTravelAction: (input: Record<string, unknown>) => request<{ ok: boolean; error?: string }>('POST', 'scene-travel', {}, input),
  sceneMove: (input: Record<string, unknown>) => request<{ ok: boolean; error?: string }>('POST', 'scene-motion', {}, input),
  playerScenePreview: (player: string) => request<import('../server/sceneRuntime').SceneSnapshot>('GET', 'scene-runtime', { player }),
  sceneFocus: (sceneId: string) => request<import('../server/sceneRuntime').SceneSnapshot>('GET', 'scene-runtime', { focus: sceneId }),
  mapImage: (id: string, thumbnail = false) => request<{ url: string; expiresIn: number }>('GET', 'scene-assets', { id, thumbnail: thumbnail ? '1' : undefined }),
  mapUpload: (sceneId: string, audience: 'gm' | 'players', image: string, thumbnail: string) => request<{ id: string; width: number; height: number }>('POST', 'scene-assets', {}, { sceneId, audience, image, thumbnail }, { timeoutMs: 30_000 }),
  scenePlayers: () => request<{ players: { userId: string; name: string; tokenIds: string[]; sceneId: string | null; revision: number; inheritedArena: boolean; joined?: boolean }[] }>('GET', 'scene-runtime'),
  sceneMotionState: (sceneId: string, tokenId: string) => request<import('../server/sceneMotion').MotionSnapshot>('GET', 'scene-motion', { sceneId, tokenId }),
  sceneAssign: (sceneId: string | null, targets: { userId: string; revision: number }[], requestId: string) => request<{ ok: boolean; error?: string }>('POST', 'scene-runtime', {}, { sceneId, targets, requestId }),
  sceneAction: (id: string, revision: number, action: string, fields: Record<string, unknown> = {}) => request<{ scene: import('../server/scenes').SceneDefinition }>('POST', 'scenes', {}, { ...fields, id, revision, action }),
  journalList: (offset = 0, mine = false, filters:import('../server/journals').JournalFilters={}) => request<{ entries: import('../server/journals').JournalEntry[]; nextOffset: number | null; ownerId: string }>('GET', 'journal', { offset: String(offset), mine: mine ? '1' : undefined, ...filters }),
  journalBacklinks: (id: string, offset = 0) => request<{ entries: import('../server/journals').JournalEntry[]; nextOffset: number | null }>('GET', 'journal', { backlinks: id, offset: String(offset) }),
  journalRead: (id: string) => request<{ entry: import('../server/journals').JournalEntry }>('GET', 'journal', { id }),
  journalSave: (id: string, version: number, entry: import('../server/journals').JournalDraft) => request<{ entry: import('../server/journals').JournalEntry }>('POST', 'journal', {}, { action: 'save', id, version, entry }),
  journalDelete: (id: string, version: number) => request<{ deleted: boolean }>('POST', 'journal', {}, { action: 'delete', id, version }),
  sceneList: (offset=0,filters:import('../server/scenes').SceneFilters={}) => request<{scenes:import('../server/scenes').SceneSummary[];nextOffset:number|null}>('GET','scenes',{offset:String(offset),category:filters.category,search:filters.search,archived:filters.archived===undefined?undefined:filters.archived?'1':'0',sort:filters.sort}),
  scenePreview: (id: string) => request<{ scene: import('../server/scenes').SceneDefinition }>('GET', 'scenes', { id }),
  kenneyPreview: (sceneId: string) => request<{ assets: { ground: string; tree: string; bush: string }; expiresIn: number }>('GET', 'kenney-preview', { sceneId }),
  sceneCreate: (name: string, category: import('../server/scenes').SceneCategory, template?: string) => request<{ scene: import('../server/scenes').SceneDefinition }>('POST', 'scenes', {}, { name, category, template }),
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
  command: (campaignId: string, command: unknown, requestId: string, as?: string, worldId?: string | null, sceneRevision = 0) =>
    request<CampaignPayload>('POST', 'command', {}, { campaignId, command, as, requestId, sceneRevision, ...(worldId !== undefined ? { worldId } : {}) }),
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
  sheetAbility: (tokenId: string, body: Record<string, unknown>) => request<SheetPayload>('POST', 'sheet', {}, { ...body, tokenId }),
  uploadBeastImage: (tokenId: string, formId: string, image: string) => request<{ v: number }>('POST', 'beast-image', {}, { tokenId, formId, image }, { timeoutMs: 30_000 }),
  /** APEX 0.7 – GM character archive (snapshots). */
  characterArchive: <T>(body: Record<string, unknown>) => request<T>('POST', 'character-archive', {}, body),
  /** APEX 0.7 – feedback reports (players: own + shared, GM: all). */
  feedbackList: () => request<{ feedback: import('../server/repo').FeedbackRow[] }>('GET', 'feedback'),
  feedback: <T>(body: Record<string, unknown>) => request<T>('POST', 'feedback', {}, body, { timeoutMs: 30_000 }),
};
