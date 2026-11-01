import type { GameState } from '../src/game/types';
import type { Assignment, AuthUser, Campaign, CommandLogEntry, Invite, Member, Repo, SnapshotInfo, StoredState } from '../src/server/repo';

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

  async userFromToken(token: string) {
    return this.users.get(token) ?? null;
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
