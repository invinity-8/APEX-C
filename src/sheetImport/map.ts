/**
 * Maps data extracted from a character-sheet PDF to the APEX sheet model.
 *
 * Order of trust:
 *  1. Known layouts with real form fields (Aurora Builder → aurora.ts) – "recognized".
 *  2. Generic fillable D&D 5e sheets (official field names) – "recognized".
 *  3. Page text, only for values the form did not provide – always "uncertain".
 * Missing essentials are listed as "missing" (nothing is invented). Filled form fields that APEX does
 * not understand go to the Advanced section ("raw"), never into the main sheet unless confirmed.
 *
 * Pure functions – unit-tested, also against the real Aurora sample (tests/fixtures/sinna.pdf).
 */
import { SHEET_LIMITS, SHEET_SCHEMA, newEntryId, type CharacterSheet } from '../game/sheet';
import { reconstructAuroraFields } from './auroraFlat';
import { isAurora, mapAurora } from './aurora';

export type RowStatus = 'recognized' | 'uncertain' | 'missing' | 'unrecognized';
export type ImportGroup = 'identity' | 'attributes' | 'combat' | 'skills' | 'features' | 'spells' | 'equipment' | 'background' | 'raw';
export type RowKind =
  | 'detail'
  | 'appearance'
  | 'attribute'
  | 'hp'
  | 'combat'
  | 'resource'
  | 'skill'
  | 'save'
  | 'attack'
  | 'feature'
  | 'spellcasting'
  | 'spell'
  | 'item'
  | 'note'
  | 'raw';

export interface ImportRow {
  key: string;
  group: ImportGroup;
  kind: RowKind;
  label: string;
  value: string;
  /** attribute: modifier · resource: maximum */
  modifier?: string;
  hp?: 'current' | 'max' | 'temp';
  proficient?: boolean;
  expertise?: boolean;
  /** spell level (0 = cantrip) */
  level?: number;
  prepared?: boolean;
  spellSource?: string;
  quantity?: number;
  equipped?: boolean;
  bonus?: string;
  damage?: string;
  range?: string;
  status: RowStatus;
  /** Where the value came from (PDF field name or "page text"). */
  source: string;
  include: boolean;
  note?: string;
}

export interface PositionedText {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The run ends a line (pdf.js hasEOL). */
  eol?: boolean;
}

export interface Extracted {
  /** Form field name → value (text fields, choices). */
  fields: Record<string, string>;
  /** Checkbox / radio states (true = checked). */
  checkboxes?: Record<string, boolean>;
  /** Plain text of all pages. */
  text: string;
  /** Plain text per page. */
  pageTexts?: string[];
  /** Text runs with their position on the page (PDF units, origin bottom-left), per page. */
  positioned?: PositionedText[][];
  pages: number;
}

export interface MappingResult {
  rows: ImportRow[];
  /** Human description of the detected layout. */
  format: string;
  /** Neither form fields nor text → probably a scanned/image-only PDF. */
  imageOnly: boolean;
}

export const GROUP_LABEL: Record<ImportGroup, string> = {
  identity: 'Identity & appearance',
  attributes: 'Attributes',
  combat: 'Combat & resources',
  skills: 'Skills & saving throws',
  features: 'Features & traits',
  spells: 'Spells',
  equipment: 'Equipment & inventory',
  background: 'Background & notes',
  raw: 'Advanced – raw imported fields',
};

export const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
export const clean = (v: string) => v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
const isCheckboxValue = (v: string) => /^(yes|no|off|on|true|false|\/?yes|\/?off|x)$/i.test(v.trim());

/** Builder used by the mappers – fills defaults (include = recognized/uncertain). */
export function row(r: Omit<ImportRow, 'include'> & { include?: boolean }): ImportRow {
  return { include: r.status !== 'missing' && r.status !== 'unrecognized', ...r };
}

// ---------------------------------------------------------------- generic fillable 5e sheet

