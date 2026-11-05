/**
 * Feedback (APEX 0.7): Report Bug · Request Feature · Suggest Improvement – for players and the GM.
 *
 * Sends only what the reporter typed plus app version, UI area and (optionally) a screenshot they chose. Never
 * passwords, tokens, character records or the campaign state. Players see the status of their own reports; the
 * GM's inbox lists every report with filters, search, status changes, notes, sharing and CSV/JSON export.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { APP_VERSION } from '../build/version';
import type { FeedbackKind, FeedbackRow, FeedbackStatus } from '../server/repo';
import type { OnlineControls } from '../state/gameApi';

const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
export const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Report Bug', feature: 'Request Feature', improvement: 'Suggest Improvement' };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: 'New', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved', rejected: 'Not planned' };
const STATUS_TONE: Record<FeedbackStatus, string> = {
  new: 'border-gold-400/60 text-gold-200',
  acknowledged: 'border-arcane-400/60 text-arcane-300',
  in_progress: 'border-amber-400/60 text-amber-200',
  resolved: 'border-emerald-500/60 text-emerald-300',
  rejected: 'border-ink-500 text-marble-500',
};
const CATEGORIES = ['Map & movement', 'Character sheet', 'Inventory & items', 'Equipment', 'Loot & economy', 'Workspace & layout', 'Login & accounts', 'Performance', 'Other'];
const AREAS = ['Map', 'Character', 'Inventory', 'Arsenal', 'Feedback', 'Welcome / login', 'Other'];
const MAX_SHOT = 1_500_000;
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

function StatusChip({ s }: { s: FeedbackStatus }) {
  return (
    <span className={`chip whitespace-nowrap ${STATUS_TONE[s]}`} data-status={s}>
      {STATUS_LABEL[s]}
    </span>
  );
}

/** Header button + dialog: new report and "My reports". */
export function FeedbackButton({ online, area, notify }: { online: OnlineControls; area: string; notify: (m: string, k?: 'error' | 'info') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-ghost px-2" onClick={() => setOpen(true)} title="Report a bug or suggest a feature" aria-label="Feedback">
        💬<span className="hidden xl:inline"> Feedback</span>
      </button>
      {open && <FeedbackDialog online={online} area={area} notify={notify} onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({ online, area, notify, onClose }: { online: OnlineControls; area: string; notify: (m: string, k?: 'error' | 'info') => void; onClose?: () => void }) {
  const sizeRef = useResizePersist('apex.feedback.size');
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [page, setPage] = useState(AREAS.includes(area) ? area : 'Other');
  const [shot, setShot] = useState<{ name: string; data: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<FeedbackRow[] | null>(null);
  useEffect(() => {
    if (tab === 'mine' && mine === null) void online.feedbackList().then(setMine, (e: Error) => setError(e.message));
  }, [tab, mine, online]);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return setShot(null);
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError('Screenshots must be PNG, JPG or WebP pictures.');
    if (f.size > MAX_SHOT) return setError('The screenshot is too large (max. 1.5 MB).');
    const r = new FileReader();
    r.onload = () => setShot({ name: f.name, data: String(r.result) });
    r.readAsDataURL(f);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Please enter a short title.');
    setBusy(true);
    setError(null);
    try {
      await online.feedback({ action: 'submit', kind, category, title: title.trim(), description, steps, page, appVersion: APP_VERSION, ...(shot ? { screenshot: shot.data } : {}) });
      notify('Thank you – your report was sent to the Game Master.', 'info');
      setTitle('');
      setDescription('');
      setSteps('');
      setShot(null);
      setMine(null);
      setTab('mine');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Rendered into <body> – the header (backdrop-filter) would otherwise trap `position: fixed` and squeeze
  // the dialog into a thin strip above the map.
  const node = (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-8" role="dialog" aria-modal aria-label="Feedback">
      {/* APEX 0.7: the dialog can be resized (handle bottom-right); the size is remembered on this device */}
      <div ref={sizeRef} className="panel apex-resizable space-y-3 p-4 text-sm" data-testid="feedback-panel">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-display text-xl font-bold text-gold-200">Feedback</h2>
          {onClose && <button className="btn btn-ghost" onClick={onClose} aria-label="Close feedback">
            ✕
          </button>}
        </div>
        <div className="flex gap-1 text-xs" role="tablist">
          <button role="tab" aria-selected={tab === 'new'} className={`rounded-lg px-3 py-1 ${tab === 'new' ? 'bg-gold-400/20 text-gold-200' : 'text-marble-300'}`} onClick={() => setTab('new')}>
            New report
          </button>
          <button role="tab" aria-selected={tab === 'mine'} className={`rounded-lg px-3 py-1 ${tab === 'mine' ? 'bg-gold-400/20 text-gold-200' : 'text-marble-300'}`} onClick={() => setTab('mine')}>
            My reports
          </button>
        </div>
        {tab === 'new' ? (
          <form className="space-y-2 text-xs text-marble-300" onSubmit={submit}>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Type">
              {(Object.keys(KIND_LABEL) as FeedbackKind[]).map((k) => (
                <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-md border px-2 py-1 ${kind === k ? 'border-gold-400 text-gold-100' : 'border-ink-600 text-marble-300'}`}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <label className="block">
              Title
              <input className={input} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} aria-label="Feedback title" required />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                Category
                <select className={input} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Where in APEX?
                <select className={input} value={page} onChange={(e) => setPage(e.target.value)} aria-label="UI area">
                  {AREAS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              Description
              <textarea className={`${input} min-h-24`} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
            </label>
            {kind === 'bug' && (
              <label className="block">
                Steps to reproduce (optional)
                <textarea className={`${input} min-h-16`} value={steps} maxLength={3000} onChange={(e) => setSteps(e.target.value)} aria-label="Steps to reproduce" placeholder={'1. Open …\n2. Click …\n3. …'} />
              </label>
            )}
            <label className="block">
              Screenshot (optional, PNG/JPG/WebP, max. 1.5 MB)
              <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block text-[11px]" onChange={(e) => pick(e.target.files?.[0])} aria-label="Screenshot" />
            </label>
            {shot && <p className="text-marble-400">Attached: {shot.name}</p>}
            <p className="text-[11px] text-marble-500">Sent with your report: app version {APP_VERSION}, the area above and the time. Never passwords, sessions or character data.</p>
            {error && (
              <p role="alert" className="rounded-md border border-blood-400/50 bg-blood-600/20 p-2 text-red-200">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => onClose?.()}>
                Cancel
              </button>
              <button type="submit" className="btn btn-gold" disabled={busy || !title.trim()}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-2 text-xs" aria-label="My reports">
            {error && <p className="text-red-200">{error}</p>}
            {mine === null ? (
              <p className="text-marble-500">Loading…</p>
            ) : !mine.length ? (
              <p className="text-marble-500">No reports yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {mine.map((f) => (
                  <li key={f.id} className="rounded-md border border-ink-600 p-2" data-feedback={f.id}>
                    <div className="flex items-center gap-2">
                      <b className="flex-1 text-marble-50">{f.title}</b>
                      <StatusChip s={f.status} />
                    </div>
                    <p className="text-marble-500">
                      {KIND_LABEL[f.kind]} · {fmt(f.createdAt)}
                      {f.shared && f.profileKey === '' ? ' · shared by the GM' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

// ---------------------------------------------------------------- GM inbox

export function toCsv(rows: FeedbackRow[]): string {
  const cols: Array<keyof FeedbackRow> = ['createdAt', 'kind', 'category', 'status', 'title', 'description', 'steps', 'page', 'appVersion', 'profileKey', 'tokenId', 'gmNotes', 'shared', 'statusChangedAt'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // neutralise spreadsheet formulas and quote everything
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FeedbackInbox({ online, notify }: { online: OnlineControls; notify: (m: string, k?: 'error' | 'info') => void }) {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [kind, setKind] = useState<FeedbackKind | 'all'>('all');
  const [status, setStatus] = useState<FeedbackStatus | 'open' | 'all'>('open');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => online.feedbackList().then(setRows, (e: Error) => notify(e.message)), [online, notify]);
  useEffect(() => {
    void load();
  }, [load]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (kind === 'all' || r.kind === kind) &&
        (status === 'all' || (status === 'open' ? r.status !== 'resolved' && r.status !== 'rejected' : r.status === status)) &&
        (!n || `${r.title} ${r.description} ${r.steps} ${r.category} ${r.profileKey}`.toLowerCase().includes(n)),
    );
  }, [rows, kind, status, q]);
  const update = async (id: string, patch: Partial<Pick<FeedbackRow, 'status' | 'gmNotes' | 'shared'>>) => {
    try {
      const r = await online.feedback<{ feedback: FeedbackRow }>({ action: 'update', id, ...patch });
      setRows((rs) => (rs ?? []).map((x) => (x.id === id ? r.feedback : x)));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const showShot = async (id: string) => {
    try {
      const r = await online.feedback<{ url: string | null }>({ action: 'screenshot', id });
      if (r.url) window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const counts = (rows ?? []).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3" aria-label="Feedback inbox">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-display text-2xl font-black text-gold-200">Feedback inbox</h2>
        <button className="btn btn-ghost" onClick={() => void load()}>
          ↻ Refresh
        </button>
        <button className="btn btn-ghost" disabled={!list.length} onClick={() => download(`apex-feedback-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list), 'text/csv;charset=utf-8')}>
          ⤓ CSV
        </button>
        <button className="btn btn-ghost" disabled={!list.length} onClick={() => download(`apex-feedback-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(list, null, 2), 'application/json')}>
          ⤓ JSON
        </button>
      </div>
      <div className="panel flex flex-wrap items-end gap-2 p-3 text-xs text-marble-300">
        <label className="min-w-[12rem] flex-1">
          Search
          <input className={input} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search feedback" />
        </label>
        <label>
          Type
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind | 'all')} aria-label="Filter type">
            <option value="all">All types</option>
            {(Object.keys(KIND_LABEL) as FeedbackKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | 'open' | 'all')} aria-label="Filter status">
            <option value="open">Open (not resolved / rejected)</option>
            <option value="all">All</option>
            {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]} ({counts[s] ?? 0})
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows === null ? (
        <p className="text-sm text-marble-500">Loading…</p>
      ) : !list.length ? (
        <p className="text-sm text-marble-500">No reports match.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="panel p-3 text-xs" data-feedback={r.id}>
              <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                <StatusChip s={r.status} />
                <b className="min-w-0 flex-1 text-sm text-marble-50">{r.title}</b>
                <span className="text-marble-400">
                  {KIND_LABEL[r.kind]} · {r.category} · {r.profileKey || 'unknown'} · {fmt(r.createdAt)}
                </span>
              </button>
              {openId === r.id && <InboxDetail r={r} onUpdate={(p) => void update(r.id, p)} onShot={() => void showShot(r.id)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxDetail({ r, onUpdate, onShot }: { r: FeedbackRow; onUpdate: (p: Partial<Pick<FeedbackRow, 'status' | 'gmNotes' | 'shared'>>) => void; onShot: () => void }) {
  const [notes, setNotes] = useState(r.gmNotes);
  return (
    <div className="mt-2 space-y-2 border-t border-ink-700 pt-2 text-marble-200">
      {r.description && <p className="whitespace-pre-line">{r.description}</p>}
      {r.steps && (
        <div>
          <b className="text-marble-400">Steps to reproduce</b>
          <p className="whitespace-pre-line">{r.steps}</p>
        </div>
      )}
      <p className="text-marble-500">
        Area: {r.page || '—'} · App {r.appVersion || '—'}
        {r.tokenId ? ` · character ${r.tokenId}` : ''}
        {r.statusChangedAt ? ` · status changed ${fmt(r.statusChangedAt)}` : ''}
      </p>
      {r.screenshotPath && (
        <button className="btn btn-ghost px-2 py-0.5" onClick={onShot}>
          View screenshot
        </button>
      )}
      <div className="flex flex-wrap gap-1">
        {(['acknowledged', 'in_progress', 'resolved', 'rejected'] as FeedbackStatus[]).map((s) => (
          <button key={s} className={`btn px-2 py-0.5 ${r.status === s ? 'btn-gold' : 'btn-ghost'}`} onClick={() => onUpdate({ status: s })} aria-pressed={r.status === s}>
            {s === 'acknowledged' ? 'Acknowledge' : s === 'in_progress' ? 'Mark In Progress' : s === 'resolved' ? 'Mark Resolved' : 'Reject / Not Planned'}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-marble-300">
          <input type="checkbox" checked={r.shared} onChange={(e) => onUpdate({ shared: e.target.checked })} />
          Share with all players
        </label>
      </div>
      <label className="block text-marble-300">
        GM notes (private)
        <textarea className={`${input} min-h-14`} value={notes} maxLength={3000} onChange={(e) => setNotes(e.target.value)} aria-label="GM notes" />
      </label>
      <div className="flex justify-end">
        <button className="btn btn-ghost px-2 py-0.5" disabled={notes === r.gmNotes} onClick={() => onUpdate({ gmNotes: notes })}>
          Save notes
        </button>
      </div>
    </div>
  );
}

/** Remembers the user-resized size of an element (local only, debounced by the ResizeObserver). */
function useResizePersist(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { w: number; h: number } | null;
      if (saved && saved.w > 0 && saved.h > 0) {
        el.style.width = `${Math.min(saved.w, window.innerWidth - 24)}px`;
        el.style.height = `${Math.min(saved.h, window.innerHeight - 24)}px`;
      }
    } catch {
      /* not remembered */
    }
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify({ w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) }));
        } catch {
          /* ignore */
        }
      }, 300);
    });
    ro.observe(el);
    return () => (ro.disconnect(), clearTimeout(t));
  }, [key]);
  return ref;
}
