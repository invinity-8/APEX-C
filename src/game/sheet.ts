/**
 * Character sheet model (APEX 0.3).
 *
 * Deliberately rules-agnostic: APEX does not assume D&D 5e. A sheet is a set of labelled
 * entries the player (or an import) fills in. Values that already exist in the authoritative
 * game state – Will, movement points, inventory – are NOT stored here; the Character panel
 * shows them from the game state instead.
 *
 * Shared by the client (editing, PDF import review) and the server (strict validation).
 */

export const SHEET_SCHEMA = 1;

/** Free label/value pair: class & level, ancestry, background, armour class, speed … */
export interface SheetEntry {
  id: string;
  label: string;
  value: string;
}

/** An attribute/ability score as written on the source sheet (value and modifier are kept as text). */
export interface SheetStat {
  id: string;
  name: string;
  value: string;
  modifier: string;
}

export interface SheetSkill {
  id: string;
  name: string;
  value: string;
  proficient: boolean;
}

/** Numeric resource with an editable name (spell slots, ki, rage, luck …). max null = no maximum. */
export interface SheetResource {
  id: string;
  name: string;
  current: number;
  max: number | null;
}

export interface SheetAbility {
  id: string;
  name: string;
  text: string;
}

export interface HitPoints {
  current: number;
  max: number;
  temp: number;
}

export interface SheetSource {
  kind: 'manual' | 'pdf';
  fileName?: string;
  importedAt?: string;
  /** Detected layout, e.g. "D&D 5e fillable sheet" or "text". */
  format?: string;
}

export interface CharacterSheet {
  schema: typeof SHEET_SCHEMA;
  /** Optional – not every system uses hit points. */
  hitPoints: HitPoints | null;
  details: SheetEntry[];
  attributes: SheetStat[];
  skills: SheetSkill[];
  resources: SheetResource[];
  abilities: SheetAbility[];
  notes: string;
  source: SheetSource;
}

export const SHEET_LIMITS = {
  listItems: 120,
  label: 80,
  value: 2000,
  text: 8000,
  notes: 30000,
  number: 100000,
};

export const emptySheet = (): CharacterSheet => ({
  schema: SHEET_SCHEMA,
  hitPoints: null,
  details: [],
  attributes: [],
  skills: [],
  resources: [],
  abilities: [],
  notes: '',
  source: { kind: 'manual' },
});

