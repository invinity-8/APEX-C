/**
 * Attack extras from features and effects (APEX 1.3, server): Sneak Attack, Divine Smite, Hunter's Mark / Hex,
 * Rage damage. Returns the extra dice/flat damage for the roll and a state step that records what was used.
 */
import type { SceneMap } from '../campaign/maps.js';
import { hexAt } from '../campaign/hexScene.js';
import { distance } from '../game/hex.js';
import type { AttackMods } from '../game/combatEffects.js';
import { effectsOf, incapacitated } from '../game/combatEffects.js';
import { classLevel } from '../game/abilities.js';
import { activeEncounter } from '../game/sceneTurns.js';
import { budgetOf, npcActor, pcActor, spend, spellSlots, type Figure } from '../game/sceneActions.js';
import type { CharacterSheet } from '../game/sheet.js';
import type { GameState } from '../game/types.js';
import { enemiesOf } from '../game/sceneCombat.js';
import { statBlock } from '../game/bestiary.js';

type Side = { kind: 'pc'; tokenId: string } | { kind: 'npc'; id: string };
const actorOf = (s: Side) => (s.kind === 'pc' ? pcActor(s.tokenId) : npcActor(s.id));
interface StrikeLike { kind?: 'melee' | 'ranged' | 'spell'; finesse?: boolean; rangeFt?: number }
interface CtxLike { state: GameState | null; sceneId?: string }

export const hasFeature = (sheet: CharacterSheet | null, re: RegExp) => !!sheet?.abilities.some((a) => re.test(a.name));

/** Smite dice: 2d8 for a 1st-level slot, +1d8 per level above (max 5d8), +1d8 against undead or fiends. */
export const smiteDice = (slot: number, undeadOrFiend: boolean) => `${Math.min(5, 1 + slot) + (undeadOrFiend ? 1 : 0)}d8`;
export const sneakDice = (rogueLevel: number) => `${Math.ceil(rogueLevel / 2)}d6`;

export async function attackExtras(ctx: CtxLike, map: SceneMap, attacker: Side, target: Side, strike: StrikeLike, melee: boolean, mods: AttackMods, figures: Figure[], sheet: CharacterSheet | null, smite?: number, sneakWanted = true): Promise<{ dice: Array<{ dice: string; label: string }>; flat: Array<{ value: number; label: string }>; after: (st: GameState) => void; smiteSlot?: number } | string> {
  const state = ctx.state!, sceneId = ctx.sceneId!;
  const me = actorOf(attacker), them = actorOf(target);
  const dice: Array<{ dice: string; label: string }> = [];
  const flat: Array<{ value: number; label: string }> = [];
  const steps: Array<(st: GameState) => void> = [];
  // marks put on the target by this attacker (Hunter's Mark, Hex)
  for (const e of effectsOf(state, sceneId, them)) if (e.mods.markDamage && e.source?.actor === me) dice.push({ dice: e.mods.markDamage, label: e.name });
  // Divine Favor and similar: extra dice on weapon hits
  if (strike.kind !== 'spell') for (const e of effectsOf(state, sceneId, me)) if (e.mods.weaponDamage) dice.push({ dice: e.mods.weaponDamage, label: e.name });
  // rage: bonus melee damage
  if (melee) for (const e of effectsOf(state, sceneId, me)) if (e.mods.meleeDamage) flat.push({ value: e.mods.meleeDamage, label: e.name });
  if (attacker.kind === 'pc' && sheet) {
    // Sneak Attack: once per turn, finesse or ranged weapon, advantage (and no disadvantage) or an ally next to the target
    const rogue = classLevel(sheet, 'rogue');
    const e = activeEncounter(state, sceneId);
    if (sneakWanted && rogue && hasFeature(sheet, /sneak attack/i) && (strike.finesse || strike.kind === 'ranged') && mods.mode !== 'dis' && !budgetOf(e, me).sneak) {
      const tf = figures.find((f) => (target.kind === 'pc' ? f.kind === 'pc' && f.id === target.tokenId : f.kind === 'npc' && f.id === target.id));
      const ally = tf && figures.some((f) => f.side === 'party' && !(f.kind === 'pc' && f.id === attacker.tokenId) && !f.down && distance(hexAt(map, f), hexAt(map, tf)) <= 1 && !incapacitated(state, sceneId, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id)));
      if (mods.mode === 'adv' || ally) {
        dice.push({ dice: sneakDice(rogue), label: 'Sneak Attack' });
        steps.push((st) => { const enc = activeEncounter(st, sceneId); if (enc) spend(st.sceneEncounters![sceneId], me, { sneak: true }); });
      }
    }
    // Divine Smite: a slot chosen with the attack, spent only on a hit
    if (smite) {
      if (!hasFeature(sheet, /divine smite/i)) return 'Divine Smite is not on the character sheet.';
      if (!melee) return 'Divine Smite needs a melee weapon attack.';
      const slot = spellSlots(sheet).find((x) => x.level === smite);
      if (!slot || slot.current < 1) return `No level-${smite} spell slot left for Divine Smite.`;
      const npc = target.kind === 'npc' ? enemiesOf(state, sceneId).find((x) => x.id === target.id) : undefined;
      const type = npc ? statBlock(state, npc.templateId)?.type ?? '' : '';
      dice.push({ dice: smiteDice(smite, /undead|fiend/i.test(type)), label: 'Divine Smite (radiant)' });
    }
  }
  return { dice, flat, after: (st) => steps.forEach((f) => f(st)), ...(smite ? { smiteSlot: smite } : {}) };
}
