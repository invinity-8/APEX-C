/**
 * APEX online API – the authoritative server layer.
 *
 * Security model (APEX 0.3):
 *  - Sign-in = profile ("Who are you?") + password. Passwords are verified server-side against
 *    Argon2id hashes; nothing about the password ever reaches the client again.
 *  - A successful sign-in creates a random session token, delivered ONLY as an HttpOnly, Secure,
 *    SameSite=Strict cookie. The database stores its SHA-256 hash. Sessions expire (14 days idle,
 *    30 days absolute) and are revoked on logout, password reset and deactivation.
 *  - Identity comes ONLY from the session; role and characters ONLY from the profile row in the
 *    database (apex_profiles) – never from the request body. Choosing the GM card grants nothing
 *    without the GM password.
 *  - State-changing requests (POST) must carry the header X-APEX-CSRF: 1 and, if the browser
 *    sends an Origin, it must be this site (CSRF protection on top of SameSite=Strict).
 *  - The full GameState is returned to the Game Master only. Players receive buildPlayerView()
 *    for their own character. Players may only move their characters and edit their own
 *    character's Will, sheet and inventory.
 *  - Commands are re-validated by executeCommand() against the latest stored state and written
 *    with optimistic locking (version check) – concurrent writes cannot overwrite each other.
 */
import { createDemoState, MAX_RADIUS, MIN_RADIUS } from '../data/demo.js';
import { CHARACTER_COMMANDS, executeCommand, type Command } from '../game/commands.js';
import { migrateState } from '../game/migrate.js';
import { emptySheet, parseSheet, type CharacterSheet } from '../game/sheet.js';
import type { Actor, GameState } from '../game/types.js';
import { phaseName } from '../game/text.js';
import { buildPlayerView } from '../game/visibility.js';
import { applyRoster, needsRosterUpdate } from '../game/roster.js';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  clearSessionCookie,
  dummyVerify,
  hashPassword,
  looksLikeToken,
  newSessionToken,
  normaliseSetupCode,
  passwordProblem,
  sessionCookie,
  sha256Hex,
  verifyPassword,
} from './auth.js';
import type {
  AdminOverview,
  CampaignPayload,
  CharacterRef,
  PlayerPayload,
  PublicProfile,
  SessionInfo,
  SheetPayload,
  WireView,
} from './protocol.js';
import type { AuthUser, HealthReport, Profile, Repo } from './repo.js';
import { EXPECTED_MIGRATIONS, REQUIRED_SCHEMA_VERSION } from './schema.js';
import { isId, isInt, isObj, parseCommand } from './validate.js';

export interface ApiRequest {
  method: string;
  op: string;
  query: Record<string, string | undefined>;
  body: unknown;
  /** Lower-case request headers (cookie, origin, host, x-apex-csrf, user-agent …). */
  headers: Record<string, string | undefined>;
  /** Client IP as reported by the platform (x-forwarded-for / x-real-ip). */
  ip: string | null;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /** Set-Cookie header values. */
  cookies?: string[];
}

const MAX_RETRIES = 4;
const KEEP_SNAPSHOTS = 60;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** Seconds until a retry makes sense (rate limits). */
    public retryAfter?: number,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const ok = (body: unknown, cookies?: string[]): ApiResponse => ({ status: 200, body, ...(cookies ? { cookies } : {}) });

/** A profile counts as "online" if one of its devices contacted the server within this window. */
export const PRESENCE_WINDOW_MS = 75_000;
const TOUCH_EVERY_MS = 20_000;
const SESSION_TOUCH_MS = 10 * 60_000;

/** Login rate limits (failed attempts within the window). */
export const LOGIN_LIMITS = {
  windowMs: 15 * 60_000,
  perProfile: 5,
  perIp: 20,
  global: 300,
};