/** Short random id for list entries (client side). */
export const newEntryId = (prefix = 'e') => `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[\w.-]{1,40}$/;

export type SheetParse = { ok: true; sheet: CharacterSheet } | { ok: false; error: string };

/**
 * Strict validation + normalisation. Unknown fields are dropped, strings are trimmed to
 * their limits, control characters removed. Rejects (instead of silently fixing) anything
 * that is structurally wrong.
 */
export function parseSheet(raw: unknown): SheetParse {
  const bad = (why: string): SheetParse => ({ ok: false, error: `Invalid character sheet: ${why}.` });
  if (!isObj(raw)) return bad('not an object');
  const L = SHEET_LIMITS;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= L.number ? Math.round(v) : null);
  const list = <T>(v: unknown, name: string, map: (o: Obj) => T | null): T[] | string => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return `${name} must be a list`;
    if (v.length > L.listItems) return `too many ${name} (max ${L.listItems})`;
    const out: T[] = [];
    const ids = new Set<string>();
    for (const item of v) {
      if (!isObj(item) || typeof item.id !== 'string' || !ID_RE.test(item.id) || ids.has(item.id)) return `${name}: invalid or duplicate id`;
      ids.add(item.id);
      const m = map(item);
      if (!m) return `${name}: invalid entry`;
      out.push(m);
    }
    return out;
  };

  const details = list(raw.details, 'details', (o) => {
    const label = str(o.label, L.label);
    const value = str(o.value, L.value);
    return label !== null && value !== null ? { id: o.id as string, label, value } : null;
  });
  const attributes = list(raw.attributes, 'attributes', (o) => {
    const name = str(o.name, L.label);
    const value = str(o.value ?? '', 40);
    const modifier = str(o.modifier ?? '', 40);
    return name !== null && value !== null && modifier !== null ? { id: o.id as string, name, value, modifier } : null;
  });
  const skills = list(raw.skills, 'skills', (o) => {
    const name = str(o.name, L.label);
    const value = str(o.value ?? '', 40);
    return name !== null && value !== null ? { id: o.id as string, name, value, proficient: o.proficient === true } : null;
  });
  const resources = list(raw.resources, 'resources', (o) => {
    const name = str(o.name, L.label);
    const current = num(o.current);
    const max = o.max === null || o.max === undefined ? null : num(o.max);
    if (name === null || current === null || (o.max !== null && o.max !== undefined && max === null)) return null;
    return { id: o.id as string, name, current, max };
  });
  const abilities = list(raw.abilities, 'abilities', (o) => {
    const name = str(o.name, L.label * 2);
    const text = str(o.text ?? '', L.text);
    return name !== null && text !== null ? { id: o.id as string, name, text } : null;
  });
  for (const r of [details, attributes, skills, resources, abilities]) if (typeof r === 'string') return bad(r);

  let hitPoints: HitPoints | null = null;
  if (raw.hitPoints !== null && raw.hitPoints !== undefined) {
    if (!isObj(raw.hitPoints)) return bad('hit points');
    const current = num(raw.hitPoints.current);
    const max = num(raw.hitPoints.max);
    const temp = num(raw.hitPoints.temp ?? 0);
    if (current === null || max === null || temp === null || max < 0 || temp < 0) return bad('hit points');
    hitPoints = { current, max, temp };
  }
  const notes = raw.notes === undefined ? '' : str(raw.notes, L.notes);
  if (notes === null) return bad('notes');

  const src = isObj(raw.source) ? raw.source : {};
  const source: SheetSource = { kind: src.kind === 'pdf' ? 'pdf' : 'manual' };
  const fileName = str(src.fileName, 200);
  const importedAt = str(src.importedAt, 40);
  const format = str(src.format, 80);
  if (fileName) source.fileName = fileName;
  if (importedAt) source.importedAt = importedAt;
  if (format) source.format = format;

  return {
    ok: true,
    sheet: {
      schema: SHEET_SCHEMA,
      hitPoints,
      details: details as SheetEntry[],
      attributes: attributes as SheetStat[],
      skills: skills as SheetSkill[],
      resources: resources as SheetResource[],
      abilities: abilities as SheetAbility[],
      notes,
      source,
    },
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Merge an imported sheet into an existing one: imported entries replace entries with the
 * same label/name, everything else is kept. Notes are appended. Hit points are taken from
 * the import only if it has them.
 */
export function mergeSheets(existing: CharacterSheet, imported: CharacterSheet): CharacterSheet {
  const mergeList = <T extends { id: string }>(a: T[], b: T[], key: (x: T) => string): T[] => {
    const out = [...a];
    for (const item of b) {
      const i = out.findIndex((x) => norm(key(x)) === norm(key(item)));
      if (i >= 0) out[i] = { ...item, id: out[i].id };
      else out.push(ids(out, item));
    }
    return out.slice(0, SHEET_LIMITS.listItems);
  };
  const ids = <T extends { id: string }>(list: T[], item: T): T => (list.some((x) => x.id === item.id) ? { ...item, id: newEntryId() } : item);
  const notes =
    imported.notes && !existing.notes.includes(imported.notes.trim())
      ? [existing.notes.trim(), imported.notes.trim()].filter(Boolean).join('\n\n').slice(0, SHEET_LIMITS.notes)
      : existing.notes;
  return {
    schema: SHEET_SCHEMA,
    hitPoints: imported.hitPoints ?? existing.hitPoints,
    details: mergeList(existing.details, imported.details, (x) => x.label),
    attributes: mergeList(existing.attributes, imported.attributes, (x) => x.name),
    skills: mergeList(existing.skills, imported.skills, (x) => x.name),
    resources: mergeList(existing.resources, imported.resources, (x) => x.name),
    abilities: mergeList(existing.abilities, imported.abilities, (x) => x.name),
    notes,
    source: imported.source,
  };
}

/** Is the sheet still empty (nothing entered yet)? */
export const sheetIsEmpty = (s: CharacterSheet) =>
  !s.hitPoints && !s.details.length && !s.attributes.length && !s.skills.length && !s.resources.length && !s.abilities.length && !s.notes.trim();
