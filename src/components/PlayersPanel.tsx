/**
 * GM interface (online mode): profiles, passwords, active devices, characters and campaign
 * backups. Passwords are sent once to the server, hashed there (Argon2id) and never shown again.
 * All changes are validated again on the server.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { needsRosterUpdate } from '../game/roster';
import type { GameState } from '../game/types';
import type { AdminOverview, ProfileInfo } from '../server/protocol';
import type { OnlineControls } from '../state/gameApi';
import { Section, Segmented } from './ui';

interface Props {
  state: GameState;
  online: OnlineControls;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

type Tab = 'profiles' | 'backups';

export function PlayersPanel({ state, online, notify }: Props) {
  const [tab, setTab] = useState<Tab>('profiles');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [busy, setBusy] = useState(false);

  // `online.admin` has a stable identity (useOnlineGame), and the effect below depends only on it.
  // Background refreshes never toggle any busy flag – they only replace `data` (no re-render loop).
  const admin = online.admin;
  const loading = useRef(false);
  const loadOverview = useCallback(async () => {
    if (loading.current) return; // single-flight
    loading.current = true;
    try {
      setData(await admin({ action: 'overview' }));
    } catch {
      /* the connection indicator reports server problems */
    } finally {
      loading.current = false;
    }
  }, [admin]);

  const act = useCallback(
    async (action: Record<string, unknown>, success?: string) => {
      if (busy) return false;
      setBusy(true);
      try {
        setData(await admin(action));
        if (success) notify(success, 'info');
        return true;
      } catch (e) {
        notify((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [admin, notify, busy],
  );

  useEffect(() => {
    void loadOverview();
    // Presence indicators: refresh every 30 s while the tab is visible (one request at a time).
    const id = setInterval(() => document.visibilityState === 'visible' && void loadOverview(), 30_000);
    return () => clearInterval(id);
  }, [loadOverview]);

  const players = Object.values(state.tokens).filter((t) => t.kind === 'player');

  return (
    <Section
      title="Players & Access"
      right={
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'profiles', label: 'Profiles' },
            { value: 'backups', label: 'Backups' },
          ]}
        />
      }
    >
      {!data ? (
        <p className="text-xs text-marble-500">Loading…</p>
      ) : tab === 'profiles' ? (
        <div className="space-y-2" aria-busy={busy}>
          {needsRosterUpdate(state) && (
            <div role="alert" className="rounded-lg border border-amber-400/50 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              This arena still uses the old placeholder characters (Livia, Marcus, Nyx, Cassius).
              <button
                className="btn btn-ghost mt-1.5 w-full"
                onClick={async () => {
                  if (!confirm('Rename Livia→Sinna, Marcus→Aster, Nyx→Elwin, Cassius→Javi? Positions, knowledge and items are kept. A backup is created first.')) return;
                  const r = await online.worldAction({ action: 'applyRoster' });
                  notify(r.ok ? 'Characters converted.' : (r.error ?? 'Conversion failed.'), r.ok ? 'info' : 'error');
                  void loadOverview();
                }}
              >
                Convert old characters
              </button>
            </div>
          )}
          {data.profiles.map((p) => (
            <ProfileRow
              key={p.key}
              p={p}
              self={p.key === 'gm'}
              players={players}
              missing={p.tokenIds.filter((t) => !state.tokens[t])}
              act={act}
            />
          ))}
          <p className="text-[11px] leading-relaxed text-marble-500">
            Each profile signs in with its own password – no email needed. Setting or resetting a password signs that profile out on all devices.
            Profiles without a password stay locked. Passwords are stored only as secure hashes; nobody (not even you) can read them later.
          </p>
        </div>
      ) : (
        <div className="space-y-2" aria-busy={busy}>
          <button className="btn btn-ghost w-full" onClick={() => act({ action: 'createSnapshot', label: `Manual backup (${new Date().toLocaleString('en-GB')})` }, 'Backup created.')}>
            ⛁ Create backup now
          </button>
          <p className="text-[11px] text-marble-500">A backup is also created automatically at every dawn and before a new arena, import or restore.</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {data.snapshots.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-marble-100" title={s.label}>
                  {s.label}
                </span>
                <span className="text-[10px] text-marble-500">{new Date(s.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <button
                  className="btn btn-ghost px-2 py-0.5"
                  onClick={async () => {
                    if (!confirm(`Restore "${s.label}"? The current state is backed up first.`)) return;
                    const r = await online.worldAction({ action: 'restoreSnapshot', id: s.id });
                    notify(r.ok ? 'Backup restored.' : (r.error ?? 'Restore failed.'), r.ok ? 'info' : 'error');
                    void loadOverview();
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
            {!data.snapshots.length && <li className="text-xs text-marble-500">No backups yet.</li>}
          </ul>
        </div>
      )}
    </Section>
  );
}

function ProfileRow({
  p,
  self,
  players,
  missing,
  act,
}: {
  p: ProfileInfo;
  self: boolean;
  players: GameState['tokens'][string][];
  missing: string[];
  act: (action: Record<string, unknown>, success?: string) => Promise<boolean>;
}) {
  const [pw, setPw] = useState('');
  const [open, setOpen] = useState(false);
  const gm = p.role === 'gm';
  const status = !p.passwordSet ? 'Locked – no password' : !p.active ? 'Deactivated' : p.online ? 'Online' : p.sessions ? `Signed in on ${p.sessions} device${p.sessions > 1 ? 's' : ''}` : 'Active';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await act({ action: 'setPassword', profile: p.key, password: pw }, `${p.displayName}: password ${p.passwordSet ? 'reset' : 'set'}. Tell ${gm ? 'yourself' : p.displayName} the new password in person.`)) {
      setPw('');
      setOpen(false);
    }
  };
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800/60 p-2 text-xs" data-profile={p.key}>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${p.online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.8)]' : p.active && p.passwordSet ? 'bg-gold-400/70' : 'bg-ink-500'}`}
          aria-hidden="true"
        />
        <span className="font-display text-sm font-bold text-marble-50">{p.displayName}</span>
        <span className="text-marble-500">{gm ? 'Game Master' : p.characterName}</span>
        <span className={`ml-auto chip ${!p.passwordSet || !p.active ? 'text-amber-200' : p.online ? 'text-emerald-300' : 'text-marble-300'}`}>{status}</span>
      </div>
      {p.passwordUpdatedAt && <div className="mt-1 text-[11px] text-marble-500">Password set {timeAgo(p.passwordUpdatedAt)}</div>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button className="btn btn-ghost px-2 py-0.5" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          🔑 {p.passwordSet ? 'Reset password' : 'Set password'}
        </button>
        {!self && p.passwordSet && (
          <button
            className="btn btn-ghost px-2 py-0.5"
            onClick={() => act({ action: 'setActive', profile: p.key, active: !p.active }, `${p.displayName} ${p.active ? 'deactivated – signed out everywhere' : 'activated'}.`)}
          >
            {p.active ? 'Deactivate' : 'Activate'}
          </button>
        )}
        {p.sessions > 0 && (
          <button
            className="btn btn-ghost px-2 py-0.5"
            onClick={() => confirm(`Sign ${p.displayName} out on all devices?`) && act({ action: 'revokeSessions', profile: p.key }, `${p.displayName} signed out everywhere.`)}
          >
            Sign out devices
          </button>
        )}
        {!self && p.passwordSet && (
          <button
            className="btn btn-ghost px-2 py-0.5 hover:border-blood-400/70"
            onClick={() => confirm(`Remove ${p.displayName}'s password? The profile is locked until you set a new one.`) && act({ action: 'clearPassword', profile: p.key }, `${p.displayName} locked.`)}
          >
            Remove password
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            autoComplete="new-password"
            spellCheck={false}
            minLength={8}
            required
            placeholder="New password (min. 8 characters)"
            aria-label={`New password for ${p.displayName}`}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-xs"
          />
          <button type="submit" className="btn btn-gold px-3 py-1" disabled={pw.length < 8}>
            Save
          </button>
        </form>
      )}
      {!gm && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-marble-500">Character</span>
          <select
            aria-label={`Character of ${p.displayName}`}
            className="flex-1 rounded-md border border-ink-600 bg-ink-800 px-2 py-1"
            value={p.tokenIds[0] ?? ''}
            onChange={(e) =>
              void act({ action: 'setProfileCharacters', profile: p.key, tokenIds: e.target.value ? [e.target.value] : [] }, `${p.displayName}: character updated.`)
            }
          >
            <option value="">— none —</option>
            {players.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {missing.length > 0 && <div className="mt-1 text-[11px] text-amber-300">Character “{missing.join(', ')}” does not exist in the current arena.</div>}
    </div>
  );
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString('en-GB');
}
