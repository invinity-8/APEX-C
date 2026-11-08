/**
 * APEX 1.0 – shared displays of the character's effective numbers: AC / speed / initiative / HP with their
 * sources, elemental resistance glyphs (points and damage reduction) and ability scores raised by items.
 */
import type { CalcStep } from '../../game/equipment';
import type { EffectiveStats } from '../../game/effectiveStats';
import type { Element } from '../../game/items/modifiers';

export const ELEMENT_STYLE: Record<Element, { label: string; color: string; path: string }> = {
  fire: { label: 'Fire', color: '#f08a3c', path: 'M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z' },
  cold: { label: 'Cold', color: '#8fd3ff', path: 'M11 2h2v7.3l5-2.9 1 1.7-5 2.9 5 2.9-1 1.7-5-2.9V22h-2v-9.3l-5 2.9-1-1.7 5-2.9-5-2.9 1-1.7 5 2.9z' },
  lightning: { label: 'Lightning', color: '#f5dc4a', path: 'M13 2 5 14h6l-1 8 8-12h-6z' },
  poison: { label: 'Poison', color: '#8ad86a', path: 'M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12zm-2 12a2 2 0 1 0 0 .1z' },
  necrotic: { label: 'Necrotic', color: '#b48ae0', path: 'M12 3a7 7 0 0 0-7 7c0 3 2 4 2 6v3h3v-2h1v2h2v-2h1v2h3v-3c0-2 2-3 2-6a7 7 0 0 0-7-7zm-3 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z' },
  radiant: { label: 'Radiant', color: '#ffe9a6', path: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM11 1h2v4h-2zm0 18h2v4h-2zM1 11h4v2H1zm18 0h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zm11.4 11.4 1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4-2.8 2.8z' },
};

export function ElementGlyph({ element, size = 16, dim = false }: { element: Element; size?: number; dim?: boolean }) {
  const s = ELEMENT_STYLE[element];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ opacity: dim ? 0.35 : 1 }}>
      <path d={s.path} fill={s.color} fillRule="evenodd" />
    </svg>
  );
}

const pct = (r: number) => `${Math.round(r * 100)} %`;

/** One chip per element: glyph, resistance points and the damage reduction they give. */
export function ResistanceRow({ resistances, compact = false }: { resistances: EffectiveStats['resistances']; compact?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Elemental resistances" data-testid="resistances">
      {resistances.map((r) => (
        <li
          key={r.element}
          className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums ${r.points ? 'border-ink-500 bg-ink-900/70 text-marble-100' : 'border-ink-700 text-marble-500'}`}
          title={`${ELEMENT_STYLE[r.element].label} resistance: ${r.points} points → ${pct(r.reduction)} less ${r.element} damage (100 points = 50 %, the maximum)${r.capped ? ' – capped' : ''}`}
          data-element={r.element}
        >
          <ElementGlyph element={r.element} dim={!r.points} />
          {!compact && <span className="text-marble-400">{ELEMENT_STYLE[r.element].label}</span>}
          <b>{r.points}</b>
          {r.points > 0 && <span className="text-emerald-300">−{pct(r.reduction)} dmg</span>}
        </li>
      ))}
    </ul>
  );
}

const stepsTitle = (steps: CalcStep[]) => steps.map((s) => `${s.op === '=' ? '' : s.op === 'cap' ? '⊓ ' : s.value >= 0 ? '+ ' : '− '}${s.op === '=' ? s.value : Math.abs(s.value)}  ${s.label}`).join('\n');
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** AC / Speed / Initiative / HP max, each with the sheet value and a step-by-step tooltip when equipment changes it. */
export function EffectiveStatGrid({ stats, hpCurrent }: { stats: EffectiveStats; hpCurrent?: number | null }) {
  const cells: Array<{ label: string; value: string; sub?: string; title?: string; changed: boolean; testid: string }> = [
    {
      label: 'Armor Class',
      value: stats.ac.value === null ? '—' : String(stats.ac.value),
      sub: stats.ac.sheet !== null && stats.ac.value !== stats.ac.sheet ? `sheet ${stats.ac.sheet}` : stats.derived.armour ? `${stats.derived.armour.weightClass} armour` : undefined,
      title: stepsTitle(stats.ac.steps),
      changed: stats.ac.sheet !== null && stats.ac.value !== stats.ac.sheet,
      testid: 'eff-ac',
    },
    {
      label: 'Speed',
      value: `${stats.speed.value} ft`,
      sub: stats.speed.sheet !== null && stats.speed.sheet !== stats.speed.value ? `sheet ${stats.speed.sheet} ft` : undefined,
      title: stepsTitle(stats.speed.steps),
      changed: stats.speed.sheet !== null && stats.speed.sheet !== stats.speed.value,
      testid: 'eff-speed',
    },
    {
      label: 'Initiative',
      value: signed(stats.initiative.value),
      sub: stats.initiative.bonus ? `sheet ${signed(stats.initiative.sheet)}` : undefined,
      title: stats.initiative.bonus ? `Sheet ${signed(stats.initiative.sheet)}\n+ ${stats.initiative.bonus} equipment` : undefined,
      changed: !!stats.initiative.bonus,
      testid: 'eff-init',
    },
    {
      label: 'Max HP',
      value: stats.maxHp.value === null ? '—' : hpCurrent != null ? `${hpCurrent} / ${stats.maxHp.value}` : String(stats.maxHp.value),
      sub: stats.maxHp.bonus ? `+${stats.maxHp.bonus} from items` : undefined,
      changed: !!stats.maxHp.bonus,
      testid: 'eff-hp',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className={`rounded-lg border bg-ink-900/60 p-2 text-center ${c.changed ? 'border-emerald-600/50' : 'border-gold-700/40'}`} title={c.title} data-testid={c.testid}>
          <div className="truncate text-[10px] uppercase tracking-wider text-marble-500">{c.label}</div>
          <div className="font-display text-xl font-bold text-marble-50">{c.value}</div>
          {c.sub && <div className={`text-[10px] ${c.changed ? 'text-emerald-300' : 'text-marble-400'}`}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
