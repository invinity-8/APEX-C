/**
 * GM encounter generator (APEX 2.0): theme, situation, difficulty, party size and level, a seed to reroll → a
 * preview of the monsters with XP and the difficulty they add up to. Entries can be removed or added from the
 * library before "Place on the map".
 */
import { useState } from 'react';
import { api } from '../online/api';
import { BUILTIN_BESTIARY, type StatBlock } from '../game/bestiary';
import { crXp, rate, SITUATIONS, THEMES, type Difficulty, type EncounterEntry, type EncounterPlan, type Situation } from '../game/encounters';

export function EncounterPanel({ sceneId, partySizeDefault, library, busy, onPlaced }: { sceneId: string; partySizeDefault: number; library: StatBlock[]; busy: boolean; onPlaced: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(THEMES[0].id);
  const [situation, setSituation] = useState<Situation>('camp');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [size, setSize] = useState(Math.max(1, partySizeDefault || 4));
  const [level, setLevel] = useState(1);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [plan, setPlan] = useState<EncounterPlan | null>(null);
  const [entries, setEntries] = useState<EncounterEntry[]>([]);
  const [add, setAdd] = useState('');
  const [error, setError] = useState('');
  const blocks = [...BUILTIN_BESTIARY, ...library];
  const roll = async (s = seed) => {
    setError('');
    try {
      const r = (await api.sceneTurn({ sceneId, action: 'encounter', op: 'plan', theme, situation, difficulty, partySize: size, partyLevel: level, seed: s })) as unknown as { plan: EncounterPlan };
      setPlan(r.plan); setEntries(r.plan.entries);
    } catch (e) { setError(String(e)); }
  };
  const place = async () => {
    setError('');
    try {
      const r = await api.sceneTurn({ sceneId, action: 'encounter', op: 'apply', situation, seed, entries });
      onPlaced(r.message ?? 'Encounter placed.');
      setPlan(null); setEntries([]);
    } catch (e) { setError(String(e)); }
  };
  const rating = rate(entries.map((e) => e.xp), size, level);
  const badge = { trivial: 'text-marble-300', easy: 'text-emerald-300', medium: 'text-amber-200', hard: 'text-orange-300', deadly: 'text-rose-300' }[rating.difficulty];
  if (!open) return <button type="button" className="btn btn-ghost w-full" onClick={() => setOpen(true)} data-testid="open-encounters">⚔ Encounter generator…</button>;
  return (
    <section className="space-y-2 rounded-xl border border-blood-400/50 bg-ink-950/90 p-2.5 text-xs" aria-label="Encounter generator" data-testid="encounter-panel">
      <div className="flex items-center gap-2"><b className="font-display text-sm text-gold-200">⚔ Encounter generator</b><button type="button" className="ml-auto text-marble-500 hover:text-gold-200" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5">Theme<select className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={theme} onChange={(e) => setTheme(e.target.value)}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label className="flex flex-col gap-0.5">Situation<select className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={situation} onChange={(e) => setSituation(e.target.value as Situation)}>{SITUATIONS.map((s) => <option key={s.id} value={s.id} title={s.text}>{s.label}</option>)}</select></label>
        <label className="flex flex-col gap-0.5">Difficulty<select className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>{(['easy', 'medium', 'hard', 'deadly'] as const).map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <div className="flex gap-1.5">
          <label className="flex flex-1 flex-col gap-0.5">Party<input type="number" min={1} max={10} className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={size} onChange={(e) => setSize(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></label>
          <label className="flex flex-1 flex-col gap-0.5">Level<input type="number" min={1} max={20} className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={level} onChange={(e) => setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
        </div>
      </div>
      <p className="text-marble-500">{SITUATIONS.find((s) => s.id === situation)?.text}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-gold px-2 py-0.5" disabled={busy} onClick={() => void roll()} data-testid="plan-encounter">Generate</button>
        <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={busy} title="New seed" onClick={() => { const s = Math.floor(Math.random() * 100000); setSeed(s); void roll(s); }}>🎲 Reroll</button>
        <span className="text-marble-500">seed {seed}</span>
      </div>
      {plan && (
        <div className="space-y-1">
          <p>Budget {plan.budget} XP · this list: {rating.raw} XP → <b>{rating.adjusted}</b> adjusted · <b className={badge}>{rating.difficulty}</b></p>
          <ul className="space-y-0.5" data-testid="encounter-entries">
            {entries.map((e, i) => (
              <li key={`${e.templateId}-${i}`} className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900/60 px-1.5 py-0.5">
                <span className="flex-1">{e.role === 'leader' ? '👑 ' : ''}{e.name} <span className="text-marble-500">CR {e.cr} · {e.xp} XP</span></span>
                <button type="button" className="text-marble-500 hover:text-rose-300" aria-label={`Remove ${e.name}`} onClick={() => setEntries(entries.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <select aria-label="Add a creature" className="flex-1 rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={add} onChange={(e) => setAdd(e.target.value)}>
              <option value="">Add from the library…</option>
              {blocks.map((b) => <option key={b.id} value={b.id}>{b.name} (CR {b.cr})</option>)}
            </select>
            <button type="button" className="btn btn-ghost px-2 py-0.5" disabled={!add} onClick={() => { const b = blocks.find((x) => x.id === add); if (b) setEntries([...entries, { templateId: b.id, name: b.name, cr: b.cr, xp: crXp(b.cr), role: 'troop' }]); setAdd(''); }}>+ Add</button>
          </div>
          <button type="button" className="btn btn-gold w-full" disabled={busy || !entries.length} onClick={() => void place()} data-testid="place-encounter">Place on the map ({SITUATIONS.find((s) => s.id === situation)?.label.toLowerCase()})</button>
        </div>
      )}
      {error && <p role="alert" className="text-rose-300">{error}</p>}
    </section>
  );
}
