import { createContext, useContext, type ReactNode } from 'react';

export function Bar({ value, max, color = '#e9c46a', className = '' }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink-700 ${className}`}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Stepper({
  label,
  value,
  onDec,
  onInc,
  hint,
}: {
  label: string;
  value: ReactNode;
  onDec: () => void;
  onInc: () => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2" title={hint}>
      <span className="text-xs text-marble-300">{label}</span>
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost h-7 w-7 px-0" onClick={onDec} aria-label={`Decrease ${label}`}>
          −
        </button>
        <span className="w-12 text-center text-sm font-semibold tabular-nums text-marble-50">{value}</span>
        <button className="btn btn-ghost h-7 w-7 px-0" onClick={onInc} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: {
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg border border-ink-600 bg-ink-900 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.hint}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 ${size === 'md' ? 'py-1.5 text-xs' : 'py-1 text-[11px]'} font-medium transition-colors ${
            value === o.value ? 'bg-gold-400/20 text-gold-200 shadow-[inset_0_0_0_1px_rgba(212,166,74,.6)]' : 'text-marble-300 hover:text-marble-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Inside the GM sidebar a Section is already framed by its collapsible header: render it bare. */
export const BareSections = createContext(false);

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const bare = useContext(BareSections);
  if (bare)
    return (
      <div>
        {right && <div className="mb-2 flex justify-end">{right}</div>}
        {children}
      </div>
    );
  return (
    <section className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="panel-title">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <button onClick={onChange} title={hint} className="flex w-full items-center justify-between gap-2 text-left text-xs text-marble-300 hover:text-marble-50">
      <span>{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? 'border-gold-400 bg-gold-400/30' : 'border-ink-500 bg-ink-800'}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${checked ? 'left-[18px] bg-gold-200' : 'left-0.5 bg-marble-500'}`} />
      </span>
    </button>
  );
}
