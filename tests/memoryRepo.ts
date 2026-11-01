import type { GameState } from '../src/game/types';
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
  SessionRecord,
  SnapshotInfo,
  StoredSheet,
  StoredState,
} from '../src/server/repo';
import { EXPECTED_MIGRATIONS, REQUIRED_SCHEMA_VERSION } from '../src/server/schema';

/** In-memory Repo with the same contract as SupabaseRepo – used by the security tests and the mock harness. */
export class MemoryRepo implements Repo {
  campaigns: Array<Campaign & { syncTopic?: string }> = [];
  profileList: Profile[] = [];
  credentials = new Map<string, Credential>(); // `${campaign}:${key}` → hash
  setupCodes: Array<{ campaignId: string; codeHash: string; expiresAt: number; usedAt: number | null }> = [];
  sessions = new Map<string, SessionRecord>();
  attempts: Array<{ profileKey: string; ipHash: string; ok: boolean; at: number }> = [];
  memberList: Member[] = [];
  assignmentList: Assignment[] = [];
  states = new Map<string, StoredState>();
  sheets = new Map<string, StoredSheet>(); // `${campaign}:${token}`
  sheetBackups: Array<{ campaignId: string; tokenId: string; data: unknown; version: number; reason: string }> = [];
  snapshots: Array<SnapshotInfo & { campaignId: string; state: GameState }> = [];
  log: CommandLogEntry[] = [];
  /** Test hook: runs before the next optimistic write (simulates a concurrent writer). */
  beforeSave: (() => void) | null = null;
  /** Test hook: runs before the next sheet write. */
  beforeSheetSave: (() => void) | null = null;
  now = () => Date.now();

