/**
 * GM interface (online mode): who may play, which account controls which character,
 * and campaign backups. All changes are validated again on the server.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { GameState } from '../game/types';
import type { AdminOverview } from '../server/protocol';
import type { OnlineControls } from '../state/gameApi';
import { Section, Segmented } from './ui';

interface Props {
  state: GameState;
  online: OnlineControls;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

type Tab = 'players' | 'characters' | 'backups';

export function PlayersPanel({ state, online, notify }: Props) {
  const [tab, setTab] = useState<Tab>('players');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (action: Record<string, unknown>, success?: string) => {
      setBusy(true);
      try {
        setData(await online.admin(action));
        if (success) notify(success, 'info');
        return true;
      } catch (e) {
        notify((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [online, notify],
  );

  useEffect(() => {
    void act({ action: 'overview' });
  }, [act]);

  const players = Object.values(state.tokens).filter((t) => t.kind === 'player');
  const owner = (tokenId: string) => data?.members.find((m) => m.tokenIds.includes(tokenId));

  return (
    <Section
      title="Players & Access"
      right={
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'players', label: 'Accounts' },
            { value: 'characters', label: 'Characters' },
            { value: 'backups', label: 'Backups' },
          ]}
        />
      }
    >
      {!data ? (
        <p className="text-xs text-marble-500">Loading…</p>
      ) : tab === 'players' ? (
        <div className="space-y-3" aria-busy={busy}>
          <ul className="space-y-1.5">
            {data.members.map((m) => (
              <li key={m.userId} className="rounded-lg border border-ink-600 bg-ink-800/60 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-marble-50" title={m.email}>
                    {m.email}
                  </span>
                  <Segmented
                    value={m.role}
                    onChange={(role) => act({ action: 'setRole', userId: m.userId, role }, `Role updated for ${m.email}.`)}
                    options={[
                      { value: 'player', label: 'Player' },
                      { value: 'gm', label: 'GM' },
                    ]}
                  />
                  <button
                    className="btn btn-ghost px-2 py-0.5 hover:border-blood-400/70"
                    title="Remove access"
                    aria-label={`Remove ${m.email}`}
                    onClick={() => confirm(`Remove ${m.email} from the campaign?`) && act({ action: 'removeMember', userId: m.userId }, 'Access removed.')}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-marble-500">
                  {m.tokenIds.length ? `Controls: ${m.tokenIds.map((id) => state.tokens[id]?.name ?? id).join(', ')}` : m.role === 'player' ? 'No character assigned' : 'Game Master'}
                </div>
              </li>
            ))}
          </ul>
          {data.invites.some((i) => !i.acceptedAt) && (
            <div>
              <div className="label mb-1">Pending invitations</div>
              <ul className="space-y-1">
                {data.invites
                  .filter((i) => !i.acceptedAt)
                  .map((i) => (
                    <li key={i.email} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-marble-300">{i.email}</span>
                      <span className="text-marble-500">{i.role === 'gm' ? 'GM' : 'Player'}</span>
                      {i.tokenIds.length > 0 && <span className="text-marble-500">· {i.tokenIds.map((id) => state.tokens[id]?.name ?? id).join(', ')}</span>}
                      <button className="btn btn-ghost px-2 py-0.5" onClick={() => act({ action: 'revokeInvite', email: i.email }, 'Invitation revoked.')}>
                        Revoke
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <InviteForm players={players} onInvite={(email, role, tokenIds) => act({ action: 'invite', email, role, tokenIds }, `Invitation saved for ${email}.`)} />
          <p className="text-[11px] leading-relaxed text-marble-500">
            Invited people sign in with this email address (create the account in Supabase → Authentication → <i>Invite user</i>, or let them sign up if
            enabled). Access is granted on their first sign-in with a confirmed email.
          </p>
        </div>
      ) : tab === 'characters' ? (
        <ul className="space-y-1.5" aria-busy={busy}>
          {players.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
              <span className="min-w-0 flex-1 truncate text-marble-50">{t.name}</span>
              <select
                aria-label={`Account controlling ${t.name}`}
                className="max-w-[55%] rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs"
                value={owner(t.id)?.userId ?? ''}
                onChange={(e) => act({ action: 'assign', tokenId: t.id, userId: e.target.value || null }, `${t.name} reassigned.`)}
              >
                <option value="">— unassigned —</option>
                {data.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.email}
                  </option>
                ))}
              </select>
            </li>
          ))}
          <li className="pt-1 text-[11px] leading-relaxed text-marble-500">
            Characters are game tokens; accounts are people. One account may control several characters. Extra in-game control rights (“may also be
            controlled by”) are set per character in the selection panel.
          </li>
        </ul>
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
                    try {
                      await online.admin({ action: 'restoreSnapshot', id: s.id });
                      online.refresh();
                      notify('Backup restored.', 'info');
                      void act({ action: 'overview' });
                    } catch (e) {
                      notify((e as Error).message);
                    }
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

function InviteForm({ players, onInvite }: { players: GameState['tokens'][string][]; onInvite: (email: string, role: 'gm' | 'player', tokenIds: string[]) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'gm' | 'player'>('player');
  const [tokens, setTokens] = useState<string[]>([]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onInvite(email.trim(), role, tokens)) {
      setEmail('');
      setTokens([]);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-ink-600 bg-ink-800/60 p-2">
      <div className="label">Invite a person</div>
      <div className="flex gap-1.5">
        <input
          type="email"
          required
          placeholder="email@example.com"
          aria-label="Email address to invite"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs"
        />
        <Segmented
          value={role}
          onChange={setRole}
          options={[
            { value: 'player', label: 'Player' },
            { value: 'gm', label: 'GM' },
          ]}
        />
      </div>
      {role === 'player' && (
        <div className="flex flex-wrap gap-1">
          {players.map((p) => {
            const on = tokens.includes(p.id);
            return (
              <button
                type="button"
                key={p.id}
                aria-pressed={on}
                className={`chip ${on ? 'border-gold-400 text-gold-200' : 'text-marble-500'}`}
                onClick={() => setTokens(on ? tokens.filter((x) => x !== p.id) : [...tokens, p.id])}
              >
                {on ? '✓' : '+'} {p.name}
              </button>
            );
          })}
        </div>
      )}
      <button type="submit" className="btn btn-gold w-full">
        Save invitation
      </button>
    </form>
  );
}
