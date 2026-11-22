/**
 * APEX 2.12 – the UI theme each player chooses for themselves (stored in this browser): the main colour (Imperial
 * Gold by default, or purple, bronze, silver …, or any colour), the text colour and the fonts. Every screen reads its
 * colours from Tailwind's CSS variables (--color-gold-*, --color-marble-*, --font-*), so changing them here re-colours
 * the whole app at once – no reload, no component changes.
 */
export interface UiTheme { accent: string; text: TextTone; display: DisplayFont; body: BodyFont; texture: number }
export type TextTone = 'marble' | 'parchment' | 'moon' | 'ash';
export type DisplayFont = 'cinzel' | 'marcellus' | 'cormorant' | 'georgia' | 'inter';
export type BodyFont = 'inter' | 'garamond' | 'georgia' | 'system';

export const ACCENTS: Array<{ id: string; label: string; color: string }> = [
  { id: 'gold', label: 'Imperial Gold', color: '#c09b58' },
  { id: 'purpur', label: 'Tyrian Purple', color: '#b0628f' },
  { id: 'amethyst', label: 'Amethyst', color: '#9a7bd1' },
  { id: 'bronze', label: 'Bronze', color: '#b5794a' },
  { id: 'silver', label: 'Silver', color: '#aab3bd' },
  { id: 'blood', label: 'Centurion Red', color: '#c0504c' },
  { id: 'verdigris', label: 'Verdigris', color: '#5fa08c' },
  { id: 'azure', label: 'Arcane Azure', color: '#6f9bd1' },
];
export const TEXT_TONES: Record<TextTone, { label: string; scale: [string, string, string, string] }> = {
  marble: { label: 'Marble', scale: ['#f3eee3', '#e3dccd', '#bcb29e', '#8c806a'] },
  parchment: { label: 'Parchment', scale: ['#f7ecd2', '#eadbb9', '#c7b38c', '#968260'] },
  moon: { label: 'Moonlight', scale: ['#eef2f7', '#d8dfe8', '#a9b3c0', '#7a8594'] },
  ash: { label: 'Ash', scale: ['#ececec', '#d2d2d2', '#a5a5a5', '#7c7c7c'] },
};
export const DISPLAY_FONTS: Record<DisplayFont, { label: string; css: string }> = {
  cinzel: { label: 'Cinzel (Roman capitals)', css: '"Cinzel", "Trajan Pro", Georgia, serif' },
  marcellus: { label: 'Marcellus (inscription)', css: '"Marcellus", "Cinzel", Georgia, serif' },
  cormorant: { label: 'Cormorant (elegant)', css: '"Cormorant Garamond", Georgia, serif' },
  georgia: { label: 'Georgia (book)', css: 'Georgia, "Times New Roman", serif' },
  inter: { label: 'Inter (plain)', css: '"Inter", ui-sans-serif, system-ui, sans-serif' },
};
export const BODY_FONTS: Record<BodyFont, { label: string; css: string }> = {
  inter: { label: 'Inter (clear)', css: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  garamond: { label: 'EB Garamond (book)', css: '"EB Garamond", Georgia, serif' },
  georgia: { label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  system: { label: 'System', css: 'ui-sans-serif, system-ui, sans-serif' },
};
export const DEFAULT_THEME: UiTheme = { accent: '#c09b58', text: 'marble', display: 'cinzel', body: 'inter', texture: 1 };
const KEY = 'apex.ui.theme';

const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : DEFAULT_THEME.accent;
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(hex(c).slice(i, i + 2), 16));
const toHex = (v: number[]) => `#${v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
/** a toward b by t (0 … 1). */
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };

/** The accent scale (200 light … 700 deep) from one colour. */
export function accentScale(c: string): Record<'200' | '300' | '400' | '500' | '700', string> {
  const a = hex(c);
  return { '200': mix(a, '#ffffff', 0.5), '300': mix(a, '#ffffff', 0.25), '400': a, '500': mix(a, '#000000', 0.18), '700': mix(a, '#000000', 0.52) };
}

export function normaliseTheme(v: unknown): UiTheme {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<UiTheme>;
  return {
    accent: hex(typeof o.accent === 'string' ? o.accent : DEFAULT_THEME.accent),
    text: o.text && o.text in TEXT_TONES ? o.text : DEFAULT_THEME.text,
    display: o.display && o.display in DISPLAY_FONTS ? o.display : DEFAULT_THEME.display,
    body: o.body && o.body in BODY_FONTS ? o.body : DEFAULT_THEME.body,
    texture: typeof o.texture === 'number' && Number.isFinite(o.texture) ? Math.max(0, Math.min(1.5, o.texture)) : DEFAULT_THEME.texture,
  };
}
export function loadTheme(): UiTheme {
  try { const s = localStorage.getItem(KEY); return s ? normaliseTheme(JSON.parse(s)) : DEFAULT_THEME; } catch { return DEFAULT_THEME; }
}
export function saveTheme(t: UiTheme) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

/** The CSS variables of a theme. */
export function themeVars(t: UiTheme): Record<string, string> {
  const a = accentScale(t.accent), txt = TEXT_TONES[t.text].scale, [r, g, b] = rgb(t.accent);
  return {
    '--color-gold-200': a['200'], '--color-gold-300': a['300'], '--color-gold-400': a['400'], '--color-gold-500': a['500'], '--color-gold-700': a['700'],
    '--apex-gold': a['400'], '--apex-highlight': a['300'], '--apex-focus': a['300'],
    '--apex-accent-rgb': `${r}, ${g}, ${b}`,
    '--apex-border': `rgba(${r}, ${g}, ${b}, 0.28)`, '--apex-border-strong': `rgba(${r}, ${g}, ${b}, 0.6)`, '--apex-selection': `rgba(${r}, ${g}, ${b}, 0.35)`, '--apex-hover': `rgba(${r}, ${g}, ${b}, 0.12)`,
    '--color-marble-50': txt[0], '--color-marble-100': txt[1], '--color-marble-300': txt[2], '--color-marble-500': txt[3],
    '--apex-text-strong': txt[0], '--apex-text': txt[1], '--apex-text-muted': txt[3],
    '--font-display': DISPLAY_FONTS[t.display].css, '--font-sans': BODY_FONTS[t.body].css,
    '--apex-texture': String(t.texture),
  };
}
export function applyTheme(t: UiTheme, el: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(themeVars(t))) el.style.setProperty(k, v);
}