export async function handleApi(req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  try {
    if (req.method === 'GET' && req.op === 'health') return ok(await health(repo));
    if (req.method === 'POST') checkCsrf(req);
    await requireCompatibleSchema(repo);

    // ---- public operations (no session yet)
    if (req.method === 'GET' && req.op === 'profiles') return ok(await profileStatus(repo));
    if (req.method === 'POST' && req.op === 'login') return await login(req, repo);
    if (req.method === 'POST' && req.op === 'setup') return await gmSetup(req, repo);
    if (req.method === 'POST' && req.op === 'logout') return await logout(req, repo);

    const user = await authenticate(req, repo);
    await touchPresence(user, repo);
    switch (`${req.method} ${req.op}`) {
      case 'GET session':
        return ok(await sessionInfo(user, repo));
      case 'GET ping': {
        // Heartbeat: keeps presence fresh and lets clients detect missed realtime pings.
        const s = await repo.loadState(user.campaignId);
        return ok({ version: s?.version ?? 0, syncTopic: await repo.syncTopic(user.campaignId) });
      }
      case 'GET state':
        return ok(await campaignPayload(user, repo, req.query.as));
      case 'POST command':
        return ok(await runCommand(user, req.body, repo));
      case 'POST admin':
        return ok(await runAdmin(user, req.body, repo));
      case 'POST password':
        return await changeOwnPassword(user, req, repo);
      case 'GET sheet':
        return ok(await getSheet(user, req.query.token, repo));
      case 'POST sheet':
        return ok(await runSheet(user, req.body, repo));
      default:
        throw new HttpError(404, 'Unknown API operation.');
    }
  } catch (e) {
    if (e instanceof HttpError) {
      const res: ApiResponse = {
        status: e.status,
        body: { error: e.message, code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}), ...(e.extra ?? {}) },
      };
      if (e.status === 401 && e.code === 'unauthenticated' && req.headers.cookie?.includes(SESSION_COOKIE)) res.cookies = [clearSessionCookie()];
      return res;
    }
    console.error('[apex-api]', e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|timeout/i.test(String((e as Error)?.message ?? e))) {
      return { status: 503, body: { error: 'The campaign database cannot be reached right now. Please try again in a moment.', code: 'db_unreachable' } };
    }
    return { status: 500, body: { error: 'Internal server error. Please try again.' } };
  }
}

// ---------------------------------------------------------------- CSRF

/**
 * POST requests must come from the APEX page itself: a custom header (cannot be sent cross-site
 * without a CORS preflight, which this API never grants) and – when present – a matching Origin.
 */
function checkCsrf(req: ApiRequest) {
  if (req.headers['x-apex-csrf'] !== '1') throw new HttpError(403, 'Request blocked (missing security header). Please reload the page.', 'csrf');
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Request blocked (invalid origin).', 'csrf');
  }
  if (!host || originHost !== host.split(',')[0].trim()) throw new HttpError(403, 'Request blocked (foreign origin).', 'csrf');
}

// ---------------------------------------------------------------- deployment health & schema gate

export async function health(repo: Repo): Promise<HealthReport> {
  const errors: string[] = [];
  const r: HealthReport = {
    database: false,
    campaignSeeded: false,
    profilesTable: false,
    realtime: false,
    securityOk: null,
    schemaVersion: null,
    requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
    migrationsComplete: false,
    missingMigrations: [...EXPECTED_MIGRATIONS],
    unknownMigrations: [],
    errors,
  };
  try {
    const d = await repo.deployStatus();
    r.database = true;
    r.schemaVersion = d.schemaVersion;
    r.campaignSeeded = d.campaignSeeded;
    r.profilesTable = d.profiles === 5;
    r.realtime = d.realtime;
    r.securityOk = d.securityProblems === null ? null : d.securityProblems.length === 0;
    if (d.securityProblems?.length) errors.push(`Security problems: ${d.securityProblems.join('; ')}`);
    r.missingMigrations = EXPECTED_MIGRATIONS.filter((v) => !d.migrations.includes(v));
    r.unknownMigrations = d.migrations.filter((v) => !EXPECTED_MIGRATIONS.includes(v));
    r.migrationsComplete = r.missingMigrations.length === 0;
    if (!r.migrationsComplete) errors.push(`Database migrations missing: ${r.missingMigrations.join(', ')}`);
    if (r.unknownMigrations.length) errors.push(`Database has migrations this deployment does not know: ${r.unknownMigrations.join(', ')}`);
    if ((d.schemaVersion ?? 0) < REQUIRED_SCHEMA_VERSION) errors.push(`Database schema version ${d.schemaVersion} is older than required ${REQUIRED_SCHEMA_VERSION}`);
    if (!d.campaignSeeded) errors.push('The main campaign is missing.');
    if (d.profiles !== 5) errors.push(`Expected 5 profiles, found ${d.profiles}.`);
    if (!d.realtime) errors.push('The live-update broadcast trigger is not installed.');
  } catch (e) {
    errors.push(`database: ${(e as Error).message}`);
  }
  return r;
}

let schemaCheckedAt = 0;
/** Refuses campaign requests while the database is older than this code (cached for 60 s). */
async function requireCompatibleSchema(repo: Repo) {
  if (Date.now() - schemaCheckedAt < 60_000) return;
  const d = await repo.deployStatus();
  if ((d.schemaVersion ?? 0) < REQUIRED_SCHEMA_VERSION) {
    throw new HttpError(503, 'The campaign database is being updated. Please try again in a few minutes.', 'schema_outdated');
  }
  schemaCheckedAt = Date.now();
}

/** Test helper: forget the cached schema check. */
export function resetSchemaCache() {
  schemaCheckedAt = 0;
}

