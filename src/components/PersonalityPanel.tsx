/**
 * APEX 2.9 – personality of a library creature: morale style, seven trait sliders and light-shyness. Preset from
 * the stat block; the GM's changes are saved on the campaign's copy. The AI and the morale checks read them.
 */
import { useMemo, useState } from 'react';
import type { StatBlock } from '../game/bestiary';
import { MORALE_STYLES, STYLE_LABEL, TRAITS, TRAIT_HELP, TRAIT_LABEL, breakAt, creaturePersonality, isLeader, leaderBonus, rallyAmount, type MoraleStyle, type Personality, type PersonalityOverride, type Trait } from '../game/morale';

/** Only what differs from the preset is stored. */
function diff(base: Personality, p: Personality): PersonalityOverride | undefined {
  const traits: Partial<Record<Trait, number>> = {};
  for (const t of TRAITS) if (p.traits[t] !== base.traits[t]) traits[t] = p.traits[t];
  const out: PersonalityOverride = { ...(p.style !== base.style ? { style: p.style } : {}), ...(p.lightShy !== base.lightShy ? { lightShy: p.lightShy } : {}), ...(Object.keys(traits).length ? { traits } : {}) };
  return Object.keys(out).length ? out : undefined;
}

export function describe(p: Personality): string[] {
  const out: string[] = [];
  if (p.style === 'horde') return ['Never checks morale: keeps coming until destroyed.'];
  out.push(`Breaks at combat fatigue ${breakAt(p)} (morale checks: Wisdom save).`);
  if (p.style === 'troop') out.push('Shaken when comrades or its leader fall and when it loses sight of its group.');
  if (p.style === 'pack') out.push('Brave in numbers: outnumbered or alone it wavers.');
  if (p.style === 'beast' || p.style === 'proud') out.push('Thinks again when badly hurt (a quarter of its hit points).');
  if (p.lightShy) out.push('Torches and fire keep it at bay unless the pack outnumbers the foes.');
  if (isLeader(p)) out.push(`⚑ Leader: comrades who see it get +${leaderBonus(p)} on morale checks; Rally (bonus action) takes ${rallyAmount(p)} fatigue from those it sees within 30 ft.`);
  if (p.traits.mercy >= 7) out.push('Lets retreating foes go (no opportunity attacks).');
  if (p.style === 'troop' && p.traits.savagery < 7 && (p.traits.mercy >= 5 || p.traits.greed >= 6 || p.traits.opportunism >= 6)) out.push('Broken and cornered, it may surrender (if clever enough).');
  if (p.traits.opportunism >= 7) out.push('Picks on the wounded and the lone.');
  if (p.traits.honor >= 7) out.push('Seeks out the strongest foe.');
  return out;
}

export function PersonalityPanel({ block, busy, onSave }: { block: StatBlock; busy: boolean; onSave: (p: PersonalityOverride | undefined) => void | Promise<void> }) {
  const base = useMemo(() => creaturePersonality({ ...block, personality: undefined }, { name: block.name, ...(block.elite ? { elite: true } : {}), abilities: block.abilities }), [block]);
  const saved = useMemo(() => creaturePersonality(block, { name: block.name, ...(block.elite ? { elite: true } : {}), abilities: block.abilities }), [block]);
  const [p, setP] = useState<Personality>(saved);
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);
  const setTrait = (t: Trait, n: number) => setP((x) => ({ ...x, traits: { ...x.traits, [t]: n } }));
  return (
    <section className="space-y-2 rounded-xl border border-gold-400/30 bg-ink-950/80 p-3 text-xs" aria-label="Personality and morale" data-testid="personality-panel">
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-display text-sm text-gold-200">🧠 Personality &amp; morale</b>
        {isLeader(p) && <span className="rounded bg-gold-500/20 px-1.5 text-gold-100" title="Inspire 6 or more">⚑ Leader</span>}
        <span className="text-marble-500">Used by the enemy AI · hidden from the players</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-marble-300">Style
          <select className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={p.style} onChange={(e) => setP((x) => ({ ...x, style: e.target.value as MoraleStyle }))} data-testid="personality-style">
            {MORALE_STYLES.map((s) => <option key={s} value={s}>{STYLE_LABEL[s]}{s === base.style ? ' (preset)' : ''}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-marble-300" title="Torches and fire keep it at bay"><input type="checkbox" checked={p.lightShy} onChange={(e) => setP((x) => ({ ...x, lightShy: e.target.checked }))} /> 🔥 shy of light</label>
      </div>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {TRAITS.map((t) => (
          <label key={t} className="flex items-center gap-2" title={TRAIT_HELP[t]}>
            <span className="w-36 shrink-0 text-marble-300">{TRAIT_LABEL[t]}</span>
            <input type="range" min={0} max={10} step={1} value={p.traits[t]} disabled={p.style === 'horde' && t !== 'savagery'} onChange={(e) => setTrait(t, Number(e.target.value))} className="flex-1 accent-amber-400" aria-label={TRAIT_LABEL[t]} data-testid={`trait-${t}`} />
            <b className={`w-5 text-right tabular-nums ${p.traits[t] !== base.traits[t] ? 'text-gold-200' : 'text-marble-200'}`}>{p.traits[t]}</b>
          </label>
        ))}
      </div>
      <ul className="list-disc space-y-0.5 pl-4 text-marble-400" data-testid="personality-summary">{describe(p).map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-gold px-3 py-1" disabled={busy || !dirty} onClick={() => void onSave(diff(base, p))} data-testid="personality-save">Save personality</button>
        <button type="button" className="btn btn-ghost px-2 py-1" disabled={busy || JSON.stringify(p) === JSON.stringify(base)} onClick={() => setP(base)}>↺ Preset</button>
      </div>
    </section>
  );
}
