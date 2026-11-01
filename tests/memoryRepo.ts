import type { GameState } from '../src/game/types';
import type { Assignment, AuthUser, Campaign, CommandLogEntry, DeployStatus, Invite, LoginRequestStats, Member, Profile, Repo, SendCodeResult, SnapshotInfo, StoredState } from '../src/server/repo';

/** In-memory Repo with the same contract as SupabaseRepo – used by the security tests. */
export class MemoryRepo implements Repo {
  users = new Map<string, AuthUser>(); // token → user
  campaigns: Campaign[] = [];
  memberList: Member[] = [];
  inviteList: Invite[] = [];
  assignmentList: Assignment[] = [];
  states = new Map<string, StoredState>();
  snapshots: Array<SnapshotInfo & { campaignId: string; state: GameState }> = [];
  log: CommandLogEntry[] = [];
  /** Test hook: runs before the next optimistic write (simulates a concurrent writer). */
  beforeSave: (() => void) | null = null;

  /** Auth accounts by email (simulates Supabase Auth users). */
  authAccounts = new Map<string, { confirmed: boolean }>();
  sentCodes: string[] = [];
  /** Test hook: next sendLoginCode result. */
  nextSendResult: SendCodeResult | null = null;

  async userFromToken(token: string) {
    return this.users.get(token) ?? null;
  }
  async isEmailAuthorized(email: string) {
    return this.inviteList.some((i) => i.email === email && !i.acceptedAt) || this.memberList.some((m) => m.email === email);
  }
  async ensureAuthUser(email: string) {
    this.authAccounts.set(email, { confirmed: true });
  }
  async sendLoginCode(email: string): Promise<SendCodeResult> {
    if (this.nextSendResult) {
      const r = this.nextSendResult;
      this.nextSendResult = null;
      return r;
    }
    if (!this.authAccounts.has(email)) return { ok: false, reason: 'failed', detail: 'no such user' };
    this.sentCodes.push(email);
    return { ok: true, via: 'smtp' };
  }
  profileList: Profile[] = [];
  async profiles(campaignId: string | null) {
    return this.profileList.filter((p) => !campaignId || p.campaignId === campaignId).map((p) => ({ ...p, tokenIds: [...p.tokenIds] }));
  }
  async updateProfile(campaignId: string, key: string, patch: Partial<Pick<Profile, 'email' | 'userId' | 'tokenIds'>>) {
    const p = this.profileList.find((x) => x.campaignId === campaignId && x.key === key);
    if (p) Object.assign(p, patch);
  }
  /** Login request log (emailHash, outcome, time). `now` can be moved forward in tests. */
  loginRequests: Array<{ emailHash: string; outcome: string; at: number }> = [];
  now = () => Date.now();
  async loginRequestStats(emailHash: string): Promise<LoginRequestStats> {
    const hourAgo = this.now() - 3600_000;
    const mine = this.loginRequests.filter((r) => r.emailHash === emailHash);
    const last = mine.filter((r) => r.outcome === 'accepted' || r.outcome === 'ignored').sort((a, b) => b.at - a.at)[0];
    return {
      lastAcceptedAt: last ? new Date(last.at).toISOString() : null,
      emailCountHour: mine.filter((r) => r.at >= hourAgo).length,
      globalAcceptedHour: this.loginRequests.filter((r) => r.outcome === 'accepted' && r.at >= hourAgo).length,
    };
  }
  async recordLoginRequest(emailHash: string, outcome: 'accepted' | 'ignored' | 'rate_limited' | 'delivery_failed' | 'quota') {
    this.loginRequests.push({ emailHash, outcome, at: this.now() });
  }
  async emailDelivery() {
    return { via: 'smtp' as const, ok: true };
  }
  async touchMember(campaignId: string, userId: string) {
    const m = this.memberList.find((x) => x.campaignId === campaignId && x.userId === userId);
    if (m) m.lastSeenAt = new Date().toISOString();
  }
  /** Test hook: simulated database deployment status. */
  deploy: DeployStatus = {
    schemaVersion: 1,
    migrations: ['20261101145653', '20261101151000', '20261101160000'],
    campaignSeeded: true,
    profiles: 5,
    realtime: true,
    securityProblems: [],
  };
  async deployStatus() {
    return { ...this.deploy, migrations: [...this.deploy.migrations] };
  }
  async authAdminOk() {
    return true;
  }
  async campaignsById(ids: string[]) {
    return this.campaigns.filter((c) => ids.includes(c.id));
  }
  async membershipsOf(userId: string) {
    return this.memberList.filter((m) => m.userId === userId).map((m) => ({ ...m }));
  }
  async members(campaignId: string) {
    return this.memberList.filter((m) => m.campaignId === campaignId).map((m) => ({ ...m }));
  }
  async upsertMember(m: Member) {
    this.memberList = this.memberList.filter((x) => !(x.campaignId === m.campaignId && x.userId === m.userId));
    this.memberList.push({ ...m });
  }
  async removeMember(campaignId: string, userId: string) {
    this.memberList = this.memberList.filter((x) => !(x.campaignId === campaignId && x.userId === userId));
    this.assignmentList = this.assignmentList.filter((a) => !(a.campaignId === campaignId && a.userId === userId));
  }
  async openInvitesFor(email: string) {
    return this.inviteList.filter((i) => i.email === email && !i.acceptedAt).map((i) => ({ ...i }));
  }
  async invites(campaignId: string) {
    return this.inviteList.filter((i) => i.campaignId === campaignId);
  }
  async upsertInvite(i: Omit<Invite, 'acceptedAt'>) {
    this.inviteList = this.inviteList.filter((x) => !(x.campaignId === i.campaignId && x.email === i.email));
    this.inviteList.push({ ...i, acceptedAt: null });
  }
  async markInviteAccepted(campaignId: string, email: string) {
    const i = this.inviteList.find((x) => x.campaignId === campaignId && x.email === email);
    if (i) i.acceptedAt = new Date().toISOString();
  }
  async deleteInvite(campaignId: string, email: string) {
    this.inviteList = this.inviteList.filter((x) => !(x.campaignId === campaignId && x.email === email));
  }
  async assignments(campaignId: string) {
    return this.assignmentList.filter((a) => a.campaignId === campaignId);
  }
  async assignToken(campaignId: string, tokenId: string, userId: string | null) {
    this.assignmentList = this.assignmentList.filter((a) => !(a.campaignId === campaignId && a.tokenId === tokenId));
    if (userId) this.assignmentList.push({ campaignId, tokenId, userId });
  }
  async loadState(campaignId: string) {
    const s = this.states.get(campaignId);
    return s ? { state: structuredClone(s.state), version: s.version } : null;
  }
  async replaceState(campaignId: string, state: GameState) {
    const version = (this.states.get(campaignId)?.version ?? 0) + 1;
    this.states.set(campaignId, { state: structuredClone(state), version });
    return version;
  }
  async saveState(campaignId: string, state: GameState, expectedVersion: number) {
    if (this.beforeSave) {
      const f = this.beforeSave;
      this.beforeSave = null;
      f();
    }
    const cur = this.states.get(campaignId);
    if (!cur || cur.version !== expectedVersion) return null;
    this.states.set(campaignId, { state: structuredClone(state), version: expectedVersion + 1 });
    return expectedVersion + 1;
  }
  async createSnapshot(campaignId: string, state: GameState, version: number, label: string) {
    this.snapshots.push({ id: this.snapshots.length + 1, campaignId, state: structuredClone(state), version, label, createdAt: new Date().toISOString() });
  }
  async listSnapshots(campaignId: string, limit: number) {
    return this.snapshots
      .filter((s) => s.campaignId === campaignId)
      .reverse()
      .slice(0, limit)
      .map(({ id, version, label, createdAt }) => ({ id, version, label, createdAt }));
  }
  async loadSnapshot(campaignId: string, id: number) {
    return this.snapshots.find((s) => s.campaignId === campaignId && s.id === id)?.state ?? null;
  }
  async pruneSnapshots() {}
  async logCommand(e: CommandLogEntry) {
    this.log.push(e);
  }
}
