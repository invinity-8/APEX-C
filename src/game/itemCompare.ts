/**
 * APEX 1.0 – "is this an upgrade?" for the inventory hover.
 *
 * Builds on previewEquipStats (the same slot and derived-stat rules as the live character): every changed number
 * becomes a line, and a weighted score gives the verdict. The weights only rank the lines (AC and attack bonus
 * matter more than a skill point); the player always sees every individual change.
 */
import { previewEquipStats, type EquipmentPreview } from './equipment.js';
import type { CharacterSheet } from './sheet.js';
import type { Token } from './types.js';
import type { ItemRules } from './items/rules.js';

export type Verdict = 'upgrade' | 'downgrade' | 'mixed' | 'same';
export interface CompareLine { label: string; current: string; candidate: string; delta?: number; good?: boolean; neutral?: boolean }
export interface Comparison { preview: EquipmentPreview; lines: CompareLine[]; score: number; verdict: Verdict }

/** Average damage of "2d6+3 slashing + 2 fire" (dice average + all flat numbers). */
export function averageDamage(text: string | undefined): number | null {
  if (!text || text === '—') return null;
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/(\d{1,2})d(\d{1,3})/g)) {
    total += (Number(m[1]) * (Number(m[2]) + 1)) / 2;
    found = true;
  }
  const rest = text.replace(/\d{1,2}d\d{1,3}/g, '');
  for (const m of rest.matchAll(/([+-])\s*(\d{1,3})/g)) total += (m[1] === '-' ? -1 : 1) * Number(m[2]);
  return found ? total : null;
}

const WEIGHT = { ac: 10, toHit: 6, damage: 2, resistancePct: 0.3, maxHp: 1, initiative: 3, speedFt: 0.6, save: 4, skill: 1.5, ability: 5, spellAttack: 6, spellDc: 8, thorns: 1, carry: 0.05 };

export function compareItem(sheet: CharacterSheet, token: Pick<Token, 'inventory' | 'equipment' | 'armorWornAt'>, itemId: string, rules?: ItemRules): Comparison | { reason: string } {
  const preview = previewEquipStats(sheet, token, itemId, rules);
  if ('reason' in preview) return preview;
  const lines: CompareLine[] = [];
  let score = 0;
  let plus = 0;
  let minus = 0;
  const add = (label: string, cur: number | null | undefined, next: number | null | undefined, weight: number, unit = '') => {
    if (cur == null || next == null || cur === next) return;
    const delta = next - cur;
    const s = delta * weight;
    score += s;
    if (s > 0) plus += s;
    else minus -= s;
    lines.push({ label, current: `${cur}${unit}`, candidate: `${next}${unit}`, delta, good: delta > 0 });
  };
  const a = preview.current;
  const b = preview.candidate;
  add('Armor Class', a.ac.value, b.ac.value, WEIGHT.ac);
  const atkA = a.attacks.find((x) => x.slot === preview.slot);
  const atkB = b.attacks.find((x) => x.slot === preview.slot);
  add('Attack bonus', atkA?.toHit ?? (atkB ? 0 : null), atkB?.toHit ?? (atkA ? 0 : null), WEIGHT.toHit);
  if (atkA?.damage !== atkB?.damage) {
    const da = averageDamage(atkA?.damage) ?? 0;
    const db = averageDamage(atkB?.damage) ?? 0;
    const delta = Math.round((db - da) * 10) / 10;
    score += delta * WEIGHT.damage;
    if (delta > 0) plus += delta * WEIGHT.damage;
    else minus -= delta * WEIGHT.damage;
    lines.push({ label: 'Damage (average)', current: atkA ? `${atkA.damage} (Ø ${da})` : '—', candidate: atkB ? `${atkB.damage} (Ø ${db})` : '—', delta, good: delta > 0, neutral: delta === 0 });
  }
  for (const el of Object.keys(a.bonuses.resistances) as Array<keyof typeof a.bonuses.resistances>) {
    add(`${el[0].toUpperCase()}${el.slice(1)} resistance`, Math.round(a.bonuses.resistances[el].reduction * 100), Math.round(b.bonuses.resistances[el].reduction * 100), WEIGHT.resistancePct, ' %');
  }
  add('Maximum HP', a.bonuses.maxHp.value, b.bonuses.maxHp.value, WEIGHT.maxHp);
  add('Initiative', a.bonuses.initiative.value, b.bonuses.initiative.value, WEIGHT.initiative);
  add('Speed', a.bonuses.speed.value, b.bonuses.speed.value, WEIGHT.speedFt, ' ft');
  add('Carrying capacity', a.bonuses.carry.value, b.bonuses.carry.value, WEIGHT.carry, ' lb');
  add('Spell attack', a.bonuses.spellAttack.value, b.bonuses.spellAttack.value, WEIGHT.spellAttack);
  add('Spell save DC', a.bonuses.spellDc.value, b.bonuses.spellDc.value, WEIGHT.spellDc);
  add('Thorns', a.bonuses.thorns.value, b.bonuses.thorns.value, WEIGHT.thorns);
  for (const k of new Set([...Object.keys(a.abilityScores), ...Object.keys(b.abilityScores)]) as Set<keyof typeof a.abilityScores>) add(k.toUpperCase(), a.abilityScores[k]?.value, b.abilityScores[k]?.value, WEIGHT.ability);
  for (const k of new Set([...Object.keys(a.bonuses.saves), ...Object.keys(b.bonuses.saves)]) as Set<keyof typeof a.bonuses.saves>) add(`${k.toUpperCase()} saves`, a.bonuses.saves[k]?.value ?? 0, b.bonuses.saves[k]?.value ?? 0, WEIGHT.save);
  for (const k of new Set([...Object.keys(a.bonuses.skills), ...Object.keys(b.bonuses.skills)])) add(k, a.bonuses.skills[k]?.value ?? 0, b.bonuses.skills[k]?.value ?? 0, WEIGHT.skill);
  const verdict: Verdict = !lines.length || (plus < 0.5 && minus < 0.5) ? 'same' : plus >= 0.5 && minus >= 0.5 && Math.abs(score) < Math.max(plus, minus) * 0.5 ? 'mixed' : score > 0 ? 'upgrade' : 'downgrade';
  return { preview, lines, score: Math.round(score * 10) / 10, verdict };
}
