/**
 * Arenaschrumpfung: äußere Ringe werden ab bestimmten Tagen gefährlich oder gesperrt.
 */
import { ORIGIN, distance, type Axial } from './hex';
import type { GameConfig, ShrinkConfig } from './types';

export type ZoneStatus = 'safe' | 'warning' | 'danger' | 'closed';

/** Kleinster Radius, der niemals schrumpft. */
export const MIN_SAFE_RADIUS = 2;

/** Wie viele äußere Ringe sind am Tag `day` betroffen? */
export function affectedRings(shrink: ShrinkConfig, day: number): number {
  if (!shrink.enabled || day < shrink.startDay) return 0;
  const steps = Math.floor((day - shrink.startDay) / Math.max(1, shrink.intervalDays)) + 1;
  return steps * shrink.ringsPerStep;
}

/** Alle Felder mit Abstand > safeRadius sind betroffen. */
export function safeRadius(config: GameConfig, day: number): number {
  return Math.max(MIN_SAFE_RADIUS, config.mapRadius - affectedRings(config.shrink, day));
}

export function zoneStatus(config: GameConfig, day: number, h: Axial): ZoneStatus {
  if (!config.shrink.enabled) return 'safe';
  const d = distance(h, ORIGIN);
  if (d > safeRadius(config, day)) return config.shrink.mode === 'closed' ? 'closed' : 'danger';
  if (d > safeRadius(config, day + config.shrink.warningDays)) return 'warning';
  return 'safe';
}
