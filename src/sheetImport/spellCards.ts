/**
 * Spell-only PDF import ("Import Spells" in Character → Spells).
 *
 * Uses the same PDF as the character import, but reads nothing except spells:
 *  1. Printed spell cards (Aurora Builder prints them as a 3 × 3 grid with CASTING TIME / RANGE /
 *     DURATION / COMPONENTS labels). Cards are located by text position, never by guessing from
 *     the running page text, so two cards in neighbouring columns cannot bleed into each other.
 *  2. The structured spell list (form fields), when the sheet has one – the authoritative source for
 *     the prepared state.
 *
 * Nothing is invented: a value that is not printed in the PDF stays empty and is marked as
 * uncertain. No rules text from other sources is ever added.
 *
 * planSpellImport() compares the result with the existing spellbook. Existing non-empty values are
 * only replaced when the user explicitly ticks the change in the review (house rules and edited
 * descriptions stay intact by default). Existing spells are never removed by an import.
 *
 * Pure functions – tested against the real Aurora sample (tests/fixtures/sinna.pdf).
 */
import { newEntryId, type SheetSpell } from '../game/sheet';
import { mapExtraction, type Extracted, type PositionedText } from './map';

export type SpellField = 'name' | 'level' | 'school' | 'castingTime' | 'range' | 'components' | 'duration' | 'concentration' | 'ritual' | 'prepared' | 'description' | 'source';
export const SPELL_FIELDS: SpellField[] = ['name', 'level', 'prepared', 'school', 'castingTime', 'range', 'components', 'duration', 'concentration', 'ritual', 'description', 'source'];
export const SPELL_FIELD_LABEL: Record<SpellField, string> = {
  name: 'Name',
  level: 'Level',
  prepared: 'Prepared',
  school: 'School',
  castingTime: 'Casting time',
  range: 'Range',
  components: 'Components',
  duration: 'Duration',
  concentration: 'Concentration',
  ritual: 'Ritual',
  description: 'Description',
  source: 'Class / source',
};

/** One spell as read from the PDF. Fields that were not found are empty and listed in `uncertain`. */
export interface ImportedSpell {
  name: string;
  level: number;
  prepared: boolean;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  /** Spellcasting class, e.g. "Druid". */
  source: string;
  /** Printed book reference on the card (shown in the review only, never stored). */
  book: string;
  /** Where it was found, e.g. "page 5 · spell card". */
  origin: string;
  /** Fields that could not be read reliably from the PDF. */
  uncertain: SpellField[];
  /** Human-readable hints for the review. */
  notes: string[];
}

const LABELS = ['CASTING TIME', 'RANGE', 'DURATION', 'COMPONENTS'] as const;
const LABEL_FIELD: Record<(typeof LABELS)[number], 'castingTime' | 'range' | 'duration' | 'components'> = {
  'CASTING TIME': 'castingTime',
  RANGE: 'range',
  DURATION: 'duration',
  COMPONENTS: 'components',
};
const CANTRIP_RE = /^([A-Za-z]+) cantrip(\s*\(ritual\))?$/i;
const LEVELED_RE = /^([1-9])(?:st|nd|rd|th)-level ([A-Za-z]+)(\s*\(ritual\))?$/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** "1st-level conjuration" / "Transmutation Cantrip" → level, school, ritual. */
export function parseSpellSubtitle(text: string): { level: number; school: string; ritual: boolean } | null {
  const t = tidy(text);
  const c = CANTRIP_RE.exec(t);
  if (c) return { level: 0, school: cap(c[1]), ritual: !!c[2] };
  const l = LEVELED_RE.exec(t);
  if (l) return { level: Number(l[1]), school: cap(l[2]), ritual: !!l[3] };
  return null;
}

interface Line {
  x: number;
  y: number;
  h: number;
  text: string;
}

/** Group runs into visual lines (same baseline), left to right. */
function toLines(runs: PositionedText[]): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<Line & { runs: PositionedText[] }> = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) < 1.5) last.runs.push(r);
    else lines.push({ x: r.x, y: r.y, h: r.h, text: '', runs: [r] });
  }
  return lines.map((l) => {
    const rs = l.runs.sort((a, b) => a.x - b.x);
    return { x: rs[0].x, y: l.y, h: Math.max(...rs.map((r) => r.h)), text: tidy(rs.map((r) => r.str).join(' ')) };
  });
}

