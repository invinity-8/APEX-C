/**
 * GM World Management (online): Archive World, Create New World, Reset Current World,
 * Restore Archived World. Every action is checked on the server, applied at most once
 * (request id) and switches worlds in one database transaction – the previous world stays
 * usable if anything fails.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MAX_RADIUS, MIN_RADIUS } from '../data/demo';
import { hexCount } from '../game/hex';
import { phaseName } from '../game/text';
import type { GameState } from '../game/types';
import type { ArchiveInfo } from '../server/repo';
import type { OnlineControls } from '../state/gameApi';
import { Spinner } from './brand';
import { Section } from './ui';

interface Props {
  state: GameState;
  online: OnlineControls;
  notify: (msg: string, kind?: 'error' | 'info') => void;
  pending: boolean;
}

type Dialog = { kind: 'archive' } | { kind: 'create' } | { kind: 'reset' } | { kind: 'restore'; archive: ArchiveInfo } | null;

const KIND_LABEL: Record<ArchiveInfo['kind'], string> = {
  manual: 'Archived by the GM',
  'before-create': 'Automatic – before a new world',
  'before-reset': 'Automatic – before a reset',
  'before-restore': 'Automatic – before a restore',
};
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const input = 'mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';

export function WorldPanel({ state, online, notify, pending }: Props) {
  const [archives, setArchives] = useState<ArchiveInfo[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const admin = online.admin as unknown as (a: Record<string, unknown>) => Promise<{ archives: ArchiveInfo[] }>;
  const loading = useRef(false);

  const loadArchives = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setArchives((await admin({ action: 'listArchives' })).archives);
    } catch {
      /* shown by the connection indicator */
    } finally {
      loading.current = false;
    }
  }, [admin]);
  useEffect(() => {
    void loadArchives();
  }, [loadArchives, state.world?.id]);

  const runWorld = async (action: Record<string, unknown>, success: string) => {
    setBusy(true);
    const r = await online.worldAction(action);
    setBusy(false);
    if (r.ok) {
      notify(success, 'info');
      setDialog(null);
      void loadArchives();
    } else notify(r.error ?? 'The action failed.');
    return r.ok;
  };

  const world = state.world;
  return (
    <Section title="World Management">
      <div className="space-y-2 text-xs text-marble-300">
        <div className="rounded-lg border border-gold-700/40 bg-ink-900/60 p-2">
          <div className="font-display text-sm font-bold text-gold-200">{world?.name ?? 'Unnamed world'}</div>
          <div>
            Radius {state.config.mapRadius} · seed {state.config.seed} · {phaseName(state.phase, state.day)} · version {online.version}
          </div>
          {world?.createdAt && <div className="text-marble-500">created {fmtDate(world.createdAt)}</div>}
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <button className="btn btn-ghost" disabled={pending || busy} onClick={() => setDialog({ kind: 'archive' })}>
            ⛁ Archive World
          </button>
          <button className="btn btn-ghost" disabled={pending || busy} onClick={() => setDialog({ kind: 'create' })}>
            ✦ Create New World
          </button>
          <button className="btn btn-ghost hover:border-blood-400/70" disabled={pending || busy} onClick={() => setDialog({ kind: 'reset' })}>
            ↺ Reset Current World
          </button>
        </div>
        <div>
          <div className="label mb-1">Archived worlds</div>
          {!archives ? (
            <p className="text-marble-500">Loading…</p>
          ) : !archives.length ? (
            <p className="text-marble-500">No archived worlds yet.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Archived worlds">
              {archives.map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-md border border-ink-700 bg-ink-850/60 p-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-marble-50" title={a.name}>
                      {a.name}
                    </div>
                    <div className="text-[10px] text-marble-500">
                      {fmtDate(a.createdAt)} · {KIND_LABEL[a.kind]}
                      {a.day ? ` · ${phaseName(a.phase === 'night' ? 'night' : 'day', a.day)}` : ''}
                      {a.radius ? ` · radius ${a.radius}` : ''}
                    </div>
                    {a.description && <div className="text-[11px] text-marble-300">{a.description}</div>}
                  </div>
                  <button className="btn btn-ghost px-2 py-0.5" disabled={pending || busy} onClick={() => setDialog({ kind: 'restore', archive: a })}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-marble-500">
          Worlds hold the map, positions, Fog of War, day/night, shrinking and events. Accounts, passwords, profiles, character assignments,
          character sheets and inventories belong to the characters and are kept.
        </p>
      </div>

      {dialog?.kind === 'archive' && <ArchiveDialog busy={busy} defaultName={`${world?.name ?? 'World'} – ${phaseName(state.phase, state.day)}`} onClose={() => setDialog(null)} onSubmit={(name, description) => runWorld({ action: 'archiveWorld', name, description }, 'World archived – the archive is saved in the database.')} />}
      {(dialog?.kind === 'create' || dialog?.kind === 'reset') && (
        <NewWorldDialog
          reset={dialog.kind === 'reset'}
          busy={busy}
          state={state}
          onClose={() => setDialog(null)}
          onSubmit={(o) =>
            runWorld(
              dialog.kind === 'reset' ? { action: 'resetWorld', confirm: 'RESET', radius: o.radius, seed: o.seed } : { action: 'createWorld', ...o },
              dialog.kind === 'reset' ? 'World reset. The previous world was archived; all players are switched automatically.' : `New world “${o.name}” is active. The previous world was archived.`,
            )
          }
        />
      )}
      {dialog?.kind === 'restore' && (
        <RestoreDialog
          archive={dialog.archive}
          busy={busy}
          currentName={world?.name ?? 'current world'}
          onClose={() => setDialog(null)}
          onSubmit={(inventory) => runWorld({ action: 'restoreArchive', archiveId: dialog.archive.id, inventory }, `“${dialog.archive.name}” restored. The previous world was archived first.`)}
        />
      )}
    </Section>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const id = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="panel w-full max-w-lg space-y-3 p-5 text-sm text-marble-300">
        <h2 id={id} className="font-display text-lg font-bold text-gold-200">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function Changes() {
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="rounded-lg border border-blood-400/40 bg-blood-600/10 p-2">
        <div className="mb-1 font-semibold text-red-200">Replaced (new world)</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Map, terrain and seed</li>
          <li>Character positions, movement points left</li>
          <li>Explored terrain / Fog of War, sightings</li>
          <li>Day/night, shrinking, events, log</li>
        </ul>
      </div>
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2">
        <div className="mb-1 font-semibold text-emerald-200">Kept</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Accounts, passwords, profiles, GM rights</li>
          <li>Player ↔ character assignments</li>
          <li>Character sheets and inventories</li>
          <li>Character names, traits, maximum Will</li>
        </ul>
      </div>
    </div>
  );
}

function ArchiveDialog({ busy, defaultName, onClose, onSubmit }: { busy: boolean; defaultName: string; onClose: () => void; onSubmit: (name: string, description: string) => void }) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  return (
    <Modal title="Archive World" onClose={onClose}>
      <p>Saves a complete, restorable copy of the current world in the database. The world itself does not change.</p>
      <label className="block text-xs">
        Name
        <input className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-xs">
        Description (optional)
        <textarea className={`${input} min-h-16`} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-gold" onClick={() => onSubmit(name, description)} disabled={busy || !name.trim()}>
          {busy && <Spinner />} Archive World
        </button>
      </div>
    </Modal>
  );
}

function NewWorldDialog({
  reset,
  busy,
  state,
  onClose,
  onSubmit,
}: {
  reset: boolean;
  busy: boolean;
  state: GameState;
  onClose: () => void;
  onSubmit: (o: { name: string; radius: number; seed: number | null }) => void;
}) {
  const [name, setName] = useState(reset ? (state.world?.name ?? 'World') : '');
  const [radius, setRadius] = useState(state.config.mapRadius);
  const [seed, setSeed] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const seedNum = seed.trim() ? Number(seed) : null;
  const valid = (!seed.trim() || (Number.isInteger(seedNum) && seedNum !== 0)) && radius >= MIN_RADIUS && radius <= MAX_RADIUS && (reset ? confirmText === 'RESET' : !!name.trim());
  return (
    <Modal title={reset ? 'Reset Current World' : 'Create New World'} onClose={onClose}>
      <p>
        {reset
          ? 'Generates a fresh world in place of the current one. The current world is archived first and can be restored at any time.'
          : 'Generates a new world and makes it active. The current world is archived first and can be restored at any time.'}
      </p>
      <Changes />
      {!reset && (
        <label className="block text-xs">
          World name
          <input className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Drowned Arena" />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          Map radius ({MIN_RADIUS}–{MAX_RADIUS})
          <input className={input} type="number" min={MIN_RADIUS} max={MAX_RADIUS} value={radius} onChange={(e) => setRadius(Math.round(Number(e.target.value) || MIN_RADIUS))} />
          <span className="text-[10px] text-marble-500">{hexCount(Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius))).toLocaleString('en-US')} hexes
            {radius > 60 && ' · very large arena: slower first load on older phones'}
          </span>
        </label>
        <label className="block text-xs">
          Seed (optional)
          <input className={input} inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^\d-]/g, ''))} placeholder="random" />
        </label>
      </div>
      <p className="text-xs text-marble-400">Characters keep their sheet, inventory, equipment and currency.</p>
      {reset && (
        <label className="block text-xs">
          Type <b className="text-red-200">RESET</b> to confirm
          <input className={input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-gold" disabled={busy || !valid} onClick={() => onSubmit({ name: name.trim(), radius, seed: seedNum })}>
          {busy && <Spinner />} {reset ? 'Archive and reset' : 'Archive and create'}
        </button>
      </div>
    </Modal>
  );
}

function RestoreDialog({
  archive,
  busy,
  currentName,
  onClose,
  onSubmit,
}: {
  archive: ArchiveInfo;
  busy: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (inventory: 'keep-current' | 'use-archived') => void;
}) {
  const [inventory, setInventory] = useState<'keep-current' | 'use-archived'>('keep-current');
  return (
    <Modal title="Restore Archived World" onClose={onClose}>
      <div className="rounded-lg border border-gold-700/40 bg-ink-900/60 p-2 text-xs">
        <div className="font-semibold text-marble-50">{archive.name}</div>
        <div>
          archived {fmtDate(archive.createdAt)} · {KIND_LABEL[archive.kind]}
          {archive.radius ? ` · radius ${archive.radius}` : ''}
        </div>
      </div>
      <p className="text-xs">
        “{currentName}” is archived first. Then the map, positions, Fog of War, day/night and events of the archive become active and all
        players are switched automatically. Accounts, passwords and character sheets are not affected.
      </p>
      <fieldset className="space-y-1 text-xs">
        <legend className="mb-1 font-semibold text-marble-100">Inventories and Will</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="inv" checked={inventory === 'keep-current'} onChange={() => setInventory('keep-current')} />
          <span>
            <b className="text-marble-50">Keep current</b> (recommended) – characters keep what they carry now; maximum Will stays as it is now.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="inv" checked={inventory === 'use-archived'} onChange={() => setInventory('use-archived')} />
          <span>
            <b className="text-marble-50">Use archived</b> – inventories and Will return to the state saved in the archive.
          </span>
        </label>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-gold" disabled={busy} onClick={() => onSubmit(inventory)}>
          {busy && <Spinner />} Archive current and restore
        </button>
      </div>
    </Modal>
  );
}