// ---------------------------------------------------------------- profiles & sign-in

/** Public: which profiles can currently sign in (no account data, no hashes). */
async function profileStatus(repo: Repo): Promise<{ profiles: PublicProfile[] }> {
  const all = await repo.profiles(null);
  const out = new Map<string, PublicProfile>();
  for (const p of all) {
    const pwSet = !!(await repo.credential(p.campaignId, p.key));
    const prev = out.get(p.key);
    const entry: PublicProfile = { key: p.key, active: (prev?.active ?? false) || (p.active && pwSet) };
    if (p.role === 'gm' && !pwSet) entry.needsSetup = true;
    out.set(p.key, entry);
  }
  return { profiles: [...out.values()] };
}

async function findProfile(repo: Repo, key: unknown, campaignId?: unknown): Promise<Profile> {
  if (typeof key !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(key)) throw new HttpError(400, 'Please choose your profile.', 'bad_profile');
  const matches = (await repo.profiles(null)).filter((p) => p.key === key && (typeof campaignId !== 'string' || p.campaignId === campaignId));
  if (!matches.length) throw new HttpError(404, 'This profile does not exist.', 'bad_profile');
  if (matches.length > 1) throw new HttpError(400, 'Please choose a campaign.', 'choose_campaign');
  return matches[0];
}

const ipHashOf = (req: ApiRequest) => sha256Hex(`apex-ip:${req.ip ?? 'unknown'}`);

/** Throws 429 when too many failed attempts happened recently. Checked BEFORE the password. */
async function checkLoginRate(repo: Repo, profileKey: string, ipHash: string) {
  const since = new Date(Date.now() - LOGIN_LIMITS.windowMs).toISOString();
  const s = await repo.loginAttemptStats(profileKey, ipHash, since);
  const wait = () => {
    const oldest = s.oldestProfileFailure ? Date.parse(s.oldestProfileFailure) : Date.now();
    return Math.max(30, Math.ceil((oldest + LOGIN_LIMITS.windowMs - Date.now()) / 1000));
  };
  if (s.profileFailures >= LOGIN_LIMITS.perProfile) {
    throw new HttpError(429, `Too many wrong passwords for this profile. Please wait ${Math.ceil(wait() / 60)} minutes and try again.`, 'rate_limited', wait());
  }
  if (s.ipFailures >= LOGIN_LIMITS.perIp || s.globalFailures >= LOGIN_LIMITS.global) {
    throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes and try again.', 'rate_limited', 900);
  }
}

/** Creates a session for a profile and returns the Set-Cookie header. */
async function startSession(repo: Repo, p: Profile, req: ApiRequest): Promise<string> {
  const token = newSessionToken();
  const now = Date.now();
  await repo.createSession({
    tokenHash: await sha256Hex(token),
    campaignId: p.campaignId,
    profileKey: p.key,
    userId: p.userId,
    expiresAt: new Date(now + Math.min(SESSION_IDLE_MS, SESSION_ABSOLUTE_MS)).toISOString(),
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 200) || null,
  });
  await ensureMember(repo, p);
  return sessionCookie(token, SESSION_IDLE_MS / 1000);
}

/** Keeps apex_campaign_members / assignments in sync with the profile (presence & audit). */
async function ensureMember(repo: Repo, p: Profile) {
  const members = await repo.members(p.campaignId);
  const m = members.find((x) => x.userId === p.userId);
  if (!m || m.role !== p.role) await repo.upsertMember({ campaignId: p.campaignId, userId: p.userId, email: null, role: p.role });
}

async function login(req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  const body = isObj(req.body) ? req.body : {};
  const p = await findProfile(repo, body.profile, body.campaignId);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw new HttpError(400, 'Please enter your password.', 'bad_password');
  if (password.length > 1000) throw new HttpError(400, 'This password is too long.', 'bad_password');
  const ipHash = await ipHashOf(req);
  await checkLoginRate(repo, p.key, ipHash);

  const cred = await repo.credential(p.campaignId, p.key);
  if (!cred || !p.active) {
    await dummyVerify(password);
    throw new HttpError(
      403,
      p.role === 'gm' && !cred
        ? 'The Game Master password has not been set up yet. Use “First-time setup” with your setup code.'
        : 'This profile has not been activated by the Game Master yet.',
      p.role === 'gm' && !cred ? 'needs_setup' : 'profile_locked',
    );
  }
  if (!(await verifyPassword(password, cred.passwordHash))) {
    await repo.recordLoginAttempt(p.key, ipHash, false);
    throw new HttpError(401, 'Wrong password. Please try again.', 'wrong_password');
  }
  await repo.recordLoginAttempt(p.key, ipHash, true);
  const cookie = await startSession(repo, p, req);
  return ok({ ok: true, profile: p.key }, [cookie]);
}

