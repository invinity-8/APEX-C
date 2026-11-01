import { useId, useRef, useState, type FormEvent } from 'react';
import type { GameApi } from '../state/gameApi';
import { downloadState } from '../state/storage';
import { safeRadius } from '../game/zone';
import { phaseName } from '../game/text';
import { ApexEmblem, Spinner } from './brand';
import { Segmented } from './ui';

interface Props {
  game: GameApi;
  onAdvancePhase: () => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

export function Header({ game, onAdvancePhase, notify }: Props) {
  const { view, gmState, demo, online } = game;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const isGm = view.role === 'gm';
  const night = view.phase === 'night';
  const next = night ? phaseName('day', view.day + 1) : phaseName('night', view.day);

  let shrinkText: string;
  if (!view.shrink.enabled) shrinkText = 'Arena stable';
  else if (gmState) {
    const safe = safeRadius(gmState.config, view.day);
    shrinkText = safe < gmState.config.mapRadius ? `☠ Safe within ring ${safe}` : `Shrinking begins on Day ${view.shrink.startDay}`;
  } else shrinkText = view.day >= view.shrink.startDay ? '☠ The arena is contracting' : `Shrinking begins on Day ${view.shrink.startDay}`;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold-700/40 bg-ink-900/85 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <ApexEmblem className="h-9 w-9 drop-shadow-[0_0_8px_rgba(212,166,74,.45)]" />
        <div className="leading-tight">
          <div className="font-display text-xl font-black tracking-[0.3em] text-gold-300">APEX</div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-marble-500">{online ? online.campaignName : 'Arena of the Eternal Will'}</div>
        </div>
      </div>

      {/* Time of day */}
      <div
        className={`flex items-center gap-3 rounded-xl border px-3 py-1.5 transition-colors duration-700 ${
          night ? 'border-arcane-500/50 bg-[#141433]' : 'border-gold-700/50 bg-ink-850'
        }`}
        aria-live="polite"
      >
        <span className="text-2xl" aria-hidden="true">
          {night ? '🌙' : '☀'}
        </span>
        <div className="leading-none">
          <div className="text-[9px] uppercase tracking-[0.2em] text-marble-500">Current phase</div>
          <div className={`font-display text-lg font-bold tabular-nums ${night ? 'text-arcane-300' : 'text-gold-200'}`}>{phaseName(view.phase, view.day)}</div>
        </div>
        <div className="h-8 w-px bg-ink-600" />
        <div className="text-[11px] leading-tight text-marble-300" title="Shrinking arena">
          <span className={shrinkText.startsWith('☠') ? 'text-blood-400' : ''}>{shrinkText}</span>
          <div className="hidden text-marble-500 xl:block">{night ? 'Night: vision reduced' : 'Movement restored at dawn'}</div>
        </div>
      </div>

      {isGm ? (
        <button
          className="btn btn-gold px-4 py-2 text-sm"
          onClick={onAdvancePhase}
          disabled={game.busy}
          title={night ? 'Dawn: restores movement points, processes events and the shrinking arena' : 'Nightfall: vision is reduced until dawn'}
        >
          {night ? '☀' : '🌙'} Begin {next}
        </button>
      ) : (
        <span className="chip text-marble-300" title="Only the Game Master advances time">
          ⏳ The Game Master controls time
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {game.busy && (
          <span className="text-gold-300" title="Sending to the server…">
            <Spinner />
          </span>
        )}

        {demo && (
          <div className="flex items-center gap-2 rounded-xl border border-arcane-500/40 bg-ink-850 px-2 py-1">
            <span
              className="chip border-arcane-500/50 text-arcane-300"
              title="Demo mode: everything is stored only in this browser. No protection of secret data – the online mode is the secure multiplayer version."
            >
              DEMO · local
            </span>
            <Segmented
              size="md"
              value={demo.session.role}
              onChange={(role) => demo.setSession({ ...demo.session, role })}
              options={[
                { value: 'gm', label: '👁 Game Master', hint: 'Sees everything' },
                { value: 'player', label: '🛡 Player', hint: 'Sees only discovered information' },
              ]}
            />
            {demo.session.role === 'player' && (
              <select
                aria-label="Player perspective"
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-marble-50"
                value={demo.session.viewerId}
                onChange={(e) => demo.setSession({ ...demo.session, viewerId: e.target.value })}
              >
                {demo.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    as {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {online && (
          <div className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-850 px-2 py-1">
            <ConnectionDot state={online.connection} lastSync={online.lastSync} onClick={online.refresh} />
            <span className="chip text-marble-300">{isGm ? '👁 Game Master' : '🛡 Player'}</span>
            {!isGm && online.characters.length > 1 && (
              <select
                aria-label="Active character"
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-marble-50"
                value={online.activeCharacter ?? ''}
                onChange={(e) => online.setActiveCharacter(e.target.value)}
              >
                {online.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <span className="hidden max-w-40 truncate text-[11px] text-marble-300 lg:inline" title="Signed-in profile">
              {online.profileName}
            </span>
            <button className="btn btn-ghost px-2" onClick={() => setPwOpen(true)} title="Change your password" aria-label="Change your password">
              🔑
            </button>
            <button className="btn btn-ghost" onClick={online.signOut}>
              Sign out
            </button>
          </div>
        )}

        {demo && (
          <span className="text-[11px] text-marble-500" title="The save is stored automatically in this browser">
            {demo.savedAt ? `✓ saved ${demo.savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '…'}
          </span>
        )}

        {gmState && (
          <>
            <button className="btn btn-ghost" onClick={() => downloadState(gmState)} title="Download the campaign as a JSON backup">
              ⤓<span className="hidden 2xl:inline"> Export</span>
            </button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Replace the campaign with a JSON save">
              ⤒<span className="hidden 2xl:inline"> Import</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (online && !confirm('Replace the shared campaign with this file? A backup snapshot of the current state is created first.')) return;
                const res = await game.importState(await file.text());
                notify(res.ok ? 'Save imported.' : `Import failed: ${res.error}`, res.ok ? 'info' : 'error');
              }}
            />
          </>
        )}

        {demo && (
          <button
            className="btn btn-ghost hover:border-blood-400/70"
            onClick={() => {
              if (confirm('Reset the demo save? Current progress will be lost (export first if needed).')) {
                demo.reset();
                notify('Demo reset – Day 1.', 'info');
              }
            }}
            title="Reset the demo save"
          >
            ↺<span className="hidden 2xl:inline"> Reset</span>
          </button>
        )}
      </div>
      {pwOpen && online && (
        <ChangePasswordDialog
          onClose={() => setPwOpen(false)}
          onSubmit={async (current, next) => {
            const r = await online.changePassword(current, next);
            if (r.ok) {
              notify('Password changed. Your other devices have been signed out.', 'info');
              setPwOpen(false);
            }
            return r;
          }}
        />
      )}
    </header>
  );
}

function ChangePasswordDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (current: string, next: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return setError('The new passwords do not match.');
    setBusy(true);
    const r = await onSubmit(current, next);
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'The password could not be changed.');
  };
  const field = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="block text-xs text-marble-300">
      {label}
      <input
        type="password"
        required
        autoComplete={auto}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-marble-50 focus:border-gold-400 focus:outline-none"
      />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-3 p-5">
        <h2 id={id} className="font-display text-lg font-bold text-gold-200">
          Change your password
        </h2>
        {field('Current password', current, setCurrent, 'current-password')}
        {field('New password (at least 8 characters)', next, setNext, 'new-password')}
        {field('Repeat the new password', repeat, setRepeat, 'new-password')}
        {error && (
          <p role="alert" className="text-xs text-blood-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-gold" disabled={busy}>
            {busy && <Spinner />} Change password
          </button>
        </div>
      </form>
    </div>
  );
}

function ConnectionDot({ state, lastSync, onClick }: { state: 'live' | 'degraded' | 'connecting' | 'offline'; lastSync: Date | null; onClick: () => void }) {
  const label = state === 'live' ? 'Live' : state === 'degraded' ? 'Synced (polling)' : state === 'connecting' ? 'Connecting…' : 'Offline – retrying';
  const color = state === 'live' ? 'bg-emerald-400' : state === 'degraded' || state === 'connecting' ? 'bg-amber-300' : 'bg-blood-400';
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-marble-300 hover:bg-ink-700"
      title={`${label}${lastSync ? ` · last update ${lastSync.toLocaleTimeString('en-GB')}` : ''} – click to refresh`}
    >
      <span className={`h-2 w-2 rounded-full ${color} ${state === 'live' ? 'shadow-[0_0_6px_rgba(52,211,153,.8)]' : ''}`} />
      {label}
    </button>
  );
}
