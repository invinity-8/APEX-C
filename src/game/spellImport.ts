/**
 * Server rule for "Import Spells": replaces only the spell list of a stored character sheet.
 * Shared by the online API (/api/apex?op=sheet, action importSpells) and the offline demo.
 */
import { parseSheet, type CharacterSheet, type SheetSpell } from './sheet.js';

export type SpellImportResult = { ok: true; sheet: CharacterSheet; added: number; changed: number } | { ok: false; error: string };

const sameSpell = (a: SheetSpell, b: SheetSpell) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Validates the imported list and returns a copy of `current` in which nothing but `spells`
 * differs. An import may add spells and change spell fields; it never removes a spell, so spell
 * effects, notes and house-rule spells stay in place.
 */
export function importSpellList(current: CharacterSheet, spells: unknown): SpellImportResult {
  if (!Array.isArray(spells)) return { ok: false, error: 'Invalid spell list.' };
  const parsed = parseSheet({ ...current, spells });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const next = parsed.sheet.spells;
  const ids = new Set(next.map((s) => s.id));
  if (!current.spells.every((s) => ids.has(s.id))) return { ok: false, error: 'A spell import cannot remove existing spells.' };
  const before = new Map(current.spells.map((s) => [s.id, s]));
  const added = next.filter((s) => !before.has(s.id)).length;
  const changed = next.filter((s) => before.has(s.id) && !sameSpell(before.get(s.id)!, s)).length;
  return { ok: true, sheet: { ...structuredClone(current), spells: next }, added, changed };
}
