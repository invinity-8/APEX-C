/**
 * APEX 2.2 – choose a creature model of the 3D kit for a stat block (beasts, mounts, monstrosities, dragons,
 * aberrations, elementals, oozes, constructs, plants, spirits, fiends), with a live preview and dragon colours.
 */
import { lazy, Suspense, useState } from 'react';
import type { StatBlock } from '../game/bestiary';
import { CREATURE_LIST, DRAGON_TINTS, type CreatureChoice } from '../game/creatures';

const FigurePreview = lazy(() => import('./FigurePreview'));

/** Mirrors the automatic choice of the 3D map (name and type) – shown as the starting point. */
export function CreaturePicker({ block, busy, onSave }: { block: StatBlock; busy: boolean; onSave: (c: CreatureChoice | null) => void | Promise<void> }) {
  const [kind, setKind] = useState(block.creature?.kind ?? '');
  const [tint, setTint] = useState(block.creature?.tint ?? '');
  const groups = [...new Set(CREATURE_LIST.map((c) => c.group))];
  const isDragon = kind === 'dragon' || kind === 'drake';
  const dirty = kind !== (block.creature?.kind ?? '') || tint !== (block.creature?.tint ?? '');
  return (
    <section className="space-y-2 rounded-xl border border-arcane-500/40 bg-ink-950/80 p-3 text-xs" aria-label="Creature model" data-testid="creature-picker">
      <div className="flex flex-wrap items-center gap-2"><b className="font-display text-sm text-gold-200">🐉 Creature model</b><span className="text-marble-500">{CREATURE_LIST.length} models · without a choice the 3D map picks one from the name and type</span></div>
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="shrink-0">
          {kind ? (
            <Suspense fallback={<div className="grid place-items-center rounded-xl border border-ink-700 bg-ink-900 text-marble-500" style={{ width: 220, height: 253 }}>Loading 3D…</div>}>
              <FigurePreview creature={{ kind, ...(tint ? { tint } : {}) }} ring={block.color} size={220} />
            </Suspense>
          ) : <div className="grid place-items-center rounded-xl border border-dashed border-ink-600 p-4 text-center text-marble-500" style={{ width: 220, height: 253 }}>Humanoid figure (below) or automatic choice</div>}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {groups.map((gr) => (
            <div key={gr} className="space-y-0.5">
              <span className="text-marble-400">{gr}</span>
              <div className="flex flex-wrap gap-0.5">
                {CREATURE_LIST.filter((c) => c.group === gr).map((c) => <button key={c.id} type="button" aria-pressed={kind === c.id} className={`rounded border px-1 py-px text-[11px] ${kind === c.id ? 'border-gold-400 bg-gold-500/20 text-gold-100' : 'border-ink-700 bg-ink-900/70 text-marble-300 hover:border-gold-400/50'}`} onClick={() => setKind(c.id)} data-testid="creature-option">{c.label}</button>)}
              </div>
            </div>
          ))}
          {isDragon && (
            <div className="flex flex-wrap items-center gap-1"><span className="text-marble-400">Dragon colour</span>{DRAGON_TINTS.map((t) => <button key={t} type="button" aria-pressed={tint === t} className={`rounded px-1.5 ${tint === t ? 'bg-gold-500/25 text-gold-100' : 'text-marble-300 hover:text-gold-200'}`} onClick={() => setTint(t)}>{t}</button>)}</div>
          )}
          {(kind === 'ooze' || kind === 'golem' || kind === 'ghost') && (
            <label className="flex items-center gap-1 text-marble-400">Colour <input type="color" value={tint && tint.startsWith('#') ? tint : '#7a7a70'} onChange={(e) => setTint(e.target.value)} /></label>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-gold px-3 py-1" disabled={busy || !kind || !dirty} onClick={() => void onSave({ kind, ...(tint ? { tint } : {}) })} data-testid="creature-save">Use this model</button>
        {block.creature && <button type="button" className="btn btn-ghost px-2 py-1" disabled={busy} onClick={() => void onSave(null)}>Back to automatic</button>}
      </div>
    </section>
  );
}
