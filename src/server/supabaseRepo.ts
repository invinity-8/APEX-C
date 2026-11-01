/**
 * Supabase implementation of the Repo. Runs ONLY on the server (Vercel Function)
 * with the secret key, which bypasses RLS. Never import this module from client code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from '../game/types';
import type { Assignment, AuthUser, Campaign, CommandLogEntry, Invite, Member, Repo, Role, SnapshotInfo, StoredState } from './repo';

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

type MemberRow = { campaign_id: string; user_id: string; email: string; role: Role };
type InviteRow = { campaign_id: string; email: string; role: Role; token_ids: string[] | null; accepted_at: string | null };

const toMember = (r: MemberRow): Member => ({ campaignId: r.campaign_id, userId: r.user_id, email: r.email, role: r.role });
const toInvite = (r: InviteRow): Invite => ({
  campaignId: r.campaign_id,
  email: r.email,
  role: r.role,
  tokenIds: r.token_ids ?? [],
  acceptedAt: r.accepted_at,
});

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(env: ServerEnv) {
    this.db = createClient(env.url, env.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async userFromToken(token: string): Promise<AuthUser | null> {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: (data.user.email ?? '').toLowerCase(), emailConfirmed: !!data.user.email_confirmed_at };
  }

  async campaignsById(ids: string[]): Promise<Campaign[]> {
    if (!ids.length) return [];
    const rows = check(await this.db.from('apex_campaigns').select('id, slug, name').in('id', ids), 'campaigns');
    return rows as Campaign[];
  }

  async membershipsOf(userId: string): Promise<Member[]> {
    const rows = check(await this.db.from('apex_campaign_members').select('campaign_id, user_id, email, role').eq('user_id', userId), 'memberships');
    return (rows as MemberRow[]).map(toMember);
  }

  async members(campaignId: string): Promise<Member[]> {
    const rows = check(
      await this.db.from('apex_campaign_members').select('campaign_id, user_id, email, role').eq('campaign_id', campaignId).order('created_at'),
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