const DETAILS: Record<string, [string, 'detail' | 'combat' | 'appearance']> = {
  charactername: ['Character name', 'detail'],
  classlevel: ['Class & level', 'detail'],
  class: ['Class', 'detail'],
  level: ['Level', 'detail'],
  subclass: ['Subclass', 'detail'],
  background: ['Background', 'detail'],
  playername: ['Player name', 'detail'],
  race: ['Race / species', 'detail'],
  species: ['Race / species', 'detail'],
  alignment: ['Alignment', 'detail'],
  xp: ['Experience points', 'detail'],
  experiencepoints: ['Experience points', 'detail'],
  faction: ['Faction', 'detail'],
  factionname: ['Faction', 'detail'],
  ac: ['Armor Class', 'combat'],
  armorclass: ['Armor Class', 'combat'],
  initiative: ['Initiative', 'combat'],
  speed: ['Speed', 'combat'],
  profbonus: ['Proficiency bonus', 'combat'],
  proficiencybonus: ['Proficiency bonus', 'combat'],
  inspiration: ['Inspiration', 'combat'],
  passive: ['Passive Perception', 'combat'],
  passiveperception: ['Passive Perception', 'combat'],
  hdtotal: ['Hit dice (total)', 'combat'],
  hd: ['Hit dice', 'combat'],
  age: ['Age', 'appearance'],
  height: ['Height', 'appearance'],
  weight: ['Weight', 'appearance'],
  eyes: ['Eyes', 'appearance'],
  skin: ['Skin', 'appearance'],
  hair: ['Hair', 'appearance'],
};
const SPELLCASTING: Record<string, string> = {
  spellcastingclass2: 'Spellcasting class',
  spellcastingability2: 'Spellcasting ability',
  spellsavedc2: 'Spell save DC',
  spellatkbonus2: 'Spell attack bonus',
};

export const ATTRS: Array<[string, string]> = [
  ['str', 'Strength'],
  ['dex', 'Dexterity'],
  ['con', 'Constitution'],
  ['int', 'Intelligence'],
  ['wis', 'Wisdom'],
  ['cha', 'Charisma'],
];

export const SKILLS: Array<[string, string, string]> = [
  ['acrobatics', 'Acrobatics', 'Dex'],
  ['animalhandling', 'Animal Handling', 'Wis'],
  ['arcana', 'Arcana', 'Int'],
  ['athletics', 'Athletics', 'Str'],
  ['deception', 'Deception', 'Cha'],
  ['history', 'History', 'Int'],
  ['insight', 'Insight', 'Wis'],
  ['intimidation', 'Intimidation', 'Cha'],
  ['investigation', 'Investigation', 'Int'],
  ['medicine', 'Medicine', 'Wis'],
  ['nature', 'Nature', 'Int'],
  ['perception', 'Perception', 'Wis'],
  ['performance', 'Performance', 'Cha'],
  ['persuasion', 'Persuasion', 'Cha'],
  ['religion', 'Religion', 'Int'],
  ['sleightofhand', 'Sleight of Hand', 'Dex'],
  ['stealth', 'Stealth', 'Dex'],
  ['survival', 'Survival', 'Wis'],
];

const TEXTS: Record<string, [string, 'feature' | 'note']> = {
  personalitytraits: ['Personality traits', 'note'],
  ideals: ['Ideals', 'note'],
  bonds: ['Bonds', 'note'],
  flaws: ['Flaws', 'note'],
  featuresandtraits: ['Features & traits', 'feature'],
  features: ['Features & traits', 'feature'],
  feat: ['Features & traits', 'feature'],
  proficiencieslang: ['Proficiencies & languages', 'feature'],
  proficiencies: ['Proficiencies & languages', 'feature'],
  languages: ['Languages', 'feature'],
  attacksspellcasting: ['Attacks & spellcasting', 'feature'],
  backstory: ['Backstory', 'note'],
  characterbackstory: ['Backstory', 'note'],
  allies: ['Allies & organizations', 'note'],
  alliesorganizations: ['Allies & organizations', 'note'],
  treasure: ['Treasure', 'note'],
  additionalfeatures: ['Additional features & traits', 'feature'],
  additionalfeaturestraits: ['Additional features & traits', 'feature'],
};

