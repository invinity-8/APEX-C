import { useState } from 'react';
import type { LogEntry } from '../game/types';

const KIND_STYLE: Record<LogEntry['kind'], string> = {
  day: 'text-gold-200',
  move: 'text-marble-300',
  event: 'text-arcane-300',
  system: 'text-marble-100',
  gm: 'text-marble-500',
  warning: 'text-blood-400',
};

export function ActivityLog({ log, isGm }: { log: LogEntry[]; isGm: boolean }) {
  const [open, setOpen] = useState(true);
  const entries = log.slice(-60).reverse();
  return (
    <div className="panel absolute bottom-3 left-3 z-10 w-[min(380px,calc(100%-5rem))]">
      <button className="flex w-full items-center justify-between px-3 py-2" onClick={() => setOpen(!open)} title="Chronik ein-/ausklappen">
        <span className="panel-title">Chronik der Arena</span>
        <span className="text-xs text-marble-500">{open ? '▾' : '▸'} {log.length}</span>
      </button>
      {open && (
        <ul className="max-h-44 space-y-1 overflow-y-auto px-3 pb-2.5 text-xs">
          {entries.length === 0 && <li className="text-marble-500">Noch nichts geschehen.</li>}
          {entries.map((e) => (
            <li key={e.id} className={`flex gap-2 leading-snug ${KIND_STYLE[e.kind]}`}>
              <span className="w-8 shrink-0 tabular-nums text-marble-500">T{e.day}</span>
              <span className="flex-1">
                {e.text}
                {isGm && e.audience === 'gm' && <span className="ml-1 rounded bg-arcane-500/20 px-1 text-[10px] text-arcane-300">nur GM</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
