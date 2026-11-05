/**
 * Storage abstraction for the online mode. The production implementation talks to
 * Supabase with the secret (service) key – see supabaseRepo.ts. Tests use an
 * in-memory implementation with exactly the same contract.
 */
import type { GameState } from '../game/types.js';

export type Role = 'gm' | 'player';

/** The signed-in identity. Built ONLY from a valid server-side session + the profile row. */
export interface AuthUser {
  /** Stable id of the profile (apex_profiles.user_id). */
  id: string;
  campaignId: string;
  profileKey: string;
  displayName: string;
  /** Role from the database (apex_profiles.role) – never from the request. */
  role: Role;
  /** Characters this profile controls (players). */
  tokenIds: string[];
  /** SHA-256 of the session token (used for logout / password change). */
  sessionHash: string;
  campaignName: string;
  /** Secret Realtime topic of the campaign. */
  syncTopic: string;
}

export interface Campaign {
  id: string;
  slug: string;
  name: string;
}

export interface Member {
  campaignId: string;
  userId: string;
  email: string | null;
  role: Role;
  /** Last authenticated API contact (presence). */
  lastSeenAt?: string | null;
}

export interface DeployStatus {
  schemaVersion: number | null;
  /** Versions recorded in supabase_migrations.schema_migrations. */
  migrations: string[];
  campaignSeeded: boolean;
  profiles: number;
  /** Live-update broadcast trigger installed. */
  realtime: boolean;
  /** RLS/privilege problems found by the database itself (null = check not deployed yet). */
  securityProblems: string[] | null;
}

export interface HealthReport {
  /** Can the server reach the database and read the APEX tables? */
  database: boolean;
  /** Does the main campaign exist? */
  campaignSeeded: boolean;
  /** Are the five profiles present? */
  profilesTable: boolean;
  /** Is the live-update broadcast installed? */
  realtime: boolean;
  /** RLS, privileges and legacy objects verified by the database (null = not checked). */
  securityOk: boolean | null;
  /** Schema version found in the database / required by this code. */
  schemaVersion: number | null;
  requiredSchemaVersion: number;
  /** Every migration file of this deployment is recorded in the database history. */
  migrationsComplete: boolean;
  missingMigrations: string[];
  /** Versions in the database history that this deployment does not know (newer DB or drift). */
  unknownMigrations: string[];
  errors: string[];
}

/** A "Who are you?" profile = one login identity. */
export interface Profile {
  campaignId: string;
  key: string;
  displayName: string;
  characterName: string;
  role: Role;
  tokenIds: string[];
  /** Stable identity of this profile. */
  userId: string;
  /** Deactivated profiles cannot sign in; their sessions are revoked. */
  active: boolean;
}

export interface Credential {
  passwordHash: string;
  updatedAt: string;
}

export interface SessionRecord {
  tokenHash: string;
  campaignId: string;
  profileKey: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** Everything needed to authenticate a request, loaded in ONE database round trip. */
export interface AuthBundle {
  session: SessionRecord;
  profile: Profile;
  passwordSet: boolean;
  campaign: { name: string; syncTopic: string };
}

/** Outcome of an idempotent command reservation. */
export type RequestReservation =
  | { kind: 'reserved' }
  | { kind: 'existing'; state: 'pending' | 'ok' | 'failed'; version: number | null; error: string | null };

export interface ProfilePresence {
  /** Active (not revoked, not expired) sessions. */
  sessions: number;
  /** Most recent API contact of any of these sessions. */
  lastSeenAt: string | null;
}

export interface LoginAttemptStats {
  /** Failed attempts for this profile within the window. */
  profileFailures: number;
  /** Failed attempts from this IP within the window. */
  ipFailures: number;
  /** Failed attempts overall within the window. */
  globalFailures: number;
  /** Time of the oldest counted failure for this profile (to compute the wait). */
  oldestProfileFailure: string | null;
}

export interface Assignment {
  campaignId: string;
  userId: string;
  tokenId: string;
}

export interface StoredState {
  state: GameState;
  version: number;
}

export interface StoredSheet {
  data: unknown;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export type ArchiveKind = 'manual' | 'before-create' | 'before-reset' | 'before-restore';

export interface ArchiveInfo {
  id: string;
  name: string;
  description: string;
  kind: ArchiveKind;
  createdAt: string;
  stateVersion: number;
  worldName: string | null;
  seed: number | null;
  radius: number | null;
  day: number | null;
  phase: string | null;
}

/** Thrown by worldTransition when the world changed after it was read (nothing was modified). */
export class WorldConflictError extends Error {
  constructor() {
    super('The world was changed in the meantime.');
  }
}

export interface SnapshotInfo {
  id: number;
  version: number;
  label: string;
  createdAt: string;
}

export interface CommandLogEntry {
  campaignId: string;
  userId: string;
  role: Role;
  command: unknown;
  ok: boolean;
  error?: string;
  version?: number;
}

export interface Repo {
  /** Separate, bounded GM preparation API; never included in shared game state. */
  sceneCatalog?: import('./scenes.js').SceneCatalog;
  // ---- profiles & credentials
  /** Profiles of one campaign, or – with campaignId null – of all campaigns. */
  profiles(campaignId: string | null): Promise<Profile[]>;
  updateProfile(campaignId: string, key: string, patch: Partial<Pick<Profile, 'tokenIds' | 'active'>>): Promise<void>;
  credential(campaignId: string, key: string): Promise<Credential | null>;
  /** Password timestamps of all profiles (one query). campaignId null = all campaigns, keyed "campaign:key". */
  credentialDates(campaignId: string | null): Promise<Record<string, string>>;
  /** null removes the password (profile locked). */
  setCredential(campaignId: string, key: string, passwordHash: string | null, byUserId: string | null): Promise<void>;
  /** Marks a valid, unused, unexpired setup code as used and returns its campaign (atomic). */
  consumeSetupCode(codeHash: string): Promise<string | null>;

