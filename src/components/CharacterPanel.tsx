/**
 * Character dashboard (APEX 0.4). Tabs: Overview · Attributes & Skills · Abilities & Spells ·
 * Resources · Inventory · Appearance · Notes.
 *
 * - APEX resources (Will, movement, vision, inventory) come from the authoritative game state.
 * - The character sheet (everything else) is persistent in Supabase with a version per sheet:
 *   one "Edit" mode for all tabs, a conflict banner instead of silent overwrites.
 * - Players edit their own character; the GM edits every character.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Command } from '../game/commands';
import { emptySheet, newEntryId, type CharacterSheet, type SheetEntry, type SheetResource, type SheetSkill, type SheetSpell } from '../game/sheet';
import type { TokenView } from '../game/visibility';
import type { SheetPayload } from '../server/protocol';
import type { DispatchResult, GameApi } from '../state/gameApi';
import { AppearanceEditor } from './AppearanceEditor';
import { CharacterPortrait } from './CharacterVisuals';
import { EquipmentPanel } from './EquipmentPanel';
import { VitalsPanel } from './ResourceOrbs';
import { InventoryPanel } from './InventoryPanel';
import { IdentityEditor } from './IdentityEditor';
import { CharacterHistory } from './CharacterHistory';
import { Bar } from './ui';

const SheetImport = lazy(() => import('./SheetImport').then((m) => ({ default: m.SheetImport })));

type Tab = 'overview' | 'attributes' | 'abilities' | 'resources' | 'equipment' | 'inventory' | 'appearance' | 'notes' | 'history';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'attributes', label: 'Attributes & Skills' },
  { id: 'abilities', label: 'Abilities & Spells' },
  { id: 'resources', label: 'Resources' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' },
];
const TAB_KEY = 'apex.character.tab';

interface Props {
  game: GameApi;
  token: TokenView;
  isGm: boolean;
  run: (cmd: Command) => Promise<DispatchResult>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
  /** Open a specific tab (e.g. the top-level "Inventory" navigation). */
  initialTab?: Tab;
}

const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';

