/**
 * Character history (APEX 0.7): level-up / re-import progression for everyone, and the GM's character archive –
 * create named snapshots, compare two snapshots (or a snapshot with the current sheet), restore selected parts.
 *
 * Restores are configuration only: sheet sections on the server (the current state is snapshotted first), identity
 * and equipment configuration through the game command gmRestoreCharacter. Items and currency recorded in a snapshot
 * are shown for reference and are NEVER restored – snapshots cannot duplicate items or currency.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Command } from '../game/commands';
import { CURRENCIES, CURRENCY_IDS } from '../game/items/currency';
import { diffSheets, SHEET_PARTS, type CharacterSnapshot, type SheetChange, type SheetPart } from '../game/progression';
import type { CharacterSheet } from '../game/sheet';
import type { TokenView } from '../game/visibility';
import type { SheetPayload } from '../server/protocol';
import type { SheetBackupInfo } from '../server/repo';
import type { DispatchResult, GameApi } from '../state/gameApi';

const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const PRESETS = ['Level {n} – Campaign Start', 'Level {n} – After Arena Trial', 'Before Boss Encounter', 'GM Manual Backup'];
type Loaded = { info: SheetBackupInfo; snapshot: Omit<CharacterSnapshot, 'kind' | 'schema'> & { kind: string; character: CharacterSnapshot['character'] | null } };
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

export function CharacterHistory({
  game,
  token,
  isGm,
  sheet,
  run,
  notify,
  onSheet,
}: {
  game: GameApi;
  token: TokenView;
  isGm: boolean;
  sheet: SheetPayload | null;
  run: (cmd: Command) => Promise<DispatchResult>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
  onSheet: (p: SheetPayload) => void;
}) {
  const progression = [...(sheet?.sheet.progression ?? [])].reverse();
  return (
    <div className="space-y-3">
      <section className="panel space-y-2 p-3" aria-label="Progression history">
        <h3 className="panel-title">Progression history</h3>
        {!progression.length && <p className="text-xs text-marble-500">No level-up or sheet update recorded yet. Re-import an updated PDF with “Import Character Sheet” → “Update (level-up)”.</p>}
        <ul className="space-y-2">
          {progression.map((p) => (
            <li key={p.id} className="rounded-lg border border-ink-600 bg-ink-800/50 p-2 text-xs" data-progression={p.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <b className="text-gold-200">{p.fromLevel !== null && p.toLevel !== null && p.fromLevel !== p.toLevel ? `Level ${p.fromLevel} → ${p.toLevel}` : 'Sheet update'}</b>
                <span className="text-marble-500">{fmtDate(p.at)}</span>
                {p.fileName && <span className="text-marble-500">· {p.fileName}</span>}
              </div>
              <p className="text-marble-300">
                {p.approved.length} of {p.changed.length} changes applied{p.approved.length ? `: ${p.approved.slice(0, 8).join(', ')}${p.approved.length > 8 ? ' …' : ''}` : ''}
              </p>
              {p.note && <p className="italic text-marble-400">{p.note}</p>}
            </li>
          ))}
        </ul>
      </section>
      {isGm && game.online ? (
        <Archive game={game} token={token} sheet={sheet} run={run} notify={notify} onSheet={onSheet} />
      ) : (
        <p className="panel p-3 text-xs text-marble-500">{isGm ? 'Character snapshots need the online campaign.' : 'Character snapshots are created and restored by the Game Master.'}</p>
      )}
    </div>
  );
}

function Archive({ game, token, sheet, run, notify, onSheet }: { game: GameApi; token: TokenView; sheet: SheetPayload | null; run: (cmd: Command) => Promise<DispatchResult>; notify: (m: string, k?: 'error' | 'info') => void; onSheet: (p: SheetPayload) => void }) {
  const online = game.online!;
  const [list, setList] = useState<SheetBackupInfo[] | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<Loaded | null>(null);
  const [b, setB] = useState<Loaded | 'current' | null>('current');
  const [parts, setParts] = useState<SheetPart[]>([]);
  const [identity, setIdentity] = useState(false);
  const [equipment, setEquipment] = useState(false);
  const level = sheet ? /\d+/.exec(sheet.sheet.details.find((d) => /level/i.test(d.label))?.value ?? '')?.[0] : undefined;

  const call = useCallback(
    async <T,>(body: Record<string, unknown>): Promise<T | null> => {
      try {
        return await online.characterArchive<T>(body);
      } catch (e) {
        notify((e as Error).message);
        return null;
      }
    },
    [online, notify],
  );
  useEffect(() => {
    void call<{ snapshots: SheetBackupInfo[] }>({ action: 'list', tokenId: token.id }).then((r) => r && setList(r.snapshots));
  }, [call, token.id]);
  const open = async (id: number) => call<Loaded>({ action: 'get', id });

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await call<{ snapshots: SheetBackupInfo[] }>({ action: 'create', tokenId: token.id, name: name.trim(), note });
    setBusy(false);
    if (r) {
      setList(r.snapshots);
      setName('');
      setNote('');
      notify('Snapshot created.', 'info');
    }
  };

  const changes: SheetChange[] = useMemo(() => {
    if (!a) return [];
    const right: CharacterSheet | null = b === 'current' ? (sheet?.sheet ?? null) : (b?.snapshot.sheet ?? null);
    return right ? diffSheets(a.snapshot.sheet, right) : [];
  }, [a, b, sheet]);

  const restore = async () => {
    if (!a || !sheet) return;
    if (!parts.length && !identity && !equipment) return;
    setBusy(true);
    try {
      if (parts.length) {
        const r = await call<{ sheet: SheetPayload; snapshots: SheetBackupInfo[] }>({ action: 'restore', tokenId: token.id, id: a.info.id, parts, expectedVersion: sheet.version });
        if (!r) return;
        onSheet(r.sheet);
        setList(r.snapshots);
      }
      const c = a.snapshot.character;
      if (c && (identity || equipment)) {
        const res = await run({
          type: 'gmRestoreCharacter',
          tokenId: token.id,
          ...(identity ? { identity: { name: c.name, title: c.title, color: c.color, ...(c.accent ? { accent: c.accent } : {}), ...(c.marker ? { marker: c.marker } : {}), initials: c.initials } } : {}),
          ...(equipment && c.equipment ? { equipment: { slots: c.equipment.slots, activeSet: c.equipment.activeSet, resting: c.equipment.resting, restingKeep: c.equipment.restingKeep } } : {}),
        });
        if (!res.ok) return;
      }
      notify('Restored. The previous state was saved as a snapshot first.', 'info');
      setParts([]);
      setIdentity(false);
      setEquipment(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel space-y-3 p-3" aria-label="Character archive">
      <h3 className="panel-title">Character archive (GM)</h3>
      <div className="flex flex-wrap items-end gap-2 text-xs text-marble-300">
        <label className="min-w-[12rem] flex-1">
          Snapshot name
          <input className={`${input} mt-1 w-full`} list="apex-snapshot-presets" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Snapshot name" placeholder="e.g. Level 2 – After Arena Trial" />
          <datalist id="apex-snapshot-presets">
            {PRESETS.map((p) => (
              <option key={p} value={p.replace('{n}', level ?? '1')} />
            ))}
          </datalist>
        </label>
        <label className="min-w-[12rem] flex-1">
          Reason / note
          <input className={`${input} mt-1 w-full`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Snapshot note" />
        </label>
        <button className="btn btn-gold" disabled={busy || !name.trim()} onClick={() => void create()}>
          Create snapshot
        </button>
      </div>

      {list === null ? (
        <p className="text-xs text-marble-500">Loading…</p>
      ) : !list.length ? (
        <p className="text-xs text-marble-500">No snapshots yet.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto text-xs" aria-label="Snapshots">
          {list.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${a?.info.id === s.id ? 'border-gold-400/70 bg-gold-400/10' : 'border-ink-600'}`} data-snapshot={s.id}>
              <span className="min-w-0 flex-1">
                <b className="text-marble-50">{s.kind === 'snapshot' ? s.name : `Automatic backup · ${s.reason}`}</b>
                {s.level && <span className="text-marble-400"> · {s.level}</span>}
                <span className="text-marble-500"> · {fmtDate(s.createdAt)}</span>
                {s.note && <span className="block italic text-marble-400">{s.note}</span>}
              </span>
              <button className="btn btn-ghost px-2 py-0.5" onClick={async () => setA(await open(s.id))}>
                Select
              </button>
              <button className="btn btn-ghost px-2 py-0.5" disabled={!a || a.info.id === s.id} onClick={async () => setB(await open(s.id))} title="Compare the selected snapshot with this one">
                Compare with
              </button>
            </li>
          ))}
        </ul>
      )}

      {a && (
        <div className="space-y-2 rounded-lg border border-gold-700/40 bg-ink-900/50 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-gold-200">{a.snapshot.name}</b>
            <span className="text-marble-500">compared with</span>
            <select className={input} value={b === 'current' ? 'current' : String(b?.info.id ?? '')} onChange={async (e) => setB(e.target.value === 'current' ? 'current' : await open(Number(e.target.value)))} aria-label="Compare with">
              <option value="current">the current character</option>
              {(list ?? [])
                .filter((s) => s.id !== a.info.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.kind === 'snapshot' ? s.name : s.reason} ({fmtDate(s.createdAt)})
                  </option>
                ))}
            </select>
          </div>
          {changes.length ? (
            <table className="w-full" aria-label="Differences">
              <thead className="text-marble-500">
                <tr>
                  <th className="text-left font-normal">Field</th>
                  <th className="text-left font-normal">{a.snapshot.name}</th>
                  <th className="text-left font-normal">{b === 'current' ? 'Current' : b?.snapshot.name}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i} className="border-t border-ink-800" data-diff={c.label}>
                    <td className="pr-2 text-marble-300">{c.label}</td>
                    <td className="pr-2 text-marble-400">{c.before ?? '—'}</td>
                    <td className="text-gold-100">{c.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-marble-500">No differences in the character sheet.</p>
          )}

          <fieldset className="space-y-1 border-t border-ink-700 pt-2">
            <legend className="font-semibold text-marble-100">Restore from “{a.snapshot.name}”</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {SHEET_PARTS.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-marble-300">
                  <input type="checkbox" checked={parts.includes(p.id)} onChange={(e) => setParts(e.target.checked ? [...parts, p.id] : parts.filter((x) => x !== p.id))} />
                  {p.label}
                </label>
              ))}
              {a.snapshot.character && (
                <>
                  <label className="flex items-center gap-2 text-marble-300">
                    <input type="checkbox" checked={identity} onChange={(e) => setIdentity(e.target.checked)} />
                    Name, tagline &amp; colours ({a.snapshot.character.name} – {a.snapshot.character.title})
                  </label>
                  <label className="flex items-center gap-2 text-marble-300">
                    <input type="checkbox" checked={equipment} disabled={!a.snapshot.character.equipment} onChange={(e) => setEquipment(e.target.checked)} />
                    Equipment configuration (only items still owned)
                  </label>
                </>
              )}
            </div>
            {a.snapshot.character && (
              <p className="text-[11px] text-marble-500">
                Recorded for reference only – never restored: {a.snapshot.character.inventory.length} items ·{' '}
                {CURRENCY_IDS.map((c) => `${a.snapshot.character!.currency[c] ?? 0} ${CURRENCIES[c].plural}`).join(' · ')}. Current HP and resource values are never raised by a restore.
              </p>
            )}
            <div className="flex justify-end">
              <button className="btn btn-gold px-3 py-1" disabled={busy || (!parts.length && !identity && !equipment)} onClick={() => void restore()}>
                Restore selected
              </button>
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
