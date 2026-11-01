/**
 * Wire format shared by the API (server) and the online client.
 * Types only – no runtime code, so the client bundle stays free of server logic.
 */
import type { Command } from '../game/commands';
import type { GameState } from '../game/types';
import type { ViewModel } from '../game/visibility';
import type { Role, SnapshotInfo } from './repo';

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
}

export interface InviteInfo {
  email: string;
  role: Role;
  tokenIds: string[];
  acceptedAt: string | null;
}

export interface AdminOverview {
  members: MemberInfo[];
  invites: InviteInfo[];
  snapshots: SnapshotInfo[];
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
  | { action: 'createSnapshot'; label: string }
  | { action: 'restoreSnapshot'; id: number };

export interface ApiError {
  error: string;
  code?: string;
}
