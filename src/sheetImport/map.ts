/**
 * Maps data extracted from a character-sheet PDF to the APEX sheet model.
 *
 * Pure functions – no PDF library here, so the mapping is unit-tested.
 *  - Fillable PDFs (AcroForm fields, e.g. the official D&D 5e sheet and many exports based on it)
 *    are mapped field by field and marked "recognized".
 *  - Text-only PDFs are scanned with conservative patterns; every value found this way is marked
 *    "uncertain" and must be confirmed in the review screen.
 *  - Important values that were not found are listed as "missing" – nothing is invented.
 *  - Filled fields that APEX does not understand are listed as "unrecognized" (not imported by default).
 *
 * Designed so other sources (e.g. Aurora's XML character files) can produce the same ImportRow list later.
 */
import { SHEET_LIMITS, SHEET_SCHEMA, newEntryId, type CharacterSheet } from '../game/sheet';

export type RowStatus = 'recognized' | 'uncertain' | 'missing' | 'unrecognized';
export type RowSection = 'details' | 'attributes' | 'skills' | 'hitPoints' | 'resources' | 'abilities' | 'notes' | 'inventory';

export interface ImportRow {
  key: string;
  section: RowSection;
  label: string;
  value: string;
  /** Attributes only. */
  modifier?: string;
  /** hitPoints only: which value. */
  hp?: 'current' | 'max' | 'temp';
  status: RowStatus;
  /** Where the value came from (PDF field name or "text"). */
  source: string;
  include: boolean;
  note?: string;
}

export interface Extracted {
  /** Form field name → value (text fields, choices). */
  fields: Record<string, string>;
  /** Plain text of the pages. */
  text: string;
  pages: number;
}

export interface MappingResult {
  rows: ImportRow[];
  /** Human description of the detected layout. */
  format: string;
  /** Neither form fields nor text → probably a scanned/image-only PDF. */
  imageOnly: boolean;
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v: string) => v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
const isCheckboxValue = (v: string) => /^(yes|no|off|on|true|false|\/?yes|\/?off|x)$/i.test(v.trim());

const DETAILS: Record<string, string> = {
  charactername: 'Character Name',
  classlevel: 'Class & Level',
  class: 'Class',
  level: 'Level',
  subclass: 'Subclass',
  background: 'Background',
  playername: 'Player Name',
  race: 'Race / Species',
  species: 'Race / Species',
  alignment: 'Alignment',
  xp: 'Experience Points',
  experiencepoints: 'Experience Points',
  ac: 'Armor Class',
  armorclass: 'Armor Class',
  initiative: 'Initiative',
  speed: 'Speed',
  profbonus: 'Proficiency Bonus',
  proficiencybonus: 'Proficiency Bonus',
  inspiration: 'Inspiration',
  passive: 'Passive Wisdom (Perception)',
  passiveperception: 'Passive Wisdom (Perception)',
  hdtotal: 'Hit Dice (total)',
  hd: 'Hit Dice',
  age: 'Age',
  height: 'Height',
  weight: 'Weight',
  eyes: 'Eyes',
  skin: 'Skin',
  hair: 'Hair',
  faction: 'Faction',
  factionname: 'Faction',
  spellcastingclass2: 'Spellcasting Class',
  spellcastingability2: 'Spellcasting Ability',
  spellsavedc2: 'Spell Save DC',
  spellatkbonus2: 'Spell Attack Bonus',
};

const ATTRS: Array<[string, string, string]> = [
  ['str', 'strmod', 'Strength'],
  ['dex', 'dexmod', 'Dexterity'],
  ['con', 'conmod', 'Constitution'],
  ['int', 'intmod', 'Intelligence'],
  ['wis', 'wismod', 'Wisdom'],
  ['cha', 'chamod', 'Charisma'],
];

const SKILLS: Record<string, string> = {
  acrobatics: 'Acrobatics',
  animal: 'Animal Handling',
  animalhandling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightofhand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
  ststrength: 'Strength Save',
  stdexterity: 'Dexterity Save',
  stconstitution: 'Constitution Save',
  stintelligence: 'Intelligence Save',
  stwisdom: 'Wisdom Save',
  stcharisma: 'Charisma Save',
};

