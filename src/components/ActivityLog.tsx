/**
 * Arena Chronicle (APEX 0.7 – a regular workspace widget).
 *
 * Chronological (newest at the bottom), grouped by day and night. "Follow latest" (personal preference, stored
 * locally) keeps the newest entry in view – but only while the reader is at the bottom: scrolling up to read
 * history pauses auto-scrolling until "Jump to Latest" (or re-enabling follow). New entries that arrive while
 * reading are counted as unread. Purely presentational: no requests, the log comes from the synced view.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../game/types';

const KIND_STYLE: Record<LogEntry['kind'], string> = {
  day: 'text-gold-200',
  move: 'text-marble-300',
  event: 'text-arcane-300',
  system: 'text-marble-100',
  gm: 'text-marble-500',
  warning: 'text-blood-400',
};
const FOLLOW_KEY = 'apex.chronicle.follow';
const SHOWN = 150;
const NEAR_BOTTOM_PX = 24;

const readFollow = () => {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== 'off';
  } catch {
    return true;
  }
};

export interface ChronicleGroup {
  key: string;
  day: number;
  phase: 'day' | 'night';
  entries: LogEntry[];
}

/** Consecutive entries of the same day and phase form one group (pure – unit-tested). */
export function groupChronicle(log: LogEntry[]): ChronicleGroup[] {
  const out: ChronicleGroup[] = [];
  for (const e of log) {
    const phase = e.phase === 'night' ? 'night' : 'day';
    const last = out[out.length - 1];
    if (last && last.day === e.day && last.phase === phase) last.entries.push(e);
    else out.push({ key: `${e.day}-${phase}-${e.id}`, day: e.day, phase, entries: [e] });
  }
  return out;
}

export function Chronicle({ log, isGm }: { log: LogEntry[]; isGm: boolean }) {
  const entries = useMemo(() => log.slice(-SHOWN), [log]);
  const groups = useMemo(() => groupChronicle(entries), [entries]);
  const lastId = entries.length ? entries[entries.length - 1].id : 0;
  const [follow, setFollowState] = useState(readFollow);
  const [atBottom, setAtBottom] = useState(true);
  const [seenId, setSeenId] = useState(lastId);
  const box = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const setFollow = (on: boolean) => {
    setFollowState(on);
    try {
      localStorage.setItem(FOLLOW_KEY, on ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    if (on) jump();
  };
  const jump = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setSeenId(lastId);
  };

  // first render: start at the newest entry
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  // new entries: follow only while the reader is at the bottom – never yank them away from history
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (follow && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setSeenId(lastId);
    }
  }, [lastId, follow]);
  useEffect(() => {
    if (!follow && atBottomRef.current) setSeenId(lastId);
  }, [lastId, follow]);

  const unread = entries.filter((e) => e.id > seenId).length;
  return (
    <div className="space-y-1.5" aria-label="Arena Chronicle">
      <div className="flex items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1.5 text-marble-300">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} aria-label="Follow latest" />
          Follow latest
        </label>
        <span className="flex-1" />
        {!atBottom && (
          <button className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={jump} data-testid="chronicle-jump">
            ↓ Jump to Latest
            {unread > 0 && (
              <span className="ml-1 rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-ink-950" data-testid="chronicle-unread">
                {unread} new
              </span>
            )}
          </button>
        )}
        {atBottom && !follow && unread > 0 && <span className="text-gold-300">{unread} new</span>}
      </div>
      <div
        ref={box}
        className="apex-chronicle-list overflow-y-auto pr-1 text-xs"
        data-testid="chronicle-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          atBottomRef.current = bottom;
          if (bottom !== atBottom) setAtBottom(bottom);
          if (bottom) setSeenId(lastId);
        }}
      >
        {entries.length === 0 && <p className="text-marble-500">Nothing has happened yet.</p>}
        {groups.map((g) => (
          <section key={g.key} aria-label={`${g.phase === 'night' ? 'Night' : 'Day'} ${g.day}`}>
            <h3 className={`sticky top-0 z-[1] mt-1 bg-ink-900/95 py-0.5 text-[10px] uppercase tracking-[0.16em] ${g.phase === 'night' ? 'text-arcane-300' : 'text-gold-300'}`}>
              {g.phase === 'night' ? '☾ Night' : '☀ Day'} {g.day}
            </h3>
            <ul className="space-y-1">
              {g.entries.map((e) => (
                <li key={e.id} className={`leading-snug ${KIND_STYLE[e.kind]} ${e.id > seenId ? 'apex-chronicle-new' : ''}`} data-log={e.id}>
                  {e.text}
                  {isGm && e.audience === 'gm' && <span className="ml-1 rounded bg-arcane-500/20 px-1 text-[10px] text-arcane-300">GM only</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
