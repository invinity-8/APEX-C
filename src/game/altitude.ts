/**
 * Flying, climbing and falling on battle maps (APEX 1.9, 3D stage 2) – D&D 5e 2014 / SRD 5.1, pure rules.
 *
 *  - Every creature has an altitude in feet above the ground of its hex (0 = standing). Absolute height = ground
 *    level × 5 ft + altitude.
 *  - Flying: a creature with a flying speed (sheet "Speed (flying)", beast form, stat block, the Fly spell) may move
 *    up and down and stay in the air. Vertical movement costs feet like horizontal movement; flying ignores
 *    difficult ground and steps/cliffs (walls still block).
 *  - Climbing: a creature with a climbing speed takes cliffs like steps and pays no extra cost for climbing.
 *  - Distances are 3D: the larger of the horizontal and the vertical distance (5-ft grid rule, like diagonals).
 *  - Falling: a flying creature that is knocked prone, incapacitated, reduced to speed 0 or loses its flight falls:
 *    1d6 bludgeoning damage per 10 ft (max 20d6), lands prone.
 */
import type { GameState } from './types.js';
import type { CharacterSheet } from './sheet.js';
import { effectsOf } from './combatEffects.js';

export const MAX_ALTITUDE_FT = 120;
export type FlightSource = 'speed' | 'spell';
export interface Altitude { ft: number; source?: FlightSource }

export const altitudeOf = (state: Pick<GameState, 'sceneAltitude'>, sceneId: string, actor: string): number => state.sceneAltitude?.[sceneId]?.[actor]?.ft ?? 0;
export function setAltitude(state: GameState, sceneId: string, actor: string, ft: number, source?: FlightSource) {
  const scene = { ...(state.sceneAltitude?.[sceneId] ?? {}) };
  const v = Math.max(0, Math.min(MAX_ALTITUDE_FT, Math.round(ft / 5) * 5));
  if (v) scene[actor] = { ft: v, ...(source ? { source } : {}) };
  else delete scene[actor];
  state.sceneAltitude = { ...(state.sceneAltitude ?? {}), [sceneId]: scene };
}

const speedFrom = (sheet: Pick<CharacterSheet, 'combat'>, re: RegExp) => {
  const row = sheet.combat.find((c) => re.test(c.label));
  const n = Number(/(\d{1,3})/.exec(row?.value ?? '')?.[1]);
  return Number.isFinite(n) ? n : 0;
};
/** Flying / climbing speed of a character: Wild Shape form, else the sheet, else effects (Fly: 60 ft). */
export function pcSpeeds(sheet: Pick<CharacterSheet, 'combat' | 'wildShape'>, beast?: { speed: { fly?: number; climb?: number } } | null, effects: Array<{ mods: { fly?: number } }> = []): { fly: number; climb: number; flySource?: FlightSource } {
  const spell = Math.max(0, ...effects.map((e) => e.mods.fly ?? 0));
  if (sheet.wildShape && beast) {
    const fly = beast.speed.fly ?? 0;
    return { fly: Math.max(fly, spell), climb: beast.speed.climb ?? 0, ...(fly || spell ? { flySource: fly >= spell ? 'speed' : 'spell' } : {}) };
  }
  const fly = speedFrom(sheet, /speed.*(fly|flying)/i), climb = speedFrom(sheet, /speed.*climb/i);
  return { fly: Math.max(fly, spell), climb, ...(fly || spell ? { flySource: fly >= spell ? 'speed' : 'spell' } : {}) };
}
export function npcSpeeds(e: { flyFt?: number; climbFt?: number }, effects: Array<{ mods: { fly?: number } }> = []) {
  const spell = Math.max(0, ...effects.map((x) => x.mods.fly ?? 0));
  const fly = e.flyFt ?? 0;
  return { fly: Math.max(fly, spell), climb: e.climbFt ?? 0, ...(fly || spell ? { flySource: (fly >= spell ? 'speed' : 'spell') as FlightSource } : {}) };
}

/** 3D distance in feet: the larger of horizontal and vertical (5e grid). */
export const distance3d = (horizontalFt: number, za: number, zb: number) => Math.max(horizontalFt, Math.abs(za - zb));

/** Falling damage dice for a drop (1d6 per full 10 ft, at most 20d6); null below 10 ft. */
export function fallDice(ft: number): string | null {
  const n = Math.min(20, Math.floor(ft / 10));
  return n > 0 ? `${n}d6` : null;
}

/**
 * Creatures in the air that must fall now: knocked prone, incapacitated, speed 0, or their flight came from a spell
 * (Fly) that ended. Returns the falls (absolute drop = altitude); altitude is reset and they land prone – the caller
 * applies the damage (sheet or NPC hit points).
 */
export function pendingFalls(state: GameState, sceneId: string): Array<{ actor: string; ft: number; why: string }> {
  const out: Array<{ actor: string; ft: number; why: string }> = [];
  for (const [actor, a] of Object.entries(state.sceneAltitude?.[sceneId] ?? {})) {
    if (!a.ft) continue;
    const fx = effectsOf(state, sceneId, actor);
    const why = fx.find((e) => e.key === 'prone') ? 'knocked prone' : fx.find((e) => e.mods.incapacitated) ? `${fx.find((e) => e.mods.incapacitated)!.name.toLowerCase()}` : fx.find((e) => e.mods.speedZero) ? 'speed 0' : a.source === 'spell' && !fx.some((e) => e.mods.fly) ? 'the flight spell ended' : null;
    if (why) out.push({ actor, ft: a.ft, why });
  }
  return out;
}