const TEXTS: Record<string, string> = {
  personalitytraits: 'Personality Traits',
  ideals: 'Ideals',
  bonds: 'Bonds',
  flaws: 'Flaws',
  featuresandtraits: 'Features & Traits',
  features: 'Features & Traits',
  feat: 'Features & Traits',
  proficiencieslang: 'Proficiencies & Languages',
  proficiencies: 'Proficiencies & Languages',
  languages: 'Languages',
  attacksspellcasting: 'Attacks & Spellcasting',
  backstory: 'Backstory',
  characterbackstory: 'Backstory',
  allies: 'Allies & Organizations',
  alliesorganizations: 'Allies & Organizations',
  treasure: 'Treasure',
  additionalfeatures: 'Additional Features & Traits',
  additionalfeaturestraits: 'Additional Features & Traits',
};

const COINS: Record<string, string> = { cp: 'Copper (cp)', sp: 'Silver (sp)', ep: 'Electrum (ep)', gp: 'Gold (gp)', pp: 'Platinum (pp)' };
const HP: Record<string, 'current' | 'max' | 'temp'> = { hpmax: 'max', hpcurrent: 'current', hptemp: 'temp', maxhp: 'max', currenthp: 'current', temphp: 'temp' };

export function mapExtraction(x: Extracted): MappingResult {
  const rows: ImportRow[] = [];
  const used = new Set<string>();
  // normalised name → [original name, value]
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
  const add = (r: Omit<ImportRow, 'include'> & { include?: boolean }) => rows.push({ include: r.status !== 'missing' && r.status !== 'unrecognized', ...r });

  // ---- form fields
  for (const [n, label] of Object.entries(DETAILS)) {
    const e = take(n);
    if (e && !isCheckboxValue(e[1])) add({ key: `d:${n}`, section: 'details', label, value: e[1].slice(0, SHEET_LIMITS.value), status: 'recognized', source: e[0] });
  }
  for (const [vk, mk, label] of ATTRS) {
    const v = take(vk);
    const m = take(mk);
    if (v || m) add({ key: `a:${vk}`, section: 'attributes', label, value: v?.[1] ?? '', modifier: m?.[1] ?? '', status: v ? 'recognized' : 'uncertain', source: [v?.[0], m?.[0]].filter(Boolean).join(' / '), note: v ? undefined : 'Only the modifier was found.' });
  }
  for (const [n, which] of Object.entries(HP)) {
    const e = take(n);
    if (e) {
      const num = /^-?\d+$/.test(e[1]) ? e[1] : '';
      add({ key: `h:${which}`, section: 'hitPoints', label: which === 'max' ? 'Hit points (maximum)' : which === 'current' ? 'Hit points (current)' : 'Temporary hit points', value: num || e[1], hp: which, status: num ? 'recognized' : 'uncertain', source: e[0], note: num ? undefined : 'Not a whole number – please correct.' });
    }
  }
  for (const [n, label] of Object.entries(SKILLS)) {
    const e = take(n);
    if (e && !isCheckboxValue(e[1])) add({ key: `s:${n}`, section: 'skills', label, value: e[1].slice(0, 40), status: 'recognized', source: e[0] });
  }
  for (const [n, label] of Object.entries(TEXTS)) {
    const e = take(n);
    if (e) add({ key: `t:${n}`, section: 'abilities', label, value: e[1].slice(0, SHEET_LIMITS.text), status: 'recognized', source: e[0] });
  }
  // Weapons: "Wpn Name", "Wpn1 AtkBonus", "Wpn1 Damage", "Wpn Name 2", "Wpn2 AtkBonus " …
  for (let i = 1; i <= 3; i++) {
    const name = take(i === 1 ? 'wpnname' : `wpnname${i}`);
    const atk = take(`wpn${i}atkbonus`);
    const dmg = take(`wpn${i}damage`);
    if (name) {
      const text = [atk ? `Attack bonus ${atk[1]}` : '', dmg ? `Damage ${dmg[1]}` : ''].filter(Boolean).join(' · ');
      add({ key: `w:${i}`, section: 'abilities', label: `Weapon: ${name[1]}`.slice(0, 160), value: text || '—', status: 'recognized', source: name[0] });
    }
  }
  for (const [n, label] of Object.entries(COINS)) {
    const e = take(n);
    if (e) {
      const ok = /^\d+$/.test(e[1]);
      add({ key: `c:${n}`, section: 'resources', label, value: ok ? e[1] : e[1], status: ok ? 'recognized' : 'uncertain', source: e[0], note: ok ? undefined : 'Not a whole number – please correct.' });
    }
  }
  // Spell slots on the official spell page: SlotsTotal 19–27 = spell levels 1–9.
  for (let lvl = 1; lvl <= 9; lvl++) {
    const total = take(`slotstotal${18 + lvl}`);
    const left = take(`slotsremaining${18 + lvl}`);
    if (total && /^\d+$/.test(total[1])) {
      add({ key: `sl:${lvl}`, section: 'resources', label: `Spell slots (level ${lvl})`, value: left && /^\d+$/.test(left[1]) ? left[1] : total[1], modifier: total[1], status: 'uncertain', source: total[0], note: 'Spell slot fields are numbered by position – please check the level.' });
    }
  }
  // Spells listed on the spell page → one ability entry.
  const spellNames = [...f.entries()].filter(([n, [, v]]) => /^spells\d+$/.test(n) && !isCheckboxValue(v)).map(([n, [, v]]) => (used.add(n), v));
  if (spellNames.length) add({ key: 'spells', section: 'abilities', label: 'Spells', value: spellNames.join('\n').slice(0, SHEET_LIMITS.text), status: 'uncertain', source: `${spellNames.length} spell fields`, note: 'Spell levels are not distinguished.' });

  const equipment = take('equipment');
  if (equipment) {
    const lines = equipment[1].split(/\n|;|,(?![^(]*\))/).map((s) => s.trim()).filter((s) => s.length > 1);
    lines.slice(0, 100).forEach((line, i) => add({ key: `i:${i}`, section: 'inventory', label: 'Inventory item', value: line.slice(0, 200), status: 'recognized', source: equipment[0] }));
  }

  // Remaining filled fields that APEX does not understand (checkboxes are ignored).
  for (const [n, [name, v]] of f) {
    if (used.has(n) || isCheckboxValue(v)) continue;
    add({ key: `u:${n}`, section: 'details', label: name.trim().slice(0, SHEET_LIMITS.label), value: v.slice(0, SHEET_LIMITS.value), status: 'unrecognized', source: name, note: 'APEX does not know this field. Tick it to keep it as a detail.' });
  }

  const formRows = rows.length;
  // ---- text patterns (only for values the form did not provide)
  const text = x.text;
  const have = (section: RowSection, label?: string) => rows.some((r) => r.section === section && (!label || r.label === label));
  const fromText = (key: string, section: RowSection, label: string, value: string, extra: Partial<ImportRow> = {}) =>
    add({ key: `x:${key}`, section, label, value, status: 'uncertain', source: 'text', note: 'Found in the page text – please check.', ...extra });

  if (text.trim()) {
    if (!have('attributes')) {
      for (const [, , label] of ATTRS) {
        const short = label.slice(0, 3);
        const re = new RegExp(`\\b(?:${label}|${short})\\b[^\\d\\n+\\-−]{0,12}(\\d{1,2})\\s*\\(?\\s*([+\\-−]\\s?\\d{1,2})?`, 'i');
        const m = re.exec(text);
        if (m && Number(m[1]) >= 1 && Number(m[1]) <= 30) fromText(`a:${short}`, 'attributes', label, m[1], { modifier: m[2]?.replace(/\s|−/g, (c) => (c === '−' ? '-' : '')) ?? '' });
      }
    }
    if (!have('hitPoints')) {
      const max = /(?:hit point maximum|max(?:imum)?\.? hp|hp max(?:imum)?|hit points?)\D{0,12}(\d{1,4})/i.exec(text);
      if (max) fromText('h:max', 'hitPoints', 'Hit points (maximum)', max[1], { hp: 'max' });
      const cur = /current hit points?\D{0,12}(\d{1,4})/i.exec(text);
      if (cur) fromText('h:current', 'hitPoints', 'Hit points (current)', cur[1], { hp: 'current' });
    }
    if (!have('details', 'Armor Class')) {
      const ac = /(?:armou?r class|\bAC\b)\D{0,8}(\d{1,2})\b/i.exec(text);
      if (ac) fromText('d:ac', 'details', 'Armor Class', ac[1]);
    }
    if (!have('details', 'Speed')) {
      const sp = /\bspeed\b\D{0,8}(\d{1,3}\s?(?:ft\.?|feet|m)\b)/i.exec(text);
      if (sp) fromText('d:speed', 'details', 'Speed', sp[1]);
    }
    if (!have('details', 'Class & Level') && !have('details', 'Class')) {
      const cl = /\b(Artificer|Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard)\s+(\d{1,2})\b/.exec(text);
      if (cl) fromText('d:class', 'details', 'Class & Level', `${cl[1]} ${cl[2]}`);
    }
    if (!have('details', 'Character Name')) {
      const nm = /character name\s*[:\n]\s*([^\n]{2,40})/i.exec(text);
      if (nm) fromText('d:name', 'details', 'Character Name', nm[1].trim());
    }
    if (text.trim().length <= SHEET_LIMITS.notes) {
      add({ key: 'notes:text', section: 'notes', label: 'Complete page text', value: text.trim(), status: 'uncertain', source: 'text', include: false, note: 'Optionally keep the whole extracted text in the notes.' });
    }
  }

  // ---- missing essentials (nothing is invented; the player may fill them in)
  const missing = (key: string, section: RowSection, label: string, extra: Partial<ImportRow> = {}) =>
    add({ key: `m:${key}`, section, label, value: '', status: 'missing', source: '—', note: 'Not found in the PDF.', ...extra });
  if (!have('hitPoints')) missing('hp', 'hitPoints', 'Hit points (maximum)', { hp: 'max' });
  if (!have('attributes')) missing('attrs', 'attributes', 'Attributes / ability scores');
  if (!have('details', 'Class & Level') && !have('details', 'Class')) missing('class', 'details', 'Class & Level');
  if (!have('details', 'Armor Class')) missing('ac', 'details', 'Armor Class');

  const hasText = text.replace(/\s/g, '').length >= 20;
  const format =
    formRows >= 10 && f.has('classlevel') ? 'Fillable D&D 5e character sheet' : formRows > 0 ? 'Fillable PDF form' : hasText ? 'Text PDF (values read from the page text)' : 'No readable content';
  return { rows, format, imageOnly: !Object.keys(x.fields).length && !hasText };
}

