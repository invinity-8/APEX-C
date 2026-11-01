/**
 * Wire format shared by the API (server) and the online client.
 * Types only – no runtime code, so the client bundle stays free of server logic.
 */
import type { Command } from '../game/commands.js';
import type { CharacterSheet } from '../game/sheet.js';
import type { GameState } from '../game/types.js';
import type { ViewModel } from '../game/visibility.js';
import type { Role, SnapshotInfo } from './repo.js';

/** ViewModel without the derived lookup table (rebuilt by the client). */
export type WireView = Omit<ViewModel, 'hexByKey'>;

export interface SessionInfo {
  user: { id: string; profile: string; displayName: string; role: Role };
  campaigns: Array<{ id: string; name: string; role: Role }>;
  /** Secret Realtime topic for live version pings (only for signed-in profiles). */
  syncTopic: string;
}

/** Public profile status for "Who are you?" – no account data. */
export interface PublicProfile {
  key: string;
  /** Can sign in: activated by the GM AND a password is set. */
  active: boolean;
  /** Only for the GM profile: no password yet → first-time setup with a setup code. */
  needsSetup?: boolean;
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

export interface ProfileInfo {
  key: string;
  displayName: string;
  characterName: string;
  role: Role;
  tokenIds: string[];
  active: boolean;
  passwordSet: boolean;
  passwordUpdatedAt: string | null;
  /** Number of signed-in devices (active sessions). */
  sessions: number;
  online: boolean;
}

export interface AdminOverview {
  snapshots: SnapshotInfo[];
  profiles: ProfileInfo[];
  /** The stored campaign still uses the old placeholder characters (Livia, Marcus, …). */
  rosterOutdated: boolean;
}

export type AdminAction =
  | { action: 'overview' }
  | { action: 'initCampaign'; radius: number; seed: number }
  | { action: 'importState'; state: unknown }
  | { action: 'setPassword'; profile: string; password: string }
  | { action: 'clearPassword'; profile: string }
  | { action: 'setActive'; profile: string; active: boolean }
  | { action: 'revokeSessions'; profile: string }
  | { action: 'setProfileCharacters'; profile: string; tokenIds: string[] }
  | { action: 'applyRoster' }
  | { action: 'createSnapshot'; label: string }
  | { action: 'restoreSnapshot'; id: number };

export interface SheetPayload {
  tokenId: string;
  characterName: string;
  sheet: CharacterSheet;
  /** 0 = no sheet saved yet. */
  version: number;
  updatedAt: string | null;
}

export type SheetAction =
  | { action: 'save'; tokenId: string; sheet: CharacterSheet; expectedVersion: number; reason?: 'edit' | 'import-merge' | 'import-replace' }
  | { action: 'adjust'; tokenId: string; target: 'hp' | 'hpTemp' | 'resource'; resourceId?: string; delta: number };

export interface ApiError {
  error: string;
  code?: string;
}
