import type { GameState, LogEntry } from './types.js';

export const MAX_LOG = 300;

/** Appends a log entry (mutates – only on copies inside commands). */
export function addLog(
  state: GameState,
  kind: LogEntry['kind'],
  text: string,
  audience: LogEntry['audience'] = 'all',
): void {
  state.log.push({ id: state.nextLogId++, day: state.day, phase: state.phase ?? 'day', kind, text, audience });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}