/**
 * One-time Game Master setup: a setup code created by a database owner
 * (select apex_private.create_gm_setup_code(); in the Supabase SQL editor) lets the GM set
 * or reset the GM password. Codes are single-use, expire, and are rate-limited like logins.
 * There is no permanent master password and nothing in the code base or environment that
 * grants access by itself.
 */
async function gmSetup(req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  const body = isObj(req.body) ? req.body : {};
  const ipHash = await ipHashOf(req);
  await checkLoginRate(repo, '__setup', ipHash);
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem, 'bad_password');
  const code = normaliseSetupCode(body.code);
  const campaignId = code ? await repo.consumeSetupCode(await sha256Hex(code)) : null;
  if (!campaignId) {
    await repo.recordLoginAttempt('__setup', ipHash, false);
    throw new HttpError(401, 'This setup code is wrong, expired or has already been used.', 'bad_code');
  }
  const gm = (await repo.profiles(campaignId)).find((p) => p.role === 'gm');
  if (!gm) throw new HttpError(500, 'The campaign has no Game Master profile.');
  await repo.recordLoginAttempt('__setup', ipHash, true);
  await repo.setCredential(campaignId, gm.key, await hashPassword(body.password as string), gm.userId);
  if (!gm.active) await repo.updateProfile(campaignId, gm.key, { active: true });
  await repo.revokeProfileSessions(campaignId, gm.key);
  const cookie = await startSession(repo, { ...gm, active: true }, req);
  return ok({ ok: true, profile: gm.key }, [cookie]);
}

async function logout(req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  const token = req.headers.cookie ? cookieToken(req) : undefined;
  if (looksLikeToken(token)) await repo.revokeSession(await sha256Hex(token));
  return ok({ ok: true }, [clearSessionCookie()]);
}

async function changeOwnPassword(user: AuthUser, req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  const body = isObj(req.body) ? req.body : {};
  const cred = await repo.credential(user.campaignId, user.profileKey);
  const ipHash = await ipHashOf(req);
  await checkLoginRate(repo, user.profileKey, ipHash);
  if (!cred || typeof body.current !== 'string' || !(await verifyPassword(body.current, cred.passwordHash))) {
    await repo.recordLoginAttempt(user.profileKey, ipHash, false);
    throw new HttpError(401, 'Your current password is not correct.', 'wrong_password');
  }
  const problem = passwordProblem(body.next);
  if (problem) throw new HttpError(400, problem, 'bad_password');
  await repo.setCredential(user.campaignId, user.profileKey, await hashPassword(body.next as string), user.id);
  // Other devices must sign in again with the new password; this device stays signed in.
  await repo.revokeProfileSessions(user.campaignId, user.profileKey, user.sessionHash);
  return ok({ ok: true });
}

// ---------------------------------------------------------------- identity

const cookieToken = (req: ApiRequest) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return undefined;
};

async function authenticate(req: ApiRequest, repo: Repo): Promise<AuthUser> {
  const token = cookieToken(req);
  if (!looksLikeToken(token)) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  const hash = await sha256Hex(token);
  const s = await repo.session(hash);
  const now = Date.now();
  if (!s || s.revokedAt || Date.parse(s.expiresAt) <= now || Date.parse(s.createdAt) + SESSION_ABSOLUTE_MS <= now) {
    throw new HttpError(401, 'Your session has ended. Please sign in again.', 'unauthenticated');
  }
  const p = (await repo.profiles(s.campaignId)).find((x) => x.key === s.profileKey);
  // Profile removed, deactivated, password removed or re-keyed → the session is no longer valid.
  if (!p || !p.active || p.userId !== s.userId || !(await repo.credential(s.campaignId, s.profileKey))) {
    await repo.revokeSession(hash);
    throw new HttpError(401, 'Your access has been changed by the Game Master. Please sign in again.', 'unauthenticated');
  }
  if (now - Date.parse(s.lastSeenAt) > SESSION_TOUCH_MS) {
    const expires = Math.min(now + SESSION_IDLE_MS, Date.parse(s.createdAt) + SESSION_ABSOLUTE_MS);
    await repo.touchSession(hash, new Date(expires).toISOString()).catch(() => undefined);
  }
  return {
    id: p.userId,
    campaignId: p.campaignId,
    profileKey: p.key,
    displayName: p.displayName,
    role: p.role,
    tokenIds: p.tokenIds,
    sessionHash: hash,
  };
}

