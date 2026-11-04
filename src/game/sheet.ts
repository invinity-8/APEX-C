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
  /** Double proficiency (e.g. Rogue/Bard expertise). */
  expertise?: boolean;
}

/** Weapon or spell attack line. */
export interface SheetAttack {
  id: string;
  name: string;
  /** Attack bonus or save, as written ("+2 vs AC"). */
  bonus: string;
  damage: string;
  range: string;
  notes: string;
}

/** A spell the character knows. level 0 = cantrip. */
export interface SheetSpell {
  id: string;
  name: string;
  level: number;
  /** Actually prepared (cantrips count as always prepared). */
  prepared: boolean;
  /** Spellcasting source, e.g. "Druid". */
  source: string;
  notes: string;
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

/** APEX 0.5 resource orb: weighted spell slots, or one of the sheet's resources. */
export type OrbSource = { type: 'spellSlots' } | { type: 'resource'; resourceId: string };
export interface OrbConfig {
  primary: OrbSource | null;
  /** Optional second resource → the orb is split in two halves. */
  secondary: OrbSource | null;
}

export interface CharacterSheet {
  schema: typeof SHEET_SCHEMA;
  /** APEX 0.5: which resources the main orb shows (missing = automatic choice). */
  orbs?: OrbConfig;
  /** Optional – not every system uses hit points. */
  hitPoints: HitPoints | null;
  /** Identity: class & level, background, alignment … */
  details: SheetEntry[];
  /** Physical description: gender, age, height, eyes … */
  appearance: SheetEntry[];
  attributes: SheetStat[];
  /** Combat values: armour class, initiative, speed, passive perception … */
  combat: SheetEntry[];
  saves: SheetSkill[];
  skills: SheetSkill[];
  attacks: SheetAttack[];
  resources: SheetResource[];
  abilities: SheetAbility[];
  /** Spellcasting summary per class: ability, attack bonus, save DC … */
  spellcasting: SheetEntry[];
  spells: SheetSpell[];
  notes: string;
  /** Advanced: unrecognised but possibly meaningful imported fields, kept apart from the sheet. */
  raw: SheetEntry[];
  source: SheetSource;
  /** APEX 0.7: level-up / re-import history (newest last, bounded). */
  progression?: ProgressionEntry[];
  /** APEX 0.7: active Wild Shape form (beast HP kept separate from the character's HP). */
  wildShape?: { formId: string; formName: string; hp: number; maxHp: number; since: string };
}

/** One approved level-up or sheet update from a re-imported PDF (APEX 0.7). */
export interface ProgressionEntry {
  id: string;
  at: string;
  fromLevel: number | null;
  toLevel: number | null;
  fileName: string;
  /** Labels of the fields that differed in the PDF. */
  changed: string[];
  /** Labels of the changes that were approved and applied. */
  approved: string[];
  note: string;
}
export const MAX_PROGRESSION = 50;

export const SHEET_LIMITS = {
  listItems: 200,
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
  appearance: [],
  attributes: [],
  combat: [],
  saves: [],
  skills: [],
  attacks: [],
  resources: [],
  abilities: [],
  spellcasting: [],
  spells: [],
  notes: '',
  raw: [],
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

  const entry = (o: Obj) => {
    const label = str(o.label, L.label);
    const value = str(o.value, L.value);
    return label !== null && value !== null ? { id: o.id as string, label, value } : null;
  };
  const details = list(raw.details, 'details', entry);
  const appearance = list(raw.appearance, 'appearance', entry);
  const combat = list(raw.combat, 'combat values', entry);
  const spellcasting = list(raw.spellcasting, 'spellcasting', entry);
  const rawFields = list(raw.raw, 'raw fields', entry);
  const skillOf = (o: Obj) => {
    const name = str(o.name, L.label);
    const value = str(o.value ?? '', 40);
    return name !== null && value !== null ? { id: o.id as string, name, value, proficient: o.proficient === true, ...(o.expertise === true ? { expertise: true } : {}) } : null;
  };
  const saves = list(raw.saves, 'saving throws', skillOf);
  const attacks = list(raw.attacks, 'attacks', (o) => {
    const name = str(o.name, L.label * 2);
    const bonus = str(o.bonus ?? '', 60);
    const damage = str(o.damage ?? '', 120);
    const range = str(o.range ?? '', 60);
    const notes = str(o.notes ?? '', L.value);
    return name !== null && bonus !== null && damage !== null && range !== null && notes !== null ? { id: o.id as string, name, bonus, damage, range, notes } : null;
  });
  const spells = list(raw.spells, 'spells', (o) => {
    const name = str(o.name, L.label * 2);
    const level = typeof o.level === 'number' && Number.isInteger(o.level) && o.level >= 0 && o.level <= 9 ? o.level : null;
    const source = str(o.source ?? '', L.label);
    const notes = str(o.notes ?? '', L.value);
    if (name === null || level === null || source === null || notes === null) return null;
    return { id: o.id as string, name, level, prepared: level === 0 || o.prepared === true, source, notes };
  });
  const attributes = list(raw.attributes, 'attributes', (o) => {
    const name = str(o.name, L.label);
    const value = str(o.value ?? '', 40);
    const modifier = str(o.modifier ?? '', 40);
    return name !== null && value !== null && modifier !== null ? { id: o.id as string, name, value, modifier } : null;
  });
  const skills = list(raw.skills, 'skills', skillOf);
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
  for (const r of [details, appearance, attributes, combat, saves, skills, attacks, resources, abilities, spellcasting, spells, rawFields]) if (typeof r === 'string') return bad(r);

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

  let orbs: OrbConfig | undefined;
  if (raw.orbs !== undefined) {
    const o = raw.orbs;
    const one = (v: unknown): OrbSource | null | 'bad' =>
      v === null || v === undefined
        ? null
        : isObj(v) && v.type === 'spellSlots'
          ? { type: 'spellSlots' }
          : isObj(v) && v.type === 'resource' && typeof v.resourceId === 'string' && ID_RE.test(v.resourceId)
            ? { type: 'resource', resourceId: v.resourceId }
            : 'bad';
    if (!isObj(o)) return bad('orbs');
    const primary = one(o.primary);
    const secondary = one(o.secondary);
    if (primary === 'bad' || secondary === 'bad') return bad('orbs');
    orbs = { primary, secondary };
  }

  let progression: ProgressionEntry[] | undefined;
  if (raw.progression !== undefined) {
    if (!Array.isArray(raw.progression) || raw.progression.length > MAX_PROGRESSION) return bad('progression');
    progression = [];
    const lvl = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 40 ? v : undefined);
    const labels = (v: unknown) => (Array.isArray(v) && v.length <= 300 && v.every((x) => typeof x === 'string') ? v.map((x) => str(x, L.label * 2)!) : null);
    for (const p of raw.progression) {
      if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id)) return bad('progression entry');
      const at = str(p.at, 40);
      const fileName = str(p.fileName ?? '', 200);
      const note = str(p.note ?? '', L.value);
      const fromLevel = lvl(p.fromLevel);
      const toLevel = lvl(p.toLevel);
      const changed = labels(p.changed);
      const approved = labels(p.approved);
      if (!at || fileName === null || note === null || fromLevel === undefined || toLevel === undefined || !changed || !approved) return bad('progression entry');
      progression.push({ id: p.id, at, fromLevel, toLevel, fileName, changed, approved, note });
    }
  }

  let wildShape: CharacterSheet['wildShape'];
  if (raw.wildShape !== undefined && raw.wildShape !== null) {
    const w = raw.wildShape;
    const formId = isObj(w) ? str(w.formId, 60) : null;
    const formName = isObj(w) ? str(w.formName, 60) : null;
    const hp = isObj(w) ? num(w.hp) : null;
    const maxHp = isObj(w) ? num(w.maxHp) : null;
    const since = isObj(w) ? str(w.since, 40) : null;
    if (!formId || !formName || hp === null || maxHp === null || !since || maxHp < 1 || hp < 0 || hp > maxHp) return bad('wild shape');
    wildShape = { formId, formName, hp, maxHp, since };
  }

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
      appearance: appearance as SheetEntry[],
      attributes: attributes as SheetStat[],
      combat: combat as SheetEntry[],
      saves: saves as SheetSkill[],
      ...(orbs ? { orbs } : {}),
      skills: skills as SheetSkill[],
      attacks: attacks as SheetAttack[],
      resources: resources as SheetResource[],
      abilities: abilities as SheetAbility[],
      spellcasting: spellcasting as SheetEntry[],
      spells: spells as SheetSpell[],
      notes,
      raw: rawFields as SheetEntry[],
      source,
      ...(progression ? { progression } : {}),
      ...(wildShape ? { wildShape } : {}),
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
    ...(existing.orbs ? { orbs: existing.orbs } : {}), // the player's orb choice survives an import-merge
    hitPoints: imported.hitPoints ?? existing.hitPoints,
    details: mergeList(existing.details, imported.details, (x) => x.label),
    appearance: mergeList(existing.appearance, imported.appearance, (x) => x.label),
    attributes: mergeList(existing.attributes, imported.attributes, (x) => x.name),
    combat: mergeList(existing.combat, imported.combat, (x) => x.label),
    saves: mergeList(existing.saves, imported.saves, (x) => x.name),
    skills: mergeList(existing.skills, imported.skills, (x) => x.name),
    attacks: mergeList(existing.attacks, imported.attacks, (x) => x.name),
    resources: mergeList(existing.resources, imported.resources, (x) => x.name),
    abilities: mergeList(existing.abilities, imported.abilities, (x) => x.name),
    spellcasting: mergeList(existing.spellcasting, imported.spellcasting, (x) => x.label),
    spells: mergeList(existing.spells, imported.spells, (x) => `${x.level}:${x.name}`),
    notes,
    raw: mergeList(existing.raw, imported.raw, (x) => x.label),
    source: imported.source,
    ...(existing.progression ? { progression: existing.progression } : {}), // history is never replaced by an import
    ...(existing.wildShape ? { wildShape: existing.wildShape } : {}), // an import never ends an active Wild Shape
  };
}

/** Is the sheet still empty (nothing entered yet)? */
export const sheetIsEmpty = (s: CharacterSheet) =>
  !s.hitPoints &&
  ![s.details, s.appearance, s.attributes, s.combat, s.saves, s.skills, s.attacks, s.resources, s.abilities, s.spellcasting, s.spells, s.raw].some((l) => l.length) &&
  !s.notes.trim();
