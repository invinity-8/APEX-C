/**
 * GM event tools (APEX 0.4):
 *  - GmEventModal: centered decision dialog for events that became due (Approve & Trigger, Reject,
 *    Postpone, Edit). Only the GM ever sees it; nothing happens before a decision.
 *  - EventsPanel: Event Library – pending decisions, available, triggered, rejected/postponed and custom
 *    events with search, filter, preview and the same server-side validation for manual triggers.
 *  - AnnouncementsPanel: compose, preview and broadcast Arena Announcements; history.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Command } from '../game/commands';
import { eventEligible, previewEvent } from '../game/events';
import { TERRAIN, TERRAIN_ORDER, type TerrainType } from '../game/terrain';
import { phaseName } from '../game/text';
import type { AnnouncementCategory, ArenaEvent, EventEffect, GameState } from '../game/types';
import type { HexKey } from '../game/hex';
import { hexKey, hexesInRange } from '../game/hex';
import type { DispatchResult } from '../state/gameApi';
import { AnnouncementCard, CATEGORY_STYLE } from './AnnouncementOverlay';
import { Spinner } from './brand';

type Run = (cmd: Command) => Promise<DispatchResult>;
const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';

const triggerText = (ev: ArenaEvent) =>
  ev.trigger.type === 'day' ? `Dawn of Day ${ev.trigger.day}` : ev.trigger.type === 'phase' ? phaseName(ev.trigger.phase, ev.trigger.day) : 'Manual';
const STATUS_LABEL: Record<ArenaEvent['status'], { text: string; cls: string }> = {
  pending: { text: 'Scheduled', cls: 'text-marble-300' },
  awaiting: { text: 'Awaiting your decision', cls: 'text-amber-200' },
  postponed: { text: 'Postponed', cls: 'text-sky-300' },
  done: { text: 'Triggered', cls: 'text-emerald-300' },
  rejected: { text: 'Rejected', cls: 'text-red-300' },
};

function EffectList({ state, ev }: { state: GameState; ev: ArenaEvent }) {
  const p = previewEvent(state, ev);
  const lines: string[] = [];
  if (p.terrainTo) lines.push(`${p.terrainChanges} hex${p.terrainChanges === 1 ? '' : 'es'} become ${p.terrainTo}${p.spared ? ` (${p.spared} spared: sites/occupied)` : ''}`);
  if (p.sites.length) lines.push(`Reveals to everyone: ${p.sites.join(', ')}`);
  if (p.movePoints !== null) lines.push(`Movement points of all players ${p.movePoints > 0 ? '+' : ''}${p.movePoints}`);
  if (ev.announce) lines.push('Players are notified (log + Arena Announcement)');
  else lines.push('GM-only (players are not notified)');
  return (
    <div className="space-y-1 text-xs">
      <ul className="list-disc space-y-0.5 pl-4 text-marble-200">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {p.characters.length > 0 && <p className="text-marble-400">Affected characters: {p.characters.join(', ')}</p>}
    </div>
  );
}

export function GmEventModal({ state, run }: { state: GameState; run: Run }) {
  const awaiting = Object.values(state.events).filter((e) => e.status === 'awaiting');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const ev = awaiting.find((e) => !hidden.has(e.id));
  if (!ev) return null;

  const decide = async (decision: 'approve' | 'reject' | 'postpone', postpone?: 'nextPhase' | 'nextDay') => {
    setBusy(true);
    const edits = editing ? { name, description, announce } : undefined;
    await run({ type: 'decideEvent', eventId: ev.id, decision, ...(postpone ? { postpone } : {}), ...(edits ? { edits } : {}) });
    setBusy(false);
    setEditing(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="panel w-full max-w-lg space-y-3 border-amber-400/50 p-5 shadow-[0_0_60px_-10px_rgba(233,196,106,.45)]">
        <div className="text-[11px] uppercase tracking-[0.35em] text-amber-200">⚡ Event due · {ev.dueAt ? phaseName(ev.dueAt.phase, ev.dueAt.day) : triggerText(ev)}</div>
        {editing ? (
          <div className="space-y-2">
            <input className={`${input} font-display text-lg`} aria-label="Event name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className={`${input} min-h-20`} aria-label="Event description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <label className="flex items-center gap-2 text-xs text-marble-300">
              <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Notify players (log + Arena Announcement)
            </label>
          </div>
        ) : (
          <>
            <h2 id={id} className="font-display text-2xl font-black text-gold-200">
              {ev.name}
            </h2>
            <p className="text-sm leading-relaxed text-marble-200">{ev.description}</p>
          </>
        )}
        <div className="rounded-lg border border-ink-600 bg-ink-900/60 p-2">
          <div className="label mb-1">If approved</div>
          <EffectList state={state} ev={editing ? { ...ev, announce } : ev} />
        </div>
        <p className="text-[11px] text-marble-500">Nothing has happened yet. Only “Approve &amp; Trigger” changes the game.{awaiting.length > 1 ? ` ${awaiting.length - 1} more event(s) waiting.` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-gold" disabled={busy} onClick={() => void decide('approve')}>
            {busy && <Spinner />} Approve &amp; Trigger
          </button>
          <button className="btn btn-ghost hover:border-blood-400/70" disabled={busy} onClick={() => void decide('reject')}>
            Reject
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void decide('postpone', 'nextPhase')}>
            Postpone (next phase)
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void decide('postpone', 'nextDay')}>
            Postpone (next day)
          </button>
          {!editing && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setName(ev.name);
                setDescription(ev.description);
                setAnnounce(ev.announce);
                setEditing(true);
              }}
            >
              ✎ Edit
            </button>
          )}
          <button className="btn btn-ghost ml-auto text-xs" onClick={() => setHidden((h) => new Set(h).add(ev.id))} title="Close for now – the event stays waiting in the Events panel">
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}

type Filter = 'decide' | 'available' | 'done' | 'closed' | 'custom' | 'all';

export function EventsPanel({ state, run, selectedHex }: { state: GameState; run: Run; selectedHex: HexKey | null }) {
  const [filter, setFilter] = useState<Filter>(() => (Object.values(state.events).some((e) => e.status === 'awaiting') ? 'decide' : 'available'));
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const events = Object.values(state.events);
  const counts: Record<Filter, number> = {
    decide: events.filter((e) => e.status === 'awaiting').length,
    available: events.filter((e) => e.status === 'pending' || e.status === 'postponed').length,
    done: events.filter((e) => e.status === 'done').length,
    closed: events.filter((e) => e.status === 'rejected' || e.status === 'postponed').length,
    custom: events.filter((e) => e.source === 'custom').length,
    all: events.length,
  };
  const match = (e: ArenaEvent) =>
    (filter === 'all' ||
      (filter === 'decide' && e.status === 'awaiting') ||
      (filter === 'available' && (e.status === 'pending' || e.status === 'postponed')) ||
      (filter === 'done' && e.status === 'done') ||
      (filter === 'closed' && (e.status === 'rejected' || e.status === 'postponed')) ||
      (filter === 'custom' && e.source === 'custom')) &&
    (!q || `${e.name} ${e.description}`.toLowerCase().includes(q.toLowerCase()));
  const list = events.filter(match);
  const labels: Record<Filter, string> = { decide: 'Pending decision', available: 'Available', done: 'Triggered', closed: 'Rejected / postponed', custom: 'Custom', all: 'All' };
  return (
    <div className="space-y-2 text-xs">
      <input className={input} placeholder="Search events…" aria-label="Search events" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {(Object.keys(labels) as Filter[]).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`chip ${filter === f ? 'border-gold-400 text-gold-200' : 'text-marble-300'}`}>
            {labels[f]} {counts[f] ? `(${counts[f]})` : ''}
          </button>
        ))}
      </div>
      <ul className="space-y-1.5">
        {list.map((ev) => (
          <li key={ev.id} className="rounded-lg border border-ink-600 bg-ink-800/60 p-2" data-event={ev.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-marble-50">⚡ {ev.name}</span>
              <span className="text-[10px] text-marble-500">{triggerText(ev)}</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-marble-300">{ev.description}</p>
            <div className={`mt-1 text-[11px] ${STATUS_LABEL[ev.status].cls}`}>
              {STATUS_LABEL[ev.status].text}
              {ev.postponedTo && ev.status === 'postponed' && ` until ${phaseName(ev.postponedTo.phase, ev.postponedTo.day)}`}
              {ev.decidedAt && ` · ${phaseName(ev.decidedAt.phase, ev.decidedAt.day)}`}
              {ev.source === 'custom' && ' · custom'}
            </div>
            {eventEligible(ev) && (
              <>
                {confirm === ev.id ? (
                  <div className="mt-1.5 space-y-1.5 rounded-md border border-gold-700/40 bg-ink-900/60 p-2">
                    <div className="label">Preview – if triggered now</div>
                    <EffectList state={state} ev={ev} />
                    <div className="flex flex-wrap gap-1.5">
                      <button className="btn btn-gold px-2 py-0.5" onClick={() => void run({ type: 'decideEvent', eventId: ev.id, decision: 'approve' }).then(result => { if (result.ok) setConfirm(null); })}>
                        Approve &amp; Trigger
                      </button>
                      <button className="btn btn-ghost px-2 py-0.5" onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button className="btn btn-ghost px-2 py-0.5" onClick={() => setConfirm(ev.id)}>
                      Review &amp; trigger…
                    </button>
                    <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'decideEvent', eventId: ev.id, decision: 'postpone', postpone: 'nextPhase' })}>
                      Postpone
                    </button>
                    <button className="btn btn-ghost px-2 py-0.5 hover:border-blood-400/70" onClick={() => void run({ type: 'decideEvent', eventId: ev.id, decision: 'reject' })}>
                      Reject
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
        {!list.length && <li className="text-marble-500">No events in this list.</li>}
      </ul>
      <CreateEvent state={state} run={run} selectedHex={selectedHex} />
    </div>
  );
}

function CreateEvent({ state, run, selectedHex }: { state: GameState; run: Run; selectedHex: HexKey | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'move' | 'terrain' | 'site'>('move');
  const [amount, setAmount] = useState(-2);
  const [terrain, setTerrain] = useState<TerrainType>('forest');
  const [radius, setRadius] = useState(1);
  const [siteId, setSiteId] = useState(Object.keys(state.sites)[0] ?? '');
  const [announce, setAnnounce] = useState(true);
  const hexes = useMemo(() => {
    if (kind !== 'terrain' || !selectedHex) return [];
    const [q, r] = selectedHex.split(',').map(Number);
    return hexesInRange({ q, r }, radius).map(hexKey).filter((k) => state.hexes[k]);
  }, [kind, selectedHex, radius, state.hexes]);
  const effect: EventEffect = kind === 'move' ? { type: 'modifyMovePoints', amount } : kind === 'terrain' ? { type: 'setTerrain', terrain } : { type: 'revealSite', siteId };
  const valid = name.trim() && (kind !== 'terrain' || hexes.length > 0) && (kind !== 'site' || !!siteId);
  if (!open)
    return (
      <button className="btn btn-ghost w-full" onClick={() => setOpen(true)}>
        ✎ Create custom event
      </button>
    );
  return (
    <div className="space-y-2 rounded-lg border border-gold-700/40 bg-ink-900/50 p-2">
      <div className="label">New custom event (not triggered until you approve it)</div>
      <input className={input} placeholder="Event name" aria-label="Custom event name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <textarea className={`${input} min-h-14`} placeholder="Description (shown to players if notified)" aria-label="Custom event description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <select className={input} aria-label="Effect" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="move">Change movement points of all players</option>
        <option value="terrain">Change terrain around the selected hex</option>
        <option value="site">Reveal a site to everyone</option>
      </select>
      {kind === 'move' && (
        <label className="block text-marble-300">
          Amount
          <input className={input} type="number" min={-20} max={20} value={amount} onChange={(e) => setAmount(Math.max(-20, Math.min(20, Math.round(Number(e.target.value) || 0))))} />
        </label>
      )}
      {kind === 'terrain' && (
        <div className="grid grid-cols-2 gap-2">
          <select className={input} aria-label="New terrain" value={terrain} onChange={(e) => setTerrain(e.target.value as TerrainType)}>
            {TERRAIN_ORDER.map((t) => (
              <option key={t} value={t}>
                {TERRAIN[t].label}
              </option>
            ))}
          </select>
          <label className="text-marble-300">
            Radius
            <input className={input} type="number" min={0} max={6} value={radius} onChange={(e) => setRadius(Math.max(0, Math.min(6, Math.round(Number(e.target.value) || 0))))} />
          </label>
          <p className="col-span-2 text-[11px] text-marble-500">{selectedHex ? `${hexes.length} hexes around ${selectedHex}` : 'Select a hex on the map first.'}</p>
        </div>
      )}
      {kind === 'site' && (
        <select className={input} aria-label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {Object.values(state.sites).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-2 text-marble-300">
        <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Notify players when triggered
      </label>
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn btn-gold"
          disabled={!valid}
          onClick={async () => {
            const r = await run({ type: 'createEvent', eventId: `ev-${Date.now().toString(36)}`, name, description, hexes, effects: [effect], announce });
            if (r.ok) {
              setOpen(false);
              setName('');
              setDescription('');
            }
          }}
        >
          Create event
        </button>
      </div>
    </div>
  );
}

const PRESETS: Array<{ category: AnnouncementCategory; title: string }> = [
  { category: 'general', title: 'THE SECOND NIGHT BEGINS' },
  { category: 'death', title: 'A TRIBUTE HAS FALLEN' },
  { category: 'warning', title: 'THE ARENA IS SHRINKING' },
];

export function AnnouncementsPanel({ state, run }: { state: GameState; run: Run }) {
  const [category, setCategory] = useState<AnnouncementCategory>('general');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const history = (state.announcements ?? []).slice().reverse();
  const send = async () => {
    setBusy(true);
    const r = await run({ type: 'announce', category, title, text });
    setBusy(false);
    if (r.ok) {
      setTitle('');
      setText('');
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.title}
            className="chip text-marble-300 hover:text-gold-200"
            onClick={() => {
              setCategory(p.category);
              setTitle(p.title);
            }}
          >
            {p.title}
          </button>
        ))}
      </div>
      <select className={input} aria-label="Announcement category" value={category} onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}>
        {(Object.keys(CATEGORY_STYLE) as AnnouncementCategory[]).map((c) => (
          <option key={c} value={c}>
            {CATEGORY_STYLE[c].icon} {c === 'death' ? 'Death / elimination' : c === 'world' ? 'World event' : c[0].toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
      <input className={`${input} font-display uppercase`} placeholder="Headline, e.g. THE ARENA IS SHRINKING" aria-label="Announcement headline" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      <textarea className={`${input} min-h-14`} placeholder="Optional text" aria-label="Announcement text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
      <p className="text-[11px] text-marble-500">Shown in the centre of every player’s screen (also later to players who are offline now). Never put secret GM information here.</p>
      <div className="flex gap-2">
        <button className="btn btn-ghost" disabled={!title.trim()} onClick={() => setPreview(true)}>
          Preview
        </button>
        <button className="btn btn-gold" disabled={!title.trim() || busy} onClick={() => void send()}>
          {busy && <Spinner />} 📣 Broadcast to all players
        </button>
      </div>
      {preview && <AnnouncementCard a={{ category, title, text }} preview onDismiss={() => setPreview(false)} />}
      <details>
        <summary className="cursor-pointer text-marble-300">History ({history.length})</summary>
        <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
          {history.map((a) => (
            <li key={a.id} className="rounded border border-ink-700 px-2 py-1">
              <span style={{ color: CATEGORY_STYLE[a.category].color }}>{CATEGORY_STYLE[a.category].icon}</span> <b className="text-marble-50">{a.title}</b>
              <span className="text-marble-500"> · {phaseName(a.phase, a.day)}</span>
              {a.text && <div className="text-marble-300">{a.text}</div>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export type { ReactNode };
