/**
 * APEX online API – the authoritative server layer.
 *
 * Security model:
 *  - Every request must carry a valid Supabase access token (verified with Supabase Auth).
 *  - Identity comes ONLY from the verified token, never from the request body.
 *  - Roles come ONLY from apex_campaign_members (server-managed), never from user metadata.
 *  - The full GameState is returned to Game Masters only. Players receive a view built by
 *    buildPlayerView() for a character that is assigned to them.
 *  - Players may only send 'move' commands, and only for characters assigned to them
 *    (or characters that granted control to one of their characters in-game).
 *  - Commands are re-validated by executeCommand() against the latest stored state and
 *    written with optimistic locking (version check) – concurrent writes cannot overwrite each other.
 */
import { createDemoState, MAX_RADIUS, MIN_RADIUS } from '../data/demo.js';
import { executeCommand, type Command } from '../game/commands.js';
import { migrateState } from '../game/migrate.js';
import type { Actor, GameState } from '../game/types.js';
import { phaseName } from '../game/text.js';
import { buildPlayerView } from '../game/visibility.js';
import type { AdminOverview, CampaignPayload, CharacterRef, PlayerPayload, SessionInfo, WireView } from './protocol.js';
import type { AuthUser, HealthReport, Member, Profile, Repo, Role } from './repo.js';
import { EXPECTED_MIGRATIONS, REQUIRED_SCHEMA_VERSION } from './schema.js';
import { applyRoster, needsRosterUpdate } from '../game/roster.js';
import { PLAYER_COMMANDS, isEmail, isId, isInt, isObj, parseCommand } from './validate.js';

export interface ApiRequest {
  method: string;
  op: string;
  token: string | null;
  query: Record<string, string | undefined>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
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
  ) {
    super(message);
  }
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });

/** A member counts as "online" if the client contacted the server within this window. */
export const PRESENCE_WINDOW_MS = 75_000;
const TOUCH_EVERY_MS = 20_000;

export async function handleApi(req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  try {
    // ---- public operations (no session yet) ----
    if (req.method === 'GET' && req.op === 'health') return ok(await health(repo, req.query.smtp === '1'));
    await requireCompatibleSchema(repo);
    if (req.method === 'POST' && req.op === 'request-code') return ok(await requestCode(req.body, repo));
    if (req.method === 'GET' && req.op === 'profiles') return ok(await profileStatus(repo));

    const user = await authenticate(req, repo);
    const memberships = await resolveMemberships(user, repo);
    await touch(memberships, repo);
    switch (`${req.method} ${req.op}`) {
      case 'GET session':
        return ok(await sessionInfo(user, memberships, repo));
      case 'GET ping': {
        // Heartbeat: keeps presence fresh and lets clients detect missed realtime pings.
        const m = pickMembership(memberships, req.query.campaign);
        await checkProfile(user, m, req.query.profile, repo);
        const s = await repo.loadState(m.campaignId);
        return ok({ version: s?.version ?? 0 });
      }
      case 'GET state': {
        const m = pickMembership(memberships, req.query.campaign);
        const profile = await checkProfile(user, m, req.query.profile, repo);
        return ok(await campaignPayload(m, repo, req.query.as ?? profile?.tokenIds[0]));
      }
      case 'POST command':
        return ok(await runCommand(user, memberships, req.body, repo));
      case 'POST admin':
        return ok(await runAdmin(user, memberships, req.body, repo));
      default:
        throw new HttpError(404, 'Unknown API operation.');
    }
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } };
    console.error('[apex-api]', e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|timeout/i.test(String((e as Error)?.message ?? e))) {
      return { status: 503, body: { error: 'The campaign database cannot be reached right now. Please try again in a moment.', code: 'db_unreachable' } };
    }
    return { status: 500, body: { error: 'Internal server error. Please try again.' } };
  }
}

// ---------------------------------------------------------------- deployment health & schema gate