/** Builds a sheet from the rows the player kept, plus the inventory lines to add. */
export function rowsToSheet(rows: ImportRow[], source: { fileName: string; format: string }): { sheet: CharacterSheet; items: string[]; problems: string[] } {
  const keep = rows.filter((r) => r.include && r.value.trim());
  const problems: string[] = [];
  const sheet: CharacterSheet = {
    schema: SHEET_SCHEMA,
    hitPoints: null,
    details: [],
    attributes: [],
    skills: [],
    resources: [],
    abilities: [],
    notes: '',
    source: { kind: 'pdf', fileName: source.fileName.slice(0, 200), importedAt: new Date().toISOString(), format: source.format },
  };
  const items: string[] = [];
  const hp: Partial<Record<'current' | 'max' | 'temp', number>> = {};
  const int = (r: ImportRow) => {
    const n = Number(r.value.trim().replace(/^\+/, ''));
    if (!Number.isInteger(n)) problems.push(`“${r.label}” must be a whole number (is “${r.value}”).`);
    return Number.isInteger(n) ? n : null;
  };
  for (const r of keep) {
    switch (r.section) {
      case 'details':
        sheet.details.push({ id: newEntryId('d'), label: r.label.slice(0, SHEET_LIMITS.label), value: r.value.trim() });
        break;
      case 'attributes':
        sheet.attributes.push({ id: newEntryId('a'), name: r.label, value: r.value.trim().slice(0, 40), modifier: (r.modifier ?? '').trim().slice(0, 40) });
        break;
      case 'skills':
        sheet.skills.push({ id: newEntryId('s'), name: r.label, value: r.value.trim().slice(0, 40), proficient: false });
        break;
      case 'hitPoints': {
        const n = int(r);
        if (n !== null && r.hp) hp[r.hp] = n;
        break;
      }
      case 'resources': {
        const n = int(r);
        const max = r.modifier && /^\d+$/.test(r.modifier) ? Number(r.modifier) : null;
        if (n !== null) sheet.resources.push({ id: newEntryId('r'), name: r.label, current: n, max });
        break;
      }
      case 'abilities':
        sheet.abilities.push({ id: newEntryId('f'), name: r.label, text: r.value.trim() });
        break;
      case 'notes':
        sheet.notes = [sheet.notes, r.value.trim()].filter(Boolean).join('\n\n').slice(0, SHEET_LIMITS.notes);
        break;
      case 'inventory':
        items.push(r.value.trim());
        break;
    }
  }
  if (hp.max !== undefined || hp.current !== undefined) {
    const max = hp.max ?? hp.current!;
    sheet.hitPoints = { max, current: hp.current ?? max, temp: hp.temp ?? 0 };
  }
  return { sheet, items, problems };
}
