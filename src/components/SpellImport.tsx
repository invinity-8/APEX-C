/**
 * "Import Spells" (Character → Spells): reads only the spells of the character PDF and shows a
 * correction view before anything is saved. Only the spell list is sent to the server
 * (action importSpells), which rebuilds the sheet from its stored copy – attributes, inventory,
 * notes and every other part of the character stay byte-for-byte unchanged.
 */
import { useId, useMemo, useRef, useState } from 'react';
import type { SheetEntry, SheetSpell } from '../game/sheet';
import { applyPreparationLimits, preparationStatus } from '../game/spellPreparation';
import { extractPdf, MAX_PDF_BYTES, PdfImportError } from '../sheetImport/extract';
import { applySpellImport, planSpellImport, readSpellsFromPdf, SPELL_FIELD_LABEL, type ImportedSpell, type SpellField, type SpellPlanRow } from '../sheetImport/spellCards';
import { Spinner } from './brand';

interface Props {
  characterName: string;
  existing: SheetSpell[];
  /** Current spellcasting entries (holds the "Spells to prepare" limit). */
  spellcasting: SheetEntry[];
  /** Players cannot save an import that exceeds the preparation limit; the GM is only warned. */
  isGm: boolean;
  onClose: () => void;
  /** Saves the final spell list (and optionally the PDF's preparation limit); resolves to an error message or null. */
  onSave: (spells: SheetSpell[], limits: Array<{ label: string; value: string }>) => Promise<string | null>;
}

type Step = { kind: 'pick' } | { kind: 'reading'; name: string } | { kind: 'review'; fileName: string; summary: string } | { kind: 'error'; message: string };

const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-marble-50 focus:border-gold-400 focus:outline-none';
const uncertainCls = 'border-amber-400/70 bg-amber-950/20';
const TEXT_FIELDS: Array<Extract<SpellField, 'school' | 'castingTime' | 'range' | 'components' | 'duration' | 'source'>> = ['school', 'castingTime', 'range', 'components', 'duration', 'source'];
const show = (v: string | number | boolean, f: SpellField) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : f === 'level' ? (v === 0 ? 'Cantrip' : `Level ${v}`) : String(v) || '—');

