/**
 * APEX 2.5 – campaign time, season and per-scene weather.
 *
 *  - World time: minutes since day 1, 00:00. The GM turns the dial (set a time), lets it run in real time (or
 *    faster), or skips ahead ("skip to dawn"). Running time is stored as a start point, so every client and the
 *    server compute the same "now" without writing every minute.
 *  - Scenes follow the time unless the GM set their lighting by hand: 7–18 h bright, 5–7 and 18–20 h dim
 *    (dawn, dusk), night dark.
 *  - Weather per scene: clear, fleecy clouds, cloudy, dark clouds, rain, fog, snow. Fog limits sight to 30 ft
 *    (heavily obscured beyond, SRD 5.1); everything else is atmosphere only.
 *  - Season and a snow amount (0–1) recolour the 3D map; they are campaign-wide.
 */
import type { GameState, SceneClockState } from './types.js';

export const WEATHERS = ['clear', 'fleecy', 'cloudy', 'dark', 'rain', 'fog', 'snow'] as const;
export type Weather = (typeof WEATHERS)[number];
export const WEATHER_LABEL: Record<Weather, string> = { clear: '☀ Clear', fleecy: '⛅ Fleecy clouds', cloudy: '☁ Cloudy', dark: '🌩 Dark clouds', rain: '🌧 Rain', fog: '🌫 Fog', snow: '❄ Snow' };
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, string> = { spring: '🌸 Spring', summer: '☀ Summer', autumn: '🍂 Autumn', winter: '❄ Winter' };
/** Sight limit in fog (ft). */
export const FOG_SIGHT_FT = 30;

export interface WorldTime {
  /** Minutes since day 1, 00:00 at `runningSince` (or now, when stopped). */
  minute: number;
  /** Epoch ms since when the time runs; absent = stopped. */
  runningSince?: number;
  /** Game minutes per real minute while running (1 = real time). */
  rate?: number;
  season?: Season;
  /** 0 … 1: how much snow lies on the map (also outside winter). */
  snow?: number;
}

export const DAY_MIN = 24 * 60;
export function nowMinute(w: WorldTime, now = Date.now()): number {
  if (!w.runningSince) return w.minute;
  return w.minute + Math.max(0, (now - w.runningSince) / 60000) * (w.rate ?? 1);
}
export const hourOf = (minute: number) => (((minute % DAY_MIN) + DAY_MIN) % DAY_MIN) / 60;
export const dayOf = (minute: number) => Math.floor(minute / DAY_MIN) + 1;
export const clockText = (minute: number) => { const h = hourOf(minute); return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

export function lightingAt(hour: number): SceneClockState['lighting'] {
  if (hour >= 7 && hour < 18) return 'bright';
  if ((hour >= 5 && hour < 7) || (hour >= 18 && hour < 20)) return 'dim';
  return 'dark';
}
/** The next time (minute) the clock shows `hour` – for "skip to dawn" (6) or "skip to 4 am". */
export function nextAt(minute: number, hour: number): number {
  const base = Math.floor(minute / DAY_MIN) * DAY_MIN + hour * 60;
  return base > minute + 0.5 ? base : base + DAY_MIN;
}

/** The scene clock as the rules see it now: lighting follows the world time unless the GM set it by hand. */
export function effectiveClock(state: Pick<GameState, 'worldTime'>, clock: SceneClockState, now = Date.now()): SceneClockState & { world?: WorldTime & { now: number } } {
  const w = state.worldTime;
  if (!w) return clock;
  const minute = nowMinute(w, now);
  const follow = clock.followTime !== false;
  const hour = hourOf(minute);
  return { ...clock, ...(follow ? { lighting: lightingAt(hour), phase: hour >= 6 && hour < 19 ? 'day' : 'night' } : {}), world: { ...w, now: minute } };
}

export function parseWorldTimeChange(v: Record<string, unknown>): { minute?: number; run?: boolean; rate?: number; season?: Season; snow?: number; skipTo?: number; advance?: number } | string {
  const out: ReturnType<typeof parseWorldTimeChange> = {};
  if (v.minute !== undefined) { if (typeof v.minute !== 'number' || !Number.isFinite(v.minute) || v.minute < 0 || v.minute > DAY_MIN * 100000) return 'Invalid time.'; out.minute = Math.round(v.minute); }
  if (v.run !== undefined) { if (typeof v.run !== 'boolean') return 'Invalid run flag.'; out.run = v.run; }
  if (v.rate !== undefined) { if (typeof v.rate !== 'number' || !(v.rate >= 1 && v.rate <= 720)) return 'Rate 1–720.'; out.rate = v.rate; }
  if (v.season !== undefined) { if (!SEASONS.includes(v.season as Season)) return 'Invalid season.'; out.season = v.season as Season; }
  if (v.snow !== undefined) { if (typeof v.snow !== 'number' || !(v.snow >= 0 && v.snow <= 1)) return 'Snow 0–1.'; out.snow = Math.round(v.snow * 100) / 100; }
  if (v.skipTo !== undefined) { if (typeof v.skipTo !== 'number' || !(v.skipTo >= 0 && v.skipTo < 24)) return 'Skip to an hour 0–23.'; out.skipTo = v.skipTo; }
  if (v.advance !== undefined) { if (typeof v.advance !== 'number' || !(v.advance > 0 && v.advance <= DAY_MIN * 30)) return 'Advance 1 minute … 30 days.'; out.advance = Math.round(v.advance); }
  return Object.keys(out).length ? out : 'Nothing to change.';
}

/** Applies a GM change to the world time (pure). */
export function changeWorldTime(prev: WorldTime | undefined, c: Exclude<ReturnType<typeof parseWorldTimeChange>, string>, now = Date.now()): WorldTime {
  const w: WorldTime = prev ? { ...prev } : { minute: 8 * 60, season: 'summer', snow: 0 };
  // freeze the running time at "now" before changing it, then restart if it was (or should be) running
  const running = c.run ?? !!w.runningSince;
  let minute = nowMinute(w, now);
  if (c.minute !== undefined) minute = c.minute;
  if (c.skipTo !== undefined) minute = nextAt(minute, c.skipTo);
  if (c.advance !== undefined) minute += c.advance;
  w.minute = Math.round(minute * 100) / 100;
  if (running) w.runningSince = now; else delete w.runningSince;
  if (c.rate !== undefined) w.rate = c.rate;
  if (c.season) w.season = c.season;
  if (c.snow !== undefined) w.snow = c.snow;
  return w;
}
