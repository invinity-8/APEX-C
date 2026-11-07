/**
 * Game scene director – pure state model for the GM's live table.
 *
 * Three things are deliberately separate and must never reset each other:
 *  - selected scene: what the GM clicked in the scene list; shown on the map as a preview only;
 *  - current scene: the GM's live scene, changed only by "Switch Scene";
 *  - player assignments: server state with one revision per player, changed only by explicit
 *    transfers. Selected players stay selected across scene selection and switching.
 * The Arena is a normal entry in the scene list (the legacy Arena scene row).
 */

/** List id of the Arena entry. The GM's stored "current scene" uses null for the Arena (legacy-compatible). */
export const ARENA_ID = 'arena';

export interface DirectorPlayer {
  userId: string;
  name: string;
  tokenIds: string[];
  sceneId: string | null;
  revision: number;
  /** false: the profile never signed in, so it is not a campaign member yet and cannot be moved. */
  joined?: boolean;
}

/** Players the server can move (campaign members). */
export const canMove = (p: Pick<DirectorPlayer, 'joined'>) => p.joined !== false;

export interface DirectorScene {
  id: string;
  name: string;
  is_legacy_arena?: boolean;
}

export interface DirectorState {
  /** GM's current scene: ARENA_ID or a scene id. */
  current: string;
  /** Scene shown on the map; equals `current` unless the GM previews another scene. */
  selected: string;
  /** Players ticked for the next transfer. */
  selectedPlayers: string[];
}

export type DirectorAction =
  | { type: 'select'; id: string }
  | { type: 'switched'; id: string }
  | { type: 'togglePlayer'; userId: string; on: boolean }
  | { type: 'selectPlayers'; userIds: string[] }
  | { type: 'playersLoaded'; players: DirectorPlayer[] }
  | { type: 'restore'; current: string };

export function initialDirector(current: string): DirectorState {
  return { current, selected: current, selectedPlayers: [] };
}

export function directorReducer(state: DirectorState, action: DirectorAction): DirectorState {
  switch (action.type) {
    case 'select':
      // Previewing a scene never changes the current scene or the player selection.
      return state.selected === action.id ? state : { ...state, selected: action.id };
    case 'switched':
      return { ...state, current: action.id, selected: action.id };
    case 'togglePlayer': {
      const has = state.selectedPlayers.includes(action.userId);
      if (has === action.on) return state;
      return { ...state, selectedPlayers: action.on ? [...state.selectedPlayers, action.userId] : state.selectedPlayers.filter((id) => id !== action.userId) };
    }
    case 'selectPlayers':
      return { ...state, selectedPlayers: [...new Set(action.userIds)] };
    case 'playersLoaded': {
      // Refreshing assignments keeps the selection of players that still exist.
      const ids = new Set(action.players.map((p) => p.userId));
      const kept = state.selectedPlayers.filter((id) => ids.has(id));
      return kept.length === state.selectedPlayers.length ? state : { ...state, selectedPlayers: kept };
    }
    case 'restore':
      return state.current === action.current ? state : { ...state, current: action.current, selected: state.selected === state.current ? action.current : state.selected };
  }
}

/** Stored focus (null = Arena) ↔ list id. */
export const storedToCurrent = (stored: string | null): string => stored || ARENA_ID;
export const currentToStored = (id: string): string | null => (id === ARENA_ID ? null : id);

/** Scene id used by the server for a list entry: the Arena maps to the legacy Arena scene row. */
export function assignmentDestination(listId: string, scenes: DirectorScene[]): string | undefined {
  if (listId === ARENA_ID) return scenes.find((s) => s.is_legacy_arena)?.id;
  return scenes.some((s) => s.id === listId) ? listId : undefined;
}

/** Where a player currently is, for the GM's player list. */
export function locationLabel(player: Pick<DirectorPlayer, 'sceneId'>, scenes: DirectorScene[], currentListId?: string): string {
  if (!player.sceneId) return 'Sanctuary';
  const scene = scenes.find((s) => s.id === player.sceneId);
  const here = currentListId !== undefined && (currentListId === player.sceneId || (currentListId === ARENA_ID && !!scene?.is_legacy_arena));
  if (scene?.is_legacy_arena) return here ? 'Arena · current scene' : 'Arena';
  if (!scene) return 'another scene';
  return here ? `${scene.name} · current scene` : scene.name;
}

/**
 * Targets for a transfer with the revisions the GM last saw. Players already at the destination are
 * skipped (nothing to do), so "bring everyone" never needlessly bumps their revision.
 */
export function transferTargets(players: DirectorPlayer[], userIds: string[], destination: string | null): Array<{ userId: string; revision: number }> {
  return players.filter((p) => canMove(p) && userIds.includes(p.userId) && p.sceneId !== destination).map((p) => ({ userId: p.userId, revision: p.revision }));
}

/** Human-readable transfer error. Stale revisions ask for a refresh instead of a blind retry. */
export function describeTransferError(status: number, message: string): string {
  const text = message.replace(/^(Api)?Error:\s*/i, '').trim();
  if (status === 0 || status >= 500) return 'The connection failed. The transfer may still have completed – use “Verify or retry” (same request, never applied twice).';
  if (/assignment changed|refresh the selection/i.test(text)) return 'A player was moved elsewhere in the meantime (assignment revision changed). The player list has been refreshed – check it and send again.';
  if (/player (is not active|unavailable)/i.test(text)) return 'A selected player has not joined the campaign yet (never signed in) and cannot be moved.';
  if (/spawn/i.test(text)) return `${text} Open Scenes, add a spawn point and publish the scene.`;
  return text || 'The transfer was refused.';
}
