/**
 * Scene time and initiative – the rules behind "Game" on battle and region maps.
 *
 *  - Every scene has its own clock (day, day/night phase, battle lighting). The Arena's day/night and
 *    movement points are never read or changed here.
 *  - Battle maps start in initiative: when characters arrive, everyone rolls d20 + initiative
 *    modifier (rolled on the server). The order is fixed; each player ends their own turn, the next
 *    turn starts automatically. The GM can end initiative (free movement) and start it again.
 *  - Movement budgets are per "epoch": one turn in initiative (speed in feet), unlimited outside
 *    initiative on battle maps, one day on region maps (8 hexes at speed 30).
 */
import { orderParticipants } from './sceneOperations.js';
import type { GameState, SceneClockState, SceneEncounter, SceneEncounterParticipant } from './types.js';

export const defaultClock = (): SceneClockState => ({ day: 1, phase: 'day', lighting: 'bright', version: 0 });
export const clockOf = (state: Pick<GameState, 'sceneClocks'>, sceneId: string): SceneClockState => ({ ...defaultClock(), ...(state.sceneClocks?.[sceneId] ?? {}) });
export const activeEncounter = (state: Pick<GameState, 'sceneEncounters'>, sceneId: string): SceneEncounter | null => {
  const e = state.sceneEncounters?.[sceneId];
  return e && e.status === 'active' ? e : null;
};

type Result = { ok: true; state: GameState; message?: string } | { ok: false; error: string };

export function setClock(prev: GameState, sceneId: string, expectedVersion: number, change: { phase?: 'day' | 'night'; nextDay?: boolean; lighting?: SceneClockState['lighting'] }): Result {
  const clock = clockOf(prev, sceneId);
  if (clock.version !== expectedVersion) return { ok: false, error: 'The scene time changed. Refresh and try again.' };
  const next: SceneClockState = { ...clock, version: clock.version + 1 };
  if (change.nextDay) { next.day = clock.day + 1; next.phase = 'day'; }
  else if (change.phase) next.phase = change.phase;
  if (change.lighting) next.lighting = change.lighting;
  const state = structuredClone(prev);
  state.sceneClocks = { ...(state.sceneClocks ?? {}), [sceneId]: next };
  return { ok: true, state, message: change.nextDay ? `Day ${next.day} begins – travel is restored.` : change.phase ? `${next.phase === 'night' ? 'Night' : 'Day'} falls on the scene.` : `Lighting: ${next.lighting}.` };
}

export interface InitiativeEntry { tokenId: string; name: string; roll: number; bonus: number }
const participantOf = (e: InitiativeEntry): SceneEncounterParticipant => ({ id: `pc-${e.tokenId}`, name: e.name.slice(0, 80), tokenId: e.tokenId, initiative: e.roll + e.bonus, bonus: e.bonus, visible: true });

/**
 * Arrivals join initiative. Without an active encounter a new one starts (order by the rolls);
 * otherwise new characters are inserted into the running order without changing whose turn it is.
 */
export function joinInitiative(prev: GameState, sceneId: string, encounterId: string, entries: InitiativeEntry[], title = 'Initiative'): Result {
  const current = activeEncounter(prev, sceneId);
  const fresh = entries.filter((e) => prev.tokens[e.tokenId] && !current?.participants.some((p) => p.tokenId === e.tokenId));
  if (!fresh.length) return { ok: true, state: prev };
  const state = structuredClone(prev);
  if (!current) {
    state.sceneEncounters = { ...(state.sceneEncounters ?? {}), [sceneId]: { id: encounterId, sceneId, title, round: 1, turnIndex: 0, version: 1, turnSerial: 1, status: 'active', participants: orderParticipants(fresh.map(participantOf)) } };
    return { ok: true, state, message: 'Initiative rolled.' };
  }
  const e = state.sceneEncounters![sceneId];
  const activeId = e.participants[e.turnIndex]?.id;
  e.participants = orderParticipants([...e.participants, ...fresh.map(participantOf)]);
  e.turnIndex = Math.max(0, e.participants.findIndex((p) => p.id === activeId));
  e.version++;
  return { ok: true, state, message: `${fresh.map((f) => f.name).join(', ')} joined initiative.` };
}

