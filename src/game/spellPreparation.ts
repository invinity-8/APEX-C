/**
 * Spell preparation limit ("Spells to prepare" on the character sheet, e.g. imported from Aurora).
 * Cantrips never count. With one limit every prepared spell of level 1+ counts; with several
 * (multiclass: "Spells to prepare (Druid)") only spells whose source matches that class.
 *
 * Shared by the server (players cannot exceed the limit), the offline demo and the UI warnings.
 * The GM may exceed it for house rules; the UI still warns.
 */
import type { CharacterSheet, SheetEntry } from './sheet.js';

export const PREPARE_LABEL = /^spells to prepare(?:\s*\(([^)]+)\))?$/i;

export interface PreparationStatus {
  /** Class the limit applies to; null = all prepared spells. */
  cls: string | null;
  limit: number;
  count: number;
  over: boolean;
  label: string;
}

const norm = (s: string) => s.trim().toLowerCase();

export function preparationLimits(sheet: Pick<CharacterSheet, 'spellcasting'>): Array<{ cls: string | null; limit: number; entry: SheetEntry }> {
  const out: Array<{ cls: string | null; limit: number; entry: SheetEntry }> = [];
  for (const entry of sheet.spellcasting) {
    const m = PREPARE_LABEL.exec(entry.label.trim());
    const n = /^\s*(\d{1,3})\s*$/.exec(entry.value);
    if (m && n) out.push({ cls: m[1]?.trim() || null, limit: Number(n[1]), entry });
  }
  return out;
}

export function preparationStatus(sheet: Pick<CharacterSheet, 'spellcasting' | 'spells'>): PreparationStatus[] {
  const limits = preparationLimits(sheet);
  return limits.map(({ cls, limit, entry }) => {
    const counted = sheet.spells.filter((s) => s.level > 0 && s.prepared && (limits.length === 1 || !cls || norm(s.source) === norm(cls)));
    return { cls, limit, count: counted.length, over: counted.length > limit, label: entry.label };
  });
}

/**
 * Error text when `after` prepares more spells than allowed AND more than `before` did (so a sheet
 * that is already over the limit – e.g. after a GM override – can always be reduced).
 */
export function preparationViolation(before: Pick<CharacterSheet, 'spellcasting' | 'spells'> | null, after: Pick<CharacterSheet, 'spellcasting' | 'spells'>): string | null {
  const prev = before ? preparationStatus({ spellcasting: after.spellcasting, spells: before.spells }) : [];
  for (const s of preparationStatus(after)) {
    if (!s.over) continue;
    const old = prev.find((p) => p.label === s.label);
    if (old && s.count <= old.count) continue;
    return `Too many prepared spells: ${s.count} of ${s.limit}${s.cls ? ` (${s.cls})` : ''}. Unprepare another spell first.`;
  }
  return null;
}

/** A player may not raise their own limit by editing the sheet (GM or a PDF import can). */
export function preparationLimitRaised(before: Pick<CharacterSheet, 'spellcasting'> | null, after: Pick<CharacterSheet, 'spellcasting'>): boolean {
  const old = before ? preparationLimits(before) : [];
  return preparationLimits(after).some((l) => {
    const prev = old.find((o) => norm(o.entry.label) === norm(l.entry.label));
    return prev ? l.limit > prev.limit : old.length > 0;
  }) || (old.length > 0 && old.some((o) => !preparationLimits(after).some((l) => norm(l.entry.label) === norm(o.entry.label))));
}

/** Sets "Spells to prepare" entries (from a PDF import). Other spellcasting entries stay untouched. */
export function applyPreparationLimits(entries: SheetEntry[], limits: Array<{ label: string; value: string }>, makeId: () => string): SheetEntry[] {
  const next = entries.map((e) => ({ ...e }));
  for (const l of limits) {
    const hit = next.find((e) => norm(e.label) === norm(l.label));
    if (hit) hit.value = l.value;
    else next.push({ id: makeId(), label: l.label, value: l.value });
  }
  return next;
}