  async profiles(campaignId: string | null) {
    return this.profileList.filter((p) => !campaignId || p.campaignId === campaignId).map((p) => ({ ...p, tokenIds: [...p.tokenIds] }));
  }
  async updateProfile(campaignId: string, key: string, patch: Partial<Pick<Profile, 'tokenIds' | 'active'>>) {
    const p = this.profileList.find((x) => x.campaignId === campaignId && x.key === key);
    if (p) Object.assign(p, patch);
  }
  async credential(campaignId: string, key: string) {
    const c = this.credentials.get(`${campaignId}:${key}`);
    return c ? { ...c } : null;
  }
  async setCredential(campaignId: string, key: string, passwordHash: string | null) {
    if (passwordHash === null) this.credentials.delete(`${campaignId}:${key}`);
    else this.credentials.set(`${campaignId}:${key}`, { passwordHash, updatedAt: new Date(this.now()).toISOString() });
  }
  async consumeSetupCode(codeHash: string) {
    const c = this.setupCodes.find((x) => x.codeHash === codeHash && x.usedAt === null && x.expiresAt > this.now());
    if (!c) return null;
    c.usedAt = this.now();
    return c.campaignId;
  }
  async createSession(s: Omit<SessionRecord, 'revokedAt' | 'lastSeenAt' | 'createdAt'> & { userAgent: string | null }) {
    const now = new Date(this.now()).toISOString();
    this.sessions.set(s.tokenHash, {
      tokenHash: s.tokenHash,
      campaignId: s.campaignId,
      profileKey: s.profileKey,
      userId: s.userId,
      expiresAt: s.expiresAt,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });
  }
  async session(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : null;
  }
  async touchSession(tokenHash: string, expiresAt: string) {
    const s = this.sessions.get(tokenHash);
    if (s) Object.assign(s, { lastSeenAt: new Date(this.now()).toISOString(), expiresAt });
  }
  async revokeSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    if (s && !s.revokedAt) s.revokedAt = new Date(this.now()).toISOString();
  }
  async revokeProfileSessions(campaignId: string, key: string, exceptHash?: string) {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.campaignId === campaignId && s.profileKey === key && !s.revokedAt && s.tokenHash !== exceptHash) {
        s.revokedAt = new Date(this.now()).toISOString();
        n++;
      }
    }
    return n;
  }
  async activeSessionCounts(campaignId: string) {
    const out: Record<string, number> = {};
    for (const s of this.sessions.values()) {
      if (s.campaignId === campaignId && !s.revokedAt && Date.parse(s.expiresAt) > this.now()) out[s.profileKey] = (out[s.profileKey] ?? 0) + 1;
    }
    return out;
  }
  async loginAttemptStats(profileKey: string, ipHash: string, sinceIso: string): Promise<LoginAttemptStats> {
    const since = Date.parse(sinceIso);
    const fails = this.attempts.filter((a) => !a.ok && a.at >= since);
    const mine = fails.filter((a) => a.profileKey === profileKey).sort((a, b) => a.at - b.at);
    return {
      profileFailures: mine.length,
      ipFailures: fails.filter((a) => a.ipHash === ipHash).length,
      globalFailures: fails.length,
      oldestProfileFailure: mine[0] ? new Date(mine[0].at).toISOString() : null,
    };
  }
  async recordLoginAttempt(profileKey: string, ipHash: string, ok: boolean) {
    this.attempts.push({ profileKey, ipHash, ok, at: this.now() });
  }
  async syncTopic(campaignId: string) {
    const c = this.campaigns.find((x) => x.id === campaignId);
    if (!c) throw new Error('campaign not found');
    c.syncTopic ??= `topic-${Math.random().toString(36).slice(2)}`;
    return `apex-sync-${c.syncTopic}`;
  }
  async rotateSyncTopic(campaignId: string) {
    const c = this.campaigns.find((x) => x.id === campaignId);
    if (c) c.syncTopic = `topic-${Math.random().toString(36).slice(2)}`;
  }
  /** Test hook: simulated database deployment status. */
  deploy: DeployStatus = {
    schemaVersion: REQUIRED_SCHEMA_VERSION,
    migrations: [...EXPECTED_MIGRATIONS],
    campaignSeeded: true,
    profiles: 5,
    realtime: true,
    securityProblems: [],
  };
  async deployStatus() {
    return { ...this.deploy, migrations: [...this.deploy.migrations] };
  }
  async campaignsById(ids: string[]) {
    return this.campaigns.filter((c) => ids.includes(c.id)).map(({ id, slug, name }) => ({ id, slug, name }));
  }
  async members(campaignId: string) {
    return this.memberList.filter((m) => m.campaignId === campaignId).map((m) => ({ ...m }));
  }
  async upsertMember(m: Member) {
    this.memberList = this.memberList.filter((x) => !(x.campaignId === m.campaignId && x.userId === m.userId));
    this.memberList.push({ ...m });
  }
  async touchMember(campaignId: string, userId: string) {
    const m = this.memberList.find((x) => x.campaignId === campaignId && x.userId === userId);
    if (m) m.lastSeenAt = new Date(this.now()).toISOString();
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
  async loadSheet(campaignId: string, tokenId: string) {
    const s = this.sheets.get(`${campaignId}:${tokenId}`);
    return s ? structuredClone(s) : null;
  }
  async saveSheet(campaignId: string, tokenId: string, data: unknown, expectedVersion: number, userId: string) {
    if (this.beforeSheetSave) {
      const f = this.beforeSheetSave;
      this.beforeSheetSave = null;
      f();
    }
    const k = `${campaignId}:${tokenId}`;
    const cur = this.sheets.get(k);
    if ((cur?.version ?? 0) !== expectedVersion) return null;
    this.sheets.set(k, { data: structuredClone(data), version: expectedVersion + 1, updatedAt: new Date(this.now()).toISOString(), updatedBy: userId });
    return expectedVersion + 1;
  }
  async backupSheet(campaignId: string, tokenId: string, data: unknown, version: number, reason: string) {
    this.sheetBackups.push({ campaignId, tokenId, data: structuredClone(data), version, reason });
  }
  async logCommand(e: CommandLogEntry) {
    this.log.push(e);
  }
}
