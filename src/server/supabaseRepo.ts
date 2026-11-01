/**
 * Supabase implementation of the Repo. Runs ONLY on the server (Vercel Function)
 * with the secret key, which bypasses RLS. Never import this module from client code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from '../game/types.js';
import type {
  Assignment,
  AuthUser,
  Campaign,
  CommandLogEntry,
  HealthReport,
  Invite,
  Member,
  Repo,
  Role,
  SendCodeResult,
  SnapshotInfo,
  StoredState,
} from './repo.js';

export interface ServerEnv {
  url: string;
  secretKey: string;
  /** Public key – used to request login codes exactly like a browser would. Optional. */
  publishableKey?: string;
}

/** Reads server-side configuration. The secret key must never use a VITE_ prefix. */
export function readServerEnv(env: Record<string, string | undefined>): ServerEnv | null {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  return { url, secretKey, publishableKey };
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

type MemberRow = { campaign_id: string; user_id: string; email: string; role: Role; last_seen_at?: string | null };
type InviteRow = { campaign_id: string; email: string; role: Role; token_ids: string[] | null; accepted_at: string | null };

const toMember = (r: MemberRow): Member => ({ campaignId: r.campaign_id, userId: r.user_id, email: r.email, role: r.role, lastSeenAt: r.last_seen_at ?? null });
const toInvite = (r: InviteRow): Invite => ({
  campaignId: r.campaign_id,
  email: r.email,
  role: r.role,
  tokenIds: r.token_ids ?? [],
  acceptedAt: r.accepted_at,
});

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;
  /** Client for public auth endpoints (sending codes). Falls back to the admin client. */
  private pub: SupabaseClient;

  constructor(env: ServerEnv) {
    const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    this.db = createClient(env.url, env.secretKey, opts);
    this.pub = env.publishableKey ? createClient(env.url, env.publishableKey, opts) : this.db;
  }

  async userFromToken(token: string): Promise<AuthUser | null> {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: (data.user.email ?? '').toLowerCase(), emailConfirmed: !!data.user.email_confirmed_at };
  }

  async isEmailAuthorized(email: string): Promise<boolean> {
    const { count: invites, error: invErr } = await this.db
      .from('apex_campaign_invites')
      .select('email', { count: 'exact', head: true })
      .eq('email', email)
      .is('accepted_at', null);
    if (invErr) throw new Error(`invite lookup: ${invErr.message}`);
    if ((invites ?? 0) > 0) return true;
    const { count: members, error } = await this.db.from('apex_campaign_members').select('user_id', { count: 'exact', head: true }).eq('email', email);
    if (error) throw new Error(`member lookup: ${error.message}`);
    return (members ?? 0) > 0;
  }

  async ensureAuthUser(email: string): Promise<void> {
    const created = await this.db.auth.admin.createUser({ email, email_confirm: true });
    if (!created.error) return;
    // Already registered → make sure the address counts as confirmed (the emailed code proves ownership).
    const status = (created.error as { status?: number }).status;
    const code = (created.error as { code?: string }).code;
    if (status !== 422 && code !== 'email_exists' && !/already/i.test(created.error.message)) throw new Error(`create user: ${created.error.message}`);
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await this.db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`list users: ${error.message}`);
      const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
      if (u) {
        if (!u.email_confirmed_at) await this.db.auth.admin.updateUserById(u.id, { email_confirm: true });
        return;
      }
      if (data.users.length < 200) return;
    }
  }

  async sendLoginCode(email: string): Promise<SendCodeResult> {
    const { error } = await this.pub.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (!error) return { ok: true };
    const status = (error as { status?: number }).status;
    if (status === 429 || /rate limit|security purposes|seconds/i.test(error.message)) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'failed', detail: error.message };
  }

  async touchMember(campaignId: string, userId: string): Promise<void> {
    await this.db.from('apex_campaign_members').update({ last_seen_at: new Date().toISOString() }).eq('campaign_id', campaignId).eq('user_id', userId);
  }

  async health(): Promise<HealthReport> {
    const errors: string[] = [];
    const r: HealthReport = { database: false, authAdmin: false, campaignSeeded: false, presenceColumn: false, errors };
    const camps = await this.db.from('apex_campaigns').select('id', { count: 'exact', head: true });
    if (camps.error) errors.push(`database: ${camps.error.message}`);
    else {
      r.database = true;
      r.campaignSeeded = (camps.count ?? 0) > 0;
      if (!r.campaignSeeded) errors.push('No campaign found – run the seed migration.');
    }
    const states = await this.db.from('apex_game_states').select('campaign_id', { count: 'exact', head: true });
    if (states.error) {
      r.database = false;
      errors.push(`game states: ${states.error.message}`);
    }
    const presence = await this.db.from('apex_campaign_members').select('last_seen_at').limit(1);
    r.presenceColumn = !presence.error;
    if (presence.error) errors.push('Presence migration (20261102000100) not applied yet.');
    const admin = await this.db.auth.admin.listUsers({ page: 1, perPage: 1 });
    r.authAdmin = !admin.error;
    if (admin.error) errors.push(`auth admin: ${admin.error.message}`);
    return r;
  }

  async campaignsById(ids: string[]): Promise<Campaign[]> {
    if (!ids.length) return [];
    const rows = check(await this.db.from('apex_campaigns').select('id, slug, name').in('id', ids), 'campaigns');
    return rows as Campaign[];
  }

  async membershipsOf(userId: string): Promise<Member[]> {
    const rows = check(await this.db.from('apex_campaign_members').select('*').eq('user_id', userId), 'memberships');
    return (rows as MemberRow[]).map(toMember);
  }

  async members(campaignId: string): Promise<Member[]> {
    const rows = check(
      await this.db.from('apex_campaign_members').select('*').eq('campaign_id', campaignId).order('created_at'),
      'members',
    );
    return (rows as MemberRow[]).map(toMember);
  }

  async upsertMember(m: Member): Promise<void> {
    check(
      await this.db
        .from('apex_campaign_members')
        .upsert({ campaign_id: m.campaignId, user_id: m.userId, email: m.email, role: m.role }, { onConflict: 'campaign_id,user_id' }),
      'upsert member',
    );
  }

  async removeMember(campaignId: string, userId: string): Promise<void> {
    check(await this.db.from('apex_campaign_members').delete().eq('campaign_id', campaignId).eq('user_id', userId), 'remove member');
  }

  async openInvitesFor(email: string): Promise<Invite[]> {
    const rows = check(
      await this.db
        .from('apex_campaign_invites')
        .select('campaign_id, email, role, token_ids, accepted_at')
        .eq('email', email)
        .is('accepted_at', null),
      'invites',
    );
    return (rows as InviteRow[]).map(toInvite);
  }

  async invites(campaignId: string): Promise<Invite[]> {
    const rows = check(
      await this.db
        .from('apex_campaign_invites')
        .select('campaign_id, email, role, token_ids, accepted_at')
        .eq('campaign_id', campaignId)
        .order('created_at'),
      'invites',
    );
    return (rows as InviteRow[]).map(toInvite);
  }

  async upsertInvite(i: Omit<Invite, 'acceptedAt'>): Promise<void> {
    check(
      await this.db
        .from('apex_campaign_invites')
        .upsert(
          { campaign_id: i.campaignId, email: i.email, role: i.role, token_ids: i.tokenIds, accepted_at: null, accepted_by: null },
          { onConflict: 'campaign_id,email' },
        ),
      'upsert invite',
    );
  }

  async markInviteAccepted(campaignId: string, email: string, userId: string): Promise<void> {
    check(
      await this.db
        .from('apex_campaign_invites')
        .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
        .eq('campaign_id', campaignId)
        .eq('email', email),
      'accept invite',
    );
  }

  async deleteInvite(campaignId: string, email: string): Promise<void> {
    check(await this.db.from('apex_campaign_invites').delete().eq('campaign_id', campaignId).eq('email', email), 'delete invite');
  }

  async assignments(campaignId: string): Promise<Assignment[]> {
    const rows = check(
      await this.db.from('apex_character_assignments').select('campaign_id, user_id, token_id').eq('campaign_id', campaignId),
      'assignments',
    );
    return (rows as Array<{ campaign_id: string; user_id: string; token_id: string }>).map((r) => ({
      campaignId: r.campaign_id,
      userId: r.user_id,
      tokenId: r.token_id,
    }));
  }

  async assignToken(campaignId: string, tokenId: string, userId: string | null): Promise<void> {
    if (userId === null) {
      check(await this.db.from('apex_character_assignments').delete().eq('campaign_id', campaignId).eq('token_id', tokenId), 'unassign');
      return;
    }
    check(
      await this.db
        .from('apex_character_assignments')
        .upsert({ campaign_id: campaignId, token_id: tokenId, user_id: userId }, { onConflict: 'campaign_id,token_id' }),
      'assign',
    );
  }

  async loadState(campaignId: string): Promise<StoredState | null> {
    const row = check(
      await this.db.from('apex_game_states').select('state, version').eq('campaign_id', campaignId).maybeSingle(),
      'load state',
    ) as { state: GameState; version: number } | null;
    return row ? { state: row.state, version: Number(row.version) } : null;
  }

  async replaceState(campaignId: string, state: GameState, userId: string): Promise<number> {
    const cur = await this.loadState(campaignId);
    const version = (cur?.version ?? 0) + 1;
    check(
      await this.db
        .from('apex_game_states')
        .upsert({ campaign_id: campaignId, state, version, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'campaign_id' }),
      'replace state',
    );
    return version;
  }

  async saveState(campaignId: string, state: GameState, expectedVersion: number, userId: string): Promise<number | null> {
    const version = expectedVersion + 1;
    const rows = check(
      await this.db
        .from('apex_game_states')
        .update({ state, version, updated_by: userId, updated_at: new Date().toISOString() })
        .eq('campaign_id', campaignId)
        .eq('version', expectedVersion)
        .select('version'),
      'save state',
    ) as Array<{ version: number }>;
    return rows.length === 1 ? version : null;
  }

  async createSnapshot(campaignId: string, state: GameState, version: number, label: string, userId: string | null): Promise<void> {
    check(
      await this.db.from('apex_state_snapshots').insert({ campaign_id: campaignId, state, version, label, created_by: userId }),
      'create snapshot',
    );
  }

  async listSnapshots(campaignId: string, limit: number): Promise<SnapshotInfo[]> {
    const rows = check(
      await this.db
        .from('apex_state_snapshots')
        .select('id, version, label, created_at')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: false })
        .limit(limit),
      'list snapshots',
    ) as Array<{ id: number; version: number; label: string; created_at: string }>;
    return rows.map((r) => ({ id: Number(r.id), version: Number(r.version), label: r.label, createdAt: r.created_at }));
  }

  async loadSnapshot(campaignId: string, id: number): Promise<GameState | null> {
    const row = check(
      await this.db.from('apex_state_snapshots').select('state').eq('campaign_id', campaignId).eq('id', id).maybeSingle(),
      'load snapshot',
    ) as { state: GameState } | null;
    return row?.state ?? null;
  }

  async pruneSnapshots(campaignId: string, keep: number): Promise<void> {
    const rows = check(
      await this.db.from('apex_state_snapshots').select('id').eq('campaign_id', campaignId).order('id', { ascending: false }).range(keep, keep + 200),
      'prune snapshots',
    ) as Array<{ id: number }>;
    if (rows.length) check(await this.db.from('apex_state_snapshots').delete().in('id', rows.map((r) => r.id)), 'prune snapshots');
  }

  async logCommand(e: CommandLogEntry): Promise<void> {
    // Audit log failures must never break gameplay.
    const { error } = await this.db.from('apex_command_log').insert({
      campaign_id: e.campaignId,
      user_id: e.userId,
      role: e.role,
      command: e.command,
      ok: e.ok,
      error: e.error ?? null,
      version: e.version ?? null,
    });
    if (error) console.warn('[apex-api] command log failed:', error.message);
  }
}