  // ---- sessions
  createSession(s: Omit<SessionRecord, 'revokedAt' | 'lastSeenAt' | 'createdAt'> & { userAgent: string | null }): Promise<void>;
  session(tokenHash: string): Promise<SessionRecord | null>;
  /** Session + profile + password flag + campaign name/topic in one round trip. */
  authBundle(tokenHash: string): Promise<AuthBundle | null>;
  touchSession(tokenHash: string, expiresAt: string): Promise<void>;
  revokeSession(tokenHash: string): Promise<void>;
  /** Revokes all sessions of a profile, optionally except one. Returns how many were revoked. */
  revokeProfileSessions(campaignId: string, key: string, exceptHash?: string): Promise<number>;
  /** Active sessions and last contact per profile key. */
  sessionPresence(campaignId: string): Promise<Record<string, ProfilePresence>>;

  // ---- login rate limiting
  loginAttemptStats(profileKey: string, ipHash: string, sinceIso: string): Promise<LoginAttemptStats>;
  recordLoginAttempt(profileKey: string, ipHash: string, ok: boolean): Promise<void>;

  // ---- realtime
  /** Secret broadcast topic of the campaign. */
  syncTopic(campaignId: string): Promise<string>;
  /** New secret topic (after revoking someone's access). */
  rotateSyncTopic(campaignId: string): Promise<void>;

  // ---- deployment
  /** Raw deployment status from the database (server-only function apex_deploy_status). */
  deployStatus(): Promise<DeployStatus>;

  // ---- campaigns & members
  campaignsById(ids: string[]): Promise<Campaign[]>;
  members(campaignId: string): Promise<Member[]>;
  upsertMember(m: Member): Promise<void>;
  /** Records presence for a member. */
  touchMember(campaignId: string, userId: string): Promise<void>;

  assignments(campaignId: string): Promise<Assignment[]>;
  /** Replaces all assignments of `tokenId` (one owner per character). null = unassign. */
  assignToken(campaignId: string, tokenId: string, userId: string | null): Promise<void>;

  // ---- game state
  loadState(campaignId: string): Promise<StoredState | null>;
  /** Only the version number of the stored state (cheap; no state transfer). null = no state yet. */
  stateVersion(campaignId: string): Promise<number | null>;
  /** Creates or replaces the state unconditionally (GM initialisation / restore). Returns the new version. */
  replaceState(campaignId: string, state: GameState, userId: string): Promise<number>;
  /** Optimistic write: succeeds only if the stored version still equals `expectedVersion`. */
  saveState(campaignId: string, state: GameState, expectedVersion: number, userId: string): Promise<number | null>;

  createSnapshot(campaignId: string, state: GameState, version: number, label: string, userId: string | null): Promise<void>;
  listSnapshots(campaignId: string, limit: number): Promise<SnapshotInfo[]>;
  loadSnapshot(campaignId: string, id: number): Promise<GameState | null>;
  pruneSnapshots(campaignId: string, keep: number): Promise<void>;

