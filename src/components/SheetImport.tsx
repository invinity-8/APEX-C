/**
 * "Import Character Sheet": choose PDF → read it in the browser → readable, grouped preview that
 * can be corrected → merge / replace / cancel. Nothing is saved before the player confirms; values
 * that would overwrite existing sheet data are marked and need an explicit confirmation; replacing
 * always keeps a server-side backup. Unrecognised fields stay in a collapsed Advanced section.
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { MAX_PROGRESSION, mergeSheets, sheetIsEmpty, type CharacterSheet } from '../game/sheet';
import { applyLevelUp, newProgressionId, sheetLevel } from '../game/progression';
import type { SheetPayload } from '../server/protocol';
import { extractPdf, MAX_PDF_BYTES, PdfImportError } from '../sheetImport/extract';
import { GROUP_LABEL, mapExtraction, rowsToSheet, type ImportedItem, type ImportGroup, type ImportRow, type RowStatus } from '../sheetImport/map';
import { Spinner } from './brand';

interface Props {
  characterName: string;
  current: SheetPayload;
  inventoryNames: string[];
  onClose: () => void;
  onSave: (sheet: CharacterSheet, mode: 'import-merge' | 'import-replace' | 'import-levelup') => Promise<boolean>;
  onAddItems: (items: ImportedItem[]) => Promise<number>;
}

type Step = { kind: 'pick' } | { kind: 'reading'; name: string } | { kind: 'review'; fileName: string; format: string } | { kind: 'error'; message: string };

const ORDER: ImportGroup[] = ['identity', 'attributes', 'combat', 'skills', 'features', 'spells', 'equipment', 'background'];
const STATUS: Record<RowStatus, { text: string; cls: string }> = {
  recognized: { text: 'Recognized', cls: 'border-emerald-500/50 text-emerald-300' },
  uncertain: { text: 'Please check', cls: 'border-amber-400/60 text-amber-200' },
  missing: { text: 'Missing', cls: 'border-blood-400/60 text-red-300' },
  unrecognized: { text: 'Unknown', cls: 'border-ink-500 text-marble-500' },
};
const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-marble-50 focus:border-gold-400 focus:outline-none';
const n = (s: string) => s.trim().toLowerCase();

/** The value this row would overwrite in the current sheet (null = nothing / identical). */
function existingValue(r: ImportRow, s: CharacterSheet): string | null {
  const diff = (old: string | undefined) => (old !== undefined && old.trim() !== '' && n(old) !== n(r.value) ? old : null);
  switch (r.kind) {
    case 'detail':
      return diff(s.details.find((d) => n(d.label) === n(r.label))?.value);
    case 'appearance':
      return diff(s.appearance.find((d) => n(d.label) === n(r.label))?.value);
    case 'combat':
      return diff(s.combat.find((d) => n(d.label) === n(r.label))?.value);
    case 'spellcasting':
      return diff(s.spellcasting.find((d) => n(d.label) === n(r.label))?.value);
    case 'attribute': {
      const a = s.attributes.find((d) => n(d.name) === n(r.label));
      return a && (a.value !== r.value || (r.modifier ?? '') !== a.modifier) ? `${a.value} (${a.modifier})` : null;
    }
    case 'skill':
      return diff(s.skills.find((d) => n(d.name) === n(r.label))?.value);
    case 'save':
      return diff(s.saves.find((d) => n(d.name) === n(r.label))?.value);
    case 'feature':
      return diff(s.abilities.find((d) => n(d.name) === n(r.label))?.text);
    case 'hp':
      return s.hitPoints && r.hp && String(s.hitPoints[r.hp]) !== r.value.trim() ? String(s.hitPoints[r.hp]) : null;
    case 'resource': {
      const x = s.resources.find((d) => n(d.name) === n(r.label));
      return x && String(x.current) !== r.value.trim() ? String(x.current) : null;
    }
    default:
      return null;
  }
}

