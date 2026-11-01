/**
 * Storage abstraction for the online mode. The production implementation talks to
 * Supabase with the secret (service) key – see supabaseRepo.ts. Tests use an
 * in-memory implementation with exactly the same contract.
 */
import type { GameState } from '../game/types.js';

export type Role = 'gm' | 'player';

export interface AuthUser {
  id: string;
  email: string;
  /** Only users with a confirmed email can redeem invitations. */
  emailConfirmed: boolean;
}

export interface Campaign {
  id: string;
  slug: string;
  name: string;
}

export interface Member {
  campaignId: string;
  userId: string;
  email: string;
  role: Role;
  /** Last authenticated API contact (presence). */
  lastSeenAt?: string | null;
}

export type SendCodeResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'failed'; detail?: string };

export interface HealthReport {
  /** Can the server reach the database and read the APEX tables? */
  database: boolean;
  /** Is the secret key valid for the Auth admin API? */
  authAdmin: boolean;
  /** Does at least one campaign exist (seed migration applied)? */
  campaignSeeded: boolean;
  /** Has the presence migration been applied? */
  presenceColumn: boolean;
  errors: string[];
}

export interface Invite {
  campaignId: string;
  email: string;
  role: Role;
  tokenIds: string[];
  acceptedAt: string | null;
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
  /** Verifies a Supabase access token and returns the user, or null if invalid/expired. */
  userFromToken(token: string): Promise<AuthUser | null>;

  /** Is this email invited to, or a member of, any campaign? */
  isEmailAuthorized(email: string): Promise<boolean>;
  /** Makes sure an Auth account with a confirmed email exists (created only for authorized emails). */
  ensureAuthUser(email: string): Promise<void>;
  /** Asks Supabase Auth to email a one-time sign-in code. Never creates accounts. */
  sendLoginCode(email: string): Promise<SendCodeResult>;
  /** Records presence for a member. */
  touchMember(campaignId: string, userId: string): Promise<void>;
  /** Configuration self-check for the setup page. */
  health(): Promise<HealthReport>;

  campaignsById(ids: string[]): Promise<Campaign[]>;
  membershipsOf(userId: string): Promise<Member[]>;
  members(campaignId: string): Promise<Member[]>;
  upsertMember(m: Member): Promise<void>;
  removeMember(campaignId: string, userId: string): Promise<void>;

  /** Open (not yet accepted) invitations for an email address (lower-case). */
  openInvitesFor(email: string): Promise<Invite[]>;
  invites(campaignId: string): Promise<Invite[]>;
  upsertInvite(i: Omit<Invite, 'acceptedAt'>): Promise<void>;
  markInviteAccepted(campaignId: string, email: string, userId: string): Promise<void>;
  deleteInvite(campaignId: string, email: string): Promise<void>;

  assignments(campaignId: string): Promise<Assignment[]>;
  /** Replaces all assignments of `tokenId` (one owner per character). null = unassign. */
  assignToken(campaignId: string, tokenId: string, userId: string | null): Promise<void>;

  loadState(campaignId: string): Promise<StoredState | null>;
  /** Creates or replaces the state unconditionally (GM initialisation / restore). Returns the new version. */
  replaceState(campaignId: string, state: GameState, userId: string): Promise<number>;
  /** Optimistic write: succeeds only if the stored version still equals `expectedVersion`. */
  saveState(campaignId: string, state: GameState, expectedVersion: number, userId: string): Promise<number | null>;

  createSnapshot(campaignId: string, state: GameState, version: number, label: string, userId: string | null): Promise<void>;
  listSnapshots(campaignId: string, limit: number): Promise<SnapshotInfo[]>;
  loadSnapshot(campaignId: string, id: number): Promise<GameState | null>;
  pruneSnapshots(campaignId: string, keep: number): Promise<void>;

  logCommand(e: CommandLogEntry): Promise<void>;
}