/** Ends the active turn. Players may only end the turn of a character they control. */
export function endTurn(prev: GameState, sceneId: string, encounterId: string, turnSerial: number, controls: (tokenId: string) => boolean): Result {
  const e = activeEncounter(prev, sceneId);
  if (!e || e.id !== encounterId) return { ok: false, error: 'Initiative is not running in this scene.' };
  if ((e.turnSerial ?? 0) !== turnSerial) return { ok: false, error: 'The turn already changed.' };
  const active = e.participants[e.turnIndex];
  if (!active) return { ok: false, error: 'Nobody is in the initiative order.' };
  if (!controls(active.tokenId ?? '')) return { ok: false, error: `It is ${active.name}'s turn.` };
  const state = structuredClone(prev);
  const enc = state.sceneEncounters![sceneId];
  enc.turnIndex++;
  if (enc.turnIndex >= enc.participants.length) { enc.turnIndex = 0; enc.round++; }
  enc.turnSerial = (enc.turnSerial ?? 0) + 1;
  // the new active creature gets its reaction back (5e: it refreshes at the start of your turn)
  const next = enc.participants[enc.turnIndex];
  if (next && enc.reactions?.[next.id] !== undefined) { const { [next.id]: _r, ...rest } = enc.reactions; void _r; enc.reactions = rest; }
  enc.version++;
  return { ok: true, state, message: `${enc.participants[enc.turnIndex].name}'s turn${enc.turnIndex === 0 ? ` · round ${enc.round}` : ''}.` };
}

export function endInitiative(prev: GameState, sceneId: string): Result {
  const e = activeEncounter(prev, sceneId);
  if (!e) return { ok: false, error: 'Initiative is not running.' };
  const state = structuredClone(prev);
  const enc = state.sceneEncounters![sceneId];
  enc.status = 'ended';
  enc.version++;
  enc.turnSerial = (enc.turnSerial ?? 0) + 1;
  return { ok: true, state, message: 'Initiative ended – free movement.' };
}

export type MovementMode = 'turn' | 'free' | 'day';
export interface MovementEpoch { mode: MovementMode; epoch: string; canMove: boolean; reason?: string; allowanceFt?: number }

/**
 * Which movement budget applies. `epoch` is checked again inside the database transaction against
 * the stored game state, so a turn change between check and write can never be exploited.
 */
export function movementEpoch(state: Pick<GameState, 'sceneEncounters' | 'sceneClocks'>, sceneId: string, category: 'battle' | 'region', tokenId: string, gm: boolean): MovementEpoch {
  if (category === 'region') return { mode: 'day', epoch: `d:${clockOf(state, sceneId).day}`, canMove: true };
  const e = activeEncounter(state, sceneId);
  if (!e) return { mode: 'free', epoch: 'free', canMove: true };
  const active = e.participants[e.turnIndex];
  const epoch = `t:${e.id}:${e.turnSerial ?? 0}`;
  if (active?.tokenId === tokenId) return { mode: 'turn', epoch, canMove: true };
  return { mode: 'turn', epoch, canMove: gm, reason: active ? `Wait for your turn – it is ${active.name}'s turn.` : 'Nobody is in the initiative order.' };
}

/** Allowance for one epoch: speed (ft) per turn, unlimited when free, 8 hexes × 3 mi per day at speed 30. */
export function epochAllowance(mode: MovementMode, speedFt: number): number {
  if (mode === 'free') return 1_000_000;
  if (mode === 'turn') return Math.max(0, speedFt);
  return Math.max(0, (speedFt / 30) * 8 * 3);
}

/** d20 + modifier from the sheet: "Initiative" combat value, else the Dexterity modifier. */
export function initiativeBonus(sheet: { combat: Array<{ label: string; value: string }>; attributes: Array<{ name: string; modifier: string }> } | null): number {
  const parse = (v: string | undefined) => { const m = /^\s*([+-−]?\s*\d{1,2})/.exec(v ?? ''); return m ? Number(m[1].replace(/[\s−]/g, (c) => (c === '−' ? '-' : ''))) : null; };
  const init = parse(sheet?.combat.find((c) => /^initiative/i.test(c.label))?.value);
  if (init !== null) return init;
  return parse(sheet?.attributes.find((a) => /^dex/i.test(a.name))?.modifier) ?? 0;
}