export const COINS: Array<[string, string]> = [
  ['cp', 'Copper (cp)'],
  ['sp', 'Silver (sp)'],
  ['ep', 'Electrum (ep)'],
  ['gp', 'Gold (gp)'],
  ['pp', 'Platinum (pp)'],
];

const HP: Record<string, 'current' | 'max' | 'temp'> = { hpmax: 'max', hpcurrent: 'current', hptemp: 'temp', maxhp: 'max', currenthp: 'current', temphp: 'temp' };
export const HP_LABEL = { max: 'Hit points (maximum)', current: 'Hit points (current)', temp: 'Temporary hit points' } as const;

/** Splits an equipment text block into lines ("Rope (50 ft), Torch" → 2 items). */
export const splitItems = (text: string) =>
  text
    .split(/\n|;|,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

function mapGeneric(x: Extracted): ImportRow[] {
  const rows: ImportRow[] = [];
  const used = new Set<string>();
  const f = new Map<string, [string, string]>();
  for (const [name, raw] of Object.entries(x.fields)) {
    const v = clean(String(raw ?? ''));
    if (!v) continue;
    const n = norm(name);
    if (!f.has(n)) f.set(n, [name, v]);
  }
  const take = (n: string) => {
    const e = f.get(n);
    if (!e) return null;
    used.add(n);
    return e;
  };
  const groupOfKind = (k: 'detail' | 'combat' | 'appearance') => (k === 'combat' ? 'combat' : 'identity');

  for (const [n, [label, kind]] of Object.entries(DETAILS)) {
    const e = take(n);
    if (e && !isCheckboxValue(e[1])) rows.push(row({ key: `d:${n}`, group: groupOfKind(kind), kind, label, value: e[1].slice(0, SHEET_LIMITS.value), status: 'recognized', source: e[0] }));
  }
  for (const [n, label] of Object.entries(SPELLCASTING)) {
    const e = take(n);
    if (e) rows.push(row({ key: `sc:${n}`, group: 'spells', kind: 'spellcasting', label, value: e[1], status: 'recognized', source: e[0] }));
  }
  for (const [k, label] of ATTRS) {
    const v = take(k);
    const m = take(`${k}mod`);
    if (v || m) {
      rows.push(row({ key: `a:${k}`, group: 'attributes', kind: 'attribute', label, value: v?.[1] ?? '', modifier: m?.[1] ?? '', status: v ? 'recognized' : 'uncertain', source: [v?.[0], m?.[0]].filter(Boolean).join(' / '), note: v ? undefined : 'Only the modifier was found.' }));
    }
  }
  for (const [n, which] of Object.entries(HP)) {
    const e = take(n);
    if (e) {
      const num = /^-?\d+$/.test(e[1]);
      rows.push(row({ key: `h:${which}`, group: 'combat', kind: 'hp', label: HP_LABEL[which], value: e[1], hp: which, status: num ? 'recognized' : 'uncertain', source: e[0], note: num ? undefined : 'Not a whole number – please correct.' }));
    }
  }
  for (const [n, label] of SKILLS) {
    const e = take(n) ?? (n === 'animalhandling' ? take('animal') : null);
    if (e && !isCheckboxValue(e[1])) rows.push(row({ key: `s:${n}`, group: 'skills', kind: 'skill', label, value: e[1].slice(0, 40), status: 'recognized', source: e[0] }));
  }
  for (const [k, label] of ATTRS) {
    const e = take(`st${label.toLowerCase()}`);
    if (e && !isCheckboxValue(e[1])) rows.push(row({ key: `sv:${k}`, group: 'skills', kind: 'save', label: `${label} save`, value: e[1].slice(0, 40), status: 'recognized', source: e[0] }));
  }
  for (const [n, [label, kind]] of Object.entries(TEXTS)) {
    const e = take(n);
    if (e) rows.push(row({ key: `t:${n}`, group: kind === 'note' ? 'background' : 'features', kind, label, value: e[1].slice(0, SHEET_LIMITS.text), status: 'recognized', source: e[0] }));
  }
  for (let i = 1; i <= 3; i++) {
    const name = take(i === 1 ? 'wpnname' : `wpnname${i}`);
    const atk = take(`wpn${i}atkbonus`);
    const dmg = take(`wpn${i}damage`);
    if (name) rows.push(row({ key: `w:${i}`, group: 'combat', kind: 'attack', label: name[1].slice(0, 160), value: name[1].slice(0, 160), bonus: atk?.[1] ?? '', damage: dmg?.[1] ?? '', range: '', status: 'recognized', source: name[0] }));
  }
  for (const [n, label] of COINS) {
    const e = take(n);
    if (e) {
      const ok = /^\d+$/.test(e[1]);
      rows.push(row({ key: `c:${n}`, group: 'equipment', kind: 'resource', label, value: e[1], status: ok ? 'recognized' : 'uncertain', source: e[0], note: ok ? undefined : 'Not a whole number – please correct.' }));
    }
  }
  for (let lvl = 1; lvl <= 9; lvl++) {
    const total = take(`slotstotal${18 + lvl}`);
    const left = take(`slotsremaining${18 + lvl}`);
    if (total && /^\d+$/.test(total[1])) {
      rows.push(row({ key: `sl:${lvl}`, group: 'spells', kind: 'resource', label: `Spell slots (level ${lvl})`, value: left && /^\d+$/.test(left[1]) ? left[1] : total[1], modifier: total[1], status: 'uncertain', source: total[0], note: 'Spell slot fields are numbered by position – please check the level.' }));
    }
  }
  const spellNames = [...f.entries()].filter(([n, [, v]]) => /^spells\d+$/.test(n) && !isCheckboxValue(v)).map(([n, [, v]]) => (used.add(n), v));
  if (spellNames.length) {
    spellNames.forEach((name, i) =>
      rows.push(row({ key: `sp:${i}`, group: 'spells', kind: 'spell', label: name, value: name, level: 1, prepared: false, spellSource: '', status: 'uncertain', source: 'spell fields', note: 'This sheet does not say the spell level or whether it is prepared – please check.' })),
    );
  }
  const equipment = take('equipment');
  if (equipment) {
    splitItems(equipment[1]).slice(0, 100).forEach((line, i) => rows.push(row({ key: `i:${i}`, group: 'equipment', kind: 'item', label: line.slice(0, 200), value: line.slice(0, 200), quantity: 1, status: 'recognized', source: equipment[0] })));
  }
  for (const [n, [name, v]] of f) {
    if (used.has(n) || isCheckboxValue(v)) continue;
    rows.push(row({ key: `u:${n}`, group: 'raw', kind: 'raw', label: name.trim().slice(0, SHEET_LIMITS.label), value: v.slice(0, SHEET_LIMITS.value), status: 'unrecognized', source: name }));
  }
  return rows;
}

/** Conservative page-text patterns – only for values the form did not provide; always "uncertain". */
function mapText(x: Extracted, rows: ImportRow[]): void {
  const text = x.text;
  if (!text.trim()) return;
  const have = (kind: RowKind, label?: string) => rows.some((r) => r.kind === kind && (!label || r.label === label));
  const fromText = (key: string, r: Omit<ImportRow, 'key' | 'status' | 'source' | 'include'>) =>
    rows.push(row({ key: `x:${key}`, status: 'uncertain', source: 'page text', note: 'Found in the page text – please check.', ...r }));
  if (!have('attribute')) {
    for (const [short, label] of ATTRS) {
      const re = new RegExp(`\\b(?:${label}|${short.toUpperCase()})\\b[^\\d\\n+\\-−]{0,12}(\\d{1,2})\\s*\\(?\\s*([+\\-−]\\s?\\d{1,2})?`, 'i');
      const m = re.exec(text);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 30) fromText(`a:${short}`, { group: 'attributes', kind: 'attribute', label, value: m[1], modifier: m[2]?.replace(/\s/g, '').replace('−', '-') ?? '' });
    }
  }
  if (!have('hp')) {
    const max = /(?:hit point maximum|max(?:imum)?\.? hp|hp max(?:imum)?)\D{0,12}(\d{1,4})/i.exec(text);
    if (max) fromText('h:max', { group: 'combat', kind: 'hp', label: HP_LABEL.max, value: max[1], hp: 'max' });
  }
  if (!have('combat', 'Armor Class')) {
    const ac = /(?:armou?r class)\s*[:\-]?\s*(\d{1,2})\b/i.exec(text);
    if (ac) fromText('d:ac', { group: 'combat', kind: 'combat', label: 'Armor Class', value: ac[1] });
  }
  if (!have('combat', 'Speed')) {
    const sp = /\bspeed\b\s*[:\-]?\s*(\d{1,3}\s?(?:ft\.?|feet|m)\b)/i.exec(text);
    if (sp) fromText('d:speed', { group: 'combat', kind: 'combat', label: 'Speed', value: sp[1] });
  }
  if (!have('detail', 'Class & level') && !have('detail', 'Class')) {
    const cl = /\b(Artificer|Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard)\s+(\d{1,2})\b/.exec(text);
    if (cl) fromText('d:class', { group: 'identity', kind: 'detail', label: 'Class & level', value: `${cl[1]} ${cl[2]}` });
  }
  if (!have('detail', 'Character name')) {
    // "Character Name: Aster" – the value must be on the same line after a colon (labels alone are never values).
    const nm = /character name\s*:\s*([^\n:]{2,40})$/im.exec(text);
    if (nm && !/^[A-Z\s]+$/.test(nm[1].trim())) fromText('d:name', { group: 'identity', kind: 'detail', label: 'Character name', value: nm[1].trim() });
  }
}

