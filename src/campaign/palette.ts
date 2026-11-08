/**
 * Scene colour schemes. A scheme is 2–6 colours plus a strength; tiles are recoloured with a
 * "gradient map": the brightness of every painted colour picks a colour along the scheme (dark →
 * light), mixed with the original by `strength`. Fog of war is applied afterwards, so remembered
 * hexes stay grey.
 */
export interface ScenePalette {
  colors: string[];
  /** 0 = original colours, 1 = fully recoloured. */
  strength: number;
}

export const PALETTE_PRESETS: Array<{ id: string; label: string; palette: ScenePalette }> = [
  { id: 'mesa', label: 'Mesa (red, orange, ochre, yellow)', palette: { colors: ['#5a1e12', '#a8401e', '#d07a2e', '#e3b25a', '#f2dc94'], strength: 0.75 } },
  { id: 'desert', label: 'Desert', palette: { colors: ['#4a3420', '#9a7444', '#d2b07a', '#f0dcae'], strength: 0.6 } },
  { id: 'tundra', label: 'Tundra & ice', palette: { colors: ['#1e2c3a', '#566e82', '#a8bccc', '#eef4f8'], strength: 0.7 } },
  { id: 'swamp', label: 'Swamp', palette: { colors: ['#141e14', '#2e4228', '#5e6e3a', '#9aa060'], strength: 0.6 } },
  { id: 'volcanic', label: 'Volcanic', palette: { colors: ['#120c0a', '#3a2420', '#7a3018', '#e0602a', '#ffc070'], strength: 0.7 } },
  { id: 'autumn', label: 'Autumn', palette: { colors: ['#2a1a0e', '#6a3a14', '#b0641e', '#d8a040', '#ead08a'], strength: 0.55 } },
  { id: 'underdark', label: 'Underdark', palette: { colors: ['#0c0a14', '#2a2440', '#4a4a7a', '#7ae0d0'], strength: 0.65 } },
  { id: 'feywild', label: 'Feywild', palette: { colors: ['#1a0e2a', '#4a2a6a', '#3a8a6a', '#e0a0d8', '#fff0c0'], strength: 0.55 } },
];

const HEX = /^#[0-9a-f]{6}$/i;
export function validPalette(v: unknown): v is ScenePalette {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as ScenePalette;
  return Array.isArray(p.colors) && p.colors.length >= 2 && p.colors.length <= 6 && p.colors.every((c) => typeof c === 'string' && HEX.test(c)) && typeof p.strength === 'number' && p.strength >= 0 && p.strength <= 1;
}

type RGB = [number, number, number];
const parse = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Colour → recoloured colour (pure; also used by tests). */
export function gradientMap(palette: ScenePalette): (rgb: RGB) => RGB {
  const stops = palette.colors.map(parse).sort((a, b) => lum(a) - lum(b));
  const k = Math.max(0, Math.min(1, palette.strength));
  const cache = new Map<number, RGB>();
  return (rgb) => {
    const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    const hit = cache.get(key);
    if (hit) return hit;
    const t = lum(rgb) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
    const a = stops[i], b = stops[i + 1];
    const m: RGB = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    const out: RGB = [rgb[0] + (m[0] - rgb[0]) * k, rgb[1] + (m[1] - rgb[1]) * k, rgb[2] + (m[2] - rgb[2]) * k];
    if (cache.size < 4096) cache.set(key, out);
    return out;
  };
}
export const paletteKey = (p: ScenePalette | undefined) => (p ? `${p.colors.join(',')}@${p.strength}` : '');
