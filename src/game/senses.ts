/**
 * APEX 2.5 – special senses for scene vision (SRD 5.1): darkvision (sees in darkness as in dim light, in dim light
 * as in bright light, within its range) and blindsight / tremorsense / truesight (perceive without light within
 * their range). Read from sheet texts, the ancestry, a Wild Shape form or a stat block's senses line.
 */
import type { CharacterSheet } from './sheet.js';

export interface Senses { darkvisionFt: number; blindFt: number }
const ft = (re: RegExp, text: string) => { let best = 0; for (const m of text.matchAll(re)) best = Math.max(best, Math.min(300, Number(m[1]))); return best; };

/** Senses from free text such as "darkvision 60 ft., blindsight 10 ft., passive Perception 12". */
export function sensesFromText(text: string | undefined): Senses {
  const t = (text ?? '').toLowerCase();
  const truesight = ft(/truesight\s*(\d{1,3})/g, t);
  return { darkvisionFt: Math.max(ft(/darkvision\s*(?:of\s*)?(\d{1,3})/g, t), truesight), blindFt: Math.max(ft(/blindsight\s*(\d{1,3})/g, t), ft(/tremorsense\s*(\d{1,3})/g, t), truesight) };
}

/** Darkvision of the common ancestries (SRD 5.1 races; superior darkvision for drow and deep gnomes). */
export function ancestryDarkvision(text: string | undefined): number {
  const t = (text ?? '').toLowerCase();
  if (/\b(drow|dark elf|deep gnome|svirfneblin|duergar)\b/.test(t)) return 120;
  if (/\b(dwarf|dwarven|elf|elven|half-elf|half elf|half-orc|half orc|orc|gnome|tiefling|goblin|hobgoblin|bugbear|kobold|tabaxi|yuan-ti|aasimar|firbolg|genasi|changeling|kenku|lizardfolk|minotaur|centaur|satyr)\b/.test(t)) return 60;
  return 0;
}

/** Senses of a player character: sheet texts first, then the ancestry, plus an active Wild Shape form's senses. */
export function sheetSenses(sheet: CharacterSheet, formSenses?: string): Senses {
  const texts = [...sheet.combat.map((c) => `${c.label} ${c.value}`), ...sheet.abilities.map((a) => `${a.name} ${a.text.slice(0, 300)}`), ...sheet.raw.map((r) => `${r.label} ${r.value}`)].join(' \n ');
  const own = sensesFromText(texts);
  const ancestry = sheet.details.filter((d) => /race|species|ancestry|lineage|heritage|volk|rasse|herkunft/i.test(d.label)).map((d) => d.value).join(' ');
  const form = formSenses ? sensesFromText(formSenses) : { darkvisionFt: 0, blindFt: 0 };
  // Wild Shape: the beast's senses apply; a racial darkvision is kept as well (the better range counts)
  return { darkvisionFt: Math.max(own.darkvisionFt, ancestryDarkvision(ancestry), form.darkvisionFt), blindFt: Math.max(own.blindFt, form.blindFt) };
}
