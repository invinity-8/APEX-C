/**
 * Wire format shared by the API (server) and the online client.
 * Types only – no runtime code, so the client bundle stays free of server logic.
 */
import type { Command } from '../game/commands.js';
import type { GameState } from '../game/types.js';
import type { ViewModel } from '../game/visibility.js';
import type { Role, SnapshotInfo } from './repo.js';

/** ViewModel without the derived lookup table (rebuilt by the client). */
export type WireView = Omit<ViewModel, 'hexByKey'>;

export interface SessionInfo {
  user: { id: string; email: string };
  campaigns: Array<{ id: string; name: string; role: Role }>;
}

export interface CharacterRef {
  id: string;
  name: string;
}

export interface GmPayload {
  role: 'gm';
  campaignId: string;
  campaignName: string;
  version: number;
  /** null = the campaign has not been initialised yet. */
  state: GameState | null;
}

export interface PlayerPayload {
  role: 'player';
  campaignId: string;
  campaignName: string;
  version: number;
  characters: CharacterRef[];
  activeCharacter: string | null;
  /** null = no character assigned yet or campaign not initialised. */
  view: WireView | null;
  notice?: string;
}

export type CampaignPayload = GmPayload | PlayerPayload;

export interface CommandRequest {
  campaignId: string;
  command: Command;
  /** Player only: which assigned character's perspective to return. */
  as?: string;
}

export interface MemberInfo {
  userId: string;
  email: string;
  role: Role;
  tokenIds: string[];
  lastSeenAt: string | null;
  /** Contacted the server within the last ~75 seconds. */
  online: boolean;
}

export interface InviteInfo {
  email: string;
  role: Role;
  tokenIds: string[];
  acceptedAt: string | null;
}

export interface ProfileInfo {
  key: string;
  displayName: string;
  characterName: string;
  role: Role;
  tokenIds: string[];
  /** Linked email – visible to the GM only. */
  email: string | null;
  /** Has the linked person signed in at least once? */
  signedIn: boolean;
  active: boolean;
  online: boolean;
}

export interface AdminOverview {
  members: MemberInfo[];
  invites: InviteInfo[];
  snapshots: SnapshotInfo[];
  profiles: ProfileInfo[];
  /** The stored campaign still uses the old placeholder characters (Livia, Marcus, …). */
  rosterOutdated: boolean;
}

export type AdminAction =
  | { action: 'overview' }
  | { action: 'invite'; email: string; role: Role; tokenIds: string[] }
  | { action: 'revokeInvite'; email: string }
  | { action: 'assign'; tokenId: string; userId: string | null }
  | { action: 'setRole'; userId: string; role: Role }
  | { action: 'removeMember'; userId: string }
  | { action: 'initCampaign'; radius: number; seed: number }
  | { action: 'importState'; state: unknown }
  | { action: 'linkProfile'; profile: string; email: string | null }
  | { action: 'setProfileCharacters'; profile: string; tokenIds: string[] }
  | { action: 'applyRoster' }
  | { action: 'createSnapshot'; label: string }
  | { action: 'restoreSnapshot'; id: number };

export interface ApiError {
  error: string;
  code?: string;
}
