/**
 * Character progression (APEX 0.7): level detection, readable sheet diffs, character snapshots and selective restore.
 *
 * A CHARACTER SNAPSHOT records the character's configuration – sheet (identity, attributes, skills, HP, resources,
 * spells, features, notes) plus the token's identity and equipment CONFIGURATION. It also records the inventory and
 * currency, but only as a read-only reference: restoring a snapshot never brings back items or currency (that would
 * duplicate them or undo trades). Economic recovery is a separate, explicit World-Management decision.
 */
import { newEntryId, type CharacterSheet, type SheetEntry } from './sheet.js';
import type { Equipment } from './equipment.js';
import type { Item, Token } from './types.js';
import type { CurrencyId } from './items/currency.js';

export const SNAPSHOT_KIND = 'apex-character-snapshot';

export type SheetPart = 'identity' | 'attributes' | 'combat' | 'resources' | 'features' | 'spells';
export const SHEET_PARTS: Array<{ id: SheetPart; label: string }> = [
  { id: 'identity', label: 'Identity, background, appearance & notes' },
  { id: 'attributes', label: 'Attributes, saving throws & skills' },
  { id: 'combat', label: 'Hit points, combat values & attacks' },
  { id: 'resources', label: 'Resources & spell slots' },
  { id: 'features', label: 'Features & abilities' },
  { id: 'spells', label: 'Spellcasting & spells' },
];

export interface CharacterSnapshot {
  kind: typeof SNAPSHOT_KIND;
  schema: 1;
  name: string;
  note: string;
  /** e.g. "Druid 2" or "2" – for the list view. */
  level: string | null;
  takenAt: string;
  sheet: CharacterSheet;
  character: {
    name: string;
    title: string;
    color: string;
    accent?: string;
    marker?: Token['marker'];
    initials: string;
    speedFt?: number;
    equipment?: Equipment;
    /** Reference only – never restored. */
    inventory: Array<Pick<Item, 'id' | 'name' | 'quantity'> & Partial<Pick<Item, 'baseId' | 'rarity' | 'itemLevel'>>>;
    /** Reference only – never restored. */
    currency: Partial<Record<CurrencyId, number>>;
  };
}

const LEVEL_LABEL = /^(level|class & level|class and level|race, class & level|class)$/i;

/** Character level from the sheet: an explicit "Level" entry, else the sum of the numbers in "Class & Level". */
export function sheetLevel(sheet: Pick<CharacterSheet, 'details'>): number | null {
  const lvl = sheet.details.find((d) => /^level$/i.test(d.label.trim()));
  if (lvl) {
    const n = Number(/\d+/.exec(lvl.value)?.[0]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const cls = sheet.details.find((d) => LEVEL_LABEL.test(d.label.trim()) && /\d/.test(d.value));
  if (!cls) return null;
  const nums = [...cls.value.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 20);
  return nums.length ? Math.min(40, nums.reduce((a, b) => a + b, 0)) : null;
}

export function buildSnapshot(sheet: CharacterSheet, t: Token, name: string, note: string, now = new Date()): CharacterSnapshot {
  const lvl = sheetLevel(sheet);
  const cls = sheet.details.find((d) => /class/i.test(d.label))?.value;
  return {
    kind: SNAPSHOT_KIND,
    schema: 1,
    name: name.trim().slice(0, 80) || `Snapshot ${now.toISOString().slice(0, 10)}`,
    note: note.trim().slice(0, 500),
    level: cls?.trim().slice(0, 60) || (lvl !== null ? String(lvl) : null),
    takenAt: now.toISOString(),
    sheet: structuredClone(sheet),
    character: {
      name: t.name,
      title: t.title,
      color: t.color,
      ...(t.accent ? { accent: t.accent } : {}),
      ...(t.marker ? { marker: t.marker } : {}),
      initials: t.initials,
      ...(t.speedFt ? { speedFt: t.speedFt } : {}),
      ...(t.equipment ? { equipment: structuredClone(t.equipment) } : {}),
      inventory: t.inventory.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, ...(i.baseId ? { baseId: i.baseId } : {}), ...(i.rarity ? { rarity: i.rarity } : {}), ...(i.itemLevel ? { itemLevel: i.itemLevel } : {}) })),
      currency: { ...(t.currency ?? {}) },
    },
  };
}

export function isSnapshot(v: unknown): v is CharacterSnapshot {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === SNAPSHOT_KIND && typeof (v as { sheet?: unknown }).sheet === 'object';
}

// ---------------------------------------------------------------- diff