  // ---- world management
  /**
   * ONE transaction: lock the state, check expectedVersion (null = no check), archive the current world,
   * optionally replace it with newState (null = archive only). Throws WorldConflictError on a version mismatch.
   */
  worldTransition(
    campaignId: string,
    expectedVersion: number | null,
    newState: GameState | null,
    archive: { name: string; description: string; kind: ArchiveKind },
    userId: string,
  ): Promise<{ archiveId: string; version: number }>;
  listArchives(campaignId: string): Promise<ArchiveInfo[]>;
  loadArchive(campaignId: string, id: string): Promise<(ArchiveInfo & { state: GameState }) | null>;

  // ---- portraits (private storage bucket)
  uploadPortrait(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Short-lived signed URL for a private portrait. */
  portraitUrl(path: string, expiresInSeconds: number): Promise<string | null>;
  deletePortrait(path: string): Promise<void>;

  // ---- character sheets
  loadSheet(campaignId: string, tokenId: string): Promise<StoredSheet | null>;
  /** Hit points of every stored sheet in one query (Party Health) – token id → raw hitPoints JSON. */
  loadSheetVitals(campaignId: string): Promise<Record<string, unknown>>;
  /** APEX 0.7: the `details` list of every sheet (level detection for the party's median level). */
  loadSheetDetails(campaignId: string): Promise<Record<string, unknown>>;
  /** Optimistic write. expectedVersion 0 = create. Returns the new version, or null if someone else wrote first. */
  saveSheet(campaignId: string, tokenId: string, data: unknown, expectedVersion: number, userId: string): Promise<number | null>;
  backupSheet(campaignId: string, tokenId: string, data: unknown, version: number, reason: string, userId: string): Promise<void>;
  /** APEX 0.7: character snapshots + automatic sheet backups of one character (newest first, metadata only). */
  listSheetBackups(campaignId: string, tokenId: string, limit: number): Promise<SheetBackupInfo[]>;
  loadSheetBackup(campaignId: string, id: number): Promise<(SheetBackupInfo & { tokenId: string; data: unknown }) | null>;

  // ---- feedback (APEX 0.7)
  createFeedback(row: NewFeedback): Promise<FeedbackRow>;
  /** userId set = only that user's reports plus reports the GM shared. */
  listFeedback(campaignId: string, opts: { userId?: string; limit: number }): Promise<FeedbackRow[]>;
  updateFeedback(campaignId: string, id: string, patch: Partial<Pick<FeedbackRow, 'status' | 'gmNotes' | 'shared'>>): Promise<FeedbackRow | null>;
  countRecentFeedback(campaignId: string, userId: string, sinceIso: string): Promise<number>;

  logCommand(e: CommandLogEntry): Promise<void>;
  /** Idempotency: reserves a client request id (atomic, unique per campaign) before a state change. */
  reserveRequest(e: Omit<CommandLogEntry, 'ok' | 'error' | 'version'> & { requestId: string }): Promise<RequestReservation>;
  /** Records the outcome of a reserved request. */
  finishRequest(campaignId: string, requestId: string, ok: boolean, error: string | null, version: number | null): Promise<void>;
  /** Looks up a reserved request (to verify an action whose response was lost). */
  requestStatus(campaignId: string, requestId: string): Promise<RequestReservation | null>;
}

/** APEX 0.7 – one row of apex_character_sheet_backups without its payload. */
export interface SheetBackupInfo {
  id: number;
  version: number;
  reason: string;
  createdAt: string;
  /** 'snapshot' = named character snapshot; 'backup' = automatic sheet backup (import, restore …). */
  kind: 'snapshot' | 'backup';
  name: string | null;
  note: string | null;
  level: string | null;
}

export type FeedbackKind = 'bug' | 'feature' | 'improvement';
export type FeedbackStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'rejected';
export interface NewFeedback {
  campaignId: string;
  userId: string;
  profileKey: string;
  tokenId: string | null;
  kind: FeedbackKind;
  category: string;
  title: string;
  description: string;
  steps: string;
  page: string;
  appVersion: string;
  screenshotPath: string | null;
}
export interface FeedbackRow extends Omit<NewFeedback, 'campaignId'> {
  id: string;
  status: FeedbackStatus;
  gmNotes: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string | null;
}
