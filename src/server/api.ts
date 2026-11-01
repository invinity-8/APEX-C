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
import type { AuthUser, Member, Repo, Role } from './repo.js';
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
  ) {
    super(message);
  }
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });

export async function handleApi(req: ApiRequest, repo: Repo): Promise<ApiResponse> {
  try {
    const user = await authenticate(req, repo);
    const memberships = await resolveMemberships(user, repo);
    switch (`${req.method} ${req.op}`) {
      case 'GET session':
        return ok(await sessionInfo(user, memberships, repo));
      case 'GET state': {
        const m = pickMembership(memberships, req.query.campaign);
        return ok(await campaignPayload(m, repo, req.query.as));
      }
      case 'POST command':
        return ok(await runCommand(user, memberships, req.body, repo));
      case 'POST admin':
        return ok(await runAdmin(user, memberships, req.body, repo));
      default:
        throw new HttpError(404, 'Unknown API operation.');
    }
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, code: e.code } };
    console.error('[apex-api]', e);
    return { status: 500, body: { error: 'Internal server error. Please try again.' } };
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
  const as = typeof body.as === 'string' ? body.as : undefined;

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
  const [members, invites, assignments, snapshots] = await Promise.all([
    repo.members(cid),
    repo.invites(cid),
    repo.assignments(cid),
    repo.listSnapshots(cid, 20),
  ]);
  return {
    members: members.map((x) => ({
      userId: x.userId,
      email: x.email,
      role: x.role,
      tokenIds: assignments.filter((a) => a.userId === x.userId).map((a) => a.tokenId),
    })),
    invites: invites.map((i) => ({ email: i.email, role: i.role, tokenIds: i.tokenIds, acceptedAt: i.acceptedAt })),
    snapshots,
  };
}
