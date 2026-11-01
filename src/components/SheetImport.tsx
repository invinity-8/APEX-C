/**
 * "Import Character Sheet" dialog: choose PDF → extract in the browser → review every value
 * (recognized / uncertain / missing / unrecognized) → merge, replace or cancel.
 * Nothing is saved before the player confirms; replacing always keeps a backup on the server.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { mergeSheets, sheetIsEmpty, type CharacterSheet } from '../game/sheet';
import type { SheetPayload } from '../server/protocol';
import { extractPdf, MAX_PDF_BYTES, PdfImportError } from '../sheetImport/extract';
import { mapExtraction, rowsToSheet, type ImportRow, type RowSection, type RowStatus } from '../sheetImport/map';
import { Spinner } from './brand';

interface Props {
  characterName: string;
  current: SheetPayload;
  inventoryNames: string[];
  onClose: () => void;
  onSave: (sheet: CharacterSheet, mode: 'import-merge' | 'import-replace') => Promise<boolean>;
  onAddItems: (names: string[]) => Promise<number>;
}

type Step = { kind: 'pick' } | { kind: 'reading'; name: string } | { kind: 'review'; fileName: string; format: string } | { kind: 'error'; message: string };

const SECTION_LABEL: Record<RowSection, string> = {
  details: 'Details',
  attributes: 'Attributes',
  hitPoints: 'Hit points',
  skills: 'Skills & saving throws',
  resources: 'Resources',
  abilities: 'Abilities, features & texts',
  inventory: 'Equipment → inventory',
  notes: 'Notes',
};
const STATUS: Record<RowStatus, { text: string; cls: string }> = {
  recognized: { text: 'Recognized', cls: 'border-emerald-500/50 text-emerald-300' },
  uncertain: { text: 'Please check', cls: 'border-amber-400/60 text-amber-200' },
  missing: { text: 'Missing', cls: 'border-blood-400/60 text-red-300' },
  unrecognized: { text: 'Unknown field', cls: 'border-ink-500 text-marble-500' },
};
const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-marble-50 focus:border-gold-400 focus:outline-none';

export function SheetImport({ characterName, current, inventoryNames, onClose, onSave, onAddItems }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hasExisting = !sheetIsEmpty(current.sheet);
  const owned = useMemo(() => new Set(inventoryNames.map((n) => n.trim().toLowerCase())), [inventoryNames]);

  const read = async (file: File) => {
    setStep({ kind: 'reading', name: file.name });
    try {
      const x = await extractPdf(file);
      const m = mapExtraction(x);
      if (m.imageOnly) {
        setStep({
          kind: 'error',
          message:
            'This PDF contains no readable text or form fields – it is probably a scan or a picture. APEX cannot read scanned sheets (no OCR available). Please export the sheet as a text or fillable PDF, or enter the values manually with “Edit sheet”.',
        });
        return;
      }
      // Equipment that already exists in the inventory is not added twice.
      setRows(m.rows.map((r) => (r.section === 'inventory' && owned.has(r.value.trim().toLowerCase()) ? { ...r, include: false, note: 'Already in the inventory.' } : r)));
      setStep({ kind: 'review', fileName: file.name, format: m.format });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof PdfImportError ? e.message : 'The PDF could not be read. Please try another file.' });
    }
  };

  const update = (key: string, patch: Partial<ImportRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, ...(patch.value !== undefined && r.status === 'missing' ? { include: !!patch.value.trim() } : {}) } : r)));

  const finish = async (mode: 'import-merge' | 'import-replace') => {
    if (step.kind !== 'review') return;
    const built = rowsToSheet(rows, { fileName: step.fileName, format: step.format });
    if (built.problems.length) return setProblems(built.problems);
    setBusy(true);
    const sheet = mode === 'import-merge' ? mergeSheets(current.sheet, built.sheet) : built.sheet;
    const ok = await onSave(sheet, mode);
    if (ok && built.items.length) await onAddItems(built.items);
    setBusy(false);
    if (ok) onClose();
  };

  const counts = rows.reduce<Record<RowStatus, number>>((a, r) => ((a[r.status] += 1), a), { recognized: 0, uncertain: 0, missing: 0, unrecognized: 0 });
  const sections = (Object.keys(SECTION_LABEL) as RowSection[]).filter((s) => rows.some((r) => r.section === s));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
              <li>Best results: fillable PDF sheets (e.g. the official D&amp;D 5e sheet or exports based on it).</li>
              <li>Text PDFs work too; values read from text are marked “Please check”.</li>
              <li>Scanned / photographed sheets cannot be read (no OCR) – enter those values manually.</li>
              <li>Aurora: use its PDF character-sheet export. Aurora’s own character files are not supported yet.</li>
            </ul>
            <p className="text-xs text-marble-500">You will see every value before anything is saved. Maximum size {MAX_PDF_BYTES / 1048576} MB.</p>
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

        {step.kind === 'review' && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-marble-300">
              <span>
                <b className="text-marble-50">{step.fileName}</b> · {step.format}
              </span>
              {(Object.keys(counts) as RowStatus[]).map((s) =>
                counts[s] ? (
                  <span key={s} className={`chip ${STATUS[s].cls}`}>
                    {counts[s]} {STATUS[s].text.toLowerCase()}
                  </span>
                ) : null,
              )}
            </div>
            <p className="text-xs text-marble-500">
              Check every value. Only ticked rows are imported. Rows marked “Please check” were guessed from the page text, “Missing” rows were not found –
              fill them in or leave them empty.
            </p>
            {sections.map((sec) => (
              <fieldset key={sec} className="rounded-lg border border-ink-600 p-2">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-gold-300">{SECTION_LABEL[sec]}</legend>
                <ul className="space-y-1.5">
                  {rows
                    .filter((r) => r.section === sec)
                    .map((r) => (
                      <li key={r.key} className="grid grid-cols-[auto_minmax(0,9rem)_1fr_auto] items-start gap-2 sm:grid-cols-[auto_minmax(0,12rem)_1fr_auto]">
                        <input
                          type="checkbox"
                          className="mt-1.5"
                          checked={r.include}
                          aria-label={`Import ${r.label}`}
                          onChange={(e) => update(r.key, { include: e.target.checked })}
                        />
                        {r.status === 'unrecognized' || r.section === 'details' ? (
                          <input className={input} aria-label="Label" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} />
                        ) : (
                          <span className="pt-1 text-xs text-marble-100">{r.label}</span>
                        )}
                        <div className="space-y-1">
                          {r.section === 'abilities' || r.section === 'notes' || r.value.length > 80 ? (
                            <textarea className={`${input} min-h-14`} aria-label={`Value of ${r.label}`} value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} />
                          ) : (
                            <div className="flex gap-1">
                              <input className={input} aria-label={`Value of ${r.label}`} value={r.value} placeholder={r.status === 'missing' ? 'not found – type to add' : ''} onChange={(e) => update(r.key, { value: e.target.value })} />
                              {r.section === 'attributes' && (
                                <input className={`${input} w-16`} aria-label={`Modifier of ${r.label}`} placeholder="mod" value={r.modifier ?? ''} onChange={(e) => update(r.key, { modifier: e.target.value })} />
                              )}
                              {r.section === 'resources' && (
                                <input className={`${input} w-16`} aria-label={`Maximum of ${r.label}`} placeholder="max" value={r.modifier ?? ''} onChange={(e) => update(r.key, { modifier: e.target.value })} />
                              )}
                            </div>
                          )}
                          {r.note && <p className="text-[10px] text-marble-500">{r.note}</p>}
                        </div>
                        <span className={`chip whitespace-nowrap ${STATUS[r.status].cls}`} title={r.source !== '—' ? `Source: ${r.source}` : undefined}>
                          {STATUS[r.status].text}
                        </span>
                      </li>
                    ))}
                </ul>
              </fieldset>
            ))}
            {problems.length > 0 && (
              <ul role="alert" className="list-disc rounded-lg border border-blood-400/50 bg-blood-600/20 p-2 pl-6 text-xs text-red-200">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-600 pt-3">
              {hasExisting && <span className="mr-auto text-xs text-marble-500">{characterName} already has a sheet. Merge keeps existing entries; replace keeps a backup.</span>}
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
        )}
      </div>
    </div>
  );
}
