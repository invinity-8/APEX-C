/**
 * The interface between the UI and a game backend. Two implementations:
 *  - useDemoGame()   – everything local in this browser (development / demo)
 *  - useOnlineGame() – shared Supabase campaign via the secure /api/apex server
 */
import type { Command } from '../game/commands';
import type { GameState } from '../game/types';
import type { ViewModel } from '../game/visibility';
import type { AdminOverview, CharacterRef } from '../server/protocol';
import type { Session } from './storage';

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

export type Connection = 'live' | 'connecting' | 'offline';

export interface DemoControls {
  session: Session;
  setSession: (s: Session) => void;
  players: CharacterRef[];
  savedAt: Date | null;
  reset: () => void;
}

export interface OnlineControls {
  email: string;
  campaignId: string;
  campaignName: string;
  characters: CharacterRef[];
  activeCharacter: string | null;
  setActiveCharacter: (id: string) => void;
  connection: Connection;
  version: number;
  lastSync: Date | null;
  refresh: () => void;
  signOut: () => void;
  admin: (action: Record<string, unknown>) => Promise<AdminOverview>;
}

export interface GameApi {
  mode: 'demo' | 'online';
  view: ViewModel;
  /** Full state – only ever set for the Game Master. */
  gmState: GameState | null;
  busy: boolean;
  dispatch: (cmd: Command) => Promise<DispatchResult>;
  /** GM: replace the campaign with a newly generated arena. */
  regenerate: (radius: number, seed: number) => Promise<DispatchResult>;
  /** GM: load a JSON save into the campaign. */
  importState: (text: string) => Promise<DispatchResult>;
  demo?: DemoControls;
  online?: OnlineControls;
}

/** Rebuilds the derived lookup table of a view received over the wire. */
export function withLookup(view: Omit<ViewModel, 'hexByKey'>): ViewModel {
  return { ...view, hexByKey: Object.fromEntries(view.hexes.map((h) => [h.key, h])) };
}
