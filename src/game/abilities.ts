/**
 * Class abilities (APEX 0.7) – D&D 5e SRD 5.1 (2014 rules), applied to the character sheet by the server.
 *
 * Wild Shape (Druid, SRD 5.1):
 *  - from druid level 2; 2 uses, regained on a short or long rest; lasts up to ⌊druid level / 2⌋ hours;
 *  - beast limits: level 2–3 CR ≤ 1/4 and no flying or swimming speed; level 4–7 CR ≤ 1/2 and no flying speed;
 *    level 8+ CR ≤ 1 (Circle of the Moon is not part of the SRD – the GM can add suitable forms as custom beasts);
 *  - the beast's Strength, Dexterity, Constitution, AC, speeds, senses, attacks, HP and Hit Dice replace yours; you
 *    keep Intelligence, Wisdom, Charisma, your skill and saving-throw proficiencies (using the beast's bonus if it is
 *    higher) and class features you are physically able to use;
 *  - no spellcasting until Beast Spells at druid level 18;
 *  - you revert at 0 beast HP; excess damage carries over to your normal form; temporary HP are spent first.
 *  - Equipment (APEX rule, one of the SRD options): it merges into the new form and has no effect while transformed;
 *    items stay in the inventory untouched.
 *
 * Temporary hit points (SRD): separate from HP, lost first, do not stack – a new grant replaces the old amount only
 * if you choose to (APEX default "grant" keeps the higher value).
 *
 * Font of Magic (Sorcerer, SRD 5.1): from sorcerer level 2; Sorcery Points maximum = sorcerer level.
 *  - Creating a spell slot: 1st 2 SP · 2nd 3 · 3rd 5 · 4th 6 · 5th 7 (no slot above 5th). The slot is extra (it may
 *    exceed the slot maximum) and – as in the rules – vanishes on a long rest (the GM/player resets it).
 *  - Converting a slot gives SP equal to its level, never above the SP maximum.
 */
import { beastsFor } from './beastCatalog.js';
import type { BeastForm } from './beasts.js';
import { sheetLevel } from './progression.js';
import { SLOT_RE } from './resources.js';
import { newEntryId, type CharacterSheet, type SheetResource } from './sheet.js';

export type AbilityResult = { ok: true; sheet: CharacterSheet; message: string } | { ok: false; error: string };
const fail = (error: string): AbilityResult => ({ ok: false, error });

// ---------------------------------------------------------------- class levels

const CLASS_FIELDS = /^(class|class & level|class and level|race, class & level|multiclass)$/i;