async function touchPresence(user: AuthUser, repo: Repo) {
  const m = (await repo.members(user.campaignId)).find((x) => x.userId === user.id);
  if (!m) {
    await repo.upsertMember({ campaignId: user.campaignId, userId: user.id, email: null, role: user.role }).catch(() => undefined);
    return;
  }
  const last = m.lastSeenAt ? Date.parse(m.lastSeenAt) : 0;
  if (Date.now() - last > TOUCH_EVERY_MS) await repo.touchMember(user.campaignId, user.id).catch(() => undefined);
}

function checkCampaign(user: AuthUser, campaignId: unknown) {
  if (campaignId !== undefined && campaignId !== null && campaignId !== user.campaignId) {
    throw new HttpError(403, 'You are not a member of this campaign.', 'not_authorized');
  }
}

async function campaignName(campaignId: string, repo: Repo): Promise<string> {
  return (await repo.campaignsById([campaignId]))[0]?.name ?? 'APEX Campaign';
}

async function sessionInfo(user: AuthUser, repo: Repo): Promise<SessionInfo> {
  return {
    user: { id: user.id, profile: user.profileKey, displayName: user.displayName, role: user.role },
    campaigns: [{ id: user.campaignId, name: await campaignName(user.campaignId, repo), role: user.role }],
    syncTopic: await repo.syncTopic(user.campaignId),
  };
}

// ---------------------------------------------------------------- views

const toWire = (view: ReturnType<typeof buildPlayerView>): WireView => {
  const { hexByKey: _drop, ...rest } = view;
  return rest;
};

function charactersOf(user: AuthUser, state: GameState | null): CharacterRef[] {
  if (!state || user.role === 'gm') return [];
  return user.tokenIds.filter((id) => state.tokens[id]?.kind === 'player').map((id) => ({ id, name: state.tokens[id].name }));
}

async function campaignPayload(user: AuthUser, repo: Repo, as?: string, stored?: { state: GameState; version: number } | null): Promise<CampaignPayload> {
  const s = stored === undefined ? await repo.loadState(user.campaignId) : stored;
  const name = await campaignName(user.campaignId, repo);
  if (user.role === 'gm') {
    return { role: 'gm', campaignId: user.campaignId, campaignName: name, version: s?.version ?? 0, state: s?.state ?? null };
  }
  const characters = charactersOf(user, s?.state ?? null);
  const base: PlayerPayload = {
    role: 'player',
    campaignId: user.campaignId,
    campaignName: name,
    version: s?.version ?? 0,
    characters,
    activeCharacter: null,
    view: null,
  };
  if (!s) return { ...base, notice: 'The Game Master has not opened the arena yet.' };
  if (!characters.length) return { ...base, notice: 'No character has been assigned to your profile yet. Please ask your Game Master.' };
  const active = characters.find((c) => c.id === as)?.id ?? characters[0].id;
  return { ...base, activeCharacter: active, view: toWire(buildPlayerView(s.state, active)) };
}

// ---------------------------------------------------------------- commands

async function runCommand(user: AuthUser, body: unknown, repo: Repo): Promise<CampaignPayload> {
  if (!isObj(body)) throw new HttpError(400, 'Invalid request.');
  checkCampaign(user, body.campaignId);
  const parsed = parseCommand(body.command);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const cmd = parsed.command;
  const as = typeof body.as === 'string' ? body.as : undefined;
  const log = (ok: boolean, error?: string, version?: number) =>
    repo.logCommand({ campaignId: user.campaignId, userId: user.id, role: user.role, command: cmd, ok, error, version });

  if (user.role !== 'gm' && cmd.type !== 'move' && !CHARACTER_COMMANDS.has(cmd.type)) {
    await log(false, 'gm-only');
    throw new HttpError(403, 'Only the Game Master can do that.', 'forbidden');
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const stored = await repo.loadState(user.campaignId);
    if (!stored) throw new HttpError(409, 'The campaign has not been initialised yet.', 'not_initialised');

    let actor: Actor;
    try {
      actor = actorFor(user, cmd, stored.state);
    } catch (e) {
      await log(false, (e as Error).message);
      throw e;
    }
    const res = executeCommand(stored.state, actor, cmd);
    if (!res.ok) {
      await log(false, res.error);
      throw new HttpError(422, res.error, 'rejected');
    }
    const version = await repo.saveState(user.campaignId, res.state, stored.version, user.id);
    if (version === null) continue; // somebody else wrote first → re-validate against the fresh state

    await log(true, undefined, version);
    if ((cmd.type === 'advancePhase' || cmd.type === 'endDay') && res.state.phase === 'day') {
      await repo.createSnapshot(user.campaignId, res.state, version, `Dawn of ${phaseName('day', res.state.day)}`, null);
      await repo.pruneSnapshots(user.campaignId, KEEP_SNAPSHOTS);
    }
    return campaignPayload(user, repo, as ?? (CHARACTER_COMMANDS.has(cmd.type) ? (cmd as { tokenId: string }).tokenId : undefined), {
      state: res.state,
      version,
    });
  }
  throw new HttpError(409, 'The campaign was changed by someone else at the same time. Please try again.', 'conflict');
}

