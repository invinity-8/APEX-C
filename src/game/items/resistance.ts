/**
 * APEX resistances (APEX 0.6) – additive points, separate from D&D 5e damage resistance.
 *
 *   Damage Reduction = min(max(points, 0), cap) / 200        (cap 100 → at most 50 %)
 *
 * Calculation order for one damage instance of one type (see docs/game/ITEMIZATION_BALANCE.md):
 *   1. Immunity (D&D)            → 0 damage, stop.
 *   2. D&D resistance            → halve, round down.
 *      D&D vulnerability         → double (both cancel each other, as in 5e).
 *   3. APEX resistance points    → prevented = floor(damage × reduction); damage −= prevented.
 * APEX reduction is applied last, rounds the PREVENTED amount down (so it never prevents more than its share)
 * and can never stack into immunity. The function only explains numbers – it never writes combat events.
 */
import { ELEMENTS, type Element } from './modifiers.js';

export const RESISTANCE_DIVISOR = 200;
export const MAX_RESISTANCE_CAP = 100;

export function resistanceReduction(points: number, cap = MAX_RESISTANCE_CAP): number {
  const c = Math.max(0, Math.min(MAX_RESISTANCE_CAP, cap));
  const p = Number.isFinite(points) ? Math.max(0, Math.min(points, c)) : 0;
  return p / RESISTANCE_DIVISOR;
}

export const formatReduction = (r: number) => `${Math.round(r * 1000) / 10}%`;

export function resistanceLabel(element: Element, points: number, cap = MAX_RESISTANCE_CAP): string {
  const name = element[0].toUpperCase() + element.slice(1);
  const capped = points > cap ? ` (capped at ${cap})` : '';
  return `${name} Resistance: ${points} points${capped} (${formatReduction(resistanceReduction(points, cap))} damage reduction)`;
}

export interface DamageInput {
  amount: number;
  immune?: boolean;
  dndResistant?: boolean;
  dndVulnerable?: boolean;
  apexPoints?: number;
  cap?: number;
}

export function applyDamage(input: DamageInput): { final: number; steps: Array<{ label: string; value: number }> } {
  let dmg = Math.max(0, Math.floor(input.amount));
  const steps = [{ label: 'Rolled damage', value: dmg }];
  if (input.immune) return { final: 0, steps: [...steps, { label: 'Immune (D&D)', value: 0 }] };
  if (input.dndResistant && !input.dndVulnerable) {
    dmg = Math.floor(dmg / 2);
    steps.push({ label: 'D&D resistance (halved, rounded down)', value: dmg });
  } else if (input.dndVulnerable && !input.dndResistant) {
    dmg = dmg * 2;
    steps.push({ label: 'D&D vulnerability (doubled)', value: dmg });
  }
  const r = resistanceReduction(input.apexPoints ?? 0, input.cap);
  if (r > 0) {
    const prevented = Math.floor(dmg * r);
    dmg -= prevented;
    steps.push({ label: `APEX resistance ${formatReduction(r)} (prevented ${prevented})`, value: dmg });
  }
  return { final: dmg, steps };
}

export type ResistanceTotals = Record<Element, number>;
export const emptyResistances = (): ResistanceTotals => Object.fromEntries(ELEMENTS.map((e) => [e, 0])) as ResistanceTotals;
