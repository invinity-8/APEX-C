/**
 * Areas of effect on 5-ft battle hexes (APEX 1.2): sphere / cylinder (radius around a point), cube (around a point),
 * cone (from the caster towards a point; 5e cone: as wide as it is long → half angle ≈ 26.6°, a little tolerance
 * for hex centres) and line (5 ft wide from the caster). Shared by the area preview and the server.
 */
import { hexAt, hexCentre, tileLookup } from './hexScene.js';
import { lineOfSight } from './hexVision.js';
import type { SceneMap } from './maps.js';
import { axialRound, distance, hexKey, hexesInRange, type HexKey } from '../game/hex.js';

export type AreaShape = 'sphere' | 'cone' | 'line' | 'cube';
/** `fromSelf`: the area starts at the caster ("Self (15-foot cube)" – Thunderwave; "Self (10-foot radius)"). */
export interface AreaSpec { shape: AreaShape; sizeFt: number; fromSelf?: boolean }
type MapLike = Pick<SceneMap, 'width' | 'height' | 'hex' | 'unitsPerCell'>;

/** "20-foot-radius sphere", "15-foot cone", "100 feet long and 5 feet wide", "10-foot cube" → area (or null). */
export function parseArea(text: string): AreaSpec | null {
  const a = parseAreaShape(text);
  return a && /^\s*self\b/i.test(text) ? { ...a, fromSelf: true } : a;
}
function parseAreaShape(text: string): AreaSpec | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  let m = /(\d{1,3})-foot[- ]radius (?:sphere|cylinder|circle)|(\d{1,3})-foot[- ]radius/.exec(t);
  if (m) return { shape: 'sphere', sizeFt: Number(m[1] ?? m[2]) };
  m = /(\d{1,3})-foot cone/.exec(t);
  if (m) return { shape: 'cone', sizeFt: Number(m[1]) };
  m = /line (?:that is )?(\d{1,3}) feet long|(\d{1,3}) feet long and \d{1,2} feet wide|(\d{1,3})-foot line/.exec(t);
  if (m) return { shape: 'line', sizeFt: Number(m[1] ?? m[2] ?? m[3]) };
  m = /(\d{1,3})-foot cube/.exec(t);
  if (m) return { shape: 'cube', sizeFt: Number(m[1]) };
  return null;
}

/** Hexes covered by an area. Sphere and cube are centred on `point`; cone and line start at `origin`. */
export function areaHexes(map: MapLike, origin: { x: number; y: number }, point: { x: number; y: number }, area: AreaSpec): HexKey[] {
  if (!map.hex) return [];
  const inMap = tileLookup(map);
  const o = hexAt(map, origin), p = hexAt(map, point);
  const cells = Math.max(1, Math.round(area.sizeFt / (map.unitsPerCell || 5)));
  let out: Array<ReturnType<typeof hexAt>>;
  let centre = p;
  if (area.fromSelf && area.shape === 'sphere') centre = o; // "Self (10-foot radius)": around the caster
  if (area.fromSelf && area.shape === 'cube') {
    // the cube touches the caster and extends towards the point: its centre is half a cube (+1 hex) away
    const half = Math.max(0, Math.floor(cells / 2));
    const d = distance(o, p);
    const k = d ? (half + 1) / d : 0;
    centre = d ? axialRound(o.q + (p.q - o.q) * k, o.r + (p.r - o.r) * k) : { q: o.q + half + 1, r: o.r };
  }
  if (area.shape === 'sphere') out = hexesInRange(centre, cells).filter((h) => !(area.fromSelf && h.q === o.q && h.r === o.r));
  else if (area.shape === 'cube') out = hexesInRange(centre, Math.max(0, Math.floor(cells / 2))).filter((h) => !(area.fromSelf && h.q === o.q && h.r === o.r));
  else {
    const oc = hexCentre(map, o), pc = hexCentre(map, p);
    const step = Math.hypot(hexCentre(map, { q: o.q + 1, r: o.r }).x - oc.x, hexCentre(map, { q: o.q + 1, r: o.r }).y - oc.y) || 1;
    const dir = { x: pc.x - oc.x, y: pc.y - oc.y };
    const len = Math.hypot(dir.x, dir.y);
    if (!len) return [];
    const u = { x: dir.x / len, y: dir.y / len };
    out = hexesInRange(o, cells).filter((h) => {
      if (h.q === o.q && h.r === o.r) return false;
      const c = hexCentre(map, h), v = { x: c.x - oc.x, y: c.y - oc.y };
      const along = v.x * u.x + v.y * u.y;
      if (along <= 0 || along > cells * step + step * 0.5) return false;
      const across = Math.abs(v.x * u.y - v.y * u.x);
      return area.shape === 'line' ? across <= step * 0.55 : across <= along * 0.5 + step * 0.35;
    });
  }
  // walls stop the effect: every hex needs a line of effect from the area's point of origin
  const src = area.fromSelf ? o : area.shape === 'sphere' || area.shape === 'cube' ? p : o;
  const blocks = (k: HexKey) => !!inMap(k)?.blocksSight;
  return out.filter((h) => !!inMap(hexKey(h)) && (hexKey(h) === hexKey(src) || lineOfSight(src, h, blocks))).map(hexKey);
}

/** Distance in feet between two map points (hex steps × 5 ft). */
export const feetApart = (map: MapLike, a: { x: number; y: number }, b: { x: number; y: number }) => distance(hexAt(map, a), hexAt(map, b)) * (map.unitsPerCell || 5);