/** Determines the in-game actor. Never trusts anything but the server-side profile. */
function actorFor(user: AuthUser, cmd: Command, state: GameState): Actor {
  if (user.role === 'gm') return { role: 'gm' };
  const own = charactersOf(user, state).map((c) => c.id);
  if (!own.length) throw new HttpError(403, 'No character has been assigned to your profile.', 'forbidden');
  if (cmd.type === 'move') {
    if (own.includes(cmd.tokenId)) return { role: 'player', tokenId: cmd.tokenId };
    // In-game control permission granted by the GM (Token.controllers).
    const target = state.tokens[cmd.tokenId];
    const via = own.find((id) => target?.kind === 'player' && target.controllers.includes(id));
    if (via) return { role: 'player', tokenId: via };
    throw new HttpError(403, `You may not move ${target?.name ?? 'this character'} – only characters assigned to you.`, 'forbidden');
  }
  if (CHARACTER_COMMANDS.has(cmd.type)) {
    const tokenId = (cmd as { tokenId: string }).tokenId;
    if (!own.includes(tokenId)) throw new HttpError(403, 'You can only change your own character.', 'forbidden');
    return { role: 'player', tokenId };
  }
  return { role: 'player', tokenId: own[0] };
}

// ---------------------------------------------------------------- character sheets

/** Which characters may this profile see/edit the sheet of? GM: all player characters; players: their own. */
function sheetAccess(user: AuthUser, tokenId: unknown, state: GameState | null): string {
  if (!isId(tokenId)) throw new HttpError(400, 'Invalid character.');
  if (!state) throw new HttpError(409, 'The campaign has not been initialised yet.', 'not_initialised');
  if (state.tokens[tokenId]?.kind !== 'player') throw new HttpError(404, 'Character not found.');
  if (user.role !== 'gm' && !user.tokenIds.includes(tokenId)) {
    throw new HttpError(403, 'You can only open your own character sheet.', 'forbidden');
  }
  return tokenId;
}

async function getSheet(user: AuthUser, tokenId: unknown, repo: Repo): Promise<SheetPayload> {
  const state = (await repo.loadState(user.campaignId))?.state ?? null;
  const id = sheetAccess(user, tokenId, state);
  return sheetPayload(repo, user.campaignId, id, state!);
}

async function sheetPayload(repo: Repo, campaignId: string, tokenId: string, state: GameState): Promise<SheetPayload> {
  const s = await repo.loadSheet(campaignId, tokenId);
  const parsed = s ? parseSheet(s.data) : null;
  return {
    tokenId,
    characterName: state.tokens[tokenId].name,
    sheet: parsed?.ok ? parsed.sheet : emptySheet(),
    version: s?.version ?? 0,
    updatedAt: s?.updatedAt ?? null,
  };
}