export interface SheetChange {
  part: SheetPart;
  label: string;
  before: string | null;
  after: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();
function diffList<T>(part: SheetPart, a: T[], b: T[], key: (x: T) => string, show: (x: T) => string, prefix = ''): SheetChange[] {
  const out: SheetChange[] = [];
  const am = new Map(a.map((x) => [norm(key(x)), x]));
  const bm = new Map(b.map((x) => [norm(key(x)), x]));
  for (const [k, x] of bm) {
    const old = am.get(k);
    if (!old) out.push({ part, label: `${prefix}${key(x)}`, before: null, after: show(x) });
    else if (show(old) !== show(x)) out.push({ part, label: `${prefix}${key(x)}`, before: show(old), after: show(x) });
  }
  for (const [k, x] of am) if (!bm.has(k)) out.push({ part, label: `${prefix}${key(x)}`, before: show(x), after: null });
  return out;
}
const entry = (e: SheetEntry) => e.value;

/** Readable differences between two sheets ("Strength: 11 → 12", "New feature: Wild Shape" …). */
export function diffSheets(a: CharacterSheet, b: CharacterSheet): SheetChange[] {
  const out: SheetChange[] = [];
  const la = sheetLevel(a);
  const lb = sheetLevel(b);
  if (la !== lb) out.push({ part: 'identity', label: 'Level', before: la === null ? null : String(la), after: lb === null ? null : String(lb) });
  out.push(...diffList('identity', a.details, b.details, (x) => x.label, entry));
  out.push(...diffList('identity', a.appearance, b.appearance, (x) => x.label, entry, 'Appearance: '));
  if (a.notes.trim() !== b.notes.trim()) out.push({ part: 'identity', label: 'Notes', before: a.notes.trim() ? `${a.notes.trim().slice(0, 60)}…` : null, after: b.notes.trim() ? `${b.notes.trim().slice(0, 60)}…` : null });
  out.push(...diffList('attributes', a.attributes, b.attributes, (x) => x.name, (x) => `${x.value}${x.modifier ? ` (${x.modifier})` : ''}`));
  out.push(...diffList('attributes', a.saves, b.saves, (x) => x.name, (x) => `${x.value}${x.proficient ? ' ●' : ''}`, 'Save: '));
  out.push(...diffList('attributes', a.skills, b.skills, (x) => x.name, (x) => `${x.value}${x.expertise ? ' ●●' : x.proficient ? ' ●' : ''}`, 'Skill: '));
  const hp = (s: CharacterSheet) => (s.hitPoints ? String(s.hitPoints.max) : null);
  if (hp(a) !== hp(b)) out.push({ part: 'combat', label: 'Maximum HP', before: hp(a), after: hp(b) });
  out.push(...diffList('combat', a.combat, b.combat, (x) => x.label, entry));
  out.push(...diffList('combat', a.attacks, b.attacks, (x) => x.name, (x) => `${x.bonus} ${x.damage}`.trim(), 'Attack: '));
  out.push(...diffList('resources', a.resources, b.resources, (x) => x.name, (x) => (x.max === null ? String(x.current) : `max ${x.max}`)));
  out.push(...diffList('features', a.abilities, b.abilities, (x) => x.name, (x) => x.text.slice(0, 80), 'Feature: '));
  out.push(...diffList('spells', a.spellcasting, b.spellcasting, (x) => x.label, entry));
  out.push(...diffList('spells', a.spells, b.spells, (x) => `${x.name} (${x.level ? `level ${x.level}` : 'cantrip'})`, (x) => (x.prepared ? 'prepared' : 'known'), 'Spell: '));
  return out;
}

/** Restores the chosen parts of a snapshot's sheet; everything else (and the progression history) stays current. */
export function restoreSheetParts(current: CharacterSheet, snap: CharacterSheet, parts: SheetPart[]): CharacterSheet {
  const next = structuredClone(current);
  const s = structuredClone(snap);
  for (const p of parts) {
    if (p === 'identity') (next.details = s.details), (next.appearance = s.appearance), (next.notes = s.notes);
    if (p === 'attributes') (next.attributes = s.attributes), (next.saves = s.saves), (next.skills = s.skills);
    if (p === 'combat') {
      next.combat = s.combat;
      next.attacks = s.attacks;
      if (s.hitPoints) {
        // configuration only: the maximum comes back, current HP is never raised by a restore
        const cur = next.hitPoints?.current ?? s.hitPoints.current;
        next.hitPoints = { max: s.hitPoints.max, current: Math.min(cur, s.hitPoints.max), temp: next.hitPoints?.temp ?? 0 };
      } else next.hitPoints = null;
    }
    if (p === 'resources') {
      next.resources = s.resources.map((r) => {
        const now = current.resources.find((x) => norm(x.name) === norm(r.name));
        const cur = now ? now.current : r.current;
        return { ...r, current: r.max === null ? cur : Math.min(cur, r.max) };
      });
    }
    if (p === 'features') next.abilities = s.abilities;
    if (p === 'spells') (next.spellcasting = s.spellcasting), (next.spells = s.spells);
  }
  return next;
}

export const newProgressionId = () => newEntryId('lvl');

/**
 * Applies an approved incremental (level-up) import: only the entries present in `approved` are merged; everything
 * else – including manual edits – stays. Consumable values (current HP, current resource uses) are kept unless the
 * player explicitly chose to take them from the PDF; maxima are updated and current values clamped to them.
 */
export function applyLevelUp(current: CharacterSheet, approved: CharacterSheet, opts: { refillCurrent: boolean; mergeSheets: (a: CharacterSheet, b: CharacterSheet) => CharacterSheet }): CharacterSheet {
  const merged = opts.mergeSheets(current, approved);
  if (opts.refillCurrent) return merged;
  if (approved.hitPoints && current.hitPoints && merged.hitPoints) {
    merged.hitPoints = { max: merged.hitPoints.max, current: Math.min(current.hitPoints.current, merged.hitPoints.max), temp: current.hitPoints.temp };
  }
  merged.resources = merged.resources.map((r) => {
    const before = current.resources.find((x) => norm(x.name) === norm(r.name));
    if (!before) return r;
    return { ...r, current: r.max === null ? before.current : Math.min(before.current, r.max) };
  });
  return merged;
}
