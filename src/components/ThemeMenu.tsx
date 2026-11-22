/** APEX 2.12 – the theme button: main colour, text colour, fonts and the surface texture (kept on this device). */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACCENTS, BODY_FONTS, DEFAULT_THEME, DISPLAY_FONTS, TEXT_TONES, applyTheme, loadTheme, saveTheme, type BodyFont, type DisplayFont, type TextTone, type UiTheme } from '../ui/theme';

export function ThemeMenu({ className = 'btn btn-ghost px-2' }: { className?: string }) {
  const [t, setT] = useState<UiTheme>(loadTheme);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const r = open ? btn.current?.getBoundingClientRect() : undefined;
  const set = (patch: Partial<UiTheme>) => { const next = { ...t, ...patch }; setT(next); applyTheme(next); saveTheme(next); };
  return (
    <span className="relative">
      <button ref={btn} type="button" className={className} aria-expanded={open} title="Colours and fonts" aria-label="Colours and fonts" onClick={() => setOpen(!open)} data-testid="theme-menu">
        <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-full border border-black/40" style={{ background: `conic-gradient(${t.accent} 0 50%, var(--color-marble-100) 50% 100%)` }} />
      </button>
      {open && r && createPortal(
        <div className="apex-popover fixed z-[90] w-80 space-y-3 rounded-xl p-3 text-xs text-marble-100" style={{ top: r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 328, r.right - 320)) }} role="dialog" aria-label="Colours and fonts">
          <b className="font-display text-sm text-gold-200">Colours and fonts</b>
          <div>
            <p className="label mb-1">Main colour</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {ACCENTS.map((a) => (
                <button key={a.id} type="button" title={a.label} aria-label={a.label} aria-pressed={t.accent === a.color} onClick={() => set({ accent: a.color })}
                  className={`h-7 w-7 rounded-full border-2 ${t.accent === a.color ? 'border-marble-50' : 'border-black/40'}`} style={{ background: `radial-gradient(circle at 35% 30%, #ffffff55, transparent 45%), ${a.color}` }} data-testid={`theme-accent-${a.id}`} />
              ))}
              <label className="ml-1 flex items-center gap-1 text-marble-300" title="Any colour">
                <input type="color" value={t.accent} onChange={(e) => set({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-ink-600 bg-transparent" aria-label="Own main colour" />
              </label>
            </div>
          </div>
          <div>
            <p className="label mb-1">Text</p>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(TEXT_TONES) as TextTone[]).map((k) => (
                <button key={k} type="button" aria-pressed={t.text === k} onClick={() => set({ text: k })} className={`rounded-md border px-1 py-1 ${t.text === k ? 'border-gold-300 bg-gold-400/15' : 'border-ink-600 hover:border-gold-600'}`} style={{ color: TEXT_TONES[k].scale[0] }}>{TEXT_TONES[k].label}</button>
              ))}
            </div>
          </div>
          <label className="block"><span className="label">Headings</span>
            <select className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-sm text-marble-50" value={t.display} onChange={(e) => set({ display: e.target.value as DisplayFont })}>
              {(Object.keys(DISPLAY_FONTS) as DisplayFont[]).map((k) => <option key={k} value={k} style={{ fontFamily: DISPLAY_FONTS[k].css }}>{DISPLAY_FONTS[k].label}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Body text</span>
            <select className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-sm text-marble-50" value={t.body} onChange={(e) => set({ body: e.target.value as BodyFont })}>
              {(Object.keys(BODY_FONTS) as BodyFont[]).map((k) => <option key={k} value={k}>{BODY_FONTS[k].label}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Surface texture</span>
            <input type="range" min={0} max={1.5} step={0.1} value={t.texture} onChange={(e) => set({ texture: Number(e.target.value) })} className="w-full accent-[var(--color-gold-400)]" aria-label="Surface texture" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1 py-1" onClick={() => set(DEFAULT_THEME)}>Reset</button>
            <button type="button" className="btn btn-gold flex-1 py-1" onClick={() => setOpen(false)}>Done</button>
          </div>
          <p className="text-[10px] text-marble-500">Only on this device – every player picks their own.</p>
        </div>, document.body)}
    </span>
  );
}