async function runSheet(user: AuthUser, body: unknown, repo: Repo): Promise<SheetPayload> {
  if (!isObj(body)) throw new HttpError(400, 'Invalid request.');
  const state = (await repo.loadState(user.campaignId))?.state ?? null;
  const tokenId = sheetAccess(user, body.tokenId, state);
  const cid = user.campaignId;

  if (body.action === 'save') {
    const parsed = parseSheet(body.sheet);
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    if (!isInt(body.expectedVersion, Number.MAX_SAFE_INTEGER) || body.expectedVersion < 0) throw new HttpError(400, 'Invalid sheet version.');
    const reason = body.reason === 'import-merge' || body.reason === 'import-replace' ? body.reason : 'edit';
    const cur = await repo.loadSheet(cid, tokenId);
    if ((cur?.version ?? 0) !== body.expectedVersion) {
      throw new HttpError(409, 'This character sheet was changed on another device. The latest version has been loaded – please check it and save again.', 'sheet_conflict', undefined, {
        current: await sheetPayload(repo, cid, tokenId, state!),
      });
    }
    // Never replace data without a backup: imports always back up the previous sheet first.
    if (cur && reason !== 'edit') await repo.backupSheet(cid, tokenId, cur.data, cur.version, `Before ${reason === 'import-replace' ? 'import (replace)' : 'import (merge)'}`, user.id);
    const v = await repo.saveSheet(cid, tokenId, parsed.sheet, body.expectedVersion, user.id);
    if (v === null) {
      throw new HttpError(409, 'This character sheet was changed on another device. The latest version has been loaded – please check it and save again.', 'sheet_conflict', undefined, {
        current: await sheetPayload(repo, cid, tokenId, state!),
      });
    }
    return sheetPayload(repo, cid, tokenId, state!);
  }

  if (body.action === 'adjust') {
    // Atomic +/- on one value: re-applied on the latest version, so quick taps on two devices both count.
    if (!isInt(body.delta, 100000) || body.delta === 0) throw new HttpError(400, 'Invalid change.');
    const delta = body.delta;
    const target = body.target;
    if (target !== 'hp' && target !== 'hpTemp' && target !== 'resource') throw new HttpError(400, 'Invalid resource.');
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const cur = await repo.loadSheet(cid, tokenId);
      const parsed = cur ? parseSheet(cur.data) : null;
      const sheet: CharacterSheet = parsed?.ok ? parsed.sheet : emptySheet();
      if (target === 'resource') {
        const r = sheet.resources.find((x) => x.id === body.resourceId);
        if (!r) throw new HttpError(404, 'This resource no longer exists.', 'gone');
        r.current = Math.max(0, Math.min(r.max ?? 100000, r.current + delta));
      } else {
        if (!sheet.hitPoints) throw new HttpError(400, 'This character sheet has no hit points.');
        if (target === 'hp') sheet.hitPoints.current = Math.max(-sheet.hitPoints.max, Math.min(sheet.hitPoints.max, sheet.hitPoints.current + delta));
        else sheet.hitPoints.temp = Math.max(0, Math.min(100000, sheet.hitPoints.temp + delta));
      }
      const v = await repo.saveSheet(cid, tokenId, sheet, cur?.version ?? 0, user.id);
      if (v !== null) return sheetPayload(repo, cid, tokenId, state!);
    }
    throw new HttpError(409, 'The character sheet is being changed elsewhere right now. Please try again.', 'conflict');
  }
  throw new HttpError(400, 'Unknown sheet action.');
}

// ---------------------------------------------------------------- admin (GM only)

