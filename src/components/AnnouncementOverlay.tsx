/**
 * Arena Announcement overlay – the Gamemakers' message projected across the sky of the arena.
 * Shown on every device (players and GM) for announcements not yet acknowledged on this device:
 *  - arrives through the normal synchronisation (announcements are part of every view),
 *  - devices that were offline see what they missed (the newest 3 unacknowledged),
 *  - auto-fades after 14 s, dismiss with the button, Esc or a click; queued if several arrive,
 *  - honours prefers-reduced-motion (no animation) and never contains GM-only information.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Announcement, AnnouncementCategory } from '../game/types';

export const CATEGORY_STYLE: Record<AnnouncementCategory, { label: string; color: string; glow: string; icon: string }> = {
  general: { label: 'Announcement', color: '#e8d4a6', glow: 'rgba(233,196,106,.55)', icon: '✦' },
  warning: { label: 'Warning', color: '#ffb35c', glow: 'rgba(255,150,60,.55)', icon: '⚠' },
  death: { label: 'A tribute has fallen', color: '#ff6b6b', glow: 'rgba(200,40,40,.6)', icon: '☩' },
  world: { label: 'World event', color: '#a6c8ff', glow: 'rgba(120,160,255,.55)', icon: '⚡' },
  custom: { label: 'The Gamemakers', color: '#e6d3ff', glow: 'rgba(180,140,255,.55)', icon: '❖' },
};

const ackKey = (scope: string) => `apex.announcements.ack.${scope}`;
const MAX_CATCH_UP = 3;
const AUTO_HIDE_MS = 14_000;

function readAck(scope: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(ackKey(scope));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function writeAck(scope: string, ids: Set<string>) {
  try {
    localStorage.setItem(ackKey(scope), JSON.stringify([...ids].slice(-200)));
  } catch {
    /* ignore */
  }
}

export function AnnouncementOverlay({ announcements, scope }: { announcements: Announcement[]; scope: string }) {
  const [acked, setAcked] = useState<Set<string>>(() => {
    const prev = readAck(scope);
    if (prev) return prev;
    // First visit on this device: everything except the newest few counts as seen.
    const seen = new Set(announcements.slice(0, -MAX_CATCH_UP).map((a) => a.id));
    writeAck(scope, seen);
    return seen;
  });
  const queue = useMemo(() => announcements.filter((a) => !acked.has(a.id)).slice(-MAX_CATCH_UP), [announcements, acked]);
  const current = queue[0];

  const dismiss = useCallback(() => {
    if (!current) return;
    setAcked((s) => {
      const next = new Set(s);
      next.add(current.id);
      writeAck(scope, next);
      return next;
    });
  }, [current, scope]);

  useEffect(() => {
    if (!current) return;
    const id = setTimeout(dismiss, AUTO_HIDE_MS);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [current, dismiss]);

  if (!current) return null;
  return <AnnouncementCard a={current} remaining={queue.length - 1} onDismiss={dismiss} />;
}

/** The visual card – also used for the GM's preview before broadcasting. */
export function AnnouncementCard({ a, remaining = 0, onDismiss, preview = false }: { a: Pick<Announcement, 'category' | 'title' | 'text'> & { day?: number }; remaining?: number; onDismiss: () => void; preview?: boolean }) {
  const s = CATEGORY_STYLE[a.category];
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), [a]);
  return (
    <div className="apex-announce-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onDismiss} role="presentation">
      <div
        role="alertdialog"
        aria-modal="false"
        aria-live="assertive"
        aria-labelledby="apex-announce-title"
        aria-describedby="apex-announce-text"
        className="apex-announce-card relative max-w-3xl text-center"
        onClick={(e) => e.stopPropagation()}
        style={{ ['--announce-glow' as string]: s.glow }}
      >
        <div className="text-[11px] uppercase tracking-[0.45em]" style={{ color: s.color }}>
          {s.icon} {preview ? `Preview – ${s.label}` : s.label} {s.icon}
        </div>
        <h2 id="apex-announce-title" className="apex-announce-title mt-3 font-display text-4xl font-black uppercase tracking-[0.12em] sm:text-6xl" style={{ color: s.color }}>
          {a.title}
        </h2>
        {a.text && (
          <p id="apex-announce-text" className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-marble-100 sm:text-lg">
            {a.text}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button ref={btn} className="btn btn-ghost border-gold-400/60 bg-ink-900/70 px-6" onClick={onDismiss}>
            {preview ? 'Close preview' : 'Acknowledge'}
          </button>
          {remaining > 0 && <span className="text-xs text-marble-300">+{remaining} more</span>}
        </div>
      </div>
    </div>
  );
}

/** Player-side history of the recent Arena Announcements (missed ones can be re-read here). */
export function AnnouncementHistory({ announcements }: { announcements: Announcement[] }) {
  if (!announcements.length) return null;
  const list = announcements.slice().reverse();
  return (
    <details className="panel p-3" data-testid="announcement-history">
      <summary className="panel-title cursor-pointer">📣 Arena announcements ({list.length})</summary>
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-xs">
        {list.map((a) => (
          <li key={a.id} className="rounded border border-ink-700 px-2 py-1">
            <span style={{ color: CATEGORY_STYLE[a.category].color }}>{CATEGORY_STYLE[a.category].icon}</span> <b className="text-marble-50">{a.title}</b>
            <span className="text-marble-500"> · {a.phase === 'day' ? 'Day' : 'Night'} {a.day}</span>
            {a.text && <div className="text-marble-300">{a.text}</div>}
          </li>
        ))}
      </ul>
    </details>
  );
}
