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
  // APEX 2.1 – rural and city schemes
  { id: 'spring', label: 'Rural · Spring meadow', palette: { colors: ['#1e3a1a', '#3f7a2e', '#8ac25a', '#e8f0a8', '#fff8e0'], strength: 0.45 } },
  { id: 'harvest', label: 'Rural · Harvest gold', palette: { colors: ['#2a1e0e', '#6a5020', '#b89a3a', '#e8cf7a', '#fff4d0'], strength: 0.5 } },
  { id: 'storybook', label: 'Rural · Storybook (bright, saturated)', palette: { colors: ['#1a2a4a', '#2f7a4a', '#7ac05a', '#f2d06a', '#fff6e0'], strength: 0.4 } },
  { id: 'moor', label: 'Rural · Grey moor', palette: { colors: ['#14181a', '#3a4440', '#6a7468', '#a8aca0', '#e0e0d8'], strength: 0.6 } },
  { id: 'sandstone', label: 'City · Sandstone town', palette: { colors: ['#2a1a10', '#7a5a3a', '#c8a070', '#ecd8b0', '#fff4e0'], strength: 0.5 } },
  { id: 'slate', label: 'City · Slate & soot', palette: { colors: ['#0e1014', '#2a3038', '#5a6470', '#9aa4ae', '#dde2e6'], strength: 0.55 } },
  { id: 'royal', label: 'City · Royal quarter (marble, gold)', palette: { colors: ['#1a1428', '#4a3a6a', '#a8a0b8', '#e8d8a0', '#fffaf0'], strength: 0.45 } },
  { id: 'coastal', label: 'City · Coastal (sea blue, whitewash)', palette: { colors: ['#0e1e2a', '#1f4a6a', '#5a9ab8', '#d8e4e0', '#ffffff'], strength: 0.45 } },
  { id: 'moonlit', label: 'Moonlit (blue night)', palette: { colors: ['#06080e', '#141e34', '#2e4468', '#7a94c0', '#d0dcf0'], strength: 0.65 } },
  { id: 'ashen', label: 'Ashen ruins', palette: { colors: ['#100c0a', '#3a3230', '#6a605a', '#a09890', '#d8d0c8'], strength: 0.7 } },
];

/** APEX 2.1 – the 3D mood of a map: light colour and direction, sky, fog. Absent = follows the in-game time of day. */
export type SceneMood = 'day' | 'golden' | 'overcast' | 'dusk' | 'night' | 'misty' | 'storybook' | 'gloom';
export const MOODS: Array<{ id: SceneMood; label: string }> = [
  { id: 'day', label: 'Bright day' }, { id: 'golden', label: 'Golden hour' }, { id: 'overcast', label: 'Overcast' }, { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' }, { id: 'misty', label: 'Misty' }, { id: 'storybook', label: 'Storybook (vivid)' }, { id: 'gloom', label: 'Gloom (cursed)' },
];
export const validMood = (v: unknown): v is SceneMood => MOODS.some((m) => m.id === v);

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
