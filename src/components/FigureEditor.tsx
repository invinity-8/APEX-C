/**
 * APEX 2.1 – low-poly figure editor: build a miniature from the parts kit (game/figure.ts). Players use it for
 * their hero, the GM for NPCs and enemy stat blocks. Left: live 3D preview (drag to turn). Right: tabs with every
 * part (◀ ▶ to flip through, or pick directly), colour swatches, presets and a dice button.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import {
  CLOTH_COLOURS, COLOUR_LABELS, DEFAULT_LOOK, EYE_COLOURS, FIGURE_PARTS, FIGURE_PRESETS, HAIR_COLOURS, lookFromPreset, METAL_COLOURS, PART_LABELS, partLabel, randomLook, SKIN_TONES,
  type FigureColourKey, type FigureLook, type FigurePartKey,
} from '../game/figure';

const FigurePreview = lazy(() => import('./FigurePreview'));

const TABS: Array<{ id: string; label: string; parts: FigurePartKey[]; colours: FigureColourKey[] }> = [
  { id: 'body', label: 'Body', parts: ['body', 'build', 'head', 'ears', 'horns'], colours: ['skin'] },
  { id: 'face', label: 'Face', parts: ['eyes', 'brows', 'nose', 'mouth', 'extra'], colours: ['eyeColor'] },
  { id: 'hair', label: 'Hair', parts: ['hair', 'beard'], colours: ['hairColor'] },
  { id: 'clothes', label: 'Clothes', parts: ['hat', 'torso', 'shoulders', 'belt', 'legs', 'boots', 'cloak'], colours: ['primary', 'secondary', 'leather'] },
  { id: 'gear', label: 'Gear', parts: ['main', 'off', 'back'], colours: ['metal'] },
  { id: 'mount', label: 'Mount', parts: ['mount'], colours: [] },
];
const SWATCHES: Record<FigureColourKey, readonly string[]> = { skin: SKIN_TONES, hairColor: HAIR_COLOURS, primary: CLOTH_COLOURS, secondary: CLOTH_COLOURS, leather: ['#6b4a2b', '#4a3220', '#8a6a45', '#3a2a1a', '#2a2a2a', '#a07850', '#5a2a1a'], metal: METAL_COLOURS, eyeColor: EYE_COLOURS };

export function FigureEditor({ value, onSave, onCancel, gm = false, busy = false, title = '3D figure', ring }: {
  value: FigureLook | null | undefined; onSave: (look: FigureLook | null) => void | Promise<void>; onCancel?: () => void; gm?: boolean; busy?: boolean; title?: string; ring?: string;
}) {
  const [look, setLook] = useState<FigureLook>(() => ({ ...DEFAULT_LOOK, ...(value ?? {}) }));
  const [tab, setTab] = useState(TABS[0].id);
  const [group, setGroup] = useState<'hero' | 'npc' | 'monster'>('hero');
  const dirty = useMemo(() => JSON.stringify(look) !== JSON.stringify({ ...DEFAULT_LOOK, ...(value ?? {}) }), [look, value]);
  const set = <K extends keyof FigureLook>(k: K, v: FigureLook[K]) => setLook((l) => ({ ...l, [k]: v }));
  const flip = (k: FigurePartKey, dir: 1 | -1) => { const list = FIGURE_PARTS[k] as readonly string[]; const i = list.indexOf(look[k] as string); set(k, list[(i + dir + list.length) % list.length] as never); };
  const current = TABS.find((t) => t.id === tab)!;
  const total = Object.values(FIGURE_PARTS).reduce((n, l) => n + l.length, 0);
  return (
    <section className="space-y-2 rounded-xl border border-gold-400/30 bg-ink-950/80 p-3 text-xs" aria-label={title} data-testid="figure-editor">
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-display text-sm text-gold-200">🧍 {title}</b>
        <span className="text-marble-500">{total} parts · low-poly miniature for the 3D battle map</span>
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <Suspense fallback={<div className="grid place-items-center rounded-xl border border-ink-700 bg-ink-900 text-marble-500" style={{ width: 260, height: 299 }}>Loading 3D…</div>}>
            <FigurePreview look={look} ring={ring} size={260} />
          </Suspense>
          <div className="flex flex-wrap justify-center gap-1">
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setLook(randomLook(Math.floor(Math.random() * 1e9), !gm))} data-testid="figure-random">🎲 Random</button>
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setLook({ ...DEFAULT_LOOK, ...(value ?? {}) })} disabled={!dirty}>↺ Undo</button>
          </div>
          <p className="max-w-[260px] text-center text-[10px] text-marble-500">Drag to turn · double-click: stop/start turning</p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-marble-400">Presets</span>
              {gm && (['hero', 'npc', 'monster'] as const).map((g) => <button key={g} type="button" aria-pressed={group === g} className={`rounded px-1.5 ${group === g ? 'bg-gold-500/25 text-gold-100' : 'text-marble-400 hover:text-gold-200'}`} onClick={() => setGroup(g)}>{g === 'hero' ? 'Heroes' : g === 'npc' ? 'NPCs' : 'Monsters'}</button>)}
            </div>
            <div className="flex flex-wrap gap-1" data-testid="figure-presets">
              {FIGURE_PRESETS.filter((p) => p.group === (gm ? group : 'hero')).map((p) => (
                <button key={p.id} type="button" className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-0.5 hover:border-gold-400/60" title={p.vary ? 'Click again for a variation' : undefined} onClick={() => setLook(lookFromPreset(p, Math.floor(Math.random() * 1e9)))}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-1 border-b border-ink-700" role="tablist">
            {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`rounded-t-md px-2 py-1 ${tab === t.id ? 'bg-ink-800 text-gold-100' : 'text-marble-400 hover:text-gold-200'}`} onClick={() => setTab(t.id)} data-testid={`figure-tab-${t.id}`}>{t.label}</button>)}
          </div>
          <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
            {current.parts.map((k) => (
              <div key={k} className="space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="w-24 shrink-0 text-marble-300">{PART_LABELS[k]}</span>
                  <button type="button" className="rounded px-1 text-marble-400 hover:text-gold-200" aria-label={`Previous ${PART_LABELS[k]}`} onClick={() => flip(k, -1)}>◀</button>
                  <b className="min-w-[5.5rem] text-center text-gold-100" data-testid={`figure-value-${k}`}>{partLabel(look[k] as string)}</b>
                  <button type="button" className="rounded px-1 text-marble-400 hover:text-gold-200" aria-label={`Next ${PART_LABELS[k]}`} onClick={() => flip(k, 1)}>▶</button>
                  {k === 'body' && <label className="ml-2 flex items-center gap-1 text-marble-400"><input type="checkbox" checked={!!look.tail} onChange={(e) => set('tail', e.target.checked)} />tail</label>}
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {(FIGURE_PARTS[k] as readonly string[]).map((v) => (
                    <button key={v} type="button" aria-pressed={look[k] === v} className={`rounded border px-1 py-px text-[11px] ${look[k] === v ? 'border-gold-400 bg-gold-500/20 text-gold-100' : 'border-ink-700 bg-ink-900/70 text-marble-300 hover:border-gold-400/50'}`} onClick={() => set(k, v as never)}>{partLabel(v)}</button>
                  ))}
                </div>
              </div>
            ))}
            {current.colours.map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-1">
                <span className="w-24 shrink-0 text-marble-300">{COLOUR_LABELS[k]}</span>
                {SWATCHES[k].map((c) => <button key={c} type="button" aria-label={`${COLOUR_LABELS[k]} ${c}`} aria-pressed={look[k] === c} className={`h-5 w-5 rounded-full border ${look[k] === c ? 'border-gold-200 ring-2 ring-gold-400/70' : 'border-ink-600'}`} style={{ background: c }} onClick={() => set(k, c)} />)}
                <input type="color" aria-label={`${COLOUR_LABELS[k]} – any colour`} className="h-5 w-7 cursor-pointer rounded border border-ink-600 bg-transparent" value={look[k]} onChange={(e) => set(k, e.target.value.toLowerCase())} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-gold px-3 py-1" disabled={busy || !dirty} onClick={() => void onSave(look)} data-testid="figure-save">Save figure</button>
        {value && <button type="button" className="btn btn-ghost px-2 py-1" disabled={busy} onClick={() => void onSave(null)} title="Back to the automatic look (or the portrait standee)">Remove figure</button>}
        {onCancel && <button type="button" className="btn btn-ghost px-2 py-1" onClick={onCancel}>Close</button>}
        {dirty && <span className="text-amber-200">unsaved changes</span>}
      </div>
    </section>
  );
}
