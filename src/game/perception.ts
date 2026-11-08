/**
 * Stealth and Perception numbers (APEX 1.4): from the character sheet (skills, "Passive Perception") or the NPC's
 * stat block (senses "passive Perception 13", ability scores). Hidden creatures are noticed by opponents whose
 * passive Perception reaches the Stealth total, or by an active Search (Wisdom (Perception) check).
 */
import type { CharacterSheet } from './sheet.js';
import type { GameState } from './types.js';
import type { SceneEnemy } from './sceneCombat.js';
import { statBlock } from './bestiary.js';

const signed = (v: string | undefined) => { const m = /([+-−]?\s*\d{1,2})/.exec(v ?? ''); return m ? Number(m[1].replace(/[\s−]/g, (c) => (c === '−' ? '-' : ''))) : null; };
const abilityMod = (sheet: Pick<CharacterSheet, 'attributes'>, re: RegExp) => { const a = sheet.attributes.find((x) => re.test(x.name.trim())); const n = Number(/\d+/.exec(a?.value ?? '')?.[0]); return Number.isFinite(n) && n > 0 ? Math.floor((n - 10) / 2) : signed(a?.modifier) ?? 0; };
const skill = (sheet: Pick<CharacterSheet, 'skills'>, name: string) => signed(sheet.skills.find((s) => s.name.trim().toLowerCase() === name)?.value);

/** Ability modifier from the sheet (score, else the printed modifier). */
export const pcAbilityMod = (sheet: Pick<CharacterSheet, 'attributes'>, re: RegExp) => abilityMod(sheet, re);
export const pcStealth = (sheet: CharacterSheet) => skill(sheet, 'stealth') ?? abilityMod(sheet, /^dex/i);
export const pcPerception = (sheet: CharacterSheet) => skill(sheet, 'perception') ?? abilityMod(sheet, /^wis/i);
export function pcPassivePerception(sheet: CharacterSheet): number {
  const p = sheet.combat.find((c) => /passive (wisdom \()?perception/i.test(c.label));
  const n = p ? Number(/\d{1,2}/.exec(p.value)?.[0]) : NaN;
  return Number.isFinite(n) ? n : 10 + pcPerception(sheet);
}

export function npcPassivePerception(state: GameState, e: SceneEnemy): number {
  const senses = statBlock(state, e.templateId)?.senses ?? '';
  const m = /passive perception (\d{1,2})/i.exec(senses);
  if (m) return Number(m[1]);
  return 10 + (e.abilities ? Math.floor((e.abilities.wis - 10) / 2) : 0);
}
export const npcStealth = (e: SceneEnemy) => (e.abilities ? Math.floor((e.abilities.dex - 10) / 2) : 0);
export const npcPerception = (state: GameState, e: SceneEnemy) => npcPassivePerception(state, e) - 10;
