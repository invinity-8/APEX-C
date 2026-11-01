/**
 * Supabase implementation of the Repo. Runs ONLY on the server (Vercel Function)
 * with the secret key, which bypasses RLS. Never import this module from client code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from '../game/types.js';
import type {
  Assignment,
  Campaign,
  CommandLogEntry,
  Credential,
  DeployStatus,
  LoginAttemptStats,
  Member,
  Profile,
  Repo,
  Role,
  SessionRecord,
  SnapshotInfo,
  StoredSheet,
  StoredState,
} from './repo.js';

export interface ServerEnv {
  url: string;
  secretKey: string;
}

/** Reads server-side configuration. The secret key must never use a VITE_ prefix. */
export function readServerEnv(env: Record<string, string | undefined>): ServerEnv | null {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return null;
  return { url, secretKey };
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

type MemberRow = { campaign_id: string; user_id: string; email: string | null; role: Role; last_seen_at?: string | null };
type SessionRow = {
  token_hash: string;
  campaign_id: string;
  profile_key: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
};

const toMember = (r: MemberRow): Member => ({ campaignId: r.campaign_id, userId: r.user_id, email: r.email, role: r.role, lastSeenAt: r.last_seen_at ?? null });
const newTopic = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(env: ServerEnv) {
    const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    this.db = createClient(env.url, env.secretKey, opts);
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
      userId: r.user_id as string,
      active: r.active === true,
    }));
  }

  async updateProfile(campaignId: string, key: string, patch: Partial<Pick<Profile, 'tokenIds' | 'active'>>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.active !== undefined) row.active = patch.active;
    if (patch.tokenIds !== undefined) row.token_ids = patch.tokenIds;
    check(await this.db.from('apex_profiles').update(row).eq('campaign_id', campaignId).eq('profile_key', key), 'update profile');
  }

  // ---------------------------------------------------------------- credentials & sessions

  async credential(campaignId: string, key: string): Promise<Credential | null> {
    const row = check(
      await this.db.from('apex_profile_credentials').select('password_hash, updated_at').eq('campaign_id', campaignId).eq('profile_key', key).maybeSingle(),
      'credential',
    ) as { password_hash: string; updated_at: string } | null;
    return row ? { passwordHash: row.password_hash, updatedAt: row.updated_at } : null;
  }

  async setCredential(campaignId: string, key: string, passwordHash: string | null, byUserId: string | null): Promise<void> {
    if (passwordHash === null) {
      check(await this.db.from('apex_profile_credentials').delete().eq('campaign_id', campaignId).eq('profile_key', key), 'clear credential');
      return;
    }
    check(
      await this.db
        .from('apex_profile_credentials')
        .upsert(
          { campaign_id: campaignId, profile_key: key, password_hash: passwordHash, updated_by: byUserId, updated_at: new Date().toISOString() },
          { onConflict: 'campaign_id,profile_key' },
        ),
      'set credential',
    );
  }

  async consumeSetupCode(codeHash: string): Promise<string | null> {
    const rows = check(
      await this.db
        .from('apex_setup_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('code_hash', codeHash)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('campaign_id'),
      'setup code',
    ) as Array<{ campaign_id: string }>;
    return rows.length === 1 ? rows[0].campaign_id : null;
  }

  async createSession(s: Omit<SessionRecord, 'revokedAt' | 'lastSeenAt' | 'createdAt'> & { userAgent: string | null }): Promise<void> {
    check(
      await this.db.from('apex_sessions').insert({
        token_hash: s.tokenHash,
        campaign_id: s.campaignId,
        profile_key: s.profileKey,
        user_id: s.userId,
        expires_at: s.expiresAt,
        user_agent: s.userAgent,
      }),
      'create session',
    );
    if (Math.random() < 0.05) {
      // Housekeeping: forget sessions that ended more than 30 days ago.
      await this.db.from('apex_sessions').delete().lt('expires_at', new Date(Date.now() - 30 * 86400_000).toISOString());
    }
  }

  async session(tokenHash: string): Promise<SessionRecord | null> {
    const r = check(await this.db.from('apex_sessions').select('*').eq('token_hash', tokenHash).maybeSingle(), 'session') as SessionRow | null;
    return r
      ? {
          tokenHash: r.token_hash,
          campaignId: r.campaign_id,
          profileKey: r.profile_key,
          userId: r.user_id,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          expiresAt: r.expires_at,
          revokedAt: r.revoked_at,
        }
      : null;
  }

  async touchSession(tokenHash: string, expiresAt: string): Promise<void> {
    await this.db.from('apex_sessions').update({ last_seen_at: new Date().toISOString(), expires_at: expiresAt }).eq('token_hash', tokenHash);
  }

  async revokeSession(tokenHash: string): Promise<void> {
    check(await this.db.from('apex_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash).is('revoked_at', null), 'revoke session');
  }

  async revokeProfileSessions(campaignId: string, key: string, exceptHash?: string): Promise<number> {
    let q = this.db
      .from('apex_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('campaign_id', campaignId)
      .eq('profile_key', key)
      .is('revoked_at', null);
    if (exceptHash) q = q.neq('token_hash', exceptHash);
    const rows = check(await q.select('token_hash'), 'revoke sessions') as unknown[];
    return rows.length;
  }

  async activeSessionCounts(campaignId: string): Promise<Record<string, number>> {
    const rows = check(
      await this.db.from('apex_sessions').select('profile_key').eq('campaign_id', campaignId).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
      'session counts',
    ) as Array<{ profile_key: string }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.profile_key] = (out[r.profile_key] ?? 0) + 1;
    return out;
  }

  async loginAttemptStats(profileKey: string, ipHash: string, sinceIso: string): Promise<LoginAttemptStats> {
    const fails = () => this.db.from('apex_login_attempts').select('id', { count: 'exact', head: true }).eq('ok', false).gte('created_at', sinceIso);
    const [profile, ip, global, oldest] = await Promise.all([
      fails().eq('profile_key', profileKey),
      fails().eq('ip_hash', ipHash),
      fails(),
      this.db
        .from('apex_login_attempts')
        .select('created_at')
        .eq('ok', false)
        .eq('profile_key', profileKey)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(1),
    ]);
    const err = profile.error ?? ip.error ?? global.error ?? oldest.error;
    if (err) throw new Error(`login attempts: ${err.message}`);
    return {
      profileFailures: profile.count ?? 0,
      ipFailures: ip.count ?? 0,
      globalFailures: global.count ?? 0,
      oldestProfileFailure: (oldest.data as Array<{ created_at: string }>)[0]?.created_at ?? null,
    };
  }

  async recordLoginAttempt(profileKey: string, ipHash: string, ok: boolean): Promise<void> {
    check(await this.db.from('apex_login_attempts').insert({ profile_key: profileKey, ip_hash: ipHash, ok }), 'record login attempt');
    if (Math.random() < 0.05) {
      await this.db.from('apex_login_attempts').delete().lt('created_at', new Date(Date.now() - 2 * 86400_000).toISOString());
    }
  }

  async syncTopic(campaignId: string): Promise<string> {
    const row = check(await this.db.from('apex_campaigns').select('sync_topic').eq('id', campaignId).maybeSingle(), 'sync topic') as { sync_topic: string } | null;
    if (!row) throw new Error('sync topic: campaign not found');
    return `apex-sync-${row.sync_topic}`;
  }

  async rotateSyncTopic(campaignId: string): Promise<void> {
    check(await this.db.from('apex_campaigns').update({ sync_topic: newTopic() }).eq('id', campaignId), 'rotate sync topic');
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

  async campaignsById(ids: string[]): Promise<Campaign[]> {
    if (!ids.length) return [];
    const rows = check(await this.db.from('apex_campaigns').select('id, slug, name').in('id', ids), 'campaigns');
    return rows as Campaign[];
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

  // ---------------------------------------------------------------- character sheets

  async loadSheet(campaignId: string, tokenId: string): Promise<StoredSheet | null> {
    const r = check(
      await this.db.from('apex_character_sheets').select('data, version, updated_at, updated_by').eq('campaign_id', campaignId).eq('token_id', tokenId).maybeSingle(),
      'load sheet',
    ) as { data: unknown; version: number; updated_at: string; updated_by: string | null } | null;
    return r ? { data: r.data, version: Number(r.version), updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
  }

  async saveSheet(campaignId: string, tokenId: string, data: unknown, expectedVersion: number, userId: string): Promise<number | null> {
    const now = new Date().toISOString();
    if (expectedVersion === 0) {
      const { error } = await this.db
        .from('apex_character_sheets')
        .insert({ campaign_id: campaignId, token_id: tokenId, data, version: 1, updated_by: userId, updated_at: now });
      if (!error) return 1;
      if ((error as { code?: string }).code === '23505') return null; // someone created it first
      throw new Error(`save sheet: ${error.message}`);
    }
    const rows = check(
      await this.db
        .from('apex_character_sheets')
        .update({ data, version: expectedVersion + 1, updated_by: userId, updated_at: now })
        .eq('campaign_id', campaignId)
        .eq('token_id', tokenId)
        .eq('version', expectedVersion)
        .select('version'),
      'save sheet',
    ) as unknown[];
    return rows.length === 1 ? expectedVersion + 1 : null;
  }

  async backupSheet(campaignId: string, tokenId: string, data: unknown, version: number, reason: string, userId: string): Promise<void> {
    check(
      await this.db.from('apex_character_sheet_backups').insert({ campaign_id: campaignId, token_id: tokenId, data, version, reason, created_by: userId }),
      'backup sheet',
    );
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