/** Level-up mode: does this PDF row change the current sheet? ('item' rows never touch the sheet.) */
export function rowChange(r: ImportRow, s: CharacterSheet): 'same' | 'changed' | 'new' | 'item' {
  if (r.kind === 'item') return 'item';
  if (existingValue(r, s) !== null) return 'changed';
  const has = (list: Array<{ label?: string; name?: string }>) => list.some((d) => n(d.label ?? d.name ?? '') === n(r.label));
  switch (r.kind) {
    case 'detail':
      return has(s.details) ? 'same' : 'new';
    case 'appearance':
      return has(s.appearance) ? 'same' : 'new';
    case 'combat':
      return has(s.combat) ? 'same' : 'new';
    case 'spellcasting':
      return has(s.spellcasting) ? 'same' : 'new';
    case 'attribute':
      return has(s.attributes) ? 'same' : 'new';
    case 'skill':
      return has(s.skills) ? 'same' : 'new';
    case 'save':
      return has(s.saves) ? 'same' : 'new';
    case 'feature':
      return has(s.abilities) ? 'same' : 'new';
    case 'resource': {
      const x = s.resources.find((d) => n(d.name) === n(r.label));
      if (!x) return 'new';
      const max = r.modifier && /^\d+$/.test(r.modifier) ? Number(r.modifier) : null;
      return max !== null && max !== x.max ? 'changed' : 'same';
    }
    case 'hp':
      if (!s.hitPoints) return 'new';
      return r.hp === 'max' && String(s.hitPoints.max) !== r.value.trim() ? 'changed' : 'same';
    case 'spell':
      return s.spells.some((x) => n(x.name) === n(r.value || r.label) && x.level === (r.level ?? 1)) ? 'same' : 'new';
    case 'attack':
      return s.attacks.some((x) => n(x.name) === n(r.value)) ? 'same' : 'new';
    case 'note':
      return s.notes.includes(r.value.trim()) ? 'same' : 'new';
    default:
      return 'same';
  }
}