/** Description lines → paragraphs. An indented line starts a new paragraph (Aurora's layout). */
function joinParagraphs(lines: Line[]): string {
  if (!lines.length) return '';
  const left = Math.min(...lines.map((l) => l.x));
  const paras: string[] = [];
  for (const l of lines) {
    if (!paras.length || l.x > left + 3) paras.push(l.text);
    else {
      const prev = paras[paras.length - 1];
      paras[paras.length - 1] = /[A-Za-z]-$/.test(prev) ? prev + l.text : `${prev} ${l.text}`;
    }
  }
  return paras.map(tidy).filter(Boolean).join('\n');
}

/** Reads printed spell cards from positioned page text. */
export function parseSpellCards(x: Extracted): ImportedSpell[] {
  const out: ImportedSpell[] = [];
  (x.positioned ?? []).forEach((runs, pageIndex) => {
    const labels = runs.filter((r) => (LABELS as readonly string[]).includes(tidy(r.str)));
    const casting = labels.filter((r) => tidy(r.str) === 'CASTING TIME');
    if (!casting.length) return;
    const columnXs = [...new Set(casting.map((r) => Math.round(r.x)))].sort((a, b) => a - b);
    const gaps = columnXs.slice(1).map((v, i) => v - columnXs[i]).filter((g) => g > 40);
    const columnWidth = gaps.length ? Math.min(...gaps) : 200;
    // Card titles: a large run with a recognisable spell subtitle directly beneath it.
    const cards: Array<{ title: PositionedText; subtitle: PositionedText; parsed: NonNullable<ReturnType<typeof parseSpellSubtitle>>; left: number }> = [];
    for (const t of runs) {
      if (t.h < 8.5 || !tidy(t.str)) continue;
      const cx = t.x + t.w / 2;
      const sub = runs.find((s) => s !== t && s.y < t.y && t.y - s.y < 20 && s.x <= cx && s.x + s.w >= cx && parseSpellSubtitle(s.str));
      if (!sub) continue;
      const label = casting.filter((c) => c.y < sub.y && sub.y - c.y < 40 && c.x <= cx).sort((a, b) => b.x - a.x)[0];
      if (!label) continue;
      cards.push({ title: t, subtitle: sub, parsed: parseSpellSubtitle(sub.str)!, left: label.x - 12 });
    }
    for (const card of cards) {
      const right = card.left + columnWidth;
      const below = cards.filter((c) => c !== card && Math.abs(c.left - card.left) < 5 && c.title.y < card.title.y).sort((a, b) => b.title.y - a.title.y)[0];
      const bottom = below ? below.title.y + below.title.h : -Infinity;
      const inCard = runs.filter((r) => r !== card.title && r !== card.subtitle && r.x >= card.left && r.x < right && r.y < card.subtitle.y - 0.5 && r.y > bottom);
      const cardLabels = inCard.filter((r) => (LABELS as readonly string[]).includes(tidy(r.str)));
      const body = inCard.filter((r) => !cardLabels.includes(r));
      const spell: ImportedSpell = {
        name: tidy(card.title.str),
        level: card.parsed.level,
        prepared: card.parsed.level === 0,
        school: card.parsed.school,
        castingTime: '',
        range: '',
        components: '',
        duration: '',
        concentration: false,
        ritual: card.parsed.ritual,
        description: '',
        source: '',
        book: '',
        origin: `page ${pageIndex + 1} · spell card`,
        uncertain: [],
        notes: [],
      };
      // Values sit on the label's baseline, to the right of the label.
      let valueX = Infinity;
      let lowestValueY = Infinity;
      for (const label of LABELS) {
        const l = cardLabels.find((r) => tidy(r.str) === label);
        const field = LABEL_FIELD[label];
        if (!l) {
          spell.uncertain.push(field);
          continue;
        }
        const value = body.filter((r) => Math.abs(r.y - l.y) < 2 && r.x > l.x + l.w).sort((a, b) => a.x - b.x);
        if (!value.length) {
          spell.uncertain.push(field);
          continue;
        }
        valueX = Math.min(valueX, value[0].x);
        lowestValueY = Math.min(lowestValueY, l.y);
        spell[field] = tidy(value.map((r) => r.str).join(' '));
      }
      const used = new Set(body.filter((r) => cardLabels.some((l) => Math.abs(r.y - l.y) < 2 && r.x > l.x + l.w)));
      const rest = toLines(body.filter((r) => !used.has(r) && r.y < lowestValueY - 0.5));
      // A long components list wraps onto lines aligned with the value column.
      let i = 0;
      if (spell.components) {
        let lastY = lowestValueY;
        while (i < rest.length && Math.abs(rest[i].x - valueX) < 2 && lastY - rest[i].y < rest[i].h * 2) {
          spell.components = tidy(`${spell.components} ${rest[i].text}`);
          lastY = rest[i].y;
          i++;
        }
      }
      // Description: continuous lines; the footer is separated by a large gap.
      const desc: Line[] = [];
      let lastY = lowestValueY;
      for (; i < rest.length; i++) {
        const gap = lastY - rest[i].y;
        if (desc.length && gap > rest[i].h * 3) break;
        desc.push(rest[i]);
        lastY = rest[i].y;
      }
      const footer = rest.slice(i);
      spell.description = joinParagraphs(desc);
      if (!spell.description) spell.uncertain.push('description');
      spell.concentration = /^concentration\b/i.test(spell.duration);
      // Footer: "Prepared (Druid)" / "Spellcasting (Druid)" on the left, the book on the right.
      const footerRuns = body.filter((r) => footer.some((f) => Math.abs(f.y - r.y) < 1.5)).sort((a, b) => a.x - b.x);
      const footerLeft = footerRuns.length ? tidy(footerRuns[0].str) : '';
      spell.book = tidy(footerRuns.slice(1).map((r) => r.str).join(' '));
      const fm = /^(.*?)\s*\(([^)]+)\)$/.exec(footerLeft);
      if (fm) spell.source = tidy(fm[2]);
      else spell.uncertain.push('source');
      const status = (fm?.[1] ?? footerLeft).toLowerCase();
      if (spell.level === 0) spell.prepared = true;
      else if (/^(prepared|always prepared)$/.test(status)) spell.prepared = true;
      else if (/^(known|spellbook|not prepared)$/.test(status)) spell.prepared = false;
      else {
        spell.prepared = false;
        spell.uncertain.push('prepared');
        spell.notes.push('The card does not say whether this spell is prepared.');
      }
      out.push(spell);
    }
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

export interface SpellPdfResult {
  spells: ImportedSpell[];
  /** Short description of what was found, for the review header. */
  summary: string;
}

/**
 * Reads only the spells of a character PDF: printed spell cards plus the structured spell list.
 * The form list decides the prepared state when both are present; disagreements are flagged.
 */
export function readSpellsFromPdf(x: Extracted): SpellPdfResult {
  const cards = parseSpellCards(x);
  const listRows = mapExtraction(x).rows.filter((r) => r.kind === 'spell');
  const spells = [...cards];
  for (const row of listRows) {
    const name = tidy(row.value || row.label);
    if (!name) continue;
    const listed = row.status === 'recognized';
    const match = spells.find((s) => norm(s.name) === norm(name));
    if (match) {
      if (listed && typeof row.level === 'number' && row.level !== match.level) {
        match.uncertain.push('level');
        match.notes.push(`The spell list says level ${row.level}, the card says level ${match.level}.`);
      }
      if (listed && match.level > 0) {
        const fromList = !!row.prepared;
        if (match.uncertain.includes('prepared')) {
          match.prepared = fromList;
          match.uncertain = match.uncertain.filter((f) => f !== 'prepared');
          match.notes = match.notes.filter((n) => !n.includes('prepared'));
        } else if (fromList !== match.prepared) {
          match.uncertain.push('prepared');
          match.notes.push(`The spell list marks it as ${fromList ? 'prepared' : 'not prepared'}, the card as ${match.prepared ? 'prepared' : 'not prepared'}.`);
          match.prepared = fromList;
        }
      }
      if (!match.source && row.spellSource) {
        match.source = row.spellSource;
        match.uncertain = match.uncertain.filter((f) => f !== 'source');
      }
      continue;
    }
    // Listed on the sheet but no printed card: only name, level and prepared state are known.
    const level = typeof row.level === 'number' ? row.level : 1;
    spells.push({
      name,
      level,
      prepared: level === 0 || !!row.prepared,
      school: '',
      castingTime: '',
      range: '',
      components: '',
      duration: '',
      concentration: false,
      ritual: false,
      description: '',
      source: row.spellSource ?? '',
      book: '',
      origin: `spell list (${row.source})`,
      uncertain: listed ? ['school', 'castingTime', 'range', 'components', 'duration', 'description'] : ['level', 'prepared', 'school', 'castingTime', 'range', 'components', 'duration', 'description'],
      notes: ['No spell card was found in the PDF – only the spell list entry is available.'],
    });
  }
  for (const s of spells) s.uncertain = [...new Set(s.uncertain)];
  const summary = `${cards.length} spell card${cards.length === 1 ? '' : 's'}${listRows.length ? ` · ${listRows.length} entries in the spell list` : ''}`;
  return { spells, summary };
}

// ---------------------------------------------------------------- comparison with the spellbook

export interface FieldChange {
  field: SpellField;
  current: string | number | boolean;
  incoming: string | number | boolean;
  /** The existing value is non-empty and differs: only applied when the user ticks it. */
  conflict: boolean;
  apply: boolean;
}

export interface SpellPlanRow {
  key: string;
  /** new: added to the spellbook · update: fills or changes an existing spell · same: nothing to do */
  status: 'new' | 'update' | 'same';
  existingId: string | null;
  incoming: ImportedSpell;
  changes: FieldChange[];
  include: boolean;
}

const EMPTY_STRING_FIELDS: SpellField[] = ['school', 'castingTime', 'range', 'components', 'duration', 'description', 'source'];

function incomingValue(s: ImportedSpell, f: SpellField): string | number | boolean {
  return s[f as keyof ImportedSpell] as string | number | boolean;
}

/** Compares the PDF spells with the stored spellbook (matched by name, case-insensitive). */
export function planSpellImport(existing: SheetSpell[], incoming: ImportedSpell[]): SpellPlanRow[] {
  const used = new Set<string>();
  return incoming.map((s, i) => {
    const match = existing.find((e) => !used.has(e.id) && norm(e.name) === norm(s.name));
    // New spells from a printed card are pre-selected; list-only entries (often the whole class list) are opt-in.
    if (!match) return { key: `new:${i}`, status: 'new', existingId: null, incoming: s, changes: [], include: !!s.name.trim() && s.origin.includes('spell card') };
    used.add(match.id);
    const changes: FieldChange[] = [];
    for (const f of SPELL_FIELDS) {
      if (f === 'name') continue;
      const inc = incomingValue(s, f);
      const cur = match[f as keyof SheetSpell] as string | number | boolean;
      // Values the PDF does not contain never clear stored data.
      if (s.uncertain.includes(f) && (inc === '' || inc === false)) continue;
      if (typeof inc === 'string' && !inc.trim()) continue;
      if (typeof inc === 'string' ? tidy(inc) === tidy(String(cur ?? '')) : inc === cur) continue;
      if (f === 'prepared' && s.level === 0) continue;
      // Empty text and unset flags are filled in; the prepared state is play data and follows the PDF.
      // Everything else (level, existing text such as house rules) is an opt-in overwrite.
      const curEmpty = EMPTY_STRING_FIELDS.includes(f) ? !String(cur ?? '').trim() : f === 'concentration' || f === 'ritual' ? cur === false : f === 'prepared';
      const conflict = !curEmpty;
      changes.push({ field: f, current: cur, incoming: inc, conflict, apply: !conflict && !s.uncertain.includes(f) });
    }
    return { key: `upd:${match.id}`, status: changes.length ? 'update' : 'same', existingId: match.id, incoming: s, changes, include: changes.some((c) => c.apply) };
  });
}

/**
 * Builds the new spell list. Only spell fields change; existing spells keep their id, notes and
 * every value the user did not tick. Existing spells missing from the PDF stay untouched.
 */
export function applySpellImport(existing: SheetSpell[], plan: SpellPlanRow[], makeId: () => string = () => newEntryId('sp')): SheetSpell[] {
  const next = existing.map((s) => ({ ...s }));
  for (const row of plan) {
    if (!row.include) continue;
    const s = row.incoming;
    if (row.status === 'new') {
      if (!s.name.trim()) continue;
      next.push({
        id: makeId(),
        name: tidy(s.name).slice(0, 160),
        level: Math.max(0, Math.min(9, s.level)),
        prepared: s.level === 0 || s.prepared,
        source: s.source.slice(0, 80),
        notes: '',
        school: s.school.slice(0, 80),
        castingTime: s.castingTime.slice(0, 120),
        range: s.range.slice(0, 120),
        components: s.components.slice(0, 160),
        duration: s.duration.slice(0, 120),
        concentration: s.concentration,
        ritual: s.ritual,
        description: s.description.slice(0, 8000),
      });
      continue;
    }
    const target = next.find((e) => e.id === row.existingId);
    if (!target) continue;
    for (const c of row.changes) {
      if (!c.apply) continue;
      (target as unknown as Record<string, unknown>)[c.field] = c.incoming;
    }
    if (target.level === 0) target.prepared = true;
  }
  return next;
}