export function SpellImport({ characterName, existing, spellcasting, isGm, onClose, onSave }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [spells, setSpells] = useState<ImportedSpell[]>([]);
  // User decisions keyed by plan row (include) and row+field (apply), kept while values are corrected.
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [apply, setApply] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [pdfLimits, setPdfLimits] = useState<Array<{ label: string; value: string; source: string }>>([]);
  const [useLimits, setUseLimits] = useState(true);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const plan: SpellPlanRow[] = useMemo(
    () =>
      planSpellImport(existing, spells).map((row) => {
        const changes = row.changes.map((c) => ({ ...c, apply: apply[`${row.key}|${c.field}`] ?? c.apply }));
        const inc = include[row.key] ?? (row.status === 'new' ? row.include : changes.some((c) => c.apply));
        return { ...row, changes, include: inc };
      }),
    [existing, spells, include, apply],
  );
  const counts = {
    add: plan.filter((r) => r.status === 'new' && r.include).length,
    update: plan.filter((r) => r.status === 'update' && r.include && r.changes.some((c) => c.apply)).length,
    uncertain: plan.filter((r) => r.include && r.incoming.uncertain.length).length,
  };

  const read = async (file: File) => {
    setStep({ kind: 'reading', name: file.name });
    try {
      const x = await extractPdf(file);
      const result = readSpellsFromPdf(x);
      if (!result.spells.length) {
        setStep({ kind: 'error', message: 'No spells were found in this PDF. Spell cards (CASTING TIME / RANGE / DURATION / COMPONENTS) or an Aurora spell list are required.' });
        return;
      }
      setSpells(result.spells);
      setPdfLimits(result.limits);
      setUseLimits(true);
      setInclude({});
      setApply({});
      setStep({ kind: 'review', fileName: file.name, summary: result.summary });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof PdfImportError ? e.message : 'This PDF could not be read.' });
    }
  };

  const edit = (index: number, patch: Partial<ImportedSpell>) => {
    setSpells((old) =>
      old.map((s, i) => {
        if (i !== index) return s;
        const fields = Object.keys(patch) as SpellField[];
        // A value corrected by hand is no longer "uncertain".
        return { ...s, ...patch, uncertain: s.uncertain.filter((f) => !fields.includes(f)) };
      }),
    );
  };

  const limitsToSend = useLimits ? pdfLimits.map(({ label, value }) => ({ label, value })) : [];
  const resulting = useMemo(() => {
    const spellsAfter = applySpellImport(existing, plan, () => 'preview');
    return preparationStatus({ spellcasting: applyPreparationLimits(spellcasting, limitsToSend, () => 'preview'), spells: spellsAfter });
  }, [existing, plan, spellcasting, useLimits, pdfLimits]);
  const overLimit = resulting.filter((r) => r.over);
  const limitsChanged = limitsToSend.some((l) => spellcasting.find((e) => e.label.trim().toLowerCase() === l.label.toLowerCase())?.value !== l.value);
  const blocked = !isGm && overLimit.length > 0;

  const save = async () => {
    setBusy(true);
    setError('');
    const next = applySpellImport(existing, plan);
    const message = await onSave(next, limitsToSend);
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="panel w-full max-w-5xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="font-display text-xl font-bold text-gold-200">
            Import Spells · {characterName}
          </h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>

        {step.kind === 'pick' && (
          <div className="mt-3 space-y-3 text-sm text-marble-300">
            <p>Choose the same character PDF used for the character import. Only spells and their spell cards are read: name, level, prepared state, school, casting time, range, components, duration, concentration, ritual and description.</p>
            <p className="text-xs text-marble-500">
              Attributes, inventory, notes and other character data are never changed. Existing spell values are only replaced when you tick them. Nothing is looked up online – the PDF is the only source. Maximum size {MAX_PDF_BYTES / 1048576} MB.
            </p>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Choose spell PDF" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
            <button className="btn btn-gold" onClick={() => fileRef.current?.click()}>
              Choose PDF
            </button>
          </div>
        )}

        {step.kind === 'reading' && (
          <p className="mt-4 flex items-center gap-2 text-sm text-marble-300" role="status">
            <Spinner /> Reading spells from {step.name}…
          </p>
        )}

        {step.kind === 'error' && (
          <div className="mt-4 space-y-2">
            <p role="alert" className="text-sm text-red-300">
              {step.message}
            </p>
            <button className="btn btn-ghost" onClick={() => setStep({ kind: 'pick' })}>
              Choose another PDF
            </button>
          </div>
        )}

        {step.kind === 'review' && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-marble-400">
              {step.fileName} · {step.summary}. Fields marked <span className="rounded border border-amber-400/70 px-1 text-amber-200">please check</span> were not found or are ambiguous in the PDF – they stay empty unless you fill them in.
            </p>
            <ul className="space-y-2" aria-label="Spells found in the PDF">
              {plan.map((row, index) => {
                const s = row.incoming;
                const unsure = (f: SpellField) => s.uncertain.includes(f);
                return (
                  <li key={row.key} className={`rounded-md border p-2 ${row.include ? 'border-gold-700/50' : 'border-ink-700 opacity-80'}`} data-testid="spell-import-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-sm font-semibold text-gold-200">
                        <input
                          type="checkbox"
                          checked={row.include}
                          disabled={row.status === 'same'}
                          onChange={(e) => setInclude((o) => ({ ...o, [row.key]: e.target.checked }))}
                          aria-label={`Import ${s.name}`}
                        />
                        {s.name || '(no name)'}
                      </label>
                      <span className={`chip ${row.status === 'new' ? 'text-emerald-300' : row.status === 'update' ? 'text-gold-200' : 'text-marble-500'}`}>
                        {row.status === 'new' ? 'New spell' : row.status === 'update' ? `${row.changes.length} change${row.changes.length === 1 ? '' : 's'}` : 'Already up to date'}
                      </span>
                      {s.uncertain.length > 0 && <span className="chip border-amber-400/60 text-amber-200">Please check: {s.uncertain.map((f) => SPELL_FIELD_LABEL[f]).join(', ')}</span>}
                      <span className="text-[11px] text-marble-500">
                        {s.origin}
                        {s.book ? ` · ${s.book}` : ''}
                      </span>
                    </div>
                    {s.notes.map((n) => (
                      <p key={n} className="mt-1 text-[11px] text-amber-200">
                        {n}
                      </p>
                    ))}
                    {row.status === 'update' && (
                      <table className="mt-2 w-full text-left text-[11px]">
                        <thead className="text-marble-500">
                          <tr>
                            <th className="w-8">Use</th>
                            <th>Field</th>
                            <th>Current spellbook</th>
                            <th>From PDF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.changes.map((c) => (
                            <tr key={c.field} className="align-top">
                              <td>
                                <input type="checkbox" checked={c.apply} aria-label={`Use PDF ${SPELL_FIELD_LABEL[c.field]} for ${s.name}`} onChange={(e) => setApply((o) => ({ ...o, [`${row.key}|${c.field}`]: e.target.checked }))} />
                              </td>
                              <td className="text-marble-300">
                                {SPELL_FIELD_LABEL[c.field]}
                                {c.conflict && <span className="ml-1 text-amber-200">(overwrites)</span>}
                              </td>
                              <td className="max-w-xs whitespace-pre-wrap text-marble-400">{show(c.current, c.field).slice(0, 400)}</td>
                              <td className="max-w-xs whitespace-pre-wrap text-marble-100">{show(c.incoming, c.field).slice(0, 400)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {row.include && row.status !== 'same' && (
                      <details className="mt-2" open={row.status === 'new' && s.uncertain.length > 0}>
                        <summary className="cursor-pointer text-[11px] text-marble-400">Correct values before saving</summary>
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                          <input className={`${input} ${unsure('name') ? uncertainCls : ''}`} aria-label="Spell name" value={s.name} onChange={(e) => edit(index, { name: e.target.value })} />
                          <select className={`${input} ${unsure('level') ? uncertainCls : ''}`} aria-label="Spell level" value={s.level} onChange={(e) => edit(index, { level: Number(e.target.value), prepared: Number(e.target.value) === 0 || s.prepared })}>
                            {Array.from({ length: 10 }, (_, i) => (
                              <option key={i} value={i}>
                                {i === 0 ? 'Cantrip' : `Level ${i}`}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-marble-300">
                            <label className={`flex items-center gap-1 rounded px-1 ${unsure('prepared') ? uncertainCls : ''}`}>
                              <input type="checkbox" checked={s.prepared} disabled={s.level === 0} onChange={(e) => edit(index, { prepared: e.target.checked })} /> prepared
                            </label>
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={s.concentration} onChange={(e) => edit(index, { concentration: e.target.checked })} /> concentration
                            </label>
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={s.ritual} onChange={(e) => edit(index, { ritual: e.target.checked })} /> ritual
                            </label>
                          </div>
                          {TEXT_FIELDS.map((f) => (
                            <input key={f} className={`${input} ${unsure(f) ? uncertainCls : ''}`} aria-label={SPELL_FIELD_LABEL[f]} placeholder={`${SPELL_FIELD_LABEL[f]}${unsure(f) ? ' – not in PDF' : ''}`} value={s[f]} onChange={(e) => edit(index, { [f]: e.target.value })} />
                          ))}
                          <textarea className={`${input} min-h-20 sm:col-span-3 ${unsure('description') ? uncertainCls : ''}`} aria-label="Spell description" placeholder={unsure('description') ? 'Description – not in PDF' : 'Description'} value={s.description} onChange={(e) => edit(index, { description: e.target.value })} />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
            <section className="rounded-md border border-ink-700 p-2 text-xs" aria-label="Spell preparation limit">
              <h3 className="font-semibold text-gold-200">Preparation limit</h3>
              {pdfLimits.length ? (
                <label className="mt-1 flex items-center gap-2 text-marble-200">
                  <input type="checkbox" checked={useLimits} onChange={(e) => setUseLimits(e.target.checked)} />
                  Use the PDF value: {pdfLimits.map((l) => `${l.label} ${l.value}`).join(' · ')}
                  {(() => {
                    const cur = pdfLimits.map((l) => spellcasting.find((e) => e.label.trim().toLowerCase() === l.label.toLowerCase())?.value).filter(Boolean);
                    return cur.length ? <span className="text-marble-500">(current: {cur.join(' / ')})</span> : <span className="text-marble-500">(not set yet)</span>;
                  })()}
                </label>
              ) : (
                <p className="mt-1 text-marble-400">The PDF does not state how many spells can be prepared.</p>
              )}
              {resulting.length ? (
                <ul className="mt-1 space-y-0.5" data-testid="prepared-after-import">
                  {resulting.map((r) => (
                    <li key={r.label} className={r.over ? 'text-red-300' : 'text-marble-300'}>
                      Prepared after import{r.cls ? ` (${r.cls})` : ''}: {r.count} / {r.limit}
                      {r.over ? (isGm ? ' – over the limit (GM override allowed)' : ' – over the limit. Untick “prepared” on some spells (Correct values) before saving.') : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-marble-500">No preparation limit is recorded, so the number of prepared spells is not checked.</p>
              )}
            </section>
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 pt-3">
              <span className="mr-auto text-xs text-marble-400" role="status">
                {counts.add} new · {counts.update} updated{counts.uncertain ? ` · ${counts.uncertain} with fields to check` : ''} · existing spells are never removed
              </span>
              <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={() => void save()} disabled={busy || blocked || (!counts.add && !counts.update && !limitsChanged)}>
                {busy ? 'Saving…' : 'Save spells'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