async function runAdmin(user: AuthUser, body: unknown, repo: Repo): Promise<unknown> {
  if (!isObj(body)) throw new HttpError(400, 'Invalid request.');
  if (user.role !== 'gm') throw new HttpError(403, 'Only the Game Master can manage the campaign.', 'forbidden');
  checkCampaign(user, body.campaignId);
  const cid = user.campaignId;
  const tokenList = (v: unknown): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 20 || !v.every(isId)) throw new HttpError(400, 'Invalid character list.');
    return [...new Set(v as string[])];
  };
  const profile = async () => {
    if (typeof body.profile !== 'string') throw new HttpError(400, 'Invalid profile.');
    const p = (await repo.profiles(cid)).find((x) => x.key === body.profile);
    if (!p) throw new HttpError(404, 'Profile not found.');
    return p;
  };
  const isSelf = (p: Profile) => p.key === user.profileKey;

  switch (body.action) {
    case 'overview':
      return adminOverview(cid, repo);
    case 'setPassword': {
      // Initialise or reset a profile's password. Revokes all existing sessions of that profile.
      const p = await profile();
      const problem = passwordProblem(body.password);
      if (problem) throw new HttpError(400, problem, 'bad_password');
      await repo.setCredential(cid, p.key, await hashPassword(body.password as string), user.id);
      if (!p.active) await repo.updateProfile(cid, p.key, { active: true });
      await repo.revokeProfileSessions(cid, p.key, isSelf(p) ? user.sessionHash : undefined);
      if (!isSelf(p)) await repo.rotateSyncTopic(cid);
      await ensureMember(repo, { ...p, active: true });
      return adminOverview(cid, repo);
    }
    case 'clearPassword': {
      const p = await profile();
      if (isSelf(p)) throw new HttpError(400, 'You cannot remove your own password.');
      await repo.setCredential(cid, p.key, null, user.id);
      await repo.revokeProfileSessions(cid, p.key);
      await repo.rotateSyncTopic(cid);
      return adminOverview(cid, repo);
    }
    case 'setActive': {
      const p = await profile();
      if (typeof body.active !== 'boolean') throw new HttpError(400, 'Invalid value.');
      if (isSelf(p) && !body.active) throw new HttpError(400, 'You cannot deactivate your own profile.');
      await repo.updateProfile(cid, p.key, { active: body.active });
      if (!body.active) {
        await repo.revokeProfileSessions(cid, p.key);
        await repo.rotateSyncTopic(cid);
      }
      return adminOverview(cid, repo);
    }
    case 'revokeSessions': {
      const p = await profile();
      await repo.revokeProfileSessions(cid, p.key, isSelf(p) ? user.sessionHash : undefined);
      if (!isSelf(p)) await repo.rotateSyncTopic(cid);
      return adminOverview(cid, repo);
    }
    case 'setProfileCharacters': {
      const p = await profile();
      if (p.role === 'gm') throw new HttpError(400, 'Characters can only be set for player profiles.');
      const tokenIds = tokenList(body.tokenIds);
      const stored = await repo.loadState(cid);
      if (stored && !tokenIds.every((t) => stored.state.tokens[t]?.kind === 'player')) throw new HttpError(400, 'Only player characters can be assigned.');
      // One character belongs to one profile.
      for (const other of await repo.profiles(cid)) {
        if (other.key !== p.key && other.tokenIds.some((t) => tokenIds.includes(t))) {
          throw new HttpError(400, `${stored?.state.tokens[other.tokenIds.find((t) => tokenIds.includes(t))!]?.name ?? 'This character'} is already assigned to ${other.displayName}.`);
        }
      }
      await ensureMember(repo, p);
      for (const t of p.tokenIds) await repo.assignToken(cid, t, null);
      await repo.updateProfile(cid, p.key, { tokenIds });
      for (const t of tokenIds) await repo.assignToken(cid, t, p.userId);
      return adminOverview(cid, repo);
    }
    case 'initCampaign': {
      if (!isInt(body.radius) || body.radius < MIN_RADIUS || body.radius > MAX_RADIUS) {
        throw new HttpError(400, `Radius must be between ${MIN_RADIUS} and ${MAX_RADIUS}.`);
      }
      if (!isInt(body.seed, 2_000_000_000)) throw new HttpError(400, 'Invalid seed.');
      await snapshotCurrent(cid, repo, user.id, 'Before new arena');
      const state = createDemoState({ radius: body.radius, seed: body.seed });
      await repo.replaceState(cid, state, user.id);
      return campaignPayload(user, repo);
    }
    case 'importState': {
      let state: GameState;
      try {
        state = migrateState(body.state);
      } catch (e) {
        throw new HttpError(400, `Import failed: ${(e as Error).message}`);
      }
      await snapshotCurrent(cid, repo, user.id, 'Before import');
      await repo.replaceState(cid, state, user.id);
      return campaignPayload(user, repo);
    }
    case 'applyRoster': {
      const stored = await repo.loadState(cid);
      if (!stored || !needsRosterUpdate(stored.state)) throw new HttpError(400, 'Nothing to convert.');
      await snapshotCurrent(cid, repo, user.id, 'Before character conversion');
      await repo.replaceState(cid, applyRoster(stored.state), user.id);
      return campaignPayload(user, repo);
    }
    case 'createSnapshot': {
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'Manual backup';
      await snapshotCurrent(cid, repo, user.id, label);
      return adminOverview(cid, repo);
    }
    case 'restoreSnapshot': {
      if (!isInt(body.id, Number.MAX_SAFE_INTEGER)) throw new HttpError(400, 'Invalid snapshot.');
      const snap = await repo.loadSnapshot(cid, body.id);
      if (!snap) throw new HttpError(404, 'Snapshot not found.');
      await snapshotCurrent(cid, repo, user.id, 'Before restore');
      await repo.replaceState(cid, migrateState(snap), user.id);
      return campaignPayload(user, repo);
    }
    default:
      throw new HttpError(400, 'Unknown admin action.');
  }
}

async function snapshotCurrent(cid: string, repo: Repo, userId: string, label: string) {
  const cur = await repo.loadState(cid);
  if (cur) {
    await repo.createSnapshot(cid, cur.state, cur.version, label, userId);
    await repo.pruneSnapshots(cid, KEEP_SNAPSHOTS);
  }
}

async function adminOverview(cid: string, repo: Repo): Promise<AdminOverview> {
  const [members, snapshots, profiles, stored, sessions] = await Promise.all([
    repo.members(cid),
    repo.listSnapshots(cid, 20),
    repo.profiles(cid),
    repo.loadState(cid),
    repo.activeSessionCounts(cid),
  ]);
  const online = (userId: string) => {
    const mm = members.find((x) => x.userId === userId);
    return !!mm?.lastSeenAt && Date.now() - Date.parse(mm.lastSeenAt) < PRESENCE_WINDOW_MS;
  };
  return {
    snapshots,
    profiles: await Promise.all(
      profiles.map(async (p) => {
        const cred = await repo.credential(cid, p.key);
        return {
          key: p.key,
          displayName: p.displayName,
          characterName: p.characterName,
          role: p.role,
          tokenIds: p.tokenIds,
          active: p.active,
          passwordSet: !!cred,
          passwordUpdatedAt: cred?.updatedAt ?? null,
          sessions: sessions[p.key] ?? 0,
          online: (sessions[p.key] ?? 0) > 0 && online(p.userId),
        };
      }),
    ),
    rosterOutdated: stored ? needsRosterUpdate(stored.state) : false,
  };
}
