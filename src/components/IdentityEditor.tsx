/**
 * Identity editor (APEX 0.7): name, character title / tagline, species, class, subclass, level, multiclass,
 * background, alignment and biography – editable by the character's player and the GM.
 *
 * - Name and tagline live on the character token (setAppearance). A tagline set here is marked as custom and is
 *   never regenerated from imported class data; the import only offers it as a suggestion.
 * - The other fields are labelled entries in the character sheet (details) and are saved with the sheet's version
 *   check, so edits from two devices never silently overwrite each other.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { Command } from '../game/commands';
import { sheetLevel } from '../game/progression';
import { newEntryId, type CharacterSheet, type SheetEntry } from '../game/sheet';
import type { TokenView } from '../game/visibility';
import type { SheetPayload } from '../server/protocol';
import type { DispatchResult } from '../state/gameApi';

const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';

/** Canonical identity fields → sheet detail labels (existing imported labels are matched too). */
export const IDENTITY_FIELDS = [
  { key: 'species', label: 'Species', match: /^(species|race)$/i },
  { key: 'class', label: 'Class', match: /^class$/i },
  { key: 'subclass', label: 'Subclass', match: /^(subclass|archetype)$/i },
  { key: 'level', label: 'Level', match: /^level$/i },
  { key: 'multiclass', label: 'Multiclass', match: /^multiclass$/i },
  { key: 'background', label: 'Background', match: /^background$/i },
  { key: 'alignment', label: 'Alignment', match: /^alignment$/i },
  { key: 'biography', label: 'Biography', match: /^(biography|backstory)$/i },
] as const;
type Key = (typeof IDENTITY_FIELDS)[number]['key'];

const BUILD = /^(race, class & level|class & level)$/i;

/** Suggested tagline from imported data: "Kor Druid 1" → "Kor Druid". Only ever a suggestion. */
export function suggestTagline(sheet: Pick<CharacterSheet, 'details'>): string | null {
  const build = sheet.details.find((d) => BUILD.test(d.label.trim()))?.value ?? sheet.details.find((d) => /^class$/i.test(d.label.trim()))?.value;
  const t = build?.replace(/\blevel\b/gi, '').replace(/\b\d{1,2}\b/g, '').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 60) : null;
}

export function applyIdentity(sheet: CharacterSheet, values: Partial<Record<Key, string>>): CharacterSheet {
  const details: SheetEntry[] = [...sheet.details];
  for (const f of IDENTITY_FIELDS) {
    const v = values[f.key];
    if (v === undefined) continue;
    const i = details.findIndex((d) => f.match.test(d.label.trim()));
    const value = v.trim();
    if (i >= 0) {
      if (value) details[i] = { ...details[i], value };
      else details.splice(i, 1);
    } else if (value) details.push({ id: newEntryId(), label: f.label, value });
  }
  return { ...sheet, details };
}

export function IdentityEditor({
  token,
  data,
  run,
  save,
  notify,
}: {
  token: TokenView;
  data: SheetPayload | null;
  run: (cmd: Command) => Promise<DispatchResult>;
  save: (sheet: CharacterSheet, expected: number) => Promise<boolean>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}) {
  const sheet = data?.sheet;
  const read = (): Record<Key, string> =>
    Object.fromEntries(IDENTITY_FIELDS.map((f) => [f.key, sheet?.details.find((d) => f.match.test(d.label.trim()))?.value ?? ''])) as Record<Key, string>;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(token.name);
  const [title, setTitle] = useState(token.title);
  const [vals, setVals] = useState(read);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) return;
    setName(token.name);
    setTitle(token.title);
    setVals(read());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token.name, token.title, data?.version]);

  const build = sheet?.details.find((d) => BUILD.test(d.label.trim()))?.value;
  const level = sheet ? sheetLevel(sheet) : null;
  const suggestion = sheet ? suggestTagline(sheet) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!data || !name.trim() || !title.trim()) return;
    setBusy(true);
    try {
      if (name.trim() !== token.name || title.trim() !== token.title || !token.titleCustom) {
        const r = await run({ type: 'setAppearance', tokenId: token.id, ...(name.trim() !== token.name ? { name: name.trim() } : {}), title: title.trim() });
        if (!r.ok) return;
      }
      const before = read();
      const changed = IDENTITY_FIELDS.some((f) => (vals[f.key] ?? '') !== before[f.key]);
      if (changed && !(await save(applyIdentity(data.sheet, vals), data.version))) return;
      notify('Identity saved.', 'info');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    const shown = IDENTITY_FIELDS.filter((f) => f.key !== 'biography' && vals[f.key]);
    return (
      <section className="panel space-y-1.5 p-3" aria-label="Identity">
        <div className="flex items-center gap-2">
          <h3 className="panel-title flex-1">Identity</h3>
          <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(true)} disabled={!data}>
            ✎ Edit identity
          </button>
        </div>
        <p className="text-sm">
          <b className="text-marble-50">{token.name}</b> <span className="text-marble-500">–</span> <span style={{ color: token.accent ?? undefined }} className={token.accent ? '' : 'text-gold-200'} data-testid="tagline">{token.title}</span>
        </p>
        {build && <p className="text-xs text-marble-400">From the sheet: {build}</p>}
        {shown.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
            {shown.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-marble-500">{f.label}</dt>
                <dd className="text-marble-200">{vals[f.key]}</dd>
              </div>
            ))}
          </dl>
        )}
        {vals.biography && <p className="whitespace-pre-line text-xs text-marble-300">{vals.biography}</p>}
      </section>
    );
  }
  return (
    <form className="panel space-y-2 p-3 text-xs text-marble-300" onSubmit={submit} aria-label="Edit identity">
      <h3 className="panel-title">Identity</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          Name
          <input className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Character name" />
        </label>
        <label>
          Character Title / Tagline
          <input className={input} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} aria-label="Character title / tagline" placeholder="e.g. Will-Weaver" />
        </label>
      </div>
      <p className="rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1">
        Preview: <b className="text-marble-50">{name.trim() || '…'}</b> – <span className="text-gold-200" data-testid="tagline-preview">{title.trim() || '…'}</span>
      </p>
      {suggestion && suggestion !== title.trim() && (
        <button type="button" className="text-gold-300 hover:text-gold-100" onClick={() => setTitle(suggestion)}>
          Use suggestion from the imported sheet: “{suggestion}”
        </button>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {IDENTITY_FIELDS.filter((f) => f.key !== 'biography').map((f) => (
          <label key={f.key}>
            {f.label}
            {f.key === 'level' && build ? (
              <input className={`${input} opacity-60`} value={level ?? ''} readOnly aria-label="Level" title={`Taken from “${build}” – update it with a PDF re-import or in Notes → Details`} />
            ) : (
              <input className={input} value={vals[f.key]} maxLength={f.key === 'multiclass' ? 120 : 80} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} aria-label={f.label} />
            )}
          </label>
        ))}
      </div>
      <label className="block">
        Biography
        <textarea className={`${input} min-h-20`} value={vals.biography} maxLength={2000} onChange={(e) => setVals({ ...vals, biography: e.target.value })} aria-label="Biography" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-gold" disabled={busy || !name.trim() || !title.trim()}>
          {busy ? 'Saving…' : 'Save identity'}
        </button>
      </div>
    </form>
  );
}
