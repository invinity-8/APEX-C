/**
 * Server rule for "Import Spells": replaces only the spell list of a stored character sheet.
 * Shared by the online API (/api/apex?op=sheet, action importSpells) and the offline demo.
 */
import { newEntryId, parseSheet, type CharacterSheet, type SheetSpell } from './sheet.js';
import { PREPARE_LABEL, applyPreparationLimits } from './spellPreparation.js';

export type SpellImportResult = { ok: true; sheet: CharacterSheet; added: number; changed: number } | { ok: false; error: string };

const sameSpell = (a: SheetSpell, b: SheetSpell) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Validates the imported list and returns a copy of `current` in which nothing but `spells`
 * (and, if given, the "Spells to prepare" limit) differs. An import may add spells and change spell fields; it never removes a spell, so spell
 * effects, notes and house-rule spells stay in place.
 */
export function importSpellList(current: CharacterSheet, spells: unknown, limits: unknown = []): SpellImportResult {
  if (!Array.isArray(spells)) return { ok: false, error: 'Invalid spell list.' };
  // Optional: the preparation limit read from the same PDF ("Spells to prepare").
  if (!Array.isArray(limits) || limits.length > 8 || !limits.every((l) => l && typeof l === 'object' && typeof l.label === 'string' && l.label.length <= 80 && PREPARE_LABEL.test(l.label.trim()) && typeof l.value === 'string' && /^\d{1,3}$/.test(l.value.trim()))) return { ok: false, error: 'Invalid preparation limit.' };
  const spellcasting = applyPreparationLimits(current.spellcasting, (limits as Array<{ label: string; value: string }>).map((l) => ({ label: l.label.trim(), value: l.value.trim() })), () => newEntryId('sc'));
  const parsed = parseSheet({ ...current, spellcasting, spells });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const next = parsed.sheet.spells;
  const ids = new Set(next.map((s) => s.id));
  if (!current.spells.every((s) => ids.has(s.id))) return { ok: false, error: 'A spell import cannot remove existing spells.' };
  const before = new Map(current.spells.map((s) => [s.id, s]));
  const added = next.filter((s) => !before.has(s.id)).length;
  const changed = next.filter((s) => before.has(s.id) && !sameSpell(before.get(s.id)!, s)).length;
  return { ok: true, sheet: { ...structuredClone(current), spellcasting: parsed.sheet.spellcasting, spells: next }, added, changed };
}
