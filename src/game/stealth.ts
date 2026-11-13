/**
 * APEX 2.4 – sneaking on the battle map: who could notice whom (pure, client and tests).
 *
 * The rules stay SRD 5.1: a hidden creature is noticed by an opponent whose passive Perception reaches its Stealth
 * total (the server filters the views by that). This module adds an APEX TABLE AID on top – nothing here changes a
 * roll or reveals anyone by itself:
 *  - Awareness radius of an awake opponent: 5 ft × passive Perception (13 → 65 ft), at most its sight
 *    (bright 120 ft, dim 60 ft, dark: darkvision, else 10 ft). Players see these rings while sneaking and plan
 *    their route around them.
 *  - “!” spotted: a hidden creature inside the radius, in line of sight, with Stealth ≤ the passive Perception.
 *  - “?” noise: inside the radius but behind cover, or Stealth only 1–4 above the passive Perception – the opponent
 *    hears something from that direction. The GM decides (reveal, Search, nothing).
 */
import type { SceneMap } from '../campaign/maps.js';
import { hexAt } from '../campaign/hexScene.js';
import { lineOfSight, sightRules, BRIGHT_SIGHT_FT, DIM_SIGHT_FT, type Lighting } from '../campaign/hexVision.js';
import { distance, hexKey } from './hex.js';

export interface StealthFigure {
  id: string;
  kind: 'pc' | 'enemy';
  side?: 'enemy' | 'ally';
  name: string;
  x: number;
  y: number;
  alt?: number;
  condition?: 'healthy' | 'bloodied' | 'down';
  effects?: Array<{ key: string; name: string; value?: number }>;
  perception?: number;
  darkvisionFt?: number;
}
export interface AwarenessRing { id: string; name: string; x: number; y: number; ft: number; passive: number; /** some sneaking creature of the other side would be noticed by it */ danger: boolean }
export interface StealthMark { watcherId: string; watcherName: string; targetId: string; targetName: string; kind: 'spotted' | 'heard'; /** compass direction from the watcher to the noise, 0 = north (up), clockwise in degrees */ bearing: number; x: number; y: number; alt?: number }

/** The Stealth total of a hidden figure (effect value, else “Hidden (Stealth 14)” in the name). */
export function stealthOf(f: Pick<StealthFigure, 'effects'>): number | null {
  const h = f.effects?.find((e) => e.key === 'hidden');
  if (!h) return null;
  if (typeof h.value === 'number') return h.value;
  const m = /stealth\s*(\d{1,2})/i.exec(h.name);
  return m ? Number(m[1]) : 0;
}
const partySide = (f: StealthFigure) => (f.kind === 'pc' || f.side === 'ally' ? 'party' : 'enemy');

export function awarenessFt(passive: number, lighting: Lighting, darkvisionFt = 0): number {
  const sight = lighting === 'bright' ? BRIGHT_SIGHT_FT : lighting === 'dim' ? Math.max(DIM_SIGHT_FT, darkvisionFt) : Math.max(10, darkvisionFt);
  return Math.max(10, Math.min(sight, Math.round(passive) * 5));
}

/** Rings around the opponents of sneaking creatures and the GM marks (spotted / heard). */
export function stealthWatch(map: Pick<SceneMap, 'hex' | 'width' | 'height' | 'unitsPerCell'>, figures: StealthFigure[], lighting: Lighting): { sneakers: StealthFigure[]; rings: AwarenessRing[]; marks: StealthMark[] } {
  const sneakers = figures.filter((f) => f.condition !== 'down' && stealthOf(f) !== null);
  if (!sneakers.length || !map.hex) return { sneakers, rings: [], marks: [] };
  const unit = map.unitsPerCell || 5;
  const rules = sightRules(map);
  const sides = new Set(sneakers.map(partySide));
  const watchers = figures.filter((f) => f.condition !== 'down' && typeof f.perception === 'number' && sides.has(partySide(f) === 'party' ? 'enemy' : 'party') && stealthOf(f) === null);
  const rings: AwarenessRing[] = [], marks: StealthMark[] = [];
  for (const w of watchers) {
    const passive = w.perception!;
    const ft = awarenessFt(passive, lighting, w.darkvisionFt);
    const wa = hexAt(map as SceneMap, w);
    let danger = false;
    for (const s of sneakers) {
      if (partySide(s) === partySide(w)) continue;
      const stealth = stealthOf(s)!;
      if (stealth <= passive) danger = true;
      const sa = hexAt(map as SceneMap, s);
      const d = Math.max(distance(wa, sa) * unit, Math.abs((s.alt ?? 0) - (w.alt ?? 0)));
      if (d > ft) continue;
      const seen = d <= unit || lineOfSight(wa, sa, rules.blocks, rules.height, { a: (w.alt ?? 0) / 5, b: (s.alt ?? 0) / 5 });
      const kind = seen && stealth <= passive ? 'spotted' : !seen || stealth - passive <= 4 ? 'heard' : null;
      if (!kind) continue;
      const bearing = (Math.round((Math.atan2(s.x - w.x, -(s.y - w.y)) * 180) / Math.PI) + 360) % 360;
      marks.push({ watcherId: w.id, watcherName: w.name, targetId: s.id, targetName: s.name, kind, bearing, x: w.x, y: w.y, ...(w.alt ? { alt: w.alt } : {}) });
    }
    rings.push({ id: w.id, name: w.name, x: w.x, y: w.y, ft, passive, danger });
  }
  // one mark per watcher: “spotted” wins over “heard”
  const best = new Map<string, StealthMark>();
  for (const m of marks) { const b = best.get(m.watcherId); if (!b || (b.kind === 'heard' && m.kind === 'spotted')) best.set(m.watcherId, m); }
  return { sneakers, rings, marks: [...best.values()].sort((a, b) => a.watcherName.localeCompare(b.watcherName) || hexKey(hexAt(map as SceneMap, a)).localeCompare(hexKey(hexAt(map as SceneMap, b)))) };
}

/** Compass arrow for a bearing (8 directions). */
export const bearingArrow = (deg: number) => ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(deg / 45) % 8];