/** Level in one class, read from the sheet ("Druid 3 / Rogue 2", "Level 4 Kor Druid", Class + Level fields …). */
export function classLevel(sheet: Pick<CharacterSheet, 'details'>, cls: string): number | null {
  const fields = sheet.details.filter((d) => CLASS_FIELDS.test(d.label.trim()));
  const re = new RegExp(`\\b${cls}\\b`, 'i');
  const hit = fields.find((d) => re.test(d.value));
  if (!hit) return null;
  const after = new RegExp(`\\b${cls}\\b\\s*(\\d{1,2})`, 'i').exec(hit.value);
  if (after) return Number(after[1]);
  const before = new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)?[- ]?(?:level)?\\s*${cls}\\b`, 'i').exec(hit.value);
  if (before && !/^level/i.test(hit.value.trim())) return Number(before[1]);
  // single class ("Level 4 Kor Druid", or a Class field + a Level field): the character level is the class level
  const classes = fields.flatMap((d) => d.value.split(/\s*\/\s*/)).filter((p) => /[a-z]/i.test(p));
  if (classes.length <= 1 || fields.length === 1) return sheetLevel(sheet);
  return null;
}

// ---------------------------------------------------------------- resources

const norm = (s: string) => s.trim().toLowerCase();
function findResource(sheet: CharacterSheet, name: string): SheetResource | undefined {
  return sheet.resources.find((r) => norm(r.name) === norm(name));
}
function ensureResource(sheet: CharacterSheet, name: string, max: number, current = max): SheetResource {
  const r = findResource(sheet, name);
  if (r) return r;
  const created = { id: newEntryId('r'), name, current, max };
  sheet.resources.push(created);
  return created;
}

// ---------------------------------------------------------------- Wild Shape

export const WILD_SHAPE_RESOURCE = 'Wild Shape';

export function wildShapeLimits(druidLevel: number) {
  if (druidLevel < 2) return null;
  const maxCr = druidLevel >= 8 ? 1 : druidLevel >= 4 ? 0.5 : 0.25;
  return { maxCr, fly: druidLevel >= 8, swim: druidLevel >= 4, hours: Math.floor(druidLevel / 2), spellcasting: druidLevel >= 18 };
}

/**
 * Druid level for Wild Shape: the class level, but at least 2 when the GM granted Wild Shape on the sheet
 * (a "Wild Shape" resource or ability) – e.g. a level-1 druid the table lets transform early.
 */
export function wildShapeLevel(sheet: Pick<CharacterSheet, 'details' | 'resources' | 'abilities'>): number | null {
  const lvl = classLevel(sheet, 'druid');
  const granted = sheet.resources.some((r) => /^wild shape$/i.test(r.name.trim())) || sheet.abilities.some((a) => /wild shape/i.test(a.name));
  if (granted) return Math.max(2, lvl ?? 0);
  return lvl;
}

export function formAllowed(form: BeastForm, druidLevel: number): string | null {
  const l = wildShapeLimits(druidLevel);
  if (!l) return 'Wild Shape needs druid level 2.';
  if (form.cr > l.maxCr) return `CR too high for druid level ${druidLevel}.`;
  if (form.speed.fly && !l.fly) return 'No flying speed before druid level 8.';
  if (form.speed.swim && !l.swim) return 'No swimming speed before druid level 4.';
  return null;
}

export interface WildShapeState {
  formId: string;
  formName: string;
  hp: number;
  maxHp: number;
  since: string;
}

export function transform(sheet: CharacterSheet, form: BeastForm, now = new Date()): AbilityResult {
  const lvl = wildShapeLevel(sheet);
  if (lvl === null) return fail('Only druids can use Wild Shape.');
  const why = formAllowed(form, lvl);
  if (why) return fail(why);
  if (sheet.wildShape) return fail(`Already transformed into a ${sheet.wildShape.formName} – revert first.`);
  if (!sheet.hitPoints) return fail('The character sheet needs hit points first.');
  const next = structuredClone(sheet);
  const uses = ensureResource(next, WILD_SHAPE_RESOURCE, 2);
  if (uses.current < 1) return fail('No Wild Shape use left – uses return after a short or long rest.');
  uses.current -= 1;
  next.wildShape = { formId: form.id, formName: form.name, hp: form.hp, maxHp: form.hp, since: now.toISOString() };
  return { ok: true, sheet: next, message: `Transformed into a ${form.name}.` };
}

export function revert(sheet: CharacterSheet): AbilityResult {
  if (!sheet.wildShape) return fail('Not transformed.');
  const next = structuredClone(sheet);
  delete next.wildShape;
  return { ok: true, sheet: next, message: 'Back in your normal form.' };
}

/** Damage: temporary HP first, then beast HP (if transformed, excess carries over and you revert), then HP. */
export function applyDamage(sheet: CharacterSheet, amount: number): AbilityResult {
  if (!sheet.hitPoints) return fail('This character sheet has no hit points.');
  const next = structuredClone(sheet);
  const hp = next.hitPoints!;
  let rest = Math.max(0, Math.floor(amount));
  const fromTemp = Math.min(hp.temp, rest);
  hp.temp -= fromTemp;
  rest -= fromTemp;
  let reverted = false;
  if (next.wildShape && rest > 0) {
    const ws = next.wildShape;
    if (rest < ws.hp) {
      ws.hp -= rest;
      rest = 0;
    } else {
      rest -= ws.hp;
      delete next.wildShape;
      reverted = true;
    }
  }
  if (rest > 0) hp.current = Math.max(0, hp.current - rest);
  return { ok: true, sheet: next, message: reverted ? `Beast form dropped to 0 HP – reverted; ${rest} damage carried over.` : `${amount} damage applied.` };
}

export function applyHealing(sheet: CharacterSheet, amount: number): AbilityResult {
  if (!sheet.hitPoints) return fail('This character sheet has no hit points.');
  const next = structuredClone(sheet);
  const n = Math.max(0, Math.floor(amount));
  if (next.wildShape) next.wildShape.hp = Math.min(next.wildShape.maxHp, next.wildShape.hp + n);
  else next.hitPoints!.current = Math.min(next.hitPoints!.max, Math.max(0, next.hitPoints!.current) + n);
  return { ok: true, sheet: next, message: `${n} HP healed.` };
}

export type TempMode = 'grant' | 'replace' | 'remove';
export function setTempHp(sheet: CharacterSheet, mode: TempMode, value: number): AbilityResult {
  if (!sheet.hitPoints) return fail('This character sheet has no hit points.');
  const next = structuredClone(sheet);
  const v = Math.max(0, Math.min(1000, Math.floor(value)));
  const hp = next.hitPoints!;
  hp.temp = mode === 'remove' ? 0 : mode === 'replace' ? v : Math.max(hp.temp, v); // temp HP never stack
  return { ok: true, sheet: next, message: `Temporary HP: ${hp.temp}.` };
}

/** Effective statistics while transformed (mental scores and proficiencies retained). */
export function wildShapeView(sheet: CharacterSheet, form: BeastForm) {
  const mod = (n: number) => Math.floor((n - 10) / 2);
  const own = (re: RegExp) => Number(sheet.attributes.find((a) => re.test(a.name.trim()))?.value) || 10;
  const pb = Number(/[+-]?\d+/.exec(sheet.combat.find((c) => /proficiency/i.test(c.label))?.value ?? '')?.[0] ?? 2);
  const scores = { str: form.str, dex: form.dex, con: form.con, int: own(/^int/i), wis: own(/^wis/i), cha: own(/^cha/i) };
  const proficient = (a: string) => sheet.saves.some((s) => s.proficient && s.name.toLowerCase().startsWith(a));
  const saves = Object.fromEntries((Object.keys(scores) as Array<keyof typeof scores>).map((a) => [a, mod(scores[a]) + (proficient(a) ? pb : 0)]));
  return { scores, mods: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, mod(v)])), saves, pb, ac: form.ac, speed: form.speed, attacks: form.attacks, senses: form.senses };
}

// ---------------------------------------------------------------- Font of Magic

export const SORCERY_RESOURCE = 'Sorcery Points';
export const SLOT_COST: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

function slotResource(sheet: CharacterSheet, level: number): SheetResource | undefined {
  return sheet.resources.find((r) => SLOT_RE.exec(r.name.trim())?.[1] === String(level));
}

export function sorceryPointsMax(sheet: CharacterSheet): number | null {
  const lvl = classLevel(sheet, 'sorcerer');
  return lvl !== null && lvl >= 2 ? lvl : null;
}

export function convertSorcery(sheet: CharacterSheet, direction: 'toSlot' | 'toPoints', level: number): AbilityResult {
  const max = sorceryPointsMax(sheet);
  if (max === null) return fail('Font of Magic needs sorcerer level 2.');
  if (!Number.isInteger(level) || level < 1 || level > 9) return fail('Invalid slot level.');
  const next = structuredClone(sheet);
  const sp = ensureResource(next, SORCERY_RESOURCE, max);
  sp.max = max; // the maximum always follows the sorcerer level
  if (direction === 'toSlot') {
    const cost = SLOT_COST[level];
    if (!cost) return fail('Sorcery Points can create spell slots up to 5th level only.');
    if (sp.current < cost) return fail(`Needs ${cost} Sorcery Points (you have ${sp.current}).`);
    let slot = slotResource(next, level);
    if (!slot) {
      slot = { id: newEntryId('r'), name: `Spell slots (level ${level})`, current: 0, max: 0 };
      next.resources.push(slot);
    }
    sp.current -= cost;
    slot.current += 1; // an extra slot may exceed the maximum; it vanishes on a long rest
    return { ok: true, sheet: next, message: `${cost} Sorcery Points → 1 level-${level} spell slot.` };
  }
  const slot = slotResource(next, level);
  if (!slot || slot.current < 1) return fail(`No level-${level} spell slot left.`);
  if (sp.current + level > max) return fail(`That would exceed your ${max} Sorcery Points.`);
  slot.current -= 1;
  sp.current += level;
  return { ok: true, sheet: next, message: `1 level-${level} spell slot → ${level} Sorcery Point${level === 1 ? '' : 's'}.` };
}

export { beastsFor };
