/**
 * Class features usable in battle (APEX 1.3) – SRD 5.1, detected from the character sheet's features and class
 * levels. Uses are tracked as sheet resources (created with the SRD maximum when missing; rests restore them as
 * before – by the player/GM in the Character tab).
 *
 *  Action Surge (Fighter 2)     free, on your turn: one more action (1/short rest; 2 from level 17)
 *  Second Wind (Fighter 1)      bonus action: regain 1d10 + fighter level HP (1/short rest)
 *  Rage (Barbarian 1)           bonus action: 10 rounds, resistance to bludgeoning/piercing/slashing,
 *                               +2/+3/+4 melee damage (uses 2–6 per long rest by level)
 *  Wild Shape (Druid 2)         action: become a beast (existing rules); revert: bonus action
 *  Lay on Hands (Paladin 1)     action, touch: heal from a pool of 5 × paladin level
 *  Bardic Inspiration (Bard 1)  bonus action, 60 ft: an ally gets a d6/d8/d10/d12 for its next attack roll
 *                               (uses = Charisma modifier, at least 1)
 *  Sneak Attack, Divine Smite   applied with attacks (see server/combatFeatures.ts)
 */
import { wildShapeLevel, classLevel } from './abilities.js';
import type { CharacterSheet } from './sheet.js';

export type FeatureId = 'actionSurge' | 'secondWind' | 'rage' | 'wildShape' | 'revertShape' | 'layOnHands' | 'bardicInspiration';
export interface FeatureInfo { id: FeatureId; name: string; cost: 'free' | 'action' | 'bonus'; resource: string | null; max: number | null; current: number | null; text: string; target?: 'ally' | 'self'; rangeFt?: number }

const has = (sheet: CharacterSheet, re: RegExp) => sheet.abilities.some((a) => re.test(a.name));
const res = (sheet: CharacterSheet, name: string) => sheet.resources.find((r) => r.name.trim().toLowerCase() === name.toLowerCase());
const chaMod = (sheet: CharacterSheet) => { const a = sheet.attributes.find((x) => /^cha/i.test(x.name.trim())); const n = Number(/\d+/.exec(a?.value ?? '')?.[0]); return Number.isFinite(n) && n > 0 ? Math.floor((n - 10) / 2) : 0; };

export const rageUses = (lvl: number) => (lvl >= 20 ? 99 : lvl >= 17 ? 6 : lvl >= 12 ? 5 : lvl >= 6 ? 4 : lvl >= 3 ? 3 : 2);
export const rageDamage = (lvl: number) => (lvl >= 16 ? 4 : lvl >= 9 ? 3 : 2);
export const inspirationDie = (lvl: number) => (lvl >= 15 ? 'd12' : lvl >= 10 ? 'd10' : lvl >= 5 ? 'd8' : 'd6');

/** Features this character can use in battle, with the resource that tracks their uses. */
export function battleFeatures(sheet: CharacterSheet): FeatureInfo[] {
  const out: FeatureInfo[] = [];
  const f = (id: FeatureId, name: string, cost: FeatureInfo['cost'], resource: string | null, max: number | null, text: string, extra: Partial<FeatureInfo> = {}) => {
    const r = resource ? res(sheet, resource) : undefined;
    out.push({ id, name, cost, resource, max, current: resource ? (r?.current ?? max) : null, text, ...extra });
  };
  const fighter = classLevel(sheet, 'fighter'), barbarian = classLevel(sheet, 'barbarian'), druid = wildShapeLevel(sheet), paladin = classLevel(sheet, 'paladin'), bard = classLevel(sheet, 'bard');
  if (fighter && (fighter >= 2 || has(sheet, /action surge/i))) f('actionSurge', 'Action Surge', 'free', 'Action Surge', fighter >= 17 ? 2 : 1, 'One additional action on this turn.');
  if (fighter || has(sheet, /second wind/i)) f('secondWind', 'Second Wind', 'bonus', 'Second Wind', 1, `Regain 1d10 + ${fighter ?? 1} hit points.`);
  if (barbarian || has(sheet, /\brage\b/i)) f('rage', 'Rage', 'bonus', 'Rage', rageUses(barbarian ?? 1), `10 rounds: resistance to bludgeoning, piercing and slashing; +${rageDamage(barbarian ?? 1)} melee damage; advantage on Strength checks and saves (GM).`);
  if (druid && druid >= 2) {
    if (sheet.wildShape) f('revertShape', `Revert (${sheet.wildShape.formName})`, 'bonus', null, null, 'Return to your normal form.');
    else f('wildShape', 'Wild Shape', 'action', 'Wild Shape', 2, 'Become a beast you have seen (CR limit by level).');
  }
  if (paladin || has(sheet, /lay on hands/i)) f('layOnHands', 'Lay on Hands', 'action', 'Lay on Hands', 5 * (paladin ?? 1), 'Touch: restore hit points from the pool.', { target: 'ally', rangeFt: 5 });
  if (bard || has(sheet, /bardic inspiration/i)) f('bardicInspiration', 'Bardic Inspiration', 'bonus', 'Bardic Inspiration', Math.max(1, chaMod(sheet)), `An ally within 60 ft adds a ${inspirationDie(bard ?? 1)} to its next attack roll.`, { target: 'ally', rangeFt: 60 });
  return out;
}

/** Sheet with one use (or `amount` points) of a feature resource spent; the resource is created when missing. */
export function spendUse(sheet: CharacterSheet, info: FeatureInfo, amount = 1): CharacterSheet | string {
  if (!info.resource) return sheet;
  const next = structuredClone(sheet);
  let r = res(next, info.resource);
  if (!r) { r = { id: `r-${info.id}-${Math.random().toString(36).slice(2, 7)}`, name: info.resource, current: info.max ?? 1, max: info.max }; next.resources.push(r); }
  if (r.current < amount) return `No ${info.name} use left${info.resource === 'Lay on Hands' ? ` (pool ${r.current})` : ''} – it returns after a rest.`;
  r.current -= amount;
  return next;
}