export function SheetImport({ characterName, current, inventoryNames, onClose, onSave, onAddItems }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  // APEX 0.7: an existing character gets the incremental "level-up" update by default
  const [mode, setMode] = useState<'update' | 'full'>('update');
  const [refill, setRefill] = useState(false);
  const [lvNote, setLvNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hasExisting = !sheetIsEmpty(current.sheet);
  const owned = useMemo(() => new Set(inventoryNames.map(n)), [inventoryNames]);

  const read = async (file: File) => {
    setStep({ kind: 'reading', name: file.name });
    try {
      const x = await extractPdf(file);
      const m = mapExtraction(x);
      if (m.imageOnly) {
        setStep({
          kind: 'error',
          message:
            'This PDF contains no readable text or form fields – it is probably a scan or a picture. APEX cannot read scanned sheets (no OCR available). Please export the sheet as a text or fillable PDF, or enter the values manually with “Edit”.',
        });
        return;
      }
      setRows(m.rows.map((r) => (r.kind === 'item' && owned.has(n(r.value)) ? { ...r, include: false, note: 'Already in the inventory – not added again.' } : r)));
      if (hasExisting) setMode('update');
      setStep({ kind: 'review', fileName: file.name, format: m.format });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof PdfImportError ? e.message : 'The PDF could not be read. Please try another file.' });
    }
  };

  const update = (key: string, patch: Partial<ImportRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, ...(patch.value !== undefined && r.status === 'missing' ? { include: !!patch.value.trim() } : {}) } : r)));
  const setGroup = (g: ImportGroup, include: boolean) => setRows((rs) => rs.map((r) => (r.group === g && r.status !== 'missing' ? { ...r, include } : r)));

  const overwrites = hasExisting ? rows.filter((r) => r.include && existingValue(r, current.sheet) !== null) : [];

  const finish = async (mode: 'import-merge' | 'import-replace') => {
    if (step.kind !== 'review') return;
    const built = rowsToSheet(rows, { fileName: step.fileName, format: step.format });
    if (built.problems.length) return setProblems(built.problems);
    // Never "save" an import that carries no character data (the sheet would only get a file name).
    if (sheetIsEmpty(built.sheet) && !built.items.length)
      return setProblems(['Nothing from this PDF is selected for import, so nothing would be saved. Fill in or tick the values to keep, or close the import.']);
    if (hasExisting && !confirmOverwrite && (mode === 'import-replace' || overwrites.length)) {
      return setProblems([mode === 'import-replace' ? 'Please confirm that the current sheet will be replaced (a backup is kept).' : 'Please confirm that the marked values will be overwritten.']);
    }
    setBusy(true);
    const sheet = mode === 'import-merge' ? mergeSheets(current.sheet, built.sheet) : built.sheet;
    const ok = await onSave(sheet, mode);
    if (ok && built.items.length) await onAddItems(built.items);
    setBusy(false);
    if (ok) onClose();
  };

  // ---- level-up / incremental update
  const lvRows = hasExisting ? rows.map((r) => ({ r, change: rowChange(r, current.sheet) })).filter((x) => x.change === 'changed' || x.change === 'new') : [];
  const [lvPick, setLvPick] = useState<Record<string, boolean>>({});
  const picked = (key: string, change: string, r: ImportRow) => lvPick[key] ?? (r.status !== 'missing' && !(r.kind === 'hp' && r.hp !== 'max') && change !== 'item');
  const applyUpdate = async () => {
    if (step.kind !== 'review') return;
    const chosen = lvRows.filter((x) => picked(x.r.key, x.change, x.r));
    if (!chosen.length) return setProblems(['No change is selected – nothing to apply.']);
    const keys = new Set(chosen.map((x) => x.r.key));
    const built = rowsToSheet(
      rows.map((r) => ({ ...r, include: keys.has(r.key) })),
      { fileName: step.fileName, format: step.format },
    );
    if (built.problems.length) return setProblems(built.problems);
    const next = applyLevelUp(current.sheet, built.sheet, { refillCurrent: refill, mergeSheets });
    const entry = {
      id: newProgressionId(),
      at: new Date().toISOString(),
      fromLevel: sheetLevel(current.sheet),
      toLevel: sheetLevel(next),
      fileName: step.fileName.slice(0, 200),
      changed: lvRows.map((x) => x.r.label),
      approved: chosen.map((x) => x.r.label),
      note: lvNote.trim().slice(0, 2000),
    };
    next.progression = [...(current.sheet.progression ?? []), entry].slice(-MAX_PROGRESSION);
    setBusy(true);
    const ok = await onSave(next, 'import-levelup');
    setBusy(false);
    if (ok) onClose();
  };
  const fromLevel = hasExisting ? sheetLevel(current.sheet) : null;
  const toLevel = useMemo(() => {
    if (!hasExisting || step.kind !== 'review') return null;
    return sheetLevel(rowsToSheet(rows.map((r) => ({ ...r, include: r.kind === 'detail' })), { fileName: '', format: '' }).sheet);
  }, [rows, hasExisting, step.kind]);

  const counts = rows.reduce<Record<RowStatus, number>>((a, r) => ((a[r.status] += 1), a), { recognized: 0, uncertain: 0, missing: 0, unrecognized: 0 });
  const raw = rows.filter((r) => r.group === 'raw');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="panel w-full max-w-4xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="font-display text-xl font-bold text-gold-200">
            Import character sheet – {characterName}
          </h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>

        {step.kind === 'pick' && (
          <div className="mt-3 space-y-3 text-sm text-marble-300">
            <p>Choose your character sheet as a PDF. APEX reads it directly in your browser – the file itself is not uploaded or stored.</p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>
                <b className="text-marble-100">Aurora Builder</b> PDFs are fully supported (form fields: abilities, skills, saves, spells with prepared flags,
                equipment, currency).
              </li>
              <li>Other fillable sheets (e.g. the official D&amp;D 5e sheet) and text PDFs work too; guessed values are marked “Please check”.</li>
              <li>Scanned / photographed sheets cannot be read (no OCR) – enter those values manually.</li>
            </ul>
            <p className="text-xs text-marble-500">You will see a preview of every value before anything is saved. Maximum size {MAX_PDF_BYTES / 1048576} MB.</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              aria-label="Choose a PDF file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void read(f);
              }}
            />
            <button className="btn btn-gold" onClick={() => fileRef.current?.click()}>
              Choose PDF…
            </button>
          </div>
        )}

        {step.kind === 'reading' && (
          <p className="mt-4 flex items-center gap-2 text-sm text-marble-300" role="status">
            <Spinner /> Reading {step.name}…
          </p>
        )}

        {step.kind === 'error' && (
          <div className="mt-4 space-y-3">
            <p role="alert" className="rounded-lg border border-blood-400/50 bg-blood-600/20 p-3 text-sm text-red-200">
              {step.message}
            </p>
            <button className="btn btn-ghost" onClick={() => setStep({ kind: 'pick' })}>
              Choose another file
            </button>
          </div>
        )}

        {step.kind === 'review' && hasExisting && (
          <div className="mt-3 flex flex-wrap gap-1 text-xs" role="tablist" aria-label="Import mode">
            <button role="tab" aria-selected={mode === 'update'} className={`rounded-lg px-3 py-1 ${mode === 'update' ? 'bg-gold-400/20 text-gold-200' : 'text-marble-300 hover:bg-ink-800'}`} onClick={() => setMode('update')}>
              Update (level-up) – only changes
            </button>
            <button role="tab" aria-selected={mode === 'full'} className={`rounded-lg px-3 py-1 ${mode === 'full' ? 'bg-gold-400/20 text-gold-200' : 'text-marble-300 hover:bg-ink-800'}`} onClick={() => setMode('full')}>
              Full review (merge / replace)
            </button>
          </div>
        )}

        {step.kind === 'review' && hasExisting && mode === 'update' && (
          <div className="mt-3 space-y-3 text-xs" aria-label="Level-up changes">
            <p className="rounded-lg border border-gold-700/40 bg-ink-900/60 p-2 text-sm text-marble-200">
              {fromLevel !== null && toLevel !== null && fromLevel !== toLevel ? (
                <b className="text-gold-200" data-testid="levelup-levels">
                  Level {fromLevel} → {toLevel}
                </b>
              ) : (
                <b className="text-gold-200">Sheet update</b>
              )}{' '}
              · {lvRows.length} changed or new values in <b className="text-marble-50">{step.fileName}</b>. Only the ticked changes are applied – everything else (manual edits, title, portrait, appearance, items, currency) stays as it is. A character snapshot is created first.
            </p>
            {!lvRows.length && <p className="text-marble-400">This PDF contains no changes compared with the current sheet.</p>}
            {ORDER.filter((g) => lvRows.some((x) => x.r.group === g)).map((g) => {
              const inG = lvRows.filter((x) => x.r.group === g);
              return (
                <fieldset key={g} className="rounded-lg border border-ink-600 p-2">
                  <legend className="flex items-center gap-2 px-1 font-semibold uppercase tracking-wider text-gold-300">
                    {GROUP_LABEL[g]}
                    <button type="button" className="text-[10px] font-normal normal-case text-marble-400 hover:text-gold-200" onClick={() => setLvPick((p) => ({ ...p, ...Object.fromEntries(inG.map((x) => [x.r.key, true])) }))}>
                      all
                    </button>
                    <button type="button" className="text-[10px] font-normal normal-case text-marble-400 hover:text-gold-200" onClick={() => setLvPick((p) => ({ ...p, ...Object.fromEntries(inG.map((x) => [x.r.key, false])) }))}>
                      none
                    </button>
                  </legend>
                  <ul className="space-y-0.5">
                    {inG.map(({ r, change }) => {
                      const old = existingValue(r, current.sheet);
                      const label = r.kind === 'spell' ? `Spell: ${r.value || r.label}` : r.kind === 'feature' ? `${change === 'new' ? 'New feature' : 'Feature'}: ${r.label}` : r.kind === 'hp' ? (r.hp === 'max' ? 'Maximum HP' : r.hp === 'current' ? 'Current HP' : 'Temporary HP') : r.label;
                      const after = r.kind === 'feature' ? (change === 'new' ? 'new' : 'updated text') : r.kind === 'attribute' ? `${r.value}${r.modifier ? ` (${r.modifier})` : ''}` : r.kind === 'resource' ? `max ${r.modifier ?? r.value}` : r.kind === 'spell' ? (r.level ? `level ${r.level}` : 'cantrip') : r.value;
                      return (
                        <li key={r.key} data-levelup={r.label}>
                          <label className="flex items-start gap-2 text-marble-200">
                            <input type="checkbox" checked={picked(r.key, change, r)} onChange={(e) => setLvPick((p) => ({ ...p, [r.key]: e.target.checked }))} aria-label={`Apply ${label}`} />
                            <span>
                              <b className="text-marble-50">{label}</b>: {change === 'new' ? <span className="text-emerald-300">new</span> : <span className="text-marble-400">{r.kind === 'resource' ? `max ${current.sheet.resources.find((x) => n(x.name) === n(r.label))?.max ?? '—'}` : r.kind === 'hp' ? String(current.sheet.hitPoints?.max ?? '—') : (old ?? '—')}</span>}
                              {change !== 'new' && ' → '}
                              {change !== 'new' && <span className="text-gold-100">{after}</span>}
                              {change === 'new' && r.kind !== 'feature' && after && <span className="text-gold-100"> {after}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              );
            })}
            <label className="flex items-start gap-2 text-marble-300">
              <input type="checkbox" checked={refill} onChange={(e) => setRefill(e.target.checked)} />
              <span>Also take <b>current</b> hit points and current resource uses from the PDF (otherwise only maxima change; current values are kept).</span>
            </label>
            <label className="block text-marble-300">
              Note for the history (optional)
              <input className={input} value={lvNote} maxLength={500} onChange={(e) => setLvNote(e.target.value)} aria-label="Level-up note" placeholder="e.g. After the Arena Trial" />
            </label>
            {problems.length > 0 && (
              <ul role="alert" className="list-disc rounded-lg border border-blood-400/50 bg-blood-600/20 p-2 pl-6 text-red-200">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2 border-t border-ink-600 pt-3">
              <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={() => void applyUpdate()} disabled={busy || !lvRows.length}>
                {busy && <Spinner />} Apply {lvRows.filter((x) => picked(x.r.key, x.change, x.r)).length} selected changes
              </button>
            </div>
          </div>
        )}

        {step.kind === 'review' && (!hasExisting || mode === 'full') && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-marble-300">
              <span>
                <b className="text-marble-50">{step.fileName}</b> · {step.format}
              </span>
              {(['recognized', 'uncertain', 'missing'] as RowStatus[]).map((s) =>
                counts[s] ? (
                  <span key={s} className={`chip ${STATUS[s].cls}`}>
                    {counts[s]} {STATUS[s].text.toLowerCase()}
                  </span>
                ) : null,
              )}
              {overwrites.length > 0 && <span className="chip border-blood-400/60 text-red-200">{overwrites.length} would overwrite existing values</span>}
            </div>
            <p className="text-xs text-marble-500">Check and correct the values. Only ticked entries are imported. You can change everything later in the character sheet.</p>

            {ORDER.filter((g) => rows.some((r) => r.group === g)).map((g) => (
              <Group key={g} title={GROUP_LABEL[g]} rows={rows.filter((r) => r.group === g)} onAll={(v) => setGroup(g, v)} defaultOpen={g !== 'spells' || rows.filter((r) => r.kind === 'spell').length < 25}>
                {g === 'attributes' ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {rows.filter((r) => r.group === g).map((r) => (
                      <AttributeCard key={r.key} r={r} over={hasExisting ? existingValue(r, current.sheet) : null} update={update} />
                    ))}
                  </div>
                ) : g === 'spells' ? (
                  <SpellsSection rows={rows.filter((r) => r.group === g)} update={update} />
                ) : (
                  <ul className="space-y-1.5">
                    {rows.filter((r) => r.group === g).map((r) => (
                      <RowEditor key={r.key} r={r} over={hasExisting ? existingValue(r, current.sheet) : null} update={update} />
                    ))}
                  </ul>
                )}
              </Group>
            ))}

            {raw.length > 0 && (
              <details className="rounded-lg border border-ink-600 p-2">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-marble-300">
                  {GROUP_LABEL.raw} ({raw.length}) – not part of the character sheet
                </summary>
                <p className="mt-1 text-[11px] text-marble-500">Fields APEX does not understand. Ticked entries are kept in the sheet’s Advanced section only.</p>
                <ul className="mt-2 space-y-1.5">
                  {raw.map((r) => (
                    <RowEditor key={r.key} r={r} over={null} update={update} />
                  ))}
                </ul>
              </details>
            )}

            {problems.length > 0 && (
              <ul role="alert" className="list-disc rounded-lg border border-blood-400/50 bg-blood-600/20 p-2 pl-6 text-xs text-red-200">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="space-y-2 border-t border-ink-600 pt-3">
              {hasExisting && (
                <label className="flex items-start gap-2 text-xs text-marble-300">
                  <input type="checkbox" checked={confirmOverwrite} onChange={(e) => setConfirmOverwrite(e.target.checked)} />
                  <span>
                    {characterName} already has a sheet. I understand that <b className="text-marble-50">merge</b> overwrites the {overwrites.length} marked value
                    {overwrites.length === 1 ? '' : 's'} and <b className="text-marble-50">replace</b> replaces the whole sheet (a backup is kept on the server).
                  </span>
                </label>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                {hasExisting ? (
                  <>
                    <button className="btn btn-ghost" onClick={() => void finish('import-replace')} disabled={busy}>
                      Replace current sheet
                    </button>
                    <button className="btn btn-gold" onClick={() => void finish('import-merge')} disabled={busy}>
                      {busy && <Spinner />} Merge into current sheet
                    </button>
                  </>
                ) : (
                  <button className="btn btn-gold" onClick={() => void finish('import-replace')} disabled={busy}>
                    {busy && <Spinner />} Save character sheet
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, rows, onAll, defaultOpen, children }: { title: string; rows: ImportRow[]; onAll: (v: boolean) => void; defaultOpen: boolean; children: ReactNode }) {
  const spells = rows.filter((r) => r.kind === 'spell');
  const spellSummary = spells.length
    ? `${spells.filter((s) => s.level === 0).length} cantrips · ${spells.filter((s) => (s.level ?? 1) > 0 && s.prepared).length} prepared · ${spells.filter((s) => (s.level ?? 1) > 0).length} known`
    : null;
  const included = rows.filter((r) => r.include).length;
  const flagged = rows.filter((r) => r.status === 'uncertain' || r.status === 'missing').length;
  return (
    <details open={defaultOpen} className="rounded-lg border border-ink-600 bg-ink-900/30 p-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-gold-300">{title}</span>
        <span className="text-marble-500">
          {included}/{rows.length} selected
        </span>
        {spellSummary && <span className="text-gold-200">{spellSummary}</span>}
        {flagged > 0 && <span className="chip border-amber-400/60 text-amber-200">{flagged} to check</span>}
        <span className="ml-auto flex gap-2 text-[11px]">
          <button type="button" className="text-marble-300 hover:text-gold-200" onClick={(e) => (e.preventDefault(), onAll(true))}>
            all
          </button>
          <button type="button" className="text-marble-300 hover:text-gold-200" onClick={(e) => (e.preventDefault(), onAll(false))}>
            none
          </button>
        </span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Badge({ r, over }: { r: ImportRow; over: string | null }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {r.status !== 'recognized' && <span className={`chip whitespace-nowrap ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span>}
      {over !== null && r.include && (
        <span className="chip whitespace-nowrap border-blood-400/60 text-red-200" title={`Current value: ${over}`}>
          overwrites “{over.length > 24 ? `${over.slice(0, 24)}…` : over}”
        </span>
      )}
    </span>
  );
}

function RowEditor({ r, over, update }: { r: ImportRow; over: string | null; update: (key: string, p: Partial<ImportRow>) => void }) {
  const long = r.kind === 'feature' || r.kind === 'note' || r.value.length > 90;
  return (
    <li className={`grid grid-cols-[auto_1fr] gap-2 rounded-md p-1 ${r.include ? '' : 'opacity-60'}`} title={r.source !== '—' ? `Source: ${r.source}` : undefined}>
      <input type="checkbox" className="mt-1.5" checked={r.include} aria-label={`Import ${r.label}`} onChange={(e) => update(r.key, { include: e.target.checked })} />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {r.kind === 'raw' || r.kind === 'feature' ? (
            <input className={`${input} max-w-xs font-semibold`} aria-label="Label" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} />
          ) : (
            <span className="text-xs font-semibold text-marble-100">{r.label}</span>
          )}
          {(r.kind === 'skill' || r.kind === 'save') && (
            <label className="flex items-center gap-1 text-[11px] text-marble-300">
              <input type="checkbox" checked={!!r.proficient} onChange={(e) => update(r.key, { proficient: e.target.checked })} /> proficient
              {r.expertise && <span className="text-gold-200">· expertise</span>}
            </label>
          )}
          <span className="ml-auto">
            <Badge r={r} over={over} />
          </span>
        </div>
        {long ? (
          <textarea className={`${input} min-h-14`} aria-label={`Value of ${r.label}`} value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} />
        ) : r.kind === 'attack' ? (
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <input className={input} aria-label="Weapon" value={r.value} onChange={(e) => update(r.key, { value: e.target.value, label: e.target.value })} />
            <input className={input} aria-label="Attack" placeholder="Attack" value={r.bonus ?? ''} onChange={(e) => update(r.key, { bonus: e.target.value })} />
            <input className={input} aria-label="Damage" placeholder="Damage" value={r.damage ?? ''} onChange={(e) => update(r.key, { damage: e.target.value })} />
            <input className={input} aria-label="Range" placeholder="Range" value={r.range ?? ''} onChange={(e) => update(r.key, { range: e.target.value })} />
          </div>
        ) : (
          <div className="flex gap-1">
            <input className={input} aria-label={`Value of ${r.label}`} value={r.value} placeholder={r.status === 'missing' ? 'not found – type to add' : ''} onChange={(e) => update(r.key, { value: e.target.value })} />
            {r.kind === 'resource' && <input className={`${input} w-16`} aria-label={`Maximum of ${r.label}`} placeholder="max" value={r.modifier ?? ''} onChange={(e) => update(r.key, { modifier: e.target.value })} />}
            {r.kind === 'item' && (
              <input className={`${input} w-16`} type="number" min={0} aria-label={`Quantity of ${r.label}`} value={r.quantity ?? 1} onChange={(e) => update(r.key, { quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            )}
          </div>
        )}
        {r.note && <p className="text-[10px] text-marble-500">{r.note}</p>}
      </div>
    </li>
  );
}

function AttributeCard({ r, over, update }: { r: ImportRow; over: string | null; update: (key: string, p: Partial<ImportRow>) => void }) {
  return (
    <div className={`rounded-lg border border-gold-700/40 bg-ink-900/60 p-2 ${r.include ? '' : 'opacity-60'}`}>
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-marble-500">
        <input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} aria-label={`Import ${r.label}`} />
        {r.label}
      </label>
      <div className="mt-1 flex gap-1">
        <input className={`${input} text-center text-base font-bold`} aria-label={`Value of ${r.label}`} value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} />
        <input className={`${input} w-14 text-center`} aria-label={`Modifier of ${r.label}`} placeholder="mod" value={r.modifier ?? ''} onChange={(e) => update(r.key, { modifier: e.target.value })} />
      </div>
      <div className="mt-1">
        <Badge r={r} over={over} />
      </div>
    </div>
  );
}

function SpellsSection({ rows, update }: { rows: ImportRow[]; update: (key: string, p: Partial<ImportRow>) => void }) {
  const [onlyPrepared, setOnlyPrepared] = useState(false);
  const spells = rows.filter((r) => r.kind === 'spell');
  const other = rows.filter((r) => r.kind !== 'spell');
  const levels = [...new Set(spells.map((s) => s.level ?? 1))].sort((a, b) => a - b);
  const prepared = spells.filter((s) => (s.level ?? 1) > 0 && s.prepared).length;
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {other.map((r) => (
          <RowEditor key={r.key} r={r} over={null} update={update} />
        ))}
      </ul>
      {spells.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-marble-300">
            <span>
              {spells.filter((s) => s.level === 0).length} cantrips · {prepared} prepared · {spells.filter((s) => (s.level ?? 1) > 0).length} spells known/available
            </span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={onlyPrepared} onChange={(e) => setOnlyPrepared(e.target.checked)} /> show only cantrips &amp; prepared
            </label>
          </div>
          {levels.map((lvl) => (
            <div key={lvl}>
              <div className="label mb-1">{lvl === 0 ? 'Cantrips (always prepared)' : `Level ${lvl}`}</div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {spells
                  .filter((s) => (s.level ?? 1) === lvl && (!onlyPrepared || lvl === 0 || s.prepared))
                  .map((s) => (
                    <li key={s.key} className={`flex items-center gap-2 rounded-md border border-ink-700 px-2 py-1 text-xs ${s.include ? '' : 'opacity-50'}`}>
                      <input type="checkbox" checked={s.include} aria-label={`Import ${s.label}`} onChange={(e) => update(s.key, { include: e.target.checked })} />
                      <span className={`min-w-0 flex-1 truncate ${s.prepared || lvl === 0 ? 'text-gold-200' : 'text-marble-100'}`}>{s.label}</span>
                      {lvl > 0 && (
                        <label className="flex items-center gap-1 text-[10px] text-marble-300">
                          <input type="checkbox" checked={!!s.prepared} onChange={(e) => update(s.key, { prepared: e.target.checked })} aria-label={`${s.label} prepared`} /> prepared
                        </label>
                      )}
                      {s.status === 'uncertain' && <span className={`chip ${STATUS.uncertain.cls}`}>check</span>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
