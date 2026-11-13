/**
 * APEX 2.4 – searchable live list of the enemy library (built-ins + the GM's own) for “Add enemy” in the game:
 * type to filter by name, type or CR, narrow by creature type, click to pick. The list is always visible.
 */
import { useMemo, useState } from 'react';
import { displayName, type StatBlock } from '../game/bestiary';

const crValue = (cr: string) => (cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr) || 0);
const kindOf = (b: StatBlock) => b.type.split(/[ (]/)[0].toLowerCase();

export function EnemyPicker({ library, value, onPick, height = '14rem' }: { library: StatBlock[]; value: string; onPick: (id: string) => void; height?: string }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const kinds = useMemo(() => [...new Set(library.map(kindOf))].sort(), [library]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return library
      .filter((b) => !kind || kindOf(b) === kind)
      .filter((b) => { const hay = `${displayName(b)} ${b.id} ${b.type} cr ${b.cr} ${b.size} ${b.flyFt ? 'fly flying' : ''} ${b.source === 'custom' ? 'own custom' : ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => crValue(a.cr) - crValue(b.cr) || displayName(a).localeCompare(displayName(b)));
  }, [library, q, kind]);
  const current = library.find((b) => b.id === value);
  return (
    <div className="space-y-1 rounded-md border border-ink-700 bg-ink-950/60 p-1.5" data-testid="enemy-picker">
      <div className="flex items-center gap-1">
        <input type="search" className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs" placeholder={`Search ${library.length} creatures – name, type, “cr 2”, “fly” …`} aria-label="Search enemies" value={q} onChange={(e) => setQ(e.target.value)} data-testid="enemy-search" />
        <span className="shrink-0 text-[10px] text-marble-500">{shown.length}</span>
      </div>
      <div className="flex flex-wrap gap-0.5" role="group" aria-label="Creature type">
        <button type="button" aria-pressed={!kind} className={`rounded px-1.5 text-[10px] ${!kind ? 'bg-gold-500/25 text-gold-100' : 'text-marble-400 hover:text-gold-200'}`} onClick={() => setKind(null)}>all</button>
        {kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} className={`rounded px-1.5 text-[10px] ${kind === k ? 'bg-gold-500/25 text-gold-100' : 'text-marble-400 hover:text-gold-200'}`} onClick={() => setKind(kind === k ? null : k)}>{k}</button>)}
      </div>
      <ul className="overflow-y-auto pr-0.5" style={{ maxHeight: height }} role="listbox" aria-label="Enemies">
        {shown.map((b) => (
          <li key={b.id}>
            <button type="button" role="option" aria-selected={b.id === value} className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left ${b.id === value ? 'bg-gold-500/20 text-gold-100' : 'text-marble-200 hover:bg-ink-800'}`} onClick={() => onPick(b.id)} data-testid={`enemy-option-${b.id}`}>
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: b.color }}>{b.icon}</span>
              <span className="min-w-0 flex-1 truncate">{b.elite ? '🐉 ' : ''}{displayName(b)}{b.flyFt ? ' 🪽' : ''}</span>
              <span className="shrink-0 text-[10px] text-marble-500">CR {b.cr} · AC {b.ac} · HP {b.hp}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-1 py-2 text-marble-500">Nothing found.</li>}
      </ul>
      {current && <p className="text-[10px] text-marble-400">Selected: <b className="text-gold-200">{displayName(current)}</b> · {current.size} {current.type} · speed {current.speedFt} ft{current.flyFt ? `, fly ${current.flyFt} ft` : ''} · {current.attacks.map((a) => a.name).join(', ')}</p>}
    </div>
  );
}