export function CharacterPanel({ game, token, isGm, run, notify, initialTab }: Props) {
  const { sheets } = game;
  const [tab, setTabState] = useState<Tab>(() => {
    if (initialTab) return initialTab;
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'overview';
    } catch {
      return 'overview';
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    if (initialTab) setTabState(initialTab);
  }, [initialTab]);

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

  // Initial load and live refresh (sheet pings from other devices) – one request per change.
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

  const save = async (sheet: CharacterSheet, expected: number, reason: 'edit' | 'import-merge' | 'import-replace' | 'import-levelup' = 'edit', quiet = false) => {
    setSaving(true);
    const r = await sheets.save(token.id, sheet, expected, reason);
    setSaving(false);
    if (r.ok) {
      setData(r.sheet);
      // An import is only reported as saved if the stored copy really contains the structured data.
      const stored = r.sheet.sheet;
      if (reason !== 'edit' && (stored.attributes.length < sheet.attributes.length || stored.skills.length < sheet.skills.length || stored.spells.length < sheet.spells.length)) {
        notify('The server stored an incomplete character sheet – please reload and try the import again.');
        return false;
      }
      setDraft(null);
      setConflict(null);
      if (!quiet) notify(reason === 'edit' ? 'Character sheet saved.' : 'Imported character sheet saved.', 'info');
      return true;
    }
    if (r.conflict) {
      setData(r.conflict);
      setBaseVersion(r.conflict.version);
      setConflict(r.error);
    } else notify(r.error);
    return false;
  };

  /** Small change outside edit mode (e.g. toggling "prepared") – saved immediately with a version check. */
  const quickSave = async (mutate: (s: CharacterSheet) => void) => {
    if (!data || draft) return;
    const before = data;
    const next = structuredClone(data.sheet);
    mutate(next);
    setData({ ...data, sheet: next }); // optimistic – rolled back below if the server refuses
    if (!(await save(next, before.version, 'edit', true))) setData((cur) => (cur && cur.version === before.version ? before : cur));
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
  const build = sheet.details.find((d) => /race, class|class & level|^class$/i.test(d.label))?.value;
  const canEditSheet = tab !== 'inventory' && tab !== 'appearance' && tab !== 'equipment' && tab !== 'history';

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3" aria-label={`Character sheet of ${token.name}`}>
      <section className="panel flex flex-wrap items-center gap-3 p-3">
        <CharacterPortrait tokenId={token.id} portraitV={token.portraitV} online={game.mode === 'online'} color={token.color} accent={token.accent} initials={token.initials} name={token.name} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-black text-gold-200">{token.name}</h2>
          {/* APEX 0.7: the tagline is shown exactly as chosen – imported class data never replaces it */}
          <p className="text-xs" style={{ color: token.accent ?? undefined }} data-testid="header-tagline">
            <span className={token.accent ? '' : 'text-marble-300'}>{token.title}</span>
          </p>
          {build && <p className="text-[11px] text-marble-400">{build}</p>}
          <p className="text-[11px] text-marble-500">
            {data?.updatedAt ? `Sheet saved ${new Date(data.updatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}` : 'No sheet saved yet'}
            {data?.sheet.source.kind === 'pdf' && ` · imported from ${data.sheet.source.fileName ?? 'PDF'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button className="btn btn-ghost" onClick={() => setImporting(true)} disabled={!data}>
                ⤒ Import Character Sheet
              </button>
              {canEditSheet && (
                <button className="btn btn-gold" onClick={startEdit} disabled={!data}>
                  ✎ Edit
                </button>
              )}
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

      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Character sections" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${tab === t.id ? 'bg-gold-400/20 text-gold-200 shadow-[inset_0_0_0_1px_rgba(192,155,88,.6)]' : 'text-marble-300 hover:bg-ink-800'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loadError && (
        <p role="alert" className="panel border-blood-400/50 p-3 text-sm text-red-200">
          {loadError}
        </p>
      )}
      {(conflict || changedElsewhere) && (
        <div role="alert" className="panel border-amber-400/60 bg-amber-500/10 p-3 text-xs text-amber-100">
          <b>This sheet was changed on another device.</b> {conflict ?? 'A newer version was saved while you were editing.'} Your unsaved changes are still shown.
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

      {tab === 'overview' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-3">
            <IdentityEditor token={token} data={data} run={run} notify={notify} save={(s, v) => save(s, v, 'edit', true)} />
          </div>
          <section className="panel space-y-2 p-3 lg:col-span-2">
            <h3 className="panel-title">At a glance</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sheet.hitPoints && <Stat label="Hit points" value={`${sheet.hitPoints.current} / ${sheet.hitPoints.max}`} />}
              {['Armor Class', 'Initiative', 'Speed (walking)', 'Speed', 'Passive Perception', 'Proficiency bonus'].map((l) => {
                const v = sheet.combat.find((c) => c.label === l)?.value;
                return v ? <Stat key={l} label={l.replace(' (walking)', '')} value={v} /> : null;
              })}
            </div>
            {sheet.attributes.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {sheet.attributes.map((a) => (
                  <Stat key={a.id} label={a.name.slice(0, 3).toUpperCase()} value={a.value || '–'} sub={a.modifier} />
                ))}
              </div>
            )}
            {sheet.spells.length > 0 && (
              <p className="text-xs text-marble-300">
                Spells: {sheet.spells.filter((s) => s.level === 0).length} cantrips · <b className="text-gold-200">{sheet.spells.filter((s) => s.level > 0 && s.prepared).length} prepared</b> ·{' '}
                {sheet.spells.filter((s) => s.level > 0).length} known
              </p>
            )}
            {sheetEmpty(sheet) && (
              <p className="text-sm text-marble-300">
                No character data yet. Use <b>Import Character Sheet</b> for an Aurora/D&amp;D PDF, or <b>Edit</b> to fill in the sheet by hand.
              </p>
            )}
          </section>
          <ApexResources game={game} token={token} isGm={isGm} run={run} />
        </div>
      )}

      {tab === 'attributes' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="panel p-3 lg:col-span-2">
            <h3 className="panel-title mb-2">Attributes</h3>
            {editing ? (
              <ListEditor
                rows={sheet.attributes}
                make={() => ({ id: newEntryId('a'), name: '', value: '', modifier: '' })}
                render={(a, upd) => (
                  <>
                    <input className={input} aria-label="Attribute name" placeholder="Name" value={a.name} onChange={(e) => upd({ ...a, name: e.target.value })} />
                    <input className={`${input} w-20`} aria-label="Score" placeholder="Score" value={a.value} onChange={(e) => upd({ ...a, value: e.target.value })} />
                    <input className={`${input} w-20`} aria-label="Modifier" placeholder="Mod" value={a.modifier} onChange={(e) => upd({ ...a, modifier: e.target.value })} />
                  </>
                )}
                onChange={(attributes) => set({ attributes })}
                addLabel="+ Attribute"
              />
            ) : sheet.attributes.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {sheet.attributes.map((a) => (
                  <Stat key={a.id} label={a.name} value={a.value || '–'} sub={a.modifier} />
                ))}
              </div>
            ) : (
              <Empty>No attributes recorded.</Empty>
            )}
          </section>
          <SkillSection title="Saving throws" rows={sheet.saves} editing={editing} onChange={(saves) => set({ saves })} prefix="sv" />
          <SkillSection title="Skills" rows={sheet.skills} editing={editing} onChange={(skills) => set({ skills })} prefix="s" />
        </div>
      )}

      {tab === 'abilities' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="panel p-3 lg:col-span-2">
            <h3 className="panel-title mb-2">Attacks</h3>
            {editing ? (
              <ListEditor
                rows={sheet.attacks}
                make={() => ({ id: newEntryId('w'), name: '', bonus: '', damage: '', range: '', notes: '' })}
                render={(a, upd) => (
                  <div className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4">
                    <input className={input} aria-label="Attack name" placeholder="Weapon / spell" value={a.name} onChange={(e) => upd({ ...a, name: e.target.value })} />
                    <input className={input} aria-label="Attack bonus" placeholder="Attack" value={a.bonus} onChange={(e) => upd({ ...a, bonus: e.target.value })} />
                    <input className={input} aria-label="Damage" placeholder="Damage" value={a.damage} onChange={(e) => upd({ ...a, damage: e.target.value })} />
                    <input className={input} aria-label="Range" placeholder="Range" value={a.range} onChange={(e) => upd({ ...a, range: e.target.value })} />
                  </div>
                )}
                onChange={(attacks) => set({ attacks })}
                addLabel="+ Attack"
              />
            ) : sheet.attacks.length ? (
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-marble-500">
                  <tr>
                    <th className="py-1">Name</th>
                    <th>Attack</th>
                    <th>Damage</th>
                    <th className="hidden sm:table-cell">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.attacks.map((a) => (
                    <tr key={a.id} className="border-t border-ink-700/60">
                      <td className="py-1 text-gold-200">{a.name}</td>
                      <td>{a.bonus}</td>
                      <td>{a.damage}</td>
                      <td className="hidden sm:table-cell">{a.range}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No attacks recorded.</Empty>
            )}
          </section>
          <SpellsSection sheet={sheet} editing={editing} set={set} onToggle={(id) => void quickSave((s) => toggle(s.spells, id))} />
          <EntrySection title="Spellcasting" editing={editing} empty="Spellcasting ability, attack bonus, save DC …" rows={sheet.spellcasting} onChange={(spellcasting) => set({ spellcasting })} />
          <section className="panel p-3 lg:col-span-2">
            <h3 className="panel-title mb-2">Features &amp; traits</h3>
            {editing ? (
              <ListEditor
                rows={sheet.abilities}
                make={() => ({ id: newEntryId('f'), name: '', text: '' })}
                render={(f, upd) => (
                  <div className="flex w-full flex-col gap-1">
                    <input className={input} aria-label="Feature name" placeholder="Name" value={f.name} onChange={(e) => upd({ ...f, name: e.target.value })} />
                    <textarea className={`${input} min-h-16`} aria-label="Description" placeholder="Description" value={f.text} onChange={(e) => upd({ ...f, text: e.target.value })} />
                  </div>
                )}
                onChange={(abilities) => set({ abilities })}
                addLabel="+ Feature"
              />
            ) : sheet.abilities.length ? (
              <div className="space-y-1">
                {sheet.abilities.map((f) => (
                  <details key={f.id} className="rounded-md border border-ink-700 px-2 py-1">
                    <summary className="cursor-pointer text-sm font-semibold text-gold-200">{f.name}</summary>
                    <p className="whitespace-pre-wrap pt-1 text-xs leading-relaxed text-marble-300">{f.text}</p>
                  </details>
                ))}
              </div>
            ) : (
              <Empty>No features recorded.</Empty>
            )}
          </section>
        </div>
      )}

      {tab === 'resources' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <ApexResources game={game} token={token} isGm={isGm} run={run} />
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
                      <input type="number" className={input} value={sheet.hitPoints![k]} onChange={(e) => set({ hitPoints: { ...sheet.hitPoints!, [k]: Math.round(Number(e.target.value) || 0) } })} />
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
                  <Resource
                    key={r.id}
                    label={r.name}
                    current={r.current}
                    max={r.max ?? undefined}
                    color="#7cc98a"
                    onDelta={(d) => void adjust('resource', d, r.id)}
                    onRemove={() =>
                      void quickSave((s) => {
                        s.resources = s.resources.filter((x) => x.id !== r.id);
                        // a resource orb pointing at the removed resource falls back to the automatic choice
                        if (s.orbs) {
                          const keep = (o: typeof s.orbs.primary) => (o?.type === 'resource' && o.resourceId === r.id ? null : o);
                          s.orbs = { primary: keep(s.orbs.primary), secondary: keep(s.orbs.secondary) };
                        }
                      })
                    }
                  />
                ))}
              </div>
            )}
            {!editing && !sheet.hitPoints && !sheet.resources.length && <Empty>No hit points or custom resources yet. Use “Edit” to add them.</Empty>}
          </section>
          <EntrySection title="Combat values" editing={editing} empty="Armor Class, initiative, speed …" rows={sheet.combat} onChange={(combat) => set({ combat })} wide />
        </div>
      )}

      {tab === 'equipment' && (
        <section className="panel p-3">
          <EquipmentPanel game={game} token={token} run={run} isGm={isGm} />
        </section>
      )}
      {tab === 'inventory' && <InventoryPanel token={token} run={run} busy={game.busy} rules={game.view.itemRules} isGm={isGm} game={game} embedded />}

      {tab === 'appearance' && (
        <div className="space-y-3">
          <AppearanceEditor game={game} token={token} run={run} notify={notify} />
          <EntrySection title="Physical description" editing={editing} empty="Gender, age, height, eyes, hair …" rows={sheet.appearance} onChange={(appearance) => set({ appearance })} wide>
            {!editing && (
              <button className="btn btn-ghost mt-2 px-2 py-0.5 text-xs" onClick={startEdit} disabled={!data}>
                ✎ Edit description
              </button>
            )}
          </EntrySection>
        </div>
      )}

      {tab === 'history' && <CharacterHistory game={game} token={token} isGm={isGm} sheet={data} run={run} notify={notify} onSheet={(p) => setData(p)} />}

      {tab === 'notes' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <EntrySection title="Details" editing={editing} empty="Class & level, background, alignment …" rows={sheet.details} onChange={(details) => set({ details })} />
          <section className="panel p-3">
            <h3 className="panel-title mb-2">Notes &amp; background</h3>
            {editing ? (
              <textarea className={`${input} min-h-48`} aria-label="Notes" value={sheet.notes} onChange={(e) => set({ notes: e.target.value })} />
            ) : sheet.notes ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-marble-100">{sheet.notes}</p>
            ) : (
              <Empty>No notes yet.</Empty>
            )}
          </section>
          {(sheet.raw.length > 0 || editing) && (
            <details className="panel p-3 lg:col-span-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-marble-300">Advanced – raw imported fields ({sheet.raw.length})</summary>
              <div className="mt-2">
                <EntryList editing={editing} rows={sheet.raw} onChange={(raw) => set({ raw })} empty="Nothing here." />
              </div>
            </details>
          )}
        </div>
      )}

      {importing && data && (
        <Suspense fallback={null}>
          <SheetImport
            characterName={token.name}
            current={data}
            inventoryNames={(details?.inventory ?? []).map((i) => i.name)}
            onClose={() => setImporting(false)}
            onSave={async (s, mode) => save(s, data.version, mode)}
            onAddItems={async (items) => {
              let added = 0;
              for (const it of items) {
                const r = await run({ type: 'invAddItem', tokenId: token.id, itemId: newEntryId('itm'), name: it.name, quantity: it.quantity, container: 'backpack' });
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

const sheetEmpty = (s: CharacterSheet) => !s.hitPoints && !s.attributes.length && !s.details.length && !s.skills.length && !s.abilities.length && !s.spells.length;
const toggle = (spells: SheetSpell[], id: string) => {
  const sp = spells.find((x) => x.id === id);
  if (sp && sp.level > 0) sp.prepared = !sp.prepared;
};

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-marble-500">{children}</p>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gold-700/40 bg-ink-900/60 p-2 text-center">
      <div className="truncate text-[10px] uppercase tracking-wider text-marble-500" title={label}>
        {label}
      </div>
      <div className="font-display text-xl font-bold text-marble-50">{value}</div>
      {sub && <div className="text-xs text-gold-200">{sub}</div>}
    </div>
  );
}

function ApexResources({ game, token, isGm, run }: { game: GameApi; token: TokenView; isGm: boolean; run: (cmd: Command) => Promise<DispatchResult> }) {
  const details = token.details;
  const canEditVitals = isGm || !!details;
  return (
    <section className="panel space-y-3 p-3">
      <h3 className="panel-title">Health, resources & movement</h3>
      <VitalsPanel game={game} token={token} canEdit={canEditVitals} />
      {details ? (
        <>
          <Resource
            label="Movement points"
            current={details.movePoints}
            max={details.maxMovePoints}
            color="#d6b878"
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
        <Empty>Not visible.</Empty>
      )}
    </section>
  );
}

function SkillSection({ title, rows, editing, onChange, prefix }: { title: string; rows: SheetSkill[]; editing: boolean; onChange: (r: SheetSkill[]) => void; prefix: string }) {
  return (
    <section className="panel p-3">
      <h3 className="panel-title mb-2">{title}</h3>
      {editing ? (
        <ListEditor
          rows={rows}
          make={(): SheetSkill => ({ id: newEntryId(prefix), name: '', value: '', proficient: false })}
          render={(sk, upd) => (
            <>
              <input className={input} aria-label={`${title} name`} placeholder="Name" value={sk.name} onChange={(e) => upd({ ...sk, name: e.target.value })} />
              <input className={`${input} w-16`} aria-label="Value" placeholder="+0" value={sk.value} onChange={(e) => upd({ ...sk, value: e.target.value })} />
              <label className="flex items-center gap-1 text-[11px] text-marble-300" title="Proficient">
                <input type="checkbox" checked={sk.proficient} onChange={(e) => upd({ ...sk, proficient: e.target.checked })} /> prof.
              </label>
              <label className="flex items-center gap-1 text-[11px] text-marble-300" title="Expertise">
                <input type="checkbox" checked={!!sk.expertise} onChange={(e) => upd({ ...sk, expertise: e.target.checked || undefined })} /> exp.
              </label>
            </>
          )}
          onChange={onChange}
          addLabel={`+ ${title === 'Skills' ? 'Skill' : 'Saving throw'}`}
        />
      ) : rows.length ? (
        <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {rows.map((sk) => (
            <li key={sk.id} className="flex justify-between border-b border-ink-700/60 py-0.5 text-sm">
              <span className={sk.proficient ? 'text-gold-200' : 'text-marble-300'}>
                <span aria-label={sk.expertise ? 'expertise' : sk.proficient ? 'proficient' : 'not proficient'}>{sk.expertise ? '◆ ' : sk.proficient ? '● ' : '○ '}</span>
                {sk.name}
              </span>
              <span className="tabular-nums text-marble-50">{sk.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing recorded.</Empty>
      )}
    </section>
  );
}

function SpellsSection({ sheet, editing, set, onToggle }: { sheet: CharacterSheet; editing: boolean; set: (p: Partial<CharacterSheet>) => void; onToggle: (id: string) => void }) {
  const [filter, setFilter] = useState<'prepared' | 'all'>('prepared');
  const [q, setQ] = useState('');
  const spells = sheet.spells;
  const levels = useMemo(() => [...new Set(spells.map((s) => s.level))].sort((a, b) => a - b), [spells]);
  const slots = sheet.resources.filter((r) => /^spell slots/i.test(r.name));
  const visible = (s: SheetSpell) => (filter === 'all' || s.level === 0 || s.prepared) && (!q || s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="panel p-3 lg:col-span-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="panel-title flex-1">Spells</h3>
        {!editing && spells.length > 0 && (
          <>
            <input className={`${input} w-40 py-0.5 text-xs`} placeholder="Search spells" aria-label="Search spells" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="inline-flex rounded-lg border border-ink-600 bg-ink-900 p-0.5 text-[11px]">
              {(['prepared', 'all'] as const).map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-md px-2 py-0.5 ${filter === f ? 'bg-gold-400/20 text-gold-200' : 'text-marble-300'}`}>
                  {f === 'prepared' ? 'Prepared' : 'All known'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {slots.length > 0 && (
        <p className="mb-2 text-xs text-marble-300">
          {slots.map((s) => `${s.name}: ${s.current}${s.max !== null ? ` / ${s.max}` : ''}`).join(' · ')} <span className="text-marble-500">(adjust in Resources)</span>
        </p>
      )}
      {editing ? (
        <ListEditor
          rows={spells}
          make={() => ({ id: newEntryId('sp'), name: '', level: 1, prepared: false, source: '', notes: '' })}
          render={(s, upd) => (
            <>
              <input className={input} aria-label="Spell name" placeholder="Spell" value={s.name} onChange={(e) => upd({ ...s, name: e.target.value })} />
              <select className={`${input} w-24`} aria-label="Spell level" value={s.level} onChange={(e) => upd({ ...s, level: Number(e.target.value), prepared: Number(e.target.value) === 0 || s.prepared })}>
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? 'Cantrip' : `Level ${i}`}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[11px] text-marble-300">
                <input type="checkbox" checked={s.prepared} disabled={s.level === 0} onChange={(e) => upd({ ...s, prepared: e.target.checked })} /> prepared
              </label>
            </>
          )}
          onChange={(next) => set({ spells: next })}
          addLabel="+ Spell"
        />
      ) : spells.length ? (
        levels.map((lvl) => {
          const list = spells.filter((s) => s.level === lvl && visible(s));
          if (!list.length) return null;
          return (
            <div key={lvl} className="mb-2">
              <div className="label mb-1">{lvl === 0 ? 'Cantrips' : `Level ${lvl}`}</div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {list.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-md border border-ink-700 px-2 py-1 text-sm">
                    <span className={`min-w-0 flex-1 truncate ${s.prepared ? 'text-gold-200' : 'text-marble-300'}`}>{s.name}</span>
                    {s.source && <span className="text-[10px] text-marble-500">{s.source}</span>}
                    {lvl > 0 && (
                      <label className="flex items-center gap-1 text-[10px] text-marble-300">
                        <input type="checkbox" checked={s.prepared} onChange={() => onToggle(s.id)} aria-label={`${s.name} prepared`} /> prepared
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      ) : (
        <Empty>No spells recorded.</Empty>
      )}
    </section>
  );
}

function SmallBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button className="btn btn-ghost h-7 w-7 px-0" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

function Resource({ label, current, max, color, onDelta, big = false, hint, onRemove }: { label: string; current: number; max?: number; color: string; onDelta?: (d: number) => void; big?: boolean; hint?: string; onRemove?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900/50 p-2" title={hint} data-resource={label}>
      {confirm && onRemove && (
        <div role="alertdialog" aria-label={`Remove ${label}?`} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md border border-blood-400/60 bg-blood-800/30 p-1.5 text-[11px] text-marble-100">
          <span className="flex-1">Remove the custom resource “{label}”? Nothing else on the sheet changes.</span>
          <button className="btn btn-ghost px-2 py-0.5" onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button className="btn btn-gold px-2 py-0.5" onClick={() => (setConfirm(false), onRemove())}>
            Remove
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-marble-300">
          {label}
          {onRemove && (
            <button className="text-marble-600 hover:text-blood-400" aria-label={`Remove ${label}`} title="Remove this custom resource" onClick={() => setConfirm(true)}>
              ✕
            </button>
          )}
        </span>
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

function ListEditor<T extends { id: string }>({ rows, make, render, onChange, addLabel }: { rows: T[]; make: () => T; render: (row: T, update: (r: T) => void) => ReactNode; onChange: (rows: T[]) => void; addLabel: string }) {
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
            <input className={input} aria-label="Resource name" placeholder="Name (e.g. Spell slots (level 1), Luck)" value={r.name} onChange={(e) => upd({ ...r, name: e.target.value })} />
            <input className={`${input} w-20`} type="number" aria-label="Current" value={r.current} onChange={(e) => upd({ ...r, current: Math.round(Number(e.target.value) || 0) })} />
            <input className={`${input} w-20`} type="number" aria-label="Maximum (empty = none)" placeholder="max" value={r.max ?? ''} onChange={(e) => upd({ ...r, max: e.target.value === '' ? null : Math.round(Number(e.target.value) || 0) })} />
          </>
        )}
        onChange={onChange}
        addLabel="+ Resource"
      />
    </div>
  );
}

function EntryList({ editing, rows, onChange, empty }: { editing: boolean; rows: SheetEntry[]; onChange: (rows: SheetEntry[]) => void; empty: string }) {
  return editing ? (
    <ListEditor
      rows={rows}
      make={() => ({ id: newEntryId('d'), label: '', value: '' })}
      render={(r, upd) => (
        <>
          <input className={`${input} w-2/5`} aria-label="Label" placeholder="Label" value={r.label} onChange={(e) => upd({ ...r, label: e.target.value })} />
          <input className={input} aria-label="Value" placeholder="Value" value={r.value} onChange={(e) => upd({ ...r, value: e.target.value })} />
        </>
      )}
      onChange={onChange}
      addLabel="+ Entry"
    />
  ) : rows.length ? (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.id} className="contents">
          <dt className="text-marble-500">{r.label}</dt>
          <dd className="whitespace-pre-wrap text-marble-50">{r.value}</dd>
        </div>
      ))}
    </dl>
  ) : (
    <Empty>{empty}</Empty>
  );
}

function EntrySection({ title, editing, rows, empty, onChange, wide, children }: { title: string; editing: boolean; rows: SheetEntry[]; empty: string; onChange: (rows: SheetEntry[]) => void; wide?: boolean; children?: ReactNode }) {
  return (
    <section className={`panel p-3 ${wide ? 'lg:col-span-full' : ''}`}>
      <h3 className="panel-title mb-2">{title}</h3>
      <EntryList editing={editing} rows={rows} onChange={onChange} empty={empty} />
      {children}
    </section>
  );
}