function addMissing(rows: ImportRow[]): void {
  const have = (kind: RowKind, label?: string) => rows.some((r) => r.kind === kind && (!label || r.label === label));
  const missing = (key: string, r: Omit<ImportRow, 'key' | 'status' | 'source' | 'include' | 'value'>) =>
    rows.push(row({ key: `m:${key}`, value: '', status: 'missing', source: '—', note: 'Not found in the PDF.', ...r }));
  if (!have('hp')) missing('hp', { group: 'combat', kind: 'hp', label: HP_LABEL.max, hp: 'max' });
  if (!have('attribute')) missing('attrs', { group: 'attributes', kind: 'attribute', label: 'Attributes / ability scores' });
  if (!have('detail', 'Class & level') && !have('detail', 'Class') && !have('detail', 'Race, class & level')) missing('class', { group: 'identity', kind: 'detail', label: 'Class & level' });
  if (!have('combat', 'Armor Class')) missing('ac', { group: 'combat', kind: 'combat', label: 'Armor Class' });
}

export function mapExtraction(x: Extracted): MappingResult {
  const hasText = x.text.replace(/\s/g, '').length >= 20;
  const imageOnly = !Object.keys(x.fields).length && !hasText;
  if (isAurora(x)) {
    const rows = mapAurora(x);
    addMissing(rows);
    return { rows, format: 'Aurora Builder character sheet (form fields)', imageOnly };
  }
  // Printed / flattened Aurora sheet: no form fields, but the values sit at the known template positions.
  const flat = reconstructAuroraFields(x);
  if (flat) {
    const fx: Extracted = { ...x, fields: flat.fields, checkboxes: flat.checkboxes, pageTexts: flat.pageTexts, text: flat.pageTexts.join('\n\n') };
    if (isAurora(fx)) {
      const rows = mapAurora(fx);
      addMissing(rows);
      return { rows, format: 'Aurora Builder character sheet (printed PDF – values read by position)', imageOnly };
    }
  }
  const rows = mapGeneric(x);
  const formRows = rows.filter((r) => r.kind !== 'raw').length;
  mapText(x, rows);
  if (x.text.trim() && x.text.trim().length <= SHEET_LIMITS.notes && formRows === 0) {
    rows.push(row({ key: 'notes:text', group: 'background', kind: 'note', label: 'Complete page text', value: x.text.trim(), status: 'uncertain', source: 'page text', include: false, note: 'Optionally keep the whole extracted text in the notes.' }));
  }
  addMissing(rows);
  const f = new Set(Object.keys(x.fields).map(norm));
  const format = formRows >= 10 && f.has('classlevel') ? 'Fillable D&D 5e character sheet' : formRows > 0 ? 'Fillable PDF form' : hasText ? 'Text PDF (values read from the page text)' : 'No readable content';
  return { rows, format, imageOnly };
}

