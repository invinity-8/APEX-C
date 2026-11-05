import type { GameState } from '../src/game/types';
import { WorldConflictError, type ArchiveInfo, type ArchiveKind } from '../src/server/repo';
import type {
  Assignment,
  AuthBundle,
  Campaign,
  CommandLogEntry,
  FeedbackRow,
  NewFeedback,
  SheetBackupInfo,
  Credential,
  DeployStatus,
  LoginAttemptStats,
  Member,
  Profile,
  ProfilePresence,
  Repo,
  RequestReservation,
  SessionRecord,
  SnapshotInfo,
  StoredSheet,
  StoredState,
} from '../src/server/repo';
import { EXPECTED_MIGRATIONS, REQUIRED_SCHEMA_VERSION } from '../src/server/schema';

/** In-memory Repo with the same contract as SupabaseRepo – used by the security tests and the mock harness. */
export class MemoryRepo implements Repo {
  journalRows: Array<import('../src/server/journals').JournalEntry & { campaign_id: string }> = [];
  readonly journalStore: import('../src/server/journals').JournalStore = {
    list: async (user, offset) => structuredClone(this.journalRows.filter(e => e.campaign_id === user.campaignId && (e.owner_id === user.id || e.sharing === 'party' || (user.role === 'gm' && e.sharing === 'gm')))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(offset, offset + 50)),
    save: async (user, id, version, draft) => {
      const index = this.journalRows.findIndex(e => e.campaign_id === user.campaignId && e.id === id);
      const old = this.journalRows[index];
      if ((version === 0 && old) || (version > 0 && (!old || old.owner_id !== user.id || old.version !== version))) return null;
      const now = new Date().toISOString();
      const entry = { ...structuredClone(draft), id, owner_id: user.id, campaign_id: user.campaignId, version: version + 1, created_at: old?.created_at ?? now, updated_at: now };
      if (old) this.journalRows[index] = entry; else this.journalRows.push(entry);
      return structuredClone(entry);
    },
    remove: async (user, id, version) => {
      const index = this.journalRows.findIndex(e => e.campaign_id === user.campaignId && e.owner_id === user.id && e.id === id && e.version === version);
      if (index < 0) return false;
      this.journalRows.splice(index, 1); return true;
    },
  };
  sceneRows: Array<import('../src/server/scenes').SceneDefinition & { campaign_id: string; published_metadata?: unknown }> = [];
  sceneAssignments: Array<import('../src/server/sceneRuntime').SceneAssignment & { campaign_id: string }> = [];
  sceneTransfers = new Map<string, string>();
  onSceneChange?: (campaignId: string) => void;
  readonly sceneRuntime: import('../src/server/sceneRuntime').SceneRuntime = {
    assignments: async campaignId => structuredClone(this.sceneAssignments.filter(a => a.campaign_id === campaignId).slice(0, 100)),
    assignment: async (campaignId, userId) => structuredClone(this.sceneAssignments.find(a => a.campaign_id === campaignId && a.user_id === userId) ?? null),
    scene: async (campaignId, id) => structuredClone(this.sceneRows.find(s => s.campaign_id === campaignId && s.id === id) as import('../src/server/sceneRuntime').RuntimeScene ?? null),
    transition: async (user, sceneId, targets, requestId) => {
      if (!this.profileList.some(p => p.campaignId === user.campaignId && p.userId === user.id && p.role === 'gm' && p.active)) return { ok: false, error: 'GM permission required.' };
      const stored = this.states.get(user.campaignId); if (!stored) return { ok: false, error: 'Campaign not initialized.' };
      const key = `${user.campaignId}:${requestId}`, payload = JSON.stringify({ actor: user.id, sceneId, targets });
      if (this.sceneTransfers.has(key)) return this.sceneTransfers.get(key) === payload ? { ok: true } : { ok: false, error: 'Request ID already used.' };
      const scene = sceneId ? this.sceneRows.find(s => s.campaign_id === user.campaignId && s.id === sceneId) : null;
      if (sceneId && (!scene || scene.is_draft || scene.archived)) return { ok: false, error: 'Destination unavailable.' };
      const nodes = (scene?.published_metadata as { nodes?: { kind: string; x: number; y: number }[] })?.nodes;
      const spawn = nodes?.find(n => n.kind === 'spawn');
      if (scene && !scene.is_legacy_arena && !spawn) return { ok: false, error: 'Destination has no spawn.' };
      for (const t of targets) {
        if (!this.profileList.some(p => p.campaignId === user.campaignId && p.userId === t.userId && p.role === 'player' && p.active) || !this.memberList.some(m => m.campaignId === user.campaignId && m.userId === t.userId && m.role === 'player')) return { ok: false, error: 'Player unavailable.' };
        const a = this.sceneAssignments.find(a => a.campaign_id === user.campaignId && a.user_id === t.userId);
        if ((a?.revision ?? 0) !== t.revision) return { ok: false, error: 'Assignment changed.' };
      }
      for (const t of targets) {
        const a = this.sceneAssignments.find(a => a.campaign_id === user.campaignId && a.user_id === t.userId);
        const next = { campaign_id: user.campaignId, user_id: t.userId, scene_id: sceneId, revision: (a?.revision ?? 0) + 1, spawn_x: spawn?.x ?? null, spawn_y: spawn?.y ?? null };
        if (a) Object.assign(a, next); else this.sceneAssignments.push(next);
      }
      this.sceneTransfers.set(key, payload); this.states.set(user.campaignId, { state: stored.state, version: stored.version + 1 }); this.onSceneChange?.(user.campaignId);
      return { ok: true };
    },
  };
  readonly sceneCatalog: import('../src/server/scenes').SceneCatalog = {
    list: async (campaignId, offset) => {
      if (this.states.has(campaignId) && !this.sceneRows.some(s => s.campaign_id === campaignId && s.is_legacy_arena)) this.sceneRows.push({ campaign_id: campaignId, id: crypto.randomUUID(), name: 'Arena', category: 'region', is_legacy_arena: true, is_draft: false, archived: false, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), metadata: {} });
      return this.sceneRows.filter(s => s.campaign_id === campaignId).slice(offset, offset + 50).map(({ metadata: _private, published_metadata: _published, campaign_id: _campaign, ...s }) => structuredClone(s));
    },
    get: async (campaignId, id) => structuredClone(this.sceneRows.find(s => s.campaign_id === campaignId && s.id === id) ?? null),
    create: async (campaignId, scene) => {
      const row = { ...scene, campaign_id: campaignId, id: crypto.randomUUID(), is_draft: true, is_legacy_arena: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), revision: 1, archived: false, metadata: {} };
      this.sceneRows.push(row); return structuredClone(row);
    },
    update: async (campaignId, id, revision, patch) => {
      const row = this.sceneRows.find(s => s.campaign_id === campaignId && s.id === id && s.revision === revision);
      if (!row) return null;
      if (patch.archived && this.sceneAssignments.some(a => a.campaign_id === campaignId && a.scene_id === id)) return null;
      Object.assign(row, structuredClone(patch), { revision: revision + 1, updated_at: new Date().toISOString() });
      return structuredClone(row);
    },
  };
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
  sheetBackups: Array<{ id: number; campaignId: string; tokenId: string; data: unknown; version: number; reason: string; createdAt: string }> = [];
  feedback: Array<FeedbackRow & { campaignId: string }> = [];
  snapshots: Array<SnapshotInfo & { campaignId: string; state: GameState }> = [];
  log: CommandLogEntry[] = [];
  /** Test hook: runs before the next optimistic write (simulates a concurrent writer). */
  beforeSave: (() => void) | null = null;
  /** Test hook: runs before the next sheet write. */
  beforeSheetSave: (() => void) | null = null;
  now = () => Date.now();
  /** Number of repository calls (≈ database round trips in production). */
  calls = 0;
  /** Request-id reservations (idempotency). */
  requests = new Map<string, { state: 'pending' | 'ok' | 'failed'; version: number | null; error: string | null }>();

  constructor() {
    // Count every repository call like a database round trip.
    return new Proxy(this, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v === 'function' && prop !== 'constructor' && typeof prop === 'string' && !['now', 'beforeSave', 'beforeSheetSave'].includes(prop)) {
          return (...args: unknown[]) => {
            target.calls++;
            return (v as (...a: unknown[]) => unknown).apply(receiver, args);
          };
        }
        return v;
      },
    });
  }

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
  async credentialDates(campaignId: string | null) {
    const out: Record<string, string> = {};
    for (const [k, c] of this.credentials) {
      const [cid, key] = k.split(':');
      if (!campaignId) out[k] = c.updatedAt;
      else if (cid === campaignId) out[key] = c.updatedAt;
    }
    return out;
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
  async authBundle(tokenHash: string): Promise<AuthBundle | null> {
    const s = this.sessions.get(tokenHash);
    const now = this.now();
    if (!s || s.revokedAt || Date.parse(s.expiresAt) <= now || Date.parse(s.createdAt) + 30 * 86400_000 <= now) return null;
    const p = this.profileList.find((x) => x.campaignId === s.campaignId && x.key === s.profileKey);
    const c = this.campaigns.find((x) => x.id === s.campaignId);
    if (!p || !c) return null;
    const before = { ...s };
    if (now - Date.parse(s.lastSeenAt) > 30_000) s.lastSeenAt = new Date(now).toISOString();
    c.syncTopic ??= `topic-${Math.random().toString(36).slice(2)}`;
    return {
      session: before,
      profile: { ...p, tokenIds: [...p.tokenIds] },
      passwordSet: this.credentials.has(`${s.campaignId}:${s.profileKey}`),
      campaign: { name: c.name, syncTopic: `apex-sync-${c.syncTopic}` },
    };
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
  async sessionPresence(campaignId: string) {
    const out: Record<string, ProfilePresence> = {};
    for (const s of this.sessions.values()) {
      if (s.campaignId !== campaignId || s.revokedAt || Date.parse(s.expiresAt) <= this.now()) continue;
      const p = (out[s.profileKey] ??= { sessions: 0, lastSeenAt: null });
      p.sessions++;
      if (!p.lastSeenAt || s.lastSeenAt > p.lastSeenAt) p.lastSeenAt = s.lastSeenAt;
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
  async stateVersion(campaignId: string) {
    return this.states.get(campaignId)?.version ?? null;
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
  archives: Array<ArchiveInfo & { campaignId: string; state: GameState }> = [];
  /** Test hook: fail the next world transition (simulated database error). */
  failNextTransition: Error | null = null;
  async worldTransition(
    campaignId: string,
    expectedVersion: number | null,
    newState: GameState | null,
    archive: { name: string; description: string; kind: ArchiveKind },
  ) {
    if (this.failNextTransition) {
      const e = this.failNextTransition;
      this.failNextTransition = null;
      throw e;
    }
    const cur = this.states.get(campaignId);
    if (!cur) throw new Error('apex:no_world');
    if (expectedVersion !== null && cur.version !== expectedVersion) throw new WorldConflictError();
    const id = `00000000-0000-4000-8000-${String(this.archives.length + 1).padStart(12, '0')}`;
    this.archives.unshift({
      id,
      campaignId,
      name: archive.name.trim().slice(0, 120) || 'Archived world',
      description: archive.description.slice(0, 2000),
      kind: archive.kind,
      createdAt: new Date(this.now()).toISOString(),
      stateVersion: cur.version,
      worldName: cur.state.world?.name ?? null,
      seed: cur.state.config.seed,
      radius: cur.state.config.mapRadius,
      day: cur.state.day,
      phase: cur.state.phase,
      state: structuredClone(cur.state),
    });
    let version = cur.version;
    if (newState) {
      version = cur.version + 1;
      this.states.set(campaignId, { state: structuredClone(newState), version });
    }
    return { archiveId: id, version };
  }
  async listArchives(campaignId: string) {
    return this.archives.filter((a) => a.campaignId === campaignId).map(({ state: _s, campaignId: _c, ...info }) => info);
  }
  async loadArchive(campaignId: string, id: string) {
    const a = this.archives.find((x) => x.campaignId === campaignId && x.id === id);
    if (!a) return null;
    const { campaignId: _c, ...rest } = a;
    return structuredClone(rest);
  }
  portraits = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async uploadPortrait(path: string, bytes: Uint8Array, contentType: string) {
    if (this.portraits.has(path)) throw new Error('portrait upload: exists');
    this.portraits.set(path, { bytes, contentType });
  }
  async portraitUrl(path: string) {
    return this.portraits.has(path) ? `/__mock/portrait?path=${encodeURIComponent(path)}` : null;
  }
  async deletePortrait(path: string) {
    this.portraits.delete(path);
  }
  async loadSheet(campaignId: string, tokenId: string) {
    const s = this.sheets.get(`${campaignId}:${tokenId}`);
    return s ? structuredClone(s) : null;
  }
  async loadSheetVitals(campaignId: string) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.sheets) if (k.startsWith(`${campaignId}:`)) out[k.slice(campaignId.length + 1)] = structuredClone((v.data as { hitPoints?: unknown })?.hitPoints ?? null);
    return out;
  }
  async loadSheetDetails(campaignId: string) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.sheets) if (k.startsWith(`${campaignId}:`)) out[k.slice(campaignId.length + 1)] = structuredClone((v.data as { details?: unknown })?.details ?? null);
    return out;
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
    this.sheetBackups.push({ id: this.sheetBackups.length + 1, campaignId, tokenId, data: structuredClone(data), version, reason, createdAt: new Date(this.now()).toISOString() });
  }
  private backupInfo(b: MemoryRepo['sheetBackups'][number]): SheetBackupInfo {
    const d = (b.data ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { id: b.id, version: b.version, reason: b.reason, createdAt: b.createdAt, kind: d.kind === 'apex-character-snapshot' ? 'snapshot' : 'backup', name: str(d.name), note: str(d.note), level: str(d.level) };
  }
  async listSheetBackups(campaignId: string, tokenId: string, limit: number) {
    return this.sheetBackups.filter((b) => b.campaignId === campaignId && b.tokenId === tokenId).reverse().slice(0, limit).map((b) => this.backupInfo(b));
  }
  async loadSheetBackup(campaignId: string, id: number) {
    const b = this.sheetBackups.find((x) => x.campaignId === campaignId && x.id === id);
    return b ? { ...this.backupInfo(b), tokenId: b.tokenId, data: structuredClone(b.data) } : null;
  }
  async createFeedback(f: NewFeedback) {
    const now = new Date(this.now()).toISOString();
    const row = { ...f, id: `fb-${this.feedback.length + 1}`, status: 'new' as const, gmNotes: '', shared: false, createdAt: now, updatedAt: now, statusChangedAt: null };
    this.feedback.push(row);
    const { campaignId: _c, ...out } = row;
    void _c;
    return structuredClone(out);
  }
  async listFeedback(campaignId: string, opts: { userId?: string; limit: number }) {
    return this.feedback
      .filter((f) => f.campaignId === campaignId && (!opts.userId || f.userId === opts.userId || f.shared))
      .reverse()
      .slice(0, opts.limit)
      .map(({ campaignId: _c, ...f }) => (void _c, structuredClone(f)));
  }
  async updateFeedback(campaignId: string, id: string, patch: Partial<Pick<FeedbackRow, 'status' | 'gmNotes' | 'shared'>>) {
    const f = this.feedback.find((x) => x.campaignId === campaignId && x.id === id);
    if (!f) return null;
    const now = new Date(this.now()).toISOString();
    if (patch.status !== undefined) (f.status = patch.status), (f.statusChangedAt = now);
    if (patch.gmNotes !== undefined) f.gmNotes = patch.gmNotes;
    if (patch.shared !== undefined) f.shared = patch.shared;
    f.updatedAt = now;
    const { campaignId: _c, ...out } = f;
    void _c;
    return structuredClone(out);
  }
  async countRecentFeedback(campaignId: string, userId: string, sinceIso: string) {
    return this.feedback.filter((f) => f.campaignId === campaignId && f.userId === userId && f.createdAt >= sinceIso).length;
  }
  async logCommand(e: CommandLogEntry) {
    this.log.push(e);
  }
  async reserveRequest(e: Omit<CommandLogEntry, 'ok' | 'error' | 'version'> & { requestId: string }): Promise<RequestReservation> {
    const k = `${e.campaignId}:${e.requestId}`;
    const cur = this.requests.get(k);
    if (cur) return { kind: 'existing', ...cur };
    this.requests.set(k, { state: 'pending', version: null, error: null });
    this.log.push({ ...e, ok: false, error: 'pending' });
    return { kind: 'reserved' };
  }
  async finishRequest(campaignId: string, requestId: string, ok: boolean, error: string | null, version: number | null) {
    this.requests.set(`${campaignId}:${requestId}`, { state: ok ? 'ok' : 'failed', version, error });
    const entry = [...this.log].reverse().find((l) => (l as { requestId?: string }).requestId === requestId);
    if (entry) Object.assign(entry, { ok, error: error ?? undefined, version: version ?? undefined });
  }
  async requestStatus(campaignId: string, requestId: string): Promise<RequestReservation | null> {
    const cur = this.requests.get(`${campaignId}:${requestId}`);
    return cur ? { kind: 'existing', ...cur } : null;
  }
}
