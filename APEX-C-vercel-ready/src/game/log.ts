import type { GameState, LogEntry } from './types';

export const MAX_LOG = 300;

/** Hängt einen Logeintrag an (mutiert – nur auf Kopien innerhalb von Commands). */
export function addLog(
  state: GameState,
  kind: LogEntry['kind'],
  text: string,
  audience: LogEntry['audience'] = 'all',
): void {
  state.log.push({ id: state.nextLogId++, day: state.day, kind, text, audience });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}
