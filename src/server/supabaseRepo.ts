/**
 * Supabase implementation of the Repo. Runs ONLY on the server (Vercel Function)
 * with the secret key, which bypasses RLS. Never import this module from client code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readSmtpEnv, sendCodeEmail, verifySmtp, type SmtpConfig } from './mailer.js';
import type { GameState } from '../game/types.js';
import type {
  Assignment,
  AuthUser,
  Campaign,
  CommandLogEntry,
  DeployStatus,
  Invite,
  LoginRequestStats,
  Member,
  Profile,
  Repo,
  Role,
  SendCodeResult,
  SnapshotInfo,
  StoredState,
} from './repo.js';

export interface ServerEnv {
  url: string;
  secretKey: string;
  /** Public key – used for the Supabase built-in mailer fallback. Optional. */
  publishableKey?: string;
  /** Own SMTP account for sign-in codes (recommended). */
  smtp: SmtpConfig | null;
}

/** Reads server-side configuration. The secret key must never use a VITE_ prefix. */
export function readServerEnv(env: Record<string, string | undefined>): ServerEnv | null {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  return { url, secretKey, publishableKey, smtp: readSmtpEnv(env) };
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
  private smtp: SmtpConfig | null;

  constructor(env: ServerEnv) {
    this.smtp = env.smtp;
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
    if (this.smtp) {
      // Supabase generates the one-time code (and later verifies it); APEX delivers it via its own SMTP.
      const { data, error } = await this.db.auth.admin.generateLink({ type: 'magiclink', email });
      if (error) {
        const status = (error as { status?: number }).status;
        if (status === 429) return { ok: false, reason: 'rate_limited', retryAfter: 60, detail: error.message };
        return { ok: false, reason: 'failed', detail: `generateLink: ${error.message}` };
      }
      const code = data.properties?.email_otp;
      if (!code) return { ok: false, reason: 'failed', detail: 'generateLink returned no email_otp' };
      try {
        const sent = await sendCodeEmail(this.smtp, email, code);
        if (!sent.accepted) return { ok: false, reason: 'not_deliverable', detail: `SMTP rejected recipient: ${sent.response}` };
        return { ok: true, via: 'smtp', detail: `SMTP accepted: ${sent.response.slice(0, 80)}` };
      } catch (e) {
        return { ok: false, reason: 'failed', detail: `SMTP: ${(e as Error).message}` };
      }
    }
    // Fallback: Supabase built-in mailer (only for team members, about 2 emails per hour per project).
    const { error } = await this.pub.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (!error) return { ok: true, via: 'supabase' };
    const status = (error as { status?: number }).status;
    const code = (error as { code?: string }).code ?? '';
    if (code === 'over_email_send_rate_limit') return { ok: false, reason: 'quota', retryAfter: 3600, detail: error.message };
    if (code === 'email_address_not_authorized') return { ok: false, reason: 'not_deliverable', detail: error.message };
    const secs = /after (\d+) seconds?/i.exec(error.message)?.[1];
    if (status === 429 || code === 'over_request_rate_limit' || secs) {
      return { ok: false, reason: 'rate_limited', retryAfter: secs ? Number(secs) : 60, detail: error.message };
    }
    return { ok: false, reason: 'failed', detail: error.message };
  }

  async loginRequestStats(emailHash: string): Promise<LoginRequestStats> {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    try {
      const [last, perEmail, global] = await Promise.all([
        this.db
          .from('apex_login_requests')
          .select('created_at')
          .eq('email_hash', emailHash)
          .in('outcome', ['accepted', 'ignored'])
          .order('created_at', { ascending: false })
          .limit(1),
        this.db.from('apex_login_requests').select('id', { count: 'exact', head: true }).eq('email_hash', emailHash).gte('created_at', hourAgo),
        this.db.from('apex_login_requests').select('id', { count: 'exact', head: true }).eq('outcome', 'accepted').gte('created_at', hourAgo),
      ]);
      if (last.error || perEmail.error || global.error) throw new Error((last.error ?? perEmail.error ?? global.error)!.message);
      return {
        lastAcceptedAt: (last.data as Array<{ created_at: string }>)[0]?.created_at ?? null,
        emailCountHour: perEmail.count ?? 0,
        globalAcceptedHour: global.count ?? 0,
      };
    } catch (e) {
      // Table not deployed yet (migration pending): do not block logins, Supabase's own limits still apply.
      console.warn('[apex-api] login rate-limit table unavailable:', (e as Error).message);
      return { lastAcceptedAt: null, emailCountHour: 0, globalAcceptedHour: 0 };
    }
  }

  async recordLoginRequest(emailHash: string, outcome: 'accepted' | 'ignored' | 'rate_limited' | 'delivery_failed' | 'quota'): Promise<void> {
    const { error } = await this.db.from('apex_login_requests').insert({ email_hash: emailHash, outcome });
    if (error) console.warn('[apex-api] recording login request failed:', error.message);
    if (Math.random() < 0.05) {
      await this.db.from('apex_login_requests').delete().lt('created_at', new Date(Date.now() - 2 * 86400_000).toISOString());
    }
  }

  async emailDelivery(check: boolean): Promise<{ via: 'smtp' | 'supabase'; ok: boolean | null; detail?: string }> {
    if (!this.smtp) return { via: 'supabase', ok: null };
    if (!check) return { via: 'smtp', ok: null };
    const r = await verifySmtp(this.smtp);
    return { via: 'smtp', ok: r.ok, detail: r.detail };
  }

  async profiles(campaignId: string | null): Promise<Profile[]> {
    let q = this.db.from('apex_profiles').select('*').order('sort');
    if (campaignId) q = q.eq('campaign_id', campaignId);
    const { data, error } = await q;
    if (error) {
      // Before the profiles migration is applied the welcome screen still works (all profiles inactive).
      if (/apex_profiles|does not exist|schema cache/i.test(error.message)) return [];
      throw new Error(`profiles: ${error.message}`);
    }
    return (data as Array<Record<string, unknown>>).map((r) => ({
      campaignId: r.campaign_id as string,
      key: r.profile_key as string,
      displayName: r.display_name as string,
      characterName: r.character_name as string,
      role: r.role as Role,
      tokenIds: (r.token_ids as string[] | null) ?? [],
      email: (r.email as string | null) ?? null,
      userId: (r.user_id as string | null) ?? null,
    }));
  }

  async updateProfile(campaignId: string, key: string, patch: Partial<Pick<Profile, 'email' | 'userId' | 'tokenIds'>>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.userId !== undefined) row.user_id = patch.userId;
    if (patch.tokenIds !== undefined) row.token_ids = patch.tokenIds;
    check(await this.db.from('apex_profiles').update(row).eq('campaign_id', campaignId).eq('profile_key', key), 'update profile');
  }

  async touchMember(campaignId: string, userId: string): Promise<void> {
    await this.db.from('apex_campaign_members').update({ last_seen_at: new Date().toISOString() }).eq('campaign_id', campaignId).eq('user_id', userId);
  }

  async deployStatus(): Promise<DeployStatus> {
    const { data, error } = await this.db.rpc('apex_deploy_status');
    if (error) throw new Error(`deploy status: ${error.message}`);
    const d = data as {
      schema_version: number | null;
      migrations: string[];
      campaign_seeded: boolean;
      profiles: number;
      realtime: boolean;
      security_problems?: string[];
    };
    return {
      schemaVersion: d.schema_version ?? null,
      migrations: d.migrations ?? [],
      campaignSeeded: !!d.campaign_seeded,
      profiles: Number(d.profiles ?? 0),
      realtime: !!d.realtime,
      securityProblems: d.security_problems ?? null,
    };
  }

  async authAdminOk(): Promise<boolean> {
    const { error } = await this.db.auth.admin.listUsers({ page: 1, perPage: 1 });
    return !error;
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
