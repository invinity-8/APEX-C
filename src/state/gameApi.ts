import type { FeedbackRow } from '../server/repo';
/**
 * The interface between the UI and a game backend. Two implementations:
 *  - useDemoGame()   – everything local in this browser (development / demo)
 *  - useOnlineGame() – shared Supabase campaign via the secure /api/apex server
 */
import type { Command } from '../game/commands';
import type { GameState } from '../game/types';
import type { ViewModel } from '../game/visibility';
import type { CharacterSheet } from '../game/sheet';
import type { AdminOverview, CharacterRef, SheetPayload } from '../server/protocol';
import type { Session } from './storage';

export interface DispatchResult {
  ok: boolean;
  error?: string;
  /** Server answer of a successful action (e.g. the archive list after Archive World). */
  value?: unknown;
}

/**
 * connected    – the command API answered recently (live updates may still be off, see realtimeLive)
 * syncing      – fetching changes
 * pending      – an action is being saved
 * reconnecting – the last request(s) failed; retrying with growing pauses
 * unavailable  – several consecutive failures; nothing can be saved right now
 * unknown      – an action may or may not have been saved; APEX is verifying it
 */
export type Connection = 'connected' | 'syncing' | 'pending' | 'reconnecting' | 'unavailable' | 'unknown';

export interface DemoControls {
  session: Session;
  setSession: (s: Session) => void;
  players: CharacterRef[];
  savedAt: Date | null;
  reset: () => void;
}

export type SheetResult = { ok: true; sheet: SheetPayload } | { ok: false; error: string; conflict?: SheetPayload };

/** Character sheets (stored separately from the game state, one per player character). */
export interface SheetApi {
  load: (tokenId: string) => Promise<SheetResult>;
  save: (tokenId: string, sheet: CharacterSheet, expectedVersion: number, reason?: 'edit' | 'import-merge' | 'import-replace' | 'import-levelup') => Promise<SheetResult>;
  adjust: (tokenId: string, target: 'hp' | 'hpTemp' | 'resource', delta: number, resourceId?: string) => Promise<SheetResult>;
  /** Changes whenever a sheet may have been changed on another device (live ping or poll). */
  revision: number;
  /** HP of the visible party in one request (GM: all player characters, player: own). */
  party: () => Promise<Array<{ tokenId: string; hp: { current: number; max: number; temp: number } | null }>>;
}

export interface OnlineControls {
  /** Display name of the signed-in profile. */
  profileName: string;
  /** Change the signed-in profile's own password. */
  changePassword: (current: string, next: string) => Promise<DispatchResult>;
  campaignId: string;
  campaignName: string;
  characters: CharacterRef[];
  activeCharacter: string | null;
  setActiveCharacter: (id: string) => void;
  connection: Connection;
  /** The Realtime websocket delivers live pings (does NOT prove the command API is healthy). */
  realtimeLive: boolean;
  /** Label of an action whose outcome is still being verified after a lost response. */
  unknownAction: string | null;
  /** Set when the GM switched the active world (reset, new world, restore) – shown once to everybody. */
  worldNotice: string | null;
  clearWorldNotice: () => void;
  /** Human-readable reason of the last failed sync/save, if any. */
  syncError: string | null;
  version: number;
  lastSync: Date | null;
  refresh: () => void;
  signOut: () => void;
  admin: (action: Record<string, unknown>) => Promise<AdminOverview>;
  /** World-replacing GM action (restore, roster conversion …): idempotent request id, verified outcome. */
  worldAction: (action: Record<string, unknown>) => Promise<DispatchResult>;
  /** APEX 0.7 – GM character archive (snapshots); throws ApiError with a readable message. */
  characterArchive: <T>(body: Record<string, unknown>) => Promise<T>;
  /** APEX 0.7 – feedback: list (own/shared or all for the GM) and actions (submit, update, screenshot). */
  feedbackList: () => Promise<FeedbackRow[]>;
  feedback: <T>(body: Record<string, unknown>) => Promise<T>;
}

export interface GameApi {
  mode: 'demo' | 'online';
  view: ViewModel;
  /** Full state – only ever set for the Game Master. */
  gmState: GameState | null;
  /** An action that conflicts with map interaction (move, phase change, world change) is being saved. */
  busy: boolean;
  /** Keys of actions currently being saved (e.g. 'move', 'phase', 'world'). Background sync never appears here. */
  pending: string[];
  dispatch: (cmd: Command) => Promise<DispatchResult>;
  /** GM: replace the campaign with a newly generated arena. */
  regenerate: (radius: number, seed: number) => Promise<DispatchResult>;
  /** GM: load a JSON save into the campaign. */
  importState: (text: string) => Promise<DispatchResult>;
  sheets: SheetApi;
  /** Online only: upload a cropped portrait (data URL) for a character. */
  uploadPortrait?: (tokenId: string, dataUrl: string) => Promise<DispatchResult>;
  demo?: DemoControls;
  online?: OnlineControls;
}

/** Rebuilds the derived lookup table of a view received over the wire. */
export function withLookup(view: Omit<ViewModel, 'hexByKey'>): ViewModel {
  return { ...view, hexByKey: Object.fromEntries(view.hexes.map((h) => [h.key, h])) };
}
