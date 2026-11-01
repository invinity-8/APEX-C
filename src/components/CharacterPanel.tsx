/**
 * Character sheet panel (APEX 0.3). Shows the character's APEX resources from the authoritative
 * game state (Will, movement, vision) and the persistent character sheet (hit points, attributes,
 * skills, custom resources, abilities, notes). Players edit their own character; the GM edits all.
 */
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Command } from '../game/commands';
import { emptySheet, newEntryId, type CharacterSheet, type SheetResource } from '../game/sheet';
import type { TokenView } from '../game/visibility';
import type { SheetPayload } from '../server/protocol';
import type { DispatchResult, GameApi } from '../state/gameApi';
import { Bar } from './ui';

const SheetImport = lazy(() => import('./SheetImport').then((m) => ({ default: m.SheetImport })));

interface Props {
  game: GameApi;
  token: TokenView;
  isGm: boolean;
  run: (cmd: Command) => Promise<DispatchResult>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';

export function CharacterPanel({ game, token, isGm, run, notify }: Props) {
  const { sheets } = game;
  const [data, setData] = useState<SheetPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CharacterSheet | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const details = token.details;

  const load = useCallback(async () => {
    const r = await sheets.load(token.id);
    if (r.ok) {
      setData(r.sheet);
      setLoadError(null);
    } else setLoadError(r.error);
  }, [sheets, token.id]);

  // Initial load and live refresh (sheet pings from other devices).
  useEffect(() => {
    void load();
  }, [load, sheets.revision]);
  useEffect(() => {
    setDraft(null);
    setConflict(null);
  }, [token.id]);

  const startEdit = () => {
    if (!data) return;
    setDraft(structuredClone(data.sheet));
    setBaseVersion(data.version);
    setConflict(null);
  };

  const save = async (sheet: CharacterSheet, expected: number, reason: 'edit' | 'import-merge' | 'import-replace' = 'edit') => {
    setSaving(true);
    const r = await sheets.save(token.id, sheet, expected, reason);
    setSaving(false);
    if (r.ok) {
      setData(r.sheet);
      setDraft(null);
      setConflict(null);
      notify(reason === 'edit' ? 'Character sheet saved.' : 'Imported character sheet saved.', 'info');
      return true;
    }
    if (r.conflict) {
      setData(r.conflict);
      setBaseVersion(r.conflict.version);
      setConflict(r.error);
    } else notify(r.error);
    return false;
  };

  const adjust = async (target: 'hp' | 'hpTemp' | 'resource', delta: number, resourceId?: string) => {
    const r = await sheets.adjust(token.id, target, delta, resourceId);
    if (r.ok) setData(r.sheet);
    else notify(r.error);
  };

  const sheet = draft ?? data?.sheet ?? emptySheet();
  const editing = !!draft;
  const set = (patch: Partial<CharacterSheet>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const changedElsewhere = editing && data && data.version !== baseVersion;

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3" aria-label={`Character sheet of ${token.name}`}>
      <section className="panel flex flex-wrap items-center gap-3 p-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 font-display text-lg font-black" style={{ borderColor: token.color, color: token.color }}>
          {token.initials}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-black text-gold-200">{token.name}</h2>
          <p className="text-xs text-marble-300">
            {token.title}
            {data?.updatedAt && <span className="text-marble-500"> · sheet saved {new Date(data.updatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>}
            {data?.sheet.source.kind === 'pdf' && <span className="text-marble-500"> · imported from {data.sheet.source.fileName ?? 'PDF'}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button className="btn btn-ghost" onClick={() => setImporting(true)} disabled={!data}>
                ⤒ Import Character Sheet
              </button>
              <button className="btn btn-gold" onClick={startEdit} disabled={!data}>
                ✎ Edit sheet
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={() => void save(draft!, baseVersion)} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          )}
        </div>
      </section>

      {loadError && (
        <p role="alert" className="panel border-blood-400/50 p-3 text-sm text-red-200">
          {loadError}
        </p>
      )}
      {(conflict || changedElsewhere) && (
        <div role="alert" className="panel border-amber-400/60 bg-amber-500/10 p-3 text-xs text-amber-100">
          <b>This sheet was changed on another device.</b> {conflict ?? 'A newer version was saved while you were editing.'} Your unsaved changes are still shown below.
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>
              Discard my changes, show the latest version
            </button>
            <button className="btn btn-gold" onClick={() => void save(draft!, data!.version)}>
              Keep my version (replace theirs)
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* APEX resources – authoritative game state */}
        <section className="panel space-y-3 p-3">
          <h3 className="panel-title">APEX resources</h3>
          {details ? (
            <>
              <Resource
                label="Willpower"
                current={details.will.current}
                max={details.will.max}
                color="#a78bfa"
                onDelta={(d) => void run({ type: 'setWill', tokenId: token.id, current: details.will.current + d })}
              />
              {isGm && (
                <div className="flex items-center justify-between text-xs text-marble-300">
                  <span>Maximum Will (GM)</span>
                  <span className="flex items-center gap-1">
                    <SmallBtn label="Decrease maximum Will" onClick={() => void run({ type: 'setWill', tokenId: token.id, max: Math.max(0, details.will.max - 1) })}>
                      −
                    </SmallBtn>
                    <span className="w-8 text-center tabular-nums">{details.will.max}</span>
                    <SmallBtn label="Increase maximum Will" onClick={() => void run({ type: 'setWill', tokenId: token.id, max: details.will.max + 1 })}>
                      +
                    </SmallBtn>
                  </span>
                </div>
              )}
              <Resource
                label="Movement points"
                current={details.movePoints}
                max={details.maxMovePoints}
                color="#e9c46a"
                onDelta={isGm ? (d) => void run({ type: 'adjustMovePoints', tokenId: token.id, delta: d }) : undefined}
                hint={isGm ? undefined : 'Spent by moving on the map, restored at dawn.'}
              />
              <div className="flex justify-between text-xs text-marble-300">
                <span>Vision</span>
                <span className="tabular-nums text-marble-50">
                  {details.visionRadius}
                  {details.visionBonus ? ` (${details.visionBonus > 0 ? '+' : ''}${details.visionBonus})` : ''} hexes
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-marble-500">Not visible.</p>
          )}
        </section>

        {/* Hit points & custom resources – character sheet */}
        <section className="panel space-y-3 p-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="panel-title">Hit points &amp; resources</h3>
            {editing && !sheet.hitPoints && (
              <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => set({ hitPoints: { current: 10, max: 10, temp: 0 } })}>
                + Hit points
              </button>
            )}
          </div>
          {sheet.hitPoints &&
            (editing ? (
              <div className="grid grid-cols-3 gap-2 text-xs text-marble-300">
                {(['current', 'max', 'temp'] as const).map((k) => (
                  <label key={k}>
                    {k === 'current' ? 'Current HP' : k === 'max' ? 'Max HP' : 'Temporary HP'}
                    <input
                      type="number"
                      className={input}
                      value={sheet.hitPoints![k]}
                      onChange={(e) => set({ hitPoints: { ...sheet.hitPoints!, [k]: Math.round(Number(e.target.value) || 0) } })}
                    />
                  </label>
                ))}
                <button className="col-span-3 justify-self-start text-[11px] text-blood-400 hover:underline" onClick={() => set({ hitPoints: null })}>
                  Remove hit points (system without HP)
                </button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Resource label="Hit points" current={sheet.hitPoints.current} max={sheet.hitPoints.max} color="#e05252" big onDelta={(d) => void adjust('hp', d)} />
                <Resource label="Temporary HP" current={sheet.hitPoints.temp} color="#6fb1e0" onDelta={(d) => void adjust('hpTemp', d)} />
              </div>
            ))}
          {editing ? (
            <ResourceEditor resources={sheet.resources} onChange={(resources) => set({ resources })} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sheet.resources.map((r) => (
                <Resource key={r.id} label={r.name} current={r.current} max={r.max ?? undefined} color="#7cc98a" onDelta={(d) => void adjust('resource', d, r.id)} />
              ))}
            </div>
          )}
          {!editing && !sheet.hitPoints && !sheet.resources.length && (
            <p className="text-xs text-marble-500">No hit points or custom resources yet. Use “Edit sheet” to add them, or import a character sheet.</p>
          )}
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <EntrySection
          title="Details"
          editing={editing}
          empty="Class, level, ancestry, background, armour class …"
          rows={sheet.details.map((d) => ({ id: d.id, a: d.label, b: d.value }))}
          labels={['Label', 'Value']}
          onChange={(rows) => set({ details: rows.map((r) => ({ id: r.id, label: r.a, value: r.b })) })}
        />
        <section className="panel p-3">
          <h3 className="panel-title mb-2">Attributes</h3>
          {editing ? (
            <ListEditor
              rows={sheet.attributes}
              make={() => ({ id: newEntryId('a'), name: '', value: '', modifier: '' })}
              render={(a, upd) => (
                <>
                  <input className={input} aria-label="Attribute name" placeholder="Name" value={a.name} onChange={(e) => upd({ ...a, name: e.target.value })} />
                  <input className={`${input} w-20`} aria-label="Value" placeholder="Value" value={a.value} onChange={(e) => upd({ ...a, value: e.target.value })} />
                  <input className={`${input} w-20`} aria-label="Modifier" placeholder="Mod" value={a.modifier} onChange={(e) => upd({ ...a, modifier: e.target.value })} />
                </>
              )}
              onChange={(attributes) => set({ attributes })}
              addLabel="+ Attribute"
            />
          ) : sheet.attributes.length ? (
            <div className="grid grid-cols-3 gap-2">
              {sheet.attributes.map((a) => (
                <div key={a.id} className="rounded-lg border border-gold-700/40 bg-ink-900/60 p-2 text-center">
                  <div className="truncate text-[10px] uppercase tracking-wider text-marble-500" title={a.name}>
                    {a.name}
                  </div>
                  <div className="font-display text-xl font-bold text-marble-50">{a.value || '–'}</div>
                  {a.modifier && <div className="text-xs text-gold-200">{a.modifier}</div>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-marble-500">No attributes recorded.</p>
          )}
        </section>
        <section className="panel p-3">
          <h3 className="panel-title mb-2">Skills</h3>
          {editing ? (
            <ListEditor
              rows={sheet.skills}
              make={() => ({ id: newEntryId('s'), name: '', value: '', proficient: false })}
              render={(sk, upd) => (
                <>
                  <input className={input} aria-label="Skill" placeholder="Skill" value={sk.name} onChange={(e) => upd({ ...sk, name: e.target.value })} />
                  <input className={`${input} w-20`} aria-label="Value" placeholder="Value" value={sk.value} onChange={(e) => upd({ ...sk, value: e.target.value })} />
                  <label className="flex items-center gap-1 text-[11px] text-marble-300">
                    <input type="checkbox" checked={sk.proficient} onChange={(e) => upd({ ...sk, proficient: e.target.checked })} /> prof.
                  </label>
                </>
              )}
              onChange={(skills) => set({ skills })}
              addLabel="+ Skill"
            />
          ) : sheet.skills.length ? (
            <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
              {sheet.skills.map((sk) => (
                <li key={sk.id} className="flex justify-between border-b border-ink-700/60 py-0.5">
                  <span className={sk.proficient ? 'text-gold-200' : 'text-marble-300'}>
                    {sk.proficient ? '● ' : ''}
                    {sk.name}
                  </span>
                  <span className="tabular-nums text-marble-50">{sk.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-marble-500">No skills recorded.</p>
          )}
        </section>
        <section className="panel p-3">
          <h3 className="panel-title mb-2">Abilities &amp; features</h3>
          {editing ? (
            <ListEditor
              rows={sheet.abilities}
              make={() => ({ id: newEntryId('f'), name: '', text: '' })}
              render={(f, upd) => (
                <div className="flex w-full flex-col gap-1">
                  <input className={input} aria-label="Ability name" placeholder="Name" value={f.name} onChange={(e) => upd({ ...f, name: e.target.value })} />
                  <textarea className={`${input} min-h-16`} aria-label="Description" placeholder="Description" value={f.text} onChange={(e) => upd({ ...f, text: e.target.value })} />
                </div>
              )}
              onChange={(abilities) => set({ abilities })}
              addLabel="+ Ability"
            />
          ) : sheet.abilities.length ? (
            <ul className="space-y-2">
              {sheet.abilities.map((f) => (
                <li key={f.id}>
                  <div className="text-sm font-semibold text-gold-200">{f.name}</div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-marble-300">{f.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-marble-500">No abilities recorded.</p>
          )}
        </section>
      </div>

      <section className="panel p-3">
        <h3 className="panel-title mb-2">Notes</h3>
        {editing ? (
          <textarea className={`${input} min-h-40`} aria-label="Notes" value={sheet.notes} onChange={(e) => set({ notes: e.target.value })} />
        ) : sheet.notes ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-marble-100">{sheet.notes}</p>
        ) : (
          <p className="text-xs text-marble-500">No notes yet.</p>
        )}
      </section>

      {importing && data && (
        <Suspense fallback={null}>
          <SheetImport
            characterName={token.name}
            current={data}
            inventoryNames={(details?.inventory ?? []).map((i) => i.name)}
            onClose={() => setImporting(false)}
            onSave={async (sheet, mode) => save(sheet, data.version, mode)}
            onAddItems={async (names) => {
              let added = 0;
              for (const name of names) {
                const r = await run({ type: 'invAddItem', tokenId: token.id, itemId: newEntryId('itm'), name, container: 'backpack' });
                if (r.ok) added++;
              }
              return added;
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function SmallBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button className="btn btn-ghost h-7 w-7 px-0" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

function Resource({
  label,
  current,
  max,
  color,
  onDelta,
  big = false,
  hint,
}: {
  label: string;
  current: number;
  max?: number;
  color: string;
  onDelta?: (d: number) => void;
  big?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900/50 p-2" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-marble-300">{label}</span>
        <span className="flex items-center gap-1">
          {onDelta && (
            <SmallBtn label={`Decrease ${label}`} onClick={() => onDelta(-1)}>
              −
            </SmallBtn>
          )}
          <span className={`min-w-14 text-center font-display font-bold tabular-nums text-marble-50 ${big ? 'text-2xl' : 'text-lg'}`}>
            {current}
            {max !== undefined && <span className="text-sm text-marble-500"> / {max}</span>}
          </span>
          {onDelta && (
            <SmallBtn label={`Increase ${label}`} onClick={() => onDelta(1)}>
              +
            </SmallBtn>
          )}
        </span>
      </div>
      {max !== undefined && max > 0 && <Bar value={current} max={max} color={color} className="mt-1.5" />}
    </div>
  );
}

function ListEditor<T extends { id: string }>({
  rows,
  make,
  render,
  onChange,
  addLabel,
}: {
  rows: T[];
  make: () => T;
  render: (row: T, update: (r: T) => void) => ReactNode;
  onChange: (rows: T[]) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-start gap-1.5">
          {render(r, (nr) => onChange(rows.map((x) => (x.id === r.id ? nr : x))))}
          <button className="btn btn-ghost h-7 w-7 shrink-0 px-0 hover:border-blood-400/70" aria-label="Remove entry" onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => onChange([...rows, make()])}>
        {addLabel}
      </button>
    </div>
  );
}

function ResourceEditor({ resources, onChange }: { resources: SheetResource[]; onChange: (r: SheetResource[]) => void }) {
  return (
    <div>
      <div className="label mb-1">Custom resources</div>
      <ListEditor
        rows={resources}
        make={() => ({ id: newEntryId('r'), name: '', current: 0, max: null })}
        render={(r, upd) => (
          <>
            <input className={input} aria-label="Resource name" placeholder="Name (e.g. Spell slots, Luck)" value={r.name} onChange={(e) => upd({ ...r, name: e.target.value })} />
            <input className={`${input} w-20`} type="number" aria-label="Current" value={r.current} onChange={(e) => upd({ ...r, current: Math.round(Number(e.target.value) || 0) })} />
            <input
              className={`${input} w-20`}
              type="number"
              aria-label="Maximum (empty = none)"
              placeholder="max"
              value={r.max ?? ''}
              onChange={(e) => upd({ ...r, max: e.target.value === '' ? null : Math.round(Number(e.target.value) || 0) })}
            />
          </>
        )}
        onChange={onChange}
        addLabel="+ Resource"
      />
    </div>
  );
}

function EntrySection({
  title,
  editing,
  rows,
  labels,
  empty,
  onChange,
}: {
  title: string;
  editing: boolean;
  rows: Array<{ id: string; a: string; b: string }>;
  labels: [string, string];
  empty: string;
  onChange: (rows: Array<{ id: string; a: string; b: string }>) => void;
}) {
  return (
    <section className="panel p-3">
      <h3 className="panel-title mb-2">{title}</h3>
      {editing ? (
        <ListEditor
          rows={rows}
          make={() => ({ id: newEntryId('d'), a: '', b: '' })}
          render={(r, upd) => (
            <>
              <input className={`${input} w-2/5`} aria-label={labels[0]} placeholder={labels[0]} value={r.a} onChange={(e) => upd({ ...r, a: e.target.value })} />
              <input className={input} aria-label={labels[1]} placeholder={labels[1]} value={r.b} onChange={(e) => upd({ ...r, b: e.target.value })} />
            </>
          )}
          onChange={onChange}
          addLabel="+ Entry"
        />
      ) : rows.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map((r) => (
            <div key={r.id} className="contents">
              <dt className="text-marble-500">{r.a}</dt>
              <dd className="whitespace-pre-wrap text-marble-50">{r.b}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-marble-500">{empty}</p>
      )}
    </section>
  );
}