export interface ImportedItem {
  name: string;
  quantity: number;
}

/** Builds a sheet from the rows the player kept, plus the inventory items to add. */
export function rowsToSheet(rows: ImportRow[], source: { fileName: string; format: string }): { sheet: CharacterSheet; items: ImportedItem[]; problems: string[] } {
  const keep = rows.filter((r) => r.include && (r.value.trim() || r.kind === 'spell'));
  const problems: string[] = [];
  const sheet: CharacterSheet = {
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
    spellEffects: [],
    notes: '',
    raw: [],
    source: { kind: 'pdf', fileName: source.fileName.slice(0, 200), importedAt: new Date().toISOString(), format: source.format },
  };
  const items: ImportedItem[] = [];
  const hp: Partial<Record<'current' | 'max' | 'temp', number>> = {};
  const int = (r: ImportRow) => {
    const n = Number(r.value.trim().replace(/^\+/, ''));
    if (!Number.isInteger(n)) problems.push(`“${r.label}” must be a whole number (is “${r.value}”).`);
    return Number.isInteger(n) ? n : null;
  };
  const entry = (r: ImportRow) => ({ id: newEntryId('d'), label: r.label.slice(0, SHEET_LIMITS.label), value: r.value.trim() });
  for (const r of keep) {
    switch (r.kind) {
      case 'detail':
        sheet.details.push(entry(r));
        break;
      case 'appearance':
        sheet.appearance.push(entry(r));
        break;
      case 'combat':
        sheet.combat.push(entry(r));
        break;
      case 'spellcasting':
        sheet.spellcasting.push(entry(r));
        break;
      case 'raw':
        sheet.raw.push(entry(r));
        break;
      case 'attribute':
        sheet.attributes.push({ id: newEntryId('a'), name: r.label, value: r.value.trim().slice(0, 40), modifier: (r.modifier ?? '').trim().slice(0, 40) });
        break;
      case 'skill':
      case 'save':
        (r.kind === 'skill' ? sheet.skills : sheet.saves).push({
          id: newEntryId('s'),
          name: r.label,
          value: r.value.trim().slice(0, 40),
          proficient: !!r.proficient,
          ...(r.expertise ? { expertise: true } : {}),
        });
        break;
      case 'hp': {
        const n = int(r);
        if (n !== null && r.hp) hp[r.hp] = n;
        break;
      }
      case 'resource': {
        const n = int(r);
        const max = r.modifier && /^\d+$/.test(r.modifier) ? Number(r.modifier) : null;
        if (n !== null) sheet.resources.push({ id: newEntryId('r'), name: r.label, current: n, max });
        break;
      }
      case 'attack':
        sheet.attacks.push({ id: newEntryId('w'), name: r.value.trim().slice(0, 160), bonus: r.bonus ?? '', damage: r.damage ?? '', range: r.range ?? '', notes: '' });
        break;
      case 'feature':
        sheet.abilities.push({ id: newEntryId('f'), name: r.label, text: r.value.trim() });
        break;
      case 'spell':
        sheet.spells.push({ id: newEntryId('sp'), name: (r.value.trim() || r.label).slice(0, 160), level: Math.max(0, Math.min(9, r.level ?? 1)), prepared: (r.level ?? 1) === 0 || !!r.prepared, source: r.spellSource ?? '', notes: '', school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, ritual: false, description: '' });
        break;
      case 'note':
        sheet.notes = [sheet.notes, r.label === 'Complete page text' ? r.value.trim() : `${r.label}:\n${r.value.trim()}`].filter(Boolean).join('\n\n').slice(0, SHEET_LIMITS.notes);
        break;
      case 'item':
        items.push({ name: r.value.trim().slice(0, 200), quantity: Math.max(0, Math.min(100000, r.quantity ?? 1)) });
        break;
    }
  }
  if (hp.max !== undefined || hp.current !== undefined) {
    const max = hp.max ?? hp.current!;
    sheet.hitPoints = { max, current: hp.current ?? max, temp: hp.temp ?? 0 };
  }
  return { sheet, items, problems };
}