export async function health(repo: Repo, checkSmtp = false): Promise<HealthReport> {
  const errors: string[] = [];
  const r: HealthReport = {
    database: false,
    authAdmin: false,
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
    if (!d.realtime) errors.push('apex_campaign_heads is not published for Realtime.');
  } catch (e) {
    errors.push(`database: ${(e as Error).message}`);
  }
  const mail = await repo.emailDelivery(checkSmtp).catch((e: Error) => ({ via: 'supabase' as const, ok: false, detail: e.message }));
  r.emailDelivery = mail.via;
  if (checkSmtp) {
    r.smtpOk = mail.ok;
    if (mail.ok === false) errors.push(`SMTP login failed: ${mail.detail ?? 'unknown error'}`);
  }
  if (mail.via === 'supabase') errors.push('Login emails use the Supabase built-in mailer (team members only, about 2 per hour). Configure SMTP_* on Vercel.');
  r.authAdmin = await repo.authAdminOk().catch(() => false);
  if (!r.authAdmin) errors.push('The server key is not accepted by Supabase Auth.');
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

// ---------------------------------------------------------------- email code login

/**
 * Sends a one-time sign-in code, but only to invited/member addresses. The answer is the same
 * whether or not the address is authorised, so the endpoint cannot be used to discover who plays.
 * Codes are generated, rate-limited, expired and verified by Supabase Auth – never by APEX.
 */
/** Server-side limits for login code requests (applied to EVERY address, invited or not). */
export const LOGIN_LIMITS = {
  // Test harness only may shorten the interval (dev/mockSupabase.ts); production uses 60 s.
  perEmailIntervalSec: Number(globalThis.process?.env?.APEX_LOGIN_INTERVAL_SEC) || 60,
  perEmailPerHour: 5,
  globalPerHour: 60,
};

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sends a one-time sign-in code, but only to the account linked to the chosen profile.
 * - Rate limits are checked BEFORE authorisation and identically for every address, so neither the
 *   answer nor the limits reveal who is invited.
 * - The code is generated, expired and verified by Supabase Auth – APEX only delivers it.
 * - Every failure is reported precisely (rate limit with retryAfter, mail quota, delivery failure).
 */
async function requestCode(body: unknown, repo: Repo) {
  if (!isObj(body) || !isEmail(body.email)) throw new HttpError(400, 'Please enter a valid email address.');
  const email = body.email.trim().toLowerCase();
  const profileKey = typeof body.profile === 'string' ? body.profile : null;
  const emailHash = await sha256(email);

  const stats = await repo.loginRequestStats(emailHash);
  const now = Date.now();
  const sinceLast = stats.lastAcceptedAt ? (now - Date.parse(stats.lastAcceptedAt)) / 1000 : Infinity;
  if (sinceLast < LOGIN_LIMITS.perEmailIntervalSec) {
    const wait = Math.ceil(LOGIN_LIMITS.perEmailIntervalSec - sinceLast);
    throw new HttpError(429, `A code for this address was just requested. You can request a new one in ${wait} seconds – or enter the code you already received.`, 'rate_limited', wait);
  }
  if (stats.emailCountHour >= LOGIN_LIMITS.perEmailPerHour) {
    await repo.recordLoginRequest(emailHash, 'rate_limited');
    throw new HttpError(429, 'Too many code requests for this address. Please try again in about an hour – or enter the code you already received.', 'rate_limited', 3600);
  }
  if (stats.globalAcceptedHour >= LOGIN_LIMITS.globalPerHour) {
    throw new HttpError(429, 'APEX is receiving too many sign-in requests right now. Please try again in a few minutes.', 'rate_limited', 300);
  }

  const generic = {
    sent: true,
    retryAfter: LOGIN_LIMITS.perEmailIntervalSec,
    message: profileKey
      ? 'If this email address belongs to the selected profile, a 6-digit code is on its way.'
      : 'If this email address is invited to APEX, a 6-digit code is on its way.',
  };
  const authorized = profileKey
    ? await emailMatchesProfile(email, profileKey, repo)
    : (await repo.isEmailAuthorized(email)) || (await profileEmailKnown(email, repo));
  if (!authorized) {
    await repo.recordLoginRequest(emailHash, 'ignored'); // counts for the per-address limits like a real request
    return generic;
  }

  await repo.ensureAuthUser(email);
  const res = await repo.sendLoginCode(email);
  if (!res.ok) {
    console.error('[apex-api] login code delivery failed:', res.reason, res.detail);
    if (res.reason === 'rate_limited') {
      throw new HttpError(429, `Please wait ${res.retryAfter ?? 60} seconds before requesting another code – or enter the code you already received.`, 'rate_limited', res.retryAfter ?? 60);
    }
    if (res.reason === 'quota') {
      await repo.recordLoginRequest(emailHash, 'quota');
      throw new HttpError(
        503,
        'The email service has reached its sending limit, so no code was sent. Please try again later. (Game Master: set up SMTP for APEX.)',
        'email_quota',
        res.retryAfter ?? 3600,
      );
    }
    await repo.recordLoginRequest(emailHash, 'delivery_failed');
    throw new HttpError(
      502,
      res.reason === 'not_deliverable'
        ? 'The email could not be delivered to this address by the mail service, so no code was sent. (Game Master: set up SMTP for APEX.)'
        : 'The email with your code could not be sent. No code was sent – please try again in a moment.',
      'delivery_failed',
    );
  }
  await repo.recordLoginRequest(emailHash, 'accepted');
  console.log(`[apex-api] login code delivered via ${res.via}${res.detail ? ` (${res.detail})` : ''}`);
  return generic;
}

// ---------------------------------------------------------------- profiles ("Who are you?")

/** Public: which profiles can currently be used (no names of accounts, no emails). */
async function profileStatus(repo: Repo) {
  const all = await repo.profiles(null);
  const byKey = new Map<string, boolean>();
  for (const p of all) byKey.set(p.key, (byKey.get(p.key) ?? false) || (await profileActive(p, repo)));
  return { profiles: [...byKey.entries()].map(([key, active]) => ({ key, active })) };
}

async function profileActive(p: Profile, repo: Repo): Promise<boolean> {
  if (p.email || p.userId) return true;
  if (p.role !== 'gm') return false;
  const [members, invites] = await Promise.all([repo.members(p.campaignId), repo.invites(p.campaignId)]);
  return members.some((m) => m.role === 'gm') || invites.some((i) => i.role === 'gm' && !i.acceptedAt);
}

/** Is `email` the account linked to this profile (GM profile: any Game Master of the campaign)? */
async function emailMatchesProfile(email: string, key: string, repo: Repo): Promise<boolean> {
  for (const p of (await repo.profiles(null)).filter((x) => x.key === key)) {
    if (p.email === email) return true;
    const members = await repo.members(p.campaignId);
    if (p.userId && members.some((m) => m.userId === p.userId && m.email === email)) return true;
    if (p.role === 'gm') {
      if (members.some((m) => m.role === 'gm' && m.email === email)) return true;
      if ((await repo.invites(p.campaignId)).some((i) => i.role === 'gm' && !i.acceptedAt && i.email === email)) return true;
    }
  }
  return false;
}

async function profileEmailKnown(email: string, repo: Repo): Promise<boolean> {
  return (await repo.profiles(null)).some((p) => p.email === email);
}

/**
 * Validates the profile chosen on the welcome screen against the verified account.
 * A profile never grants anything by itself – it can only narrow down what an account may do.
 */
async function checkProfile(user: AuthUser, m: Member, key: string | undefined, repo: Repo): Promise<Profile | null> {
  if (!key) return null;
  const p = (await repo.profiles(m.campaignId)).find((x) => x.key === key);
  const mismatch = new HttpError(403, 'This account is not linked to the profile you selected. Please choose your own profile.', 'profile_mismatch');
  if (!p) throw mismatch;
  if (p.role === 'gm') {
    if (m.role !== 'gm') throw mismatch;
    return p;
  }
  if (p.userId !== user.id && !(p.email && p.email === user.email)) throw mismatch;
  return p;
}

async function touch(memberships: Member[], repo: Repo) {
  const now = Date.now();
  for (const m of memberships) {
    const last = m.lastSeenAt ? Date.parse(m.lastSeenAt) : 0;
    if (now - last > TOUCH_EVERY_MS) await repo.touchMember(m.campaignId, m.userId).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- identity

async function authenticate(req: ApiRequest, repo: Repo): Promise<AuthUser> {
  if (!req.token) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  const user = await repo.userFromToken(req.token);
  if (!user) throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated');
  return user;
}

/** Existing memberships plus any open invitation for the user's confirmed email address. */
async function resolveMemberships(user: AuthUser, repo: Repo): Promise<Member[]> {
  const members = await repo.membershipsOf(user.id);
  if (!user.emailConfirmed || !user.email) return members;
  const invites = await repo.openInvitesFor(user.email.toLowerCase());
  for (const inv of invites) {
    if (members.some((m) => m.campaignId === inv.campaignId)) {
      await repo.markInviteAccepted(inv.campaignId, inv.email, user.id);
      continue;
    }
    const m: Member = { campaignId: inv.campaignId, userId: user.id, email: user.email.toLowerCase(), role: inv.role };
    await repo.upsertMember(m);
    for (const tokenId of inv.tokenIds) await repo.assignToken(inv.campaignId, tokenId, user.id);
    await repo.markInviteAccepted(inv.campaignId, inv.email, user.id);
    members.push(m);
  }
  // Profiles the GM linked to this email: first verified sign-in binds the account.
  for (const p of (await repo.profiles(null)).filter((x) => x.email === user.email.toLowerCase())) {
    if (p.userId && p.userId !== user.id) continue;
    let m = members.find((x) => x.campaignId === p.campaignId);
    if (!m) {
      m = { campaignId: p.campaignId, userId: user.id, email: user.email.toLowerCase(), role: p.role };
      await repo.upsertMember(m);
      members.push(m);
    } else if (p.role === 'gm' && m.role !== 'gm') {
      m.role = 'gm';
      await repo.upsertMember(m);
    }
    if (!p.userId) {
      await repo.updateProfile(p.campaignId, p.key, { userId: user.id });
      for (const t of p.tokenIds) await repo.assignToken(p.campaignId, t, user.id);
    }
  }
  return members;
}

function pickMembership(memberships: Member[], campaignId: string | undefined): Member {
  if (!memberships.length) {
    throw new HttpError(403, 'This account is not authorised for any APEX campaign. Ask your Game Master for an invitation.', 'not_authorized');
  }
  if (!campaignId) {
    if (memberships.length === 1) return memberships[0];
    throw new HttpError(400, 'Please choose a campaign.');
  }
  const m = memberships.find((x) => x.campaignId === campaignId);
  if (!m) throw new HttpError(403, 'You are not a member of this campaign.', 'not_authorized');
  return m;
}

async function sessionInfo(user: AuthUser, memberships: Member[], repo: Repo): Promise<SessionInfo> {
  const campaigns = await repo.campaignsById(memberships.map((m) => m.campaignId));
  return {
    user: { id: user.id, email: user.email },
    campaigns: memberships.map((m) => ({
      id: m.campaignId,
      name: campaigns.find((c) => c.id === m.campaignId)?.name ?? 'APEX Campaign',
      role: m.role,
    })),
  };
}

// ---------------------------------------------------------------- views

const toWire = (view: ReturnType<typeof buildPlayerView>): WireView => {
  const { hexByKey: _drop, ...rest } = view;
  return rest;
};

async function charactersOf(m: Member, state: GameState | null, repo: Repo): Promise<CharacterRef[]> {
  if (!state) return [];
  const list = await repo.assignments(m.campaignId);
  return list
    .filter((a) => a.userId === m.userId && state.tokens[a.tokenId]?.kind === 'player')
    .map((a) => ({ id: a.tokenId, name: state.tokens[a.tokenId].name }));
}

async function campaignName(campaignId: string, repo: Repo): Promise<string> {
  return (await repo.campaignsById([campaignId]))[0]?.name ?? 'APEX Campaign';
}

async function campaignPayload(m: Member, repo: Repo, as?: string, stored?: { state: GameState; version: number } | null): Promise<CampaignPayload> {
  const s = stored === undefined ? await repo.loadState(m.campaignId) : stored;
  const name = await campaignName(m.campaignId, repo);
  if (m.role === 'gm') {
    return { role: 'gm', campaignId: m.campaignId, campaignName: name, version: s?.version ?? 0, state: s?.state ?? null };
  }
  const characters = await charactersOf(m, s?.state ?? null, repo);
  const base: PlayerPayload = {
    role: 'player',
    campaignId: m.campaignId,
    campaignName: name,
    version: s?.version ?? 0,
    characters,
    activeCharacter: null,
    view: null,
  };
  if (!s) return { ...base, notice: 'The Game Master has not opened the arena yet.' };
  if (!characters.length) return { ...base, notice: 'No character has been assigned to your account yet. Please ask your Game Master.' };
  const active = characters.find((c) => c.id === as)?.id ?? characters[0].id;
  return { ...base, activeCharacter: active, view: toWire(buildPlayerView(s.state, active)) };
}

// ---------------------------------------------------------------- commands

async function runCommand(user: AuthUser, memberships: Member[], body: unknown, repo: Repo): Promise<CampaignPayload> {
  if (!isObj(body)) throw new HttpError(400, 'Invalid request.');
  const m = pickMembership(memberships, typeof body.campaignId === 'string' ? body.campaignId : undefined);
  const parsed = parseCommand(body.command);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  const cmd = parsed.command;
  const profile = await checkProfile(user, m, typeof body.profile === 'string' ? body.profile : undefined, repo);
  const as = typeof body.as === 'string' ? body.as : profile?.tokenIds[0];

  if (m.role !== 'gm' && !PLAYER_COMMANDS.has(cmd.type)) {
    await repo.logCommand({ campaignId: m.campaignId, userId: user.id, role: m.role, command: cmd, ok: false, error: 'gm-only' });
    throw new HttpError(403, 'Only the Game Master can do that.', 'forbidden');
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const stored = await repo.loadState(m.campaignId);
    if (!stored) throw new HttpError(409, 'The campaign has not been initialised yet.', 'not_initialised');

    let actor: Actor;
    try {
      actor = await actorFor(m, cmd, stored.state, repo);
    } catch (e) {
      await repo.logCommand({ campaignId: m.campaignId, userId: user.id, role: m.role, command: cmd, ok: false, error: (e as Error).message });
      throw e;
    }
    const res = executeCommand(stored.state, actor, cmd);
    if (!res.ok) {
      await repo.logCommand({ campaignId: m.campaignId, userId: user.id, role: m.role, command: cmd, ok: false, error: res.error });
      throw new HttpError(422, res.error, 'rejected');
    }
    const version = await repo.saveState(m.campaignId, res.state, stored.version, user.id);
    if (version === null) continue; // somebody else wrote first → re-validate against the fresh state

    await repo.logCommand({ campaignId: m.campaignId, userId: user.id, role: m.role, command: cmd, ok: true, version });
    if ((cmd.type === 'advancePhase' || cmd.type === 'endDay') && res.state.phase === 'day') {
      await repo.createSnapshot(m.campaignId, res.state, version, `Dawn of ${phaseName('day', res.state.day)}`, null);
      await repo.pruneSnapshots(m.campaignId, KEEP_SNAPSHOTS);
    }
    return campaignPayload(m, repo, as, { state: res.state, version });
  }
  throw new HttpError(409, 'The campaign was changed by someone else at the same time. Please try again.', 'conflict');
}

/** Determines the in-game actor. Never trusts anything but server-side membership & assignment data. */
async function actorFor(m: Member, cmd: Command, state: GameState, repo: Repo): Promise<Actor> {
  if (m.role === 'gm') return { role: 'gm' };
  const own = (await charactersOf(m, state, repo)).map((c) => c.id);
  if (!own.length) throw new HttpError(403, 'No character has been assigned to your account.', 'forbidden');
  if (cmd.type === 'move') {
    if (own.includes(cmd.tokenId)) return { role: 'player', tokenId: cmd.tokenId };
    // In-game control permission granted by the GM (Token.controllers).
    const target = state.tokens[cmd.tokenId];
    const via = own.find((id) => target?.kind === 'player' && target.controllers.includes(id));
    if (via) return { role: 'player', tokenId: via };
    throw new HttpError(403, `You may not move ${target?.name ?? 'this character'} – only characters assigned to you.`, 'forbidden');
  }
  return { role: 'player', tokenId: own[0] };
}

// ---------------------------------------------------------------- admin (GM only)

async function runAdmin(user: AuthUser, memberships: Member[], body: unknown, repo: Repo): Promise<unknown> {
  if (!isObj(body)) throw new HttpError(400, 'Invalid request.');
  const m = pickMembership(memberships, typeof body.campaignId === 'string' ? body.campaignId : undefined);
  if (m.role !== 'gm') throw new HttpError(403, 'Only the Game Master can manage the campaign.', 'forbidden');
  const cid = m.campaignId;
  const role = (v: unknown): Role => {
    if (v !== 'gm' && v !== 'player') throw new HttpError(400, 'Role must be "gm" or "player".');
    return v;
  };
  const tokenList = (v: unknown): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 20 || !v.every(isId)) throw new HttpError(400, 'Invalid character list.');
    return [...new Set(v as string[])];
  };

  switch (body.action) {
    case 'overview':
      return adminOverview(cid, repo);
    case 'invite': {
      if (!isEmail(body.email)) throw new HttpError(400, 'Please enter a valid email address.');
      const email = body.email.trim().toLowerCase();
      const r = role(body.role);
      const tokenIds = tokenList(body.tokenIds);
      const existing = (await repo.members(cid)).find((x) => x.email === email);
      if (existing) {
        // Already a member: just update role & characters.
        if (existing.userId === user.id && r !== 'gm') throw new HttpError(400, 'You cannot remove your own Game Master role.');
        await repo.upsertMember({ ...existing, role: r });
        for (const t of tokenIds) await repo.assignToken(cid, t, existing.userId);
      } else {
        await repo.upsertInvite({ campaignId: cid, email, role: r, tokenIds });
      }
      return adminOverview(cid, repo);
    }
    case 'revokeInvite':
      if (!isEmail(body.email)) throw new HttpError(400, 'Invalid email address.');
      await repo.deleteInvite(cid, body.email.toLowerCase());
      return adminOverview(cid, repo);
    case 'assign': {
      if (!isId(body.tokenId)) throw new HttpError(400, 'Invalid character.');
      const stored = await repo.loadState(cid);
      if (!stored || stored.state.tokens[body.tokenId]?.kind !== 'player') throw new HttpError(400, 'Only player characters can be assigned.');
      if (body.userId !== null) {
        const target = (await repo.members(cid)).find((x) => x.userId === body.userId);
        if (!target) throw new HttpError(400, 'This user is not a member of the campaign.');
      }
      await repo.assignToken(cid, body.tokenId, (body.userId as string | null) ?? null);
      return adminOverview(cid, repo);
    }
    case 'setRole': {
      const r = role(body.role);
      const target = (await repo.members(cid)).find((x) => x.userId === body.userId);
      if (!target) throw new HttpError(404, 'Member not found.');
      if (target.userId === user.id && r !== 'gm') throw new HttpError(400, 'You cannot remove your own Game Master role.');
      await repo.upsertMember({ ...target, role: r });
      return adminOverview(cid, repo);
    }
    case 'removeMember': {
      if (body.userId === user.id) throw new HttpError(400, 'You cannot remove yourself.');
      const target = (await repo.members(cid)).find((x) => x.userId === body.userId);
      if (!target) throw new HttpError(404, 'Member not found.');
      await repo.removeMember(cid, target.userId);
      await repo.deleteInvite(cid, target.email);
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
      return campaignPayload(m, repo);
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
      return campaignPayload(m, repo);
    }
    case 'linkProfile': {
      // Link a profile to an account by email (null = unlink). Emails are only ever shown to the GM.
      if (typeof body.profile !== 'string') throw new HttpError(400, 'Invalid profile.');
      const p = (await repo.profiles(cid)).find((x) => x.key === body.profile);
      if (!p) throw new HttpError(404, 'Profile not found.');
      const email = body.email === null || body.email === '' ? null : isEmail(body.email) ? body.email.trim().toLowerCase() : undefined;
      if (email === undefined) throw new HttpError(400, 'Please enter a valid email address.');
      const others = (await repo.profiles(cid)).filter((x) => x.key !== p.key);
      if (email && others.some((x) => x.email === email)) throw new HttpError(400, 'This email address is already linked to another profile.');
      if (p.userId) for (const t of p.tokenIds) await repo.assignToken(cid, t, null);
      const existing = email ? (await repo.members(cid)).find((x) => x.email === email) : undefined;
      await repo.updateProfile(cid, p.key, { email, userId: existing?.userId ?? null });
      if (existing) {
        if (p.role === 'gm' && existing.role !== 'gm') await repo.upsertMember({ ...existing, role: 'gm' });
        for (const t of p.tokenIds) await repo.assignToken(cid, t, existing.userId);
      }
      return adminOverview(cid, repo);
    }
    case 'setProfileCharacters': {
      if (typeof body.profile !== 'string') throw new HttpError(400, 'Invalid profile.');
      const p = (await repo.profiles(cid)).find((x) => x.key === body.profile);
      if (!p || p.role === 'gm') throw new HttpError(400, 'Characters can only be set for player profiles.');
      const tokenIds = tokenList(body.tokenIds);
      const stored = await repo.loadState(cid);
      if (stored && !tokenIds.every((t) => stored.state.tokens[t]?.kind === 'player')) throw new HttpError(400, 'Only player characters can be assigned.');
      if (p.userId) for (const t of p.tokenIds) await repo.assignToken(cid, t, null);
      await repo.updateProfile(cid, p.key, { tokenIds });
      if (p.userId) for (const t of tokenIds) await repo.assignToken(cid, t, p.userId);
      return adminOverview(cid, repo);
    }
    case 'applyRoster': {
      const stored = await repo.loadState(cid);
      if (!stored || !needsRosterUpdate(stored.state)) throw new HttpError(400, 'Nothing to convert.');
      await snapshotCurrent(cid, repo, user.id, 'Before character conversion');
      await repo.replaceState(cid, applyRoster(stored.state), user.id);
      // move existing account assignments to the new character ids
      const map: Record<string, string> = { livia: 'sinna', marcus: 'aster', nyx: 'elwin', cassius: 'javi' };
      for (const a of await repo.assignments(cid)) {
        if (map[a.tokenId]) {
          await repo.assignToken(cid, a.tokenId, null);
          await repo.assignToken(cid, map[a.tokenId], a.userId);
        }
      }
      return campaignPayload(m, repo);
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
      return campaignPayload(m, repo);
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
  const [members, invites, assignments, snapshots, profiles, stored] = await Promise.all([
    repo.members(cid),
    repo.invites(cid),
    repo.assignments(cid),
    repo.listSnapshots(cid, 20),
    repo.profiles(cid),
    repo.loadState(cid),
  ]);
  const online = (userId: string | null) => {
    const mm = members.find((x) => x.userId === userId);
    return !!mm?.lastSeenAt && Date.now() - Date.parse(mm.lastSeenAt) < PRESENCE_WINDOW_MS;
  };
  return {
    members: members.map((x) => ({
      userId: x.userId,
      email: x.email,
      role: x.role,
      tokenIds: assignments.filter((a) => a.userId === x.userId).map((a) => a.tokenId),
      lastSeenAt: x.lastSeenAt ?? null,
      online: !!x.lastSeenAt && Date.now() - Date.parse(x.lastSeenAt) < PRESENCE_WINDOW_MS,
    })),
    invites: invites.map((i) => ({ email: i.email, role: i.role, tokenIds: i.tokenIds, acceptedAt: i.acceptedAt })),
    snapshots,
    profiles: await Promise.all(
      profiles.map(async (p) => ({
        key: p.key,
        displayName: p.displayName,
        characterName: p.characterName,
        role: p.role,
        tokenIds: p.tokenIds,
        email: p.email ?? members.find((x) => x.userId === p.userId)?.email ?? null,
        signedIn: !!p.userId || (p.role === 'gm' && members.some((x) => x.role === 'gm')),
        active: await profileActive(p, repo),
        online: p.role === 'gm' ? members.some((x) => x.role === 'gm' && online(x.userId)) : online(p.userId),
      })),
    ),
    rosterOutdated: stored ? needsRosterUpdate(stored.state) : false,
  };
}
