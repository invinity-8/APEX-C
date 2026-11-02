/**
 * Health & resource orbs (APEX 0.5) – pure model.
 *  - Health: the sheet's hit points (server-authoritative, atomic +/- via the sheet "adjust" action).
 *  - Main resource: weighted spell slots or any sheet resource; optionally a second resource (split orb).
 *  - Spell-slot weighting: a level-N slot weighs N. Remaining weight / maximum weight = orb fill.
 *    The real per-level counts stay visible and editable.
 *  - Class suggestions only PROPOSE a resource name; the player enters the maximum – nothing is invented.
 */
import type { CharacterSheet, OrbConfig, OrbSource, SheetResource } from './sheet.js';

export const SLOT_RE = /^spell slots \(level ([1-9])\)$/i;

export interface SlotLevel {
  level: number;
  resource: SheetResource;
}

export function spellSlotLevels(sheet: CharacterSheet): SlotLevel[] {
  return sheet.resources
    .map((r) => {
      const m = SLOT_RE.exec(r.name.trim());
      return m ? { level: Number(m[1]), resource: r } : null;
    })
    .filter((x): x is SlotLevel => !!x)
    .sort((a, b) => a.level - b.level);
}

export interface OrbValue {
  label: string;
  current: number;
  max: number;
  /** 0…1 fill */
  fill: number;
  /** e.g. "2/2 · 1/1 · 0/1" for slots */
  detail?: string;
  source: OrbSource;
}

export function weightedSlots(sheet: CharacterSheet): { current: number; max: number; detail: string } | null {
  const levels = spellSlotLevels(sheet);
  if (!levels.length) return null;
  let current = 0;
  let max = 0;
  for (const { level, resource } of levels) {
    const m = resource.max ?? resource.current;
    current += level * Math.min(resource.current, m);
    max += level * m;
  }
  return { current, max, detail: levels.map((l) => `L${l.level} ${l.resource.current}/${l.resource.max ?? '–'}`).join(' · ') };
}

export function orbValue(sheet: CharacterSheet, src: OrbSource | null): OrbValue | null {
  if (!src) return null;
  if (src.type === 'spellSlots') {
    const w = weightedSlots(sheet);
    if (!w) return null;
    return { label: 'Spell slots', current: w.current, max: w.max, fill: w.max ? w.current / w.max : 0, detail: w.detail, source: src };
  }
  const r = sheet.resources.find((x) => x.id === src.resourceId);
  if (!r) return null;
  const max = r.max ?? Math.max(r.current, 1);
  return { label: r.name, current: r.current, max, fill: max ? Math.min(1, r.current / max) : 0, source: src };
}

/** The orb configuration in effect: the player's choice, else spell slots if present, else the first resource. */
export function effectiveOrbs(sheet: CharacterSheet): OrbConfig {
  if (sheet.orbs) return sheet.orbs;
  if (spellSlotLevels(sheet).length) return { primary: { type: 'spellSlots' }, secondary: null };
  const first = sheet.resources.find((r) => !SLOT_RE.test(r.name) && !/^(gold|silver|copper|electrum|platinum)/i.test(r.name));
  return { primary: first ? { type: 'resource', resourceId: first.id } : null, secondary: null };
}

const CLASS_RESOURCES: Array<[RegExp, string]> = [
  [/\bdruid\b/i, 'Wild Shape'],
  [/\bcleric\b|\bpaladin\b/i, 'Channel Divinity'],
  [/\bsorcerer\b/i, 'Sorcery Points'],
  [/\bmonk\b/i, 'Ki / Focus Points'],
  [/\bbattle ?master\b|\bfighter\b/i, 'Superiority Dice'],
  [/\bbard\b/i, 'Bardic Inspiration'],
  [/\bbarbarian\b/i, 'Rage'],
  [/\bwarlock\b/i, 'Pact Magic Slots'],
];

/** Resource names that fit the character's class text – suggestions only (the player enters the maximum). */
export function suggestedResources(sheet: CharacterSheet): string[] {
  const text = sheet.details.map((d) => d.value).join(' ');
  const have = new Set(sheet.resources.map((r) => r.name.toLowerCase()));
  return CLASS_RESOURCES.filter(([re, name]) => re.test(text) && !have.has(name.toLowerCase())).map(([, n]) => n);
}

// ---------------------------------------------------------------- movement

/** Baseline: 8 movement points per day for a walking speed of 30 ft. */
export const MP_BASELINE = 8;
export const MP_MIN = 4;
export const MP_MAX = 16;

/**
 * Daily movement points from walking speed: round(8 × speed / 30), clamped to 4…16.
 * 25 ft → 7 · 30 ft → 8 · 35 ft → 9 · 40 ft → 11 · 45 ft → 12 · 50 ft → 13 · 60 ft → 16.
 */
export function movePointsForSpeed(speedFt: number): number {
  if (!Number.isFinite(speedFt) || speedFt <= 0) return MP_MIN;
  return Math.max(MP_MIN, Math.min(MP_MAX, Math.round((MP_BASELINE * speedFt) / 30)));
}

/** Walking speed in feet from the sheet ("30ft.", "30 ft", "9 m" is not converted). */
export function walkingSpeed(sheet: CharacterSheet): number | null {
  const v = sheet.combat.find((c) => /^speed( \(walking\))?$/i.test(c.label))?.value ?? '';
  const m = /(\d{1,3})\s*(ft|feet|')/i.exec(v) ?? /^(\d{1,3})$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}
