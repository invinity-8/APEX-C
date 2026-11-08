/**
 * /api/apex?op=scene-turn – scene time and initiative (server-authorised, version-checked).
 *   endTurn          player (own active character) or GM
 *   startInitiative  GM: everyone assigned to the battle map rolls d20 + initiative (server dice)
 *   endInitiative    GM: free movement until initiative starts again
 *   clock            GM: region day/night, next day; battle lighting
 *   strike           attacker → target (character, enemy or ally); uses the Attack action or the bonus action
 *   standard         Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an object, other bonus action
 *   cast             cast a known spell with a chosen slot (spent on the server); attack spells roll vs AC
 *   reaction         take or skip an offered opportunity attack
 * All changes are compare-and-swap writes of the game state; scene movement re-checks the turn
 * inside the database transaction.
 */
import { combatAttacks, effectiveStats, targetAc } from '../game/effectiveStats.js';
import { itemRulesOf } from '../game/items/rules.js';
import { endInitiative, endTurn, initiativeBonus, joinInitiative, setClock, type InitiativeEntry } from '../game/sceneTurns.js';
import { orderParticipants } from '../game/sceneOperations.js';
import type { GameState } from '../game/types.js';
import type { AuthUser, Repo } from './repo.js';
import { sceneContext } from './sceneRuntime.js';
import { carriedLights, clockFor, hexKeyAt, sheetOf, visionFor, type SceneViewContext } from './sceneLocal.js';
import { spellSlots, STANDARD_ACTIONS, addOffers, attacksPerAction, budgetOf, characterLevel, dropOffer, firstOpportunity, isActiveActor, npcActor, ordinal, pcActor, planSpell, reactionUsed, reactionsOf, spellNumbers, spend, spendSlot, takeStandardAction, useEconomy, type Figure, type ReactionOffer, type StandardAction } from '../game/sceneActions.js';
import { statBlock, type AbilityKey } from '../game/bestiary.js';
import { CONDITIONS, type ConditionId, PHYSICAL, acBonus, addEffect, attackMods, conditionEffect, startConcentration, effectsOf, speedZero, concentrationDc, concentrationOf, endConcentration, incapacitated, removeEffect, resistsPhysical } from '../game/combatEffects.js';
import type { AttackOptions } from '../game/sceneCombat.js';
import { attackExtras } from './combatFeatures.js';
import { areaHexes, feetApart, parseArea, type AreaSpec } from '../campaign/hexArea.js';
import { abilityMods } from '../game/equipment.js';
import type { CharacterSheet } from '../game/sheet.js';
import { addEnemy, enemiesOf, npcAttacks, npcReach, logCombat, parseBonus, parseDamage, parseRangeFt, resolveAttack, setCarriedLight, updateEnemy } from '../game/sceneCombat.js';
import { activeEncounter } from '../game/sceneTurns.js';
import { hexAt, hexCentre, hexMovementCost, passable, tileLookup } from '../campaign/hexScene.js';
import { continuePcMove } from './sceneMotion.js';
import { lineOfSight } from '../campaign/hexVision.js';
import { distance } from '../game/hex.js';
import { applyDamage, applyHealing, classLevel, revert, transform } from '../game/abilities.js';
import { battleFeatures, inspirationDie, rageDamage, spendUse } from '../game/classFeatures.js';
import { findBeast } from '../game/beastCatalog.js';
import { spellCount, spellEffectOf, spellHealing } from '../game/spellEffects.js';
import type { SceneMap } from '../campaign/maps.js';
import { parseMap } from '../campaign/maps.js';
import type { SceneResult } from './scenes.js';

const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x);
const d20 = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 20) + 1;

type Mutation = (state: GameState) => { ok: true; state: GameState; message?: string } | { ok: false; error: string };

async function mutate(user: AuthUser, repo: Repo, fn: Mutation): Promise<SceneResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const stored = await repo.loadState(user.campaignId);
    if (!stored) return { status: 409, body: { error: 'The campaign has not been initialised yet.' } };
    const r = fn(stored.state);
    if (!r.ok) return { status: 409, body: { error: r.error } };
    if (r.state === stored.state) return { status: 200, body: { ok: true, message: r.message, version: stored.version } };
    const version = await repo.saveState(user.campaignId, r.state, stored.version, user.id);
    if (version !== null) return { status: 200, body: { ok: true, message: r.message, version } };
  }
  return { status: 409, body: { error: 'The scene changed at the same time. Please try again.' } };
}

/** Characters of the given players that are assigned to the scene, with server-rolled initiative. */
async function rollFor(user: AuthUser, repo: Repo, sceneId: string, userIds?: string[]): Promise<InitiativeEntry[]> {
  const [assignments, profiles, ctx] = await Promise.all([repo.sceneRuntime!.assignments(user.campaignId), repo.profiles(user.campaignId), sceneContext(repo, user.campaignId)]);
  const here = new Set(assignments.filter((a) => a.scene_id === sceneId).map((a) => a.user_id));
  const tokenIds = [...new Set(profiles.filter((p) => p.active && p.role === 'player' && here.has(p.userId) && (!userIds || userIds.includes(p.userId))).flatMap((p) => p.tokenIds))];
  const out: InitiativeEntry[] = [];
  for (const id of tokenIds) {
    const token = ctx.state?.tokens[id];
    if (!token) continue;
    const sheet = await sheetOf(ctx, id);
    out.push({ tokenId: id, name: token.name, roll: d20(), bonus: ctx.state ? effectiveStats(sheet, token, itemRulesOf(ctx.state)).initiative.value : initiativeBonus(sheet) });
  }
  return out;
}

/**
 * Stores what every player on the scene sees right now (arrival, or before light/time changes), so
 * the remembered map does not depend on having moved.
 */
export async function rememberCurrentVision(user: AuthUser, repo: Repo, sceneId: string): Promise<void> {
  if (!repo.sceneRuntime || !repo.sceneMotion) return;
  const scene = await repo.sceneRuntime.scene(user.campaignId, sceneId);
  const map = scene ? parseMap(scene.published_metadata) : null;
  if (!scene || !map?.hex) return;
  const [assignments, profiles, ctx] = await Promise.all([repo.sceneRuntime.assignments(user.campaignId), repo.profiles(user.campaignId), sceneContext(repo, user.campaignId)]);
  const clock = clockFor(ctx.state, sceneId);
  for (const a of assignments.filter((x) => x.scene_id === sceneId)) {
    const p = profiles.find((x) => x.userId === a.user_id && x.active && x.role === 'player');
    if (!p) continue;
    const tokenIds = p.tokenIds.filter((id) => ctx.state?.tokens[id]);
    const local = await repo.sceneMotion.localSnapshot(user.campaignId, sceneId, p.userId, tokenIds);
    const positions = tokenIds.map((id) => local.tokens.find((t) => t.tokenId === id) ?? (a.spawn_x !== null && a.spawn_y !== null ? { tokenId: id, x: a.spawn_x, y: a.spawn_y } : null)).filter((x): x is { tokenId: string; x: number; y: number } => !!x);
    const pcs = ctx.pcs ? await ctx.pcs(sceneId, map) : [];
    if (positions.length) await repo.sceneMotion.rememberVision(user.campaignId, sceneId, p.userId, [...(await visionFor(ctx, map, clock, positions.map((x) => pcs.find((q) => q.tokenId === x.tokenId) ?? x), ctx.state ? carriedLights(ctx.state, sceneId, pcs) : []))]);
  }
}

/**
 * Arrival area: characters without a stored position on the scene are placed on free hexes around the
 * spawn (≈ 4 × 4), never on walls or on top of each other. Reports when the area is full.
 */
export async function placeArrivals(user: AuthUser, repo: Repo, sceneId: string): Promise<string | undefined> {
  if (!repo.sceneRuntime || !repo.sceneMotion) return undefined;
  const scene = await repo.sceneRuntime.scene(user.campaignId, sceneId);
  const map = scene ? parseMap(scene.published_metadata) : null;
  if (!scene || !map?.hex) return undefined;
  const ctx = await sceneContext(repo, user.campaignId);
  const pcs = await ctx.pcs!(sceneId, map);
  const waiting = pcs.filter((p) => !p.stored);
  const spawn = map.nodes.find((n) => n.kind === 'spawn');
  let crowded = false;
  for (const p of waiting) {
    if (spawn && hexKeyAt(map, p) === hexKeyAt(map, spawn) && pcs.filter((q) => hexKeyAt(map, q) === hexKeyAt(map, p)).length > 1) crowded = true;
    const input = { action: 'place', sceneId, sceneRevision: scene.revision, tokenId: p.tokenId, tokenVersion: 0, assignmentRevision: 0, epoch: 0, x: p.x, y: p.y, requestId: crypto.randomUUID() };
    await repo.sceneMotion.localWrite(user, input, 0, 0, 'free', [], []);
  }
  return crowded ? 'The arrival area is full – some characters share the spawn hex. Place them by hand.' : undefined;
}

/** Called after a successful transfer to a battle map. Returns a short status line. */
export async function initiativeForArrivals(user: AuthUser, repo: Repo, sceneId: string, userIds: string[]): Promise<string | undefined> {
  const entries = await rollFor(user, repo, sceneId, userIds);
  if (!entries.length) return undefined;
  if (!userIds.length) return undefined;
  const encounterId = crypto.randomUUID();
  const r = await mutate(user, repo, (s) => joinInitiative(s, sceneId, encounterId, entries));
  return r.status === 200 ? ((r.body as { message?: string }).message ?? undefined) : undefined;
}

export async function sceneTurnRequest(user: AuthUser, method: string, body: unknown, repo: Repo): Promise<SceneResult> {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (!repo.sceneRuntime) return { status: 503, body: { error: 'Scenes are unavailable.' } };
  const v = body as Record<string, unknown> | null;
  if (!v || !uuid(v.sceneId) || typeof v.action !== 'string') return { status: 400, body: { error: 'Invalid scene action.' } };
  const scene = await repo.sceneRuntime.scene(user.campaignId, v.sceneId);
  if (!scene || scene.is_legacy_arena || scene.is_draft || scene.archived) return { status: 404, body: { error: 'Published scene not found.' } };
  const sceneId = scene.id;

  if (v.action === 'endTurn') {
    if (typeof v.encounterId !== 'string' || v.encounterId.length > 64 || !Number.isSafeInteger(v.turnSerial)) return { status: 400, body: { error: 'Invalid turn.' } };
    if (user.role !== 'gm') {
      const a = await repo.sceneRuntime.assignment(user.campaignId, user.id);
      if (a?.scene_id !== sceneId) return { status: 409, body: { error: 'You are not in this scene.' } };
    }
    const controls = (tokenId: string) => user.role === 'gm' || user.tokenIds.includes(tokenId);
    // the GM's "Next turn" ends the whole turn (block); ending one figure's turn ends only its part
    const only = typeof v.actor === 'string' ? v.actor : undefined;
    return mutate(user, repo, (s) => endTurn(s, sceneId, v.encounterId as string, v.turnSerial as number, controls, user.role === 'gm' && !only && v.force !== false, only));
  }
  if (v.action === 'torch') {
    // Players switch their own light on or off (no item check – the GM rules it by hand).
    if (typeof v.tokenId !== 'string' || typeof v.on !== 'boolean') return { status: 400, body: { error: 'Invalid light.' } };
    if (user.role !== 'gm' && !user.tokenIds.includes(v.tokenId)) return { status: 403, body: { error: 'This is not your character.' } };
    if (user.role !== 'gm' && (await repo.sceneRuntime.assignment(user.campaignId, user.id))?.scene_id !== sceneId) return { status: 409, body: { error: 'You are not in this scene.' } };
    await rememberCurrentVision(user, repo, sceneId).catch(() => undefined);
    return mutate(user, repo, (s) => setCarriedLight(s, sceneId, v.tokenId as string, v.on as boolean));
  }
  if (v.action === 'attack') return attackRequest(user, repo, scene, v);
  if (v.action === 'strike') {
    const attacker = sideOf(v.attacker), target = sideOf(v.target);
    if (!attacker || !target || (v.attackIndex !== undefined && !Number.isSafeInteger(v.attackIndex))) return { status: 400, body: { error: 'Invalid attack.' } };
    return strikeRequest(user, repo, scene, attacker, target, v.attackIndex as number | undefined, v.bonus === true, v.adv, Number.isSafeInteger(v.smite) ? (v.smite as number) : undefined);
  }
  if (v.action === 'standard') return standardRequest(user, repo, scene, v);
  if (v.action === 'cast') return castRequest(user, repo, scene, v);
  if (v.action === 'reaction') return reactionRequest(user, repo, scene, v);
  if (v.action === 'feature') return featureRequest(user, repo, scene, v);
  if (v.action === 'ready') {
    // Ready: uses the action now; the readied attack is released later with the reaction (until the next turn)
    const who = sideOf(v.actor);
    if (!who || !controls(user, who) || typeof v.trigger !== 'string') return { status: 400, body: { error: 'Invalid readied action.' } };
    const attackIndex = Number.isSafeInteger(v.attackIndex) ? (v.attackIndex as number) : 0;
    return mutate(user, repo, (s) => {
      const r = takeStandardAction(s, sceneId, actorOf(who), nameOf(s, sceneId, who), 'ready', false, user.role === 'gm');
      if (!r.ok) return r;
      const serial = r.state.sceneEncounters?.[sceneId]?.turnSerial ?? 0;
      r.state.sceneReadied = { ...(r.state.sceneReadied ?? {}), [sceneId]: { ...(r.state.sceneReadied?.[sceneId] ?? {}), [actorOf(who)]: { kind: 'attack', attackIndex, trigger: (v.trigger as string).trim().slice(0, 120) || 'when a creature comes into reach', readiedSerial: serial } } };
      const text = `${nameOf(s, sceneId, who)} readies an attack: “${(v.trigger as string).trim().slice(0, 120)}”.`;
      logCombat(r.state, sceneId, text);
      return { ok: true, state: r.state, message: text };
    });
  }
  if (v.action === 'release') {
    // the trigger happened: the readied attack uses the reaction
    const who = sideOf(v.actor), target = sideOf(v.target);
    if (!who || !target) return { status: 400, body: { error: 'Invalid release.' } };
    const stored = await repo.loadState(user.campaignId);
    const ready = stored?.state.sceneReadied?.[sceneId]?.[actorOf(who)];
    if (!ready) return { status: 409, body: { error: 'Nothing is readied.' } };
    return strikeRequest(user, repo, scene, who, target, ready.attackIndex, false, v.adv, undefined, true);
  }
  if (v.action === 'condition') {
    // GM: add/remove a condition; players may only stand up from prone (it costs movement – the GM rules it)
    const who = sideOf(v.target);
    const cond = CONDITIONS.find((c) => c === v.condition);
    if (!who || (!cond && typeof v.effectId !== 'string')) return { status: 400, body: { error: 'Invalid condition.' } };
    const actor = actorOf(who);
    if (user.role !== 'gm' && !(v.add === false && cond === 'prone' && controls(user, who))) return { status: 403, body: { error: 'Only the GM sets conditions.' } };
    return mutate(user, repo, (s) => {
      const st = structuredClone(s);
      const name = nameOf(st, sceneId, who);
      if (v.add === true && cond) { addEffect(st, sceneId, actor, conditionEffect(cond, undefined, () => `fx-${crypto.randomUUID().slice(0, 8)}`)); logCombat(st, sceneId, `${name} is ${cond}.`); return { ok: true, state: st, message: `${name}: ${cond}.` }; }
      const list = effectsOf(st, sceneId, actor).filter((e) => (typeof v.effectId === 'string' ? e.id === v.effectId : e.key === cond));
      if (!list.length) return { ok: false, error: 'Not on this creature.' };
      for (const e of list) removeEffect(st, sceneId, actor, e.id);
      logCombat(st, sceneId, `${name}: ${list.map((e) => e.name).join(', ')} ends.`);
      return { ok: true, state: st, message: `${list.map((e) => e.name).join(', ')} removed.` };
    });
  }
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can do that.' } };
  if (v.action === 'enemyAdd' || v.action === 'enemyMove') {
    const map = parseMap(scene.published_metadata);
    if (!map?.hex || typeof v.x !== 'number' || typeof v.y !== 'number') return { status: 400, body: { error: 'Choose a hex on a published hex map.' } };
    const h = hexAt(map, { x: v.x, y: v.y });
    if (!passable(map, h)) return { status: 422, body: { error: 'That hex cannot hold a figure.' } };
    const at = hexCentre(map, h);
    const ctx = await sceneContext(repo, user.campaignId);
    const pcs = await ctx.pcs!(sceneId, map);
    const key = hexKeyAt(map, at);
    if (pcs.some((p) => hexKeyAt(map, p) === key) || (ctx.state ? enemiesOf(ctx.state, sceneId) : []).some((e) => !e.defeated && e.id !== v.id && hexKeyAt(map, e) === key)) return { status: 409, body: { error: 'Another figure stands on that hex.' } };
    if (v.action === 'enemyAdd') {
      if (typeof v.templateId !== 'string' || !statBlock(ctx.state ?? {}, v.templateId)) return { status: 400, body: { error: 'Unknown enemy.' } };
      const id = `en-${crypto.randomUUID().slice(0, 8)}`, roll = d20();
      return mutate(user, repo, (s) => addEnemy(s, sceneId, id, v.templateId as string, at, typeof v.name === 'string' ? v.name : undefined, roll, v.side === 'ally' ? 'ally' : 'enemy'));
    }
    if (typeof v.id !== 'string') return { status: 400, body: { error: 'Invalid enemy.' } };
    return moveNpc(user, repo, scene, map, v.id, at);
  }
  if (v.action === 'enemyRemove' || v.action === 'enemyHp') {
    if (typeof v.id !== 'string' || (v.action === 'enemyHp' && (!Number.isSafeInteger(v.delta) || Math.abs(v.delta as number) > 1000))) return { status: 400, body: { error: 'Invalid enemy change.' } };
    return mutate(user, repo, (s) => {
      const r = updateEnemy(s, sceneId, v.id as string, v.action === 'enemyRemove' ? { remove: true } : { hpDelta: v.delta as number });
      if (r.ok && v.action === 'enemyHp') { const e = enemiesOf(r.state, sceneId).find((x) => x.id === v.id); if (e) logCombat(r.state, sceneId, `GM: ${e.name} ${(v.delta as number) < 0 ? `takes ${-(v.delta as number)} damage` : `heals ${v.delta}`} (${e.hp}/${e.maxHp}${e.defeated ? ', defeated' : ''}).`); }
      return r;
    });
  }
  if (v.action === 'enemyAttack') return enemyAttackRequest(user, repo, scene, v);
  if (v.action === 'npcArea') return npcAreaRequest(user, repo, scene, v);
  if (v.action === 'npcBuff') {
    // elite support ability: allies within the radius get the buff until the creature's next turn
    if (typeof v.id !== 'string' || !Number.isSafeInteger(v.buff)) return { status: 400, body: { error: 'Invalid ability.' } };
    const map = parseMap(scene.published_metadata);
    if (!map?.hex) return { status: 400, body: { error: 'Needs a battle map.' } };
    const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId };
    const npc = ctx.state ? enemiesOf(ctx.state, sceneId).find((e) => e.id === v.id && !e.defeated) : undefined;
    const buff = npc?.buffs?.[v.buff as number];
    if (!npc || !buff) return { status: 404, body: { error: 'Unknown ability.' } };
    if (buff.uses && (npc.areaUsed?.[buff.name] ?? 0) >= buff.uses) return { status: 409, body: { error: `${buff.name} is used up for this encounter.` } };
    const figures = await battleFigures(ctx, sceneId, map);
    const me = positionOf(figures, { kind: 'npc', id: npc.id })!;
    const allies = figures.filter((f) => !f.down && f.side === me.side && (buff.self || f !== me) && feetBetween(map)(f, me) <= buff.radiusFt);
    const actor = npcActor(npc.id);
    return mutate(user, repo, (s) => {
      const st = structuredClone(s);
      const e = st.sceneEncounters?.[sceneId];
      const err = useEconomy(e?.status === 'active' ? e : null, actor, buff.cost, { gm: true });
      if (err) return { ok: false, error: err };
      for (const f of allies) addEffect(st, sceneId, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id), { id: `fx-${crypto.randomUUID().slice(0, 8)}`, name: buff.name, key: `buff-${npc.id}`, mods: { ...(buff.toHit ? { toHit: buff.toHit } : {}), ...(buff.ac ? { ac: buff.ac } : {}), ...(buff.advantage ? { attack: 'adv' as const } : {}) }, untilStartOf: actor, source: { actor, name: npc.name } });
      const me2 = enemiesOf(st, sceneId).find((x) => x.id === npc.id);
      if (me2) me2.areaUsed = { ...(me2.areaUsed ?? {}), [buff.name]: (me2.areaUsed?.[buff.name] ?? 0) + 1 };
      if (e) e.version++;
      const text = `${npc.name}: ${buff.name} – ${allies.length ? allies.map((f) => f.name).join(', ') : 'no ally in range'}${buff.toHit ? ` +${buff.toHit} to hit` : ''}${buff.ac ? ` +${buff.ac} AC` : ''}${buff.advantage ? ' advantage on attacks' : ''} until its next turn.`;
      logCombat(st, sceneId, text);
      return { ok: true, state: st, message: text };
    });
  }
  if (v.action === 'startInitiative') {
    if (scene.category !== 'battle') return { status: 400, body: { error: 'Initiative runs on battle maps.' } };
    const entries = await rollFor(user, repo, sceneId);
    if (!entries.length) return { status: 409, body: { error: 'No characters are assigned to this battle map.' } };
    const encounterId = crypto.randomUUID();
    const enemyRolls = new Map<string, number>();
    return mutate(user, repo, (s) => {
      const r = joinInitiative(s, sceneId, encounterId, entries);
      if (!r.ok) return r;
      // Living enemies on the map roll as well.
      const st = r.state === s ? structuredClone(s) : r.state;
      const e = st.sceneEncounters?.[sceneId];
      if (e?.status === 'active') {
        for (const enemy of enemiesOf(st, sceneId).filter((x) => !x.defeated && !e.participants.some((p) => p.id === `npc-${x.id}`))) {
          if (!enemyRolls.has(enemy.id)) enemyRolls.set(enemy.id, d20());
          const activeId = e.participants[e.turnIndex]?.id;
          e.participants = orderParticipants([...e.participants, { id: `npc-${enemy.id}`, name: enemy.name, initiative: enemyRolls.get(enemy.id)! + enemy.init, bonus: enemy.init, visible: true }]);
          e.turnIndex = Math.max(0, e.participants.findIndex((p) => p.id === activeId));
        }
      }
      return { ok: true, state: st, message: r.message ?? 'Initiative rolled.' };
    });
  }
  if (v.action === 'endInitiative') return mutate(user, repo, (s) => endInitiative(s, sceneId));
  if (v.action === 'clock') {
    if (!Number.isSafeInteger(v.expectedVersion)) return { status: 400, body: { error: 'Invalid version.' } };
    const phase = v.phase === 'day' || v.phase === 'night' ? v.phase : undefined;
    const lighting = v.lighting === 'bright' || v.lighting === 'dim' || v.lighting === 'dark' ? v.lighting : undefined;
    if (!phase && !lighting && v.nextDay !== true) return { status: 400, body: { error: 'Nothing to change.' } };
    await rememberCurrentVision(user, repo, sceneId).catch(() => undefined);
    return mutate(user, repo, (s) => setClock(s, sceneId, v.expectedVersion as number, { phase, lighting, nextDay: v.nextDay === true }));
  }
  return { status: 400, body: { error: 'Invalid scene action.' } };
}

const die = (sides: number) => (crypto.getRandomValues(new Uint32Array(1))[0] % Math.max(1, sides)) + 1;
const inReach = (map: SceneMap, from: { x: number; y: number }, to: { x: number; y: number }, reachFt: number, rangeFt?: number) => {
  const d = distance(hexAt(map, from), hexAt(map, to)) * 5;
  const blocks = (k: string) => !!tileLookup(map)(k)?.blocksSight;
  return { ok: d <= (rangeFt ?? reachFt) && lineOfSight(hexAt(map, from), hexAt(map, to), blocks), distanceFt: d };
};

// ---------------------------------------------------------------- combat actions (APEX 1.1)

type Ctx = SceneViewContext & { sceneId?: string };
type Side = { kind: 'pc'; tokenId: string } | { kind: 'npc'; id: string };
const actorOf = (s: Side) => (s.kind === 'pc' ? pcActor(s.tokenId) : npcActor(s.id));
const sideOf = (x: unknown): Side | null => {
  const o = x as { kind?: unknown; tokenId?: unknown; id?: unknown } | null;
  if (o?.kind === 'pc' && typeof o.tokenId === 'string' && o.tokenId.length <= 64) return { kind: 'pc', tokenId: o.tokenId };
  if (o?.kind === 'npc' && typeof o.id === 'string' && o.id.length <= 64) return { kind: 'npc', id: o.id };
  return null;
};

/** Everybody on the battle map as rule figures (positions, side, melee reach). */
async function battleFigures(ctx: Ctx, sceneId: string, map: SceneMap): Promise<Figure[]> {
  const state = ctx.state!;
  const pcs = await ctx.pcs!(sceneId, map);
  const out: Figure[] = pcs.map((p) => ({ kind: 'pc', id: p.tokenId, name: state.tokens[p.tokenId]?.name ?? 'Character', side: 'party', x: p.x, y: p.y, reachFt: 5 }));
  for (const e of enemiesOf(state, sceneId)) out.push({ kind: 'npc', id: e.id, name: e.name, side: e.side === 'ally' ? 'party' : 'enemy', x: e.x, y: e.y, reachFt: npcReach(e), down: e.defeated });
  return out;
}
const feetBetween = (map: SceneMap) => (a: { x: number; y: number }, b: { x: number; y: number }) => distance(hexAt(map, a), hexAt(map, b)) * 5;

interface Strike { name: string; bonus: number; damage: { count: number; sides: number; mod: number }; reachFt: number; rangeFt?: number; label?: string; kind?: 'melee' | 'ranged' | 'spell'; damageType?: string; longRangeFt?: number; finesse?: boolean; /** the attack uses the inactive weapon set: switch to it */ switchSet?: boolean }

/** Attack numbers of an attacker: a character's attack (equipment + sheet) or an NPC's attack. */
async function strikeOf(ctx: Ctx, attacker: Side, attackIndex: number | undefined): Promise<Strike | string> {
  const state = ctx.state!;
  if (attacker.kind === 'npc') {
    const e = enemiesOf(state, ctx.sceneId!).find((x) => x.id === attacker.id && !x.defeated);
    if (!e) return 'That creature cannot attack.';
    const a = npcAttacks(e)[attackIndex ?? 0];
    if (!a) return 'Choose one of the creature’s attacks.';
    const dmg = parseDamage(a.damage);
    return dmg ? { name: a.name, bonus: a.bonus, damage: dmg, reachFt: a.reachFt, ...(a.kind !== 'melee' && a.rangeFt ? { rangeFt: a.rangeFt, ...(a.longRangeFt ? { longRangeFt: a.longRangeFt } : {}) } : {}), kind: a.kind, damageType: a.damageType } : 'Unreadable damage.';
  }
  const sheet = await sheetOf(ctx, attacker.tokenId);
  const attack = combatAttacks(sheet, state.tokens[attacker.tokenId], itemRulesOf(state))[attackIndex ?? 0];
  if (!attack) return 'Choose an attack from your character sheet.';
  const switchSet = !!(attack as { otherSet?: boolean }).otherSet;
  const bonus = parseBonus(attack.bonus), damage = parseDamage(attack.damage);
  if (bonus === null || !damage) return `“${attack.name}” has no readable attack bonus or damage (e.g. +5, 1d8+3). Resolve it by hand.`;
  const range = parseRangeFt(`${attack.range} ${attack.notes}`);
  return { name: attack.name, bonus, damage, reachFt: range.reachFt, rangeFt: range.rangeFt, ...(range.longRangeFt ? { longRangeFt: range.longRangeFt } : {}), kind: range.rangeFt ? 'ranged' : 'melee', damageType: /(bludgeoning|piercing|slashing|fire|cold|lightning|thunder|acid|poison|necrotic|radiant|force|psychic)/i.exec(attack.damage)?.[1]?.toLowerCase(), finesse: /finesse|dagger|rapier|shortsword|scimitar|whip/i.test(`${attack.name} ${attack.notes}`), ...(switchSet ? { switchSet: true } : {}) };
}

/**
 * Rolls an attack and applies the damage: characters lose hit points on their sheet, NPCs on the scene. Returns
 * the log text and a state mutation (the NPC hit points) to run inside the compare-and-swap write.
 */
/** Concentration check after damage (Constitution save, DC 10 or half the damage): text and whether it broke. */
async function concentrationCheck(ctx: Ctx, actor: string, damage: number): Promise<{ text: string; broken: boolean } | null> {
  const state = ctx.state!, sceneId = ctx.sceneId!;
  const c = concentrationOf(state, sceneId, actor);
  if (!c || damage <= 0) return null;
  let bonus = 0;
  if (actor.startsWith('pc-')) bonus = pcSaveBonus(await sheetOf(ctx, actor.slice(3)), 'con');
  else { const e = enemiesOf(state, sceneId).find((x) => `npc-${x.id}` === actor); bonus = e?.saves?.con ?? (e?.abilities ? Math.floor((e.abilities.con - 10) / 2) : 0); }
  const dc = concentrationDc(damage);
  const d = die(20);
  const broken = d + bonus < dc;
  return { text: ` Concentration (${c.spell}): Con save d20 ${d} ${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${d + bonus} vs DC ${dc} → ${broken ? 'lost' : 'kept'}.`, broken };
}

/** Damage to a character's sheet (temporary HP, Wild Shape and hit points). */
async function damagePc(user: AuthUser, repo: Repo, ctx: Ctx, tokenId: string, amount: number): Promise<string> {
  if (amount <= 0) return '';
  const row = await repo.loadSheet(user.campaignId, tokenId);
  const sheet = await sheetOf(ctx, tokenId);
  if (!sheet.hitPoints) return ' (no hit points on the sheet – apply by hand)';
  const hurt = applyDamage(sheet, amount);
  if (!hurt.ok) return ' (apply by hand)';
  const saved = await repo.saveSheet(user.campaignId, tokenId, hurt.sheet, row?.version ?? 0, user.id);
  return saved === null ? ' (the sheet changed meanwhile – apply the damage by hand)' : ` (${hurt.sheet.wildShape ? `${hurt.sheet.wildShape.formName} ${hurt.sheet.wildShape.hp}/${hurt.sheet.wildShape.maxHp}, ` : ''}${hurt.sheet.hitPoints?.current}/${hurt.sheet.hitPoints?.max} HP)`;
}

/** Can a character cast Shield right now (prepared, a slot left, reaction free, not incapacitated)? */
function shieldReady(state: GameState, sceneId: string, sheet: CharacterSheet, tokenId: string): boolean {
  const known = sheet.spells.some((x) => x.name.trim().toLowerCase() === 'shield' && x.prepared);
  const slot = spellSlots(sheet).some((x) => x.current > 0);
  const e = activeEncounter(state, sceneId);
  return known && slot && !reactionUsed(e, pcActor(tokenId)) && !incapacitated(state, sceneId, pcActor(tokenId));
}

/**
 * Rolls an attack and applies the damage: characters lose hit points on their sheet, NPCs on the scene. Effects
 * (advantage, Bless, Shield AC, resistance, extra dice) come in `o`; concentration of a damaged creature is checked.
 * A character that can still cast Shield gets a reaction prompt first – the damage waits for the decision.
 */
async function rollAgainst(user: AuthUser, repo: Repo, ctx: Ctx, attackerName: string, strike: Strike, target: Side, extraText = '', o: AttackOptions & { attacker?: Side; quiet?: boolean } = {}): Promise<{ text: string; apply: (s: GameState) => GameState; hit?: boolean } | string> {
  const state = ctx.state!;
  const sceneId = ctx.sceneId!;
  const targetActor = actorOf(target);
  const fxAc = acBonus(state, sceneId, targetActor);
  const physical = PHYSICAL.test(strike.damageType ?? strike.name) || (!strike.damageType && strike.kind !== 'spell');
  const halve = resistsPhysical(state, sceneId, targetActor) && physical ? 'resistance' : undefined;
  if (target.kind === 'npc') {
    const e = enemiesOf(state, sceneId).find((x) => x.id === target.id && !x.defeated);
    if (!e) return 'Target not found.';
    const roll = resolveAttack(attackerName, e.name, strike.name, strike.bonus, strike.damage, e.ac + fxAc, die, { ...o, halve });
    const conc = roll.hit ? await concentrationCheck(ctx, targetActor, roll.damage) : null;
    const text = roll.text + extraText + (conc?.text ?? '');
    return {
      text,
      hit: roll.hit,
      apply: (s) => {
        const r = roll.hit ? updateEnemy(s, sceneId, e.id, { hpDelta: -roll.damage }) : { ok: true as const, state: structuredClone(s) };
        const st = r.ok ? r.state : structuredClone(s);
        const after = enemiesOf(st, sceneId).find((x) => x.id === e.id);
        if (conc?.broken || after?.defeated) endConcentration(st, sceneId, targetActor);
        if (!o.quiet) logCombat(st, sceneId, text + (after?.defeated ? ` ${e.name} is defeated.` : ''));
        return st;
      },
    };
  }
  const token = state.tokens[target.tokenId];
  if (!token) return 'Target not found.';
  const sheet = await sheetOf(ctx, target.tokenId);
  const ac = targetAc(sheet, token, itemRulesOf(state)) + fxAc;
  const roll = resolveAttack(attackerName, token.name, strike.name, strike.bonus, strike.damage, ac, die, { ...o, halve });
  // Shield: the hit would miss against AC + 5 – the character decides first
  if (roll.hit && roll.d20 !== 20 && roll.total < ac + 5 && shieldReady(state, sceneId, sheet, target.tokenId)) {
    const hitId = `hit-${crypto.randomUUID().slice(0, 8)}`;
    const text = `${roll.text}${extraText} – ${token.name} may cast Shield (reaction).`;
    return {
      text,
      hit: true,
      apply: (s) => {
        const st = structuredClone(s);
        const e = activeEncounter(st, sceneId);
        const serial = e?.turnSerial ?? 0;
        st.scenePendingHits = { ...(st.scenePendingHits ?? {}), [sceneId]: [...(st.scenePendingHits?.[sceneId] ?? []).filter((h) => h.turnSerial === serial), { id: hitId, attacker: { kind: o.attacker?.kind ?? 'npc', id: o.attacker ? (o.attacker.kind === 'pc' ? o.attacker.tokenId : o.attacker.id) : '', name: attackerName }, target: { kind: 'pc', id: target.tokenId, name: token.name }, total: roll.total, ac, crit: roll.crit, natural20: roll.d20 === 20, damage: roll.damage, text: roll.text + extraText, turnSerial: serial }] };
        addOffers(st, sceneId, [{ id: `ro-${crypto.randomUUID().slice(0, 8)}`, kind: 'shield', hitId, reactor: { kind: 'pc', id: target.tokenId, name: token.name }, target: { kind: o.attacker?.kind ?? 'npc', id: o.attacker ? (o.attacker.kind === 'pc' ? o.attacker.tokenId : o.attacker.id) : '', name: attackerName }, turnSerial: serial, at: new Date().toISOString(), from: { x: 0, y: 0 } }]);
        if (!o.quiet) logCombat(st, sceneId, text);
        return st;
      },
    };
  }
  const hp = roll.hit ? await damagePc(user, repo, ctx, target.tokenId, roll.damage) : '';
  const conc = roll.hit ? await concentrationCheck(ctx, targetActor, roll.damage) : null;
  const text = roll.text + hp + extraText + (conc?.text ?? '');
  return { text, hit: roll.hit, apply: (s) => { const st = structuredClone(s); if (conc?.broken) endConcentration(st, sceneId, targetActor); if (!o.quiet) logCombat(st, sceneId, text); return st; } };
}

const positionOf = (figures: Figure[], s: Side) => figures.find((f) => (s.kind === 'pc' ? f.kind === 'pc' && f.id === s.tokenId : f.kind === 'npc' && f.id === s.id));
const nameOf = (state: GameState, sceneId: string, s: Side) => (s.kind === 'pc' ? state.tokens[s.tokenId]?.name : enemiesOf(state, sceneId).find((e) => e.id === s.id)?.name) ?? 'Creature';

/** Who may command an attacker: the GM always, a player only their own character. */
const controls = (user: AuthUser, s: Side) => user.role === 'gm' || (s.kind === 'pc' && user.tokenIds.includes(s.tokenId));

async function playerInScene(user: AuthUser, repo: Repo, sceneId: string) {
  return user.role === 'gm' || (await repo.sceneRuntime!.assignment(user.campaignId, user.id))?.scene_id === sceneId;
}

/**
 * An attack on the battle map: a character (player on its turn, or the GM) or an NPC (GM) attacks a target.
 * Uses the Attack action (Extra Attack allows several) or, with `bonus`, the bonus action.
 */
async function strikeRequest(user: AuthUser, repo: Repo, scene: Scene, attacker: Side, target: Side, attackIndex: number | undefined, viaBonus: boolean, adv?: unknown, smite?: number, asReaction = false): Promise<SceneResult> {
  const econ = asReaction ? 'reaction' : viaBonus ? 'bonus' : 'attack';
  const map = parseMap(scene.published_metadata);
  if (!map?.hex || scene.category !== 'battle') return { status: 400, body: { error: 'Attacks happen on battle maps.' } };
  if (!controls(user, attacker)) return { status: 403, body: { error: 'This is not your character.' } };
  if (!(await playerInScene(user, repo, scene.id))) return { status: 409, body: { error: 'You are not in this scene.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state) return { status: 409, body: { error: 'Campaign unavailable.' } };
  if (attacker.kind === 'pc' && target.kind === 'pc') return { status: 422, body: { error: 'Characters do not attack each other here – the GM resolves that by hand.' } };
  const sheet = attacker.kind === 'pc' ? await sheetOf(ctx, attacker.tokenId) : null;
  const allowed = attacker.kind === 'npc' ? (enemiesOf(ctx.state, scene.id).find((x) => x.id === attacker.id)?.multiattack ?? 1) : attacksPerAction(sheet);
  // pre-check the economy before rolling (the write re-checks it)
  const pre = useEconomy(activeEncounter(structuredClone(ctx.state), scene.id), actorOf(attacker), econ, { gm: user.role === 'gm', attacksAllowed: allowed });
  if (pre) return { status: 409, body: { error: pre } };
  const strike = await strikeOf(ctx, attacker, attackIndex);
  if (typeof strike === 'string') return { status: 422, body: { error: strike } };
  const figures = await battleFigures(ctx, scene.id, map);
  const from = positionOf(figures, attacker), to = positionOf(figures, target);
  if (!from || !to || to.down) return { status: 404, body: { error: 'Target or attacker not on the map.' } };
  const reach = inReach(map, from, to, strike.reachFt, strike.longRangeFt ?? strike.rangeFt);
  if (!reach.ok) return { status: 422, body: { error: `${to.name} is out of reach or not in line of sight (${reach.distanceFt} ft, ${strike.name}: ${strike.longRangeFt ?? strike.rangeFt ?? strike.reachFt} ft).` } };
  if (incapacitated(ctx.state, scene.id, actorOf(attacker))) return { status: 409, body: { error: `${from.name} is incapacitated.` } };
  const melee = strike.kind ? strike.kind === 'melee' : !strike.rangeFt;
  const mods = attackMods(ctx.state, scene.id, {
    attacker: actorOf(attacker), target: actorOf(target), melee, distanceFt: reach.distanceFt,
    longRange: !!strike.rangeFt && reach.distanceFt > strike.rangeFt,
    hostileAdjacent: figures.some((f) => !f.down && f.side !== from.side && feetBetween(map)(f, from) <= 5 && !incapacitated(ctx.state!, scene.id, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id))),
    manual: adv === 'adv' || adv === 'dis' ? adv : undefined,
  });
  const extras = await attackExtras(ctx, map, attacker, target, strike, melee, mods, figures, sheet, smite);
  if (typeof extras === 'string') return { status: 422, body: { error: extras } };
  const r = await rollAgainst(user, repo, ctx, from.name, strike, target, viaBonus ? ' (bonus action)' : '', { mode: mods.mode, reasons: mods.reasons, toHitDice: mods.toHitDice, toHitFlat: mods.toHit, autoCrit: mods.autoCrit, extraDice: extras.dice, extraFlat: extras.flat, attacker });
  if (typeof r === 'string') return { status: 404, body: { error: r } };
  // Divine Smite: the slot is spent only when the attack hits
  if (extras.smiteSlot && r.hit && attacker.kind === 'pc' && sheet) {
    const row = await repo.loadSheet(user.campaignId, attacker.tokenId);
    await repo.saveSheet(user.campaignId, attacker.tokenId, spendSlot(sheet, extras.smiteSlot), row?.version ?? 0, user.id);
  }
  return mutate(user, repo, (s) => {
    const st = r.apply(s);
    const err = useEconomy(st.sceneEncounters?.[scene.id]?.status === 'active' ? st.sceneEncounters[scene.id] : null, actorOf(attacker), econ, { gm: user.role === 'gm', attacksAllowed: allowed });
    if (asReaction && st.sceneReadied?.[scene.id]?.[actorOf(attacker)]) { const r = { ...st.sceneReadied[scene.id] }; delete r[actorOf(attacker)]; st.sceneReadied = { ...st.sceneReadied, [scene.id]: r }; }
    if (err) return { ok: false, error: err };
    for (const id of mods.onceUsed) removeEffect(st, scene.id, actorOf(attacker), id);
    extras.after(st);
    // drawing the other weapon set is part of the attack (free object interaction)
    if (strike.switchSet && attacker.kind === 'pc') {
      const t = st.tokens[attacker.tokenId];
      if (t?.equipment) { t.equipment = { ...t.equipment, activeSet: t.equipment.activeSet === 1 ? 2 : 1 }; logCombat(st, scene.id, `${t.name} switches to weapon set ${t.equipment.activeSet === 1 ? 'I' : 'II'}.`); }
    }
    if (st.sceneEncounters?.[scene.id]) st.sceneEncounters[scene.id].version++;
    return { ok: true, state: st, message: r.text };
  });
}

type Scene = NonNullable<Awaited<ReturnType<NonNullable<Repo['sceneRuntime']>['scene']>>>;

/** Old request shape: a character attacks an enemy. */
async function attackRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.tokenId !== 'string' || typeof v.enemyId !== 'string' || !Number.isSafeInteger(v.attackIndex)) return { status: 400, body: { error: 'Invalid attack.' } };
  return strikeRequest(user, repo, scene, { kind: 'pc', tokenId: v.tokenId }, { kind: 'npc', id: v.enemyId }, v.attackIndex as number, v.bonus === true);
}

/** Old request shape: the GM lets an enemy attack a character. */
async function enemyAttackRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.id !== 'string' || typeof v.tokenId !== 'string') return { status: 400, body: { error: 'Invalid attack.' } };
  return strikeRequest(user, repo, scene, { kind: 'npc', id: v.id }, { kind: 'pc', tokenId: v.tokenId }, undefined, false);
}

/** Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an object – or a generic bonus action. */
async function standardRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  const actor = sideOf(v.actor);
  if (!actor) return { status: 400, body: { error: 'Invalid actor.' } };
  if (!controls(user, actor)) return { status: 403, body: { error: 'This is not your character.' } };
  if (!(await playerInScene(user, repo, scene.id))) return { status: 409, body: { error: 'You are not in this scene.' } };
  const viaBonus = v.viaBonus === true;
  if (v.act === 'bonusOther') {
    const note = typeof v.note === 'string' ? v.note.trim().slice(0, 80) : '';
    return mutate(user, repo, (s) => {
      const st = structuredClone(s);
      const e = activeEncounter(st, scene.id);
      if (!e) return { ok: false, error: 'Actions are tracked while initiative runs.' };
      const err = useEconomy(st.sceneEncounters![scene.id], actorOf(actor), 'bonus', { gm: user.role === 'gm' });
      if (err) return { ok: false, error: err };
      st.sceneEncounters![scene.id].version++;
      const text = `${nameOf(st, scene.id, actor)} uses the bonus action${note ? `: ${note}` : ''}.`;
      logCombat(st, scene.id, text);
      return { ok: true, state: st, message: text };
    });
  }
  if (!STANDARD_ACTIONS.some((a) => a.id === v.act)) return { status: 400, body: { error: 'Unknown action.' } };
  return mutate(user, repo, (s) => {
    const r = takeStandardAction(s, scene.id, actorOf(actor), nameOf(s, scene.id, actor), v.act as StandardAction, viaBonus, user.role === 'gm');
    if (r.ok && r.message) logCombat(r.state, scene.id, r.message);
    return r;
  });
}

const CONCENTRATION_SPELLS = new Set(['bless', 'bane', 'shield of faith', "hunter's mark", 'hex', 'hold person', 'hold monster', 'faerie fire', 'web', 'entangle', 'invisibility', 'blur', 'tasha’s hideous laughter']);

/** Saving throw bonus of any creature on the scene. */
async function saveOf(ctx: Ctx, who: Side, ability: AbilityKey): Promise<number> {
  if (who.kind === 'pc') return pcSaveBonus(await sheetOf(ctx, who.tokenId), ability);
  const e = enemiesOf(ctx.state!, ctx.sceneId!).find((x) => x.id === who.id);
  return e?.saves?.[ability] ?? (e?.abilities ? Math.floor((e.abilities[ability] - 10) / 2) : 0);
}

/**
 * Cast a spell: a known (prepared or cantrip) spell with a slot of its level or higher (spent on the server).
 * Attack spells roll vs AC (one roll per ray/beam), Magic Missile hits automatically, saving-throw spells roll for
 * every target, areas hit everyone inside, healing heals, buffs/conditions/marks become effects – concentration
 * spells start concentration (ending the previous one).
 */
async function castRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.tokenId !== 'string' || typeof v.spellId !== 'string' || !Number.isSafeInteger(v.slotLevel)) return { status: 400, body: { error: 'Invalid spell.' } };
  const caster: Side = { kind: 'pc', tokenId: v.tokenId };
  const casterActor = actorOf(caster);
  if (!controls(user, caster)) return { status: 403, body: { error: 'This is not your character.' } };
  if (!(await playerInScene(user, repo, scene.id))) return { status: 409, body: { error: 'You are not in this scene.' } };
  const map = parseMap(scene.published_metadata);
  if (!map?.hex) return { status: 400, body: { error: 'Spells are cast on hex maps.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state?.tokens[v.tokenId]) return { status: 404, body: { error: 'Character unavailable.' } };
  if (incapacitated(ctx.state, scene.id, casterActor)) return { status: 409, body: { error: 'Incapacitated creatures cannot cast spells.' } };
  const row = await repo.loadSheet(user.campaignId, v.tokenId);
  const sheet = await sheetOf(ctx, v.tokenId);
  if (sheet.wildShape) return { status: 409, body: { error: `No spellcasting in Wild Shape (${sheet.wildShape.formName}).` } };
  const lvl = characterLevel(sheet);
  const plan = planSpell(sheet, v.spellId, v.slotLevel as number, lvl);
  if ('error' in plan) return { status: 422, body: { error: plan.error } };
  const def = spellEffectOf(plan.spell);
  const figures = await battleFigures(ctx, scene.id, map);
  const me = positionOf(figures, caster);
  // targets: `targets` (several, repeats allowed for rays), or `target`
  const rawTargets = Array.isArray(v.targets) ? (v.targets as unknown[]).slice(0, 12) : v.target ? [v.target] : [];
  const targets: Side[] = [];
  for (const t of rawTargets) { const sd = sideOf(t); if (!sd) return { status: 400, body: { error: 'Invalid target.' } }; targets.push(sd); }
  const count = def ? spellCount(def, plan.spell.level, plan.slotLevel || plan.spell.level, lvl) : 1;
  if (def && targets.length > count) return { status: 422, body: { error: `${plan.spell.name} affects at most ${count} target${count > 1 ? 's' : ''} at this level.` } };
  const there = targets.map((t) => positionOf(figures, t));
  if (there.some((f) => !f || f.down)) return { status: 404, body: { error: 'Target not on the map.' } };
  const aim = v.point as { x?: unknown; y?: unknown } | undefined;
  const point = aim && typeof aim.x === 'number' && typeof aim.y === 'number' ? { x: aim.x, y: aim.y } : null;
  if (me && point && plan.rangeFt !== null && !/^self/i.test(plan.spell.range.trim()) && feetApart(map, me, point) > plan.rangeFt) return { status: 422, body: { error: `That point is out of range (${plan.spell.name}: ${plan.rangeFt} ft).` } };
  if (me && plan.rangeFt !== null) for (const f of there) {
    const reach = inReach(map, me, f!, Math.max(5, plan.rangeFt));
    if (!reach.ok) return { status: 422, body: { error: `${f!.name} is out of range or not in line of sight (${reach.distanceFt} ft, ${plan.spell.name}: ${plan.rangeFt} ft).` } };
  }
  const kind = plan.reaction ? 'reaction' : plan.bonusAction ? 'bonus' : 'action';
  const pre = useEconomy(activeEncounter(structuredClone(ctx.state), scene.id), casterActor, kind, { gm: user.role === 'gm' });
  if (pre) return { status: 409, body: { error: pre } };
  // the slot is spent first – a failed sheet write (changed elsewhere) stops the cast
  if (plan.slotLevel) {
    const saved = await repo.saveSheet(user.campaignId, v.tokenId, spendSlot(sheet, plan.slotLevel), row?.version ?? 0, user.id);
    if (saved === null) return { status: 409, body: { error: 'The character sheet changed meanwhile – try again.' } };
  }
  const eff = effectiveStats(sheet, ctx.state.tokens[v.tokenId], itemRulesOf(ctx.state));
  const nums = spellNumbers(sheet);
  const bonus = (nums.attack ?? 0) + eff.derived.bonuses.spellAttack.value;
  const dc = nums.dc !== null ? nums.dc + eff.derived.bonuses.spellDc.value : null;
  const casterName = ctx.state.tokens[v.tokenId].name;
  const slotText = plan.slotLevel ? ` (${ordinal(plan.slotLevel)}-level slot${plan.slotLevel > plan.spell.level ? ', upcast' : ''})` : ' (cantrip)';
  const conc = plan.spell.concentration || CONCENTRATION_SPELLS.has(plan.spell.name.trim().toLowerCase());
  const lines: string[] = [`${casterName} casts ${plan.spell.name}${slotText}${conc ? ' – concentration' : ''}.`];
  const steps: Array<(st: GameState) => GameState> = [];
  const dmg = plan.damage ? parseDamage(plan.damage) : null;
  const area = parseArea(`${plan.spell.range} ${plan.spell.description}`);
  const heal = spellHealing(plan.spell, plan.slotLevel || plan.spell.level);
  const source = { actor: casterActor, name: casterName, spell: plan.spell.name, concentration: conc };
  const makeEffect = (d: NonNullable<NonNullable<typeof def>['effect']>) => (d.condition ? { ...conditionEffect(d.condition, source, () => `fx-${crypto.randomUUID().slice(0, 8)}`), name: d.name } : { id: `fx-${crypto.randomUUID().slice(0, 8)}`, name: d.name, key: d.key, mods: { ...(d.mods ?? {}) }, source, ...(d.untilStartOfCaster ? { untilStartOf: casterActor } : {}), ...(d.turns ? { turns: d.turns } : {}) });
  /** Effect with an optional saving throw for one creature. */
  const affect = async (who: Side, name: string) => {
    if (!def?.effect) return;
    if (def.save && dc !== null) {
      const b = await saveOf(ctx, who, def.save), d = die(20);
      const ok = d + b >= dc;
      lines.push(`${name}: ${def.save.toUpperCase()} save d20 ${d} ${b >= 0 ? '+' : '−'} ${Math.abs(b)} = ${d + b} vs DC ${dc} → ${ok ? 'resists' : `${def.effect.name}`}.`);
      if (ok) return;
    } else lines.push(`${name}: ${def.effect.name}.`);
    const fx = makeEffect(def.effect);
    steps.push((st) => { addEffect(st, scene.id, actorOf(who), fx); return st; });
  };

  if (def?.projectiles) {
    // several rays / darts / beams – each is its own attack (or hits automatically)
    if (!targets.length) return { status: 422, body: { error: `Choose up to ${count} target${count > 1 ? 's' : ''} for the ${def.projectiles.label}s.` } };
    const list = targets.length === count ? targets : Array.from({ length: count }, (_, i) => targets[i % targets.length]);
    const pd = parseDamage(def.projectiles.damage)!;
    for (const [i, t] of list.entries()) {
      const tname = positionOf(figures, t)!.name;
      if (def.projectiles.autoHit) {
        const r = rollDice(pd);
        const dmgText = t.kind === 'pc' ? await damagePc(user, repo, ctx, t.tokenId, r.total) : '';
        const c = await concentrationCheck(ctx, actorOf(t), r.total);
        lines.push(`${def.projectiles.label} ${i + 1} → ${tname}: ${r.total} damage${dmgText}.${c?.text ?? ''}`);
        if (t.kind === 'npc') steps.push((st) => { const u = updateEnemy(st, scene.id, t.id, { hpDelta: -r.total }); return u.ok ? u.state : st; });
        if (c?.broken) steps.push((st) => { endConcentration(st, scene.id, actorOf(t)); return st; });
      } else {
        const tf = positionOf(figures, t)!;
        const mods = attackMods(ctx.state, scene.id, { attacker: casterActor, target: actorOf(t), melee: false, distanceFt: me ? feetBetween(map)(me, tf) : 30, manual: v.adv === 'adv' || v.adv === 'dis' ? v.adv : undefined });
        const r = await rollAgainst(user, repo, ctx, casterName, { name: `${plan.spell.name} (${def.projectiles.label} ${i + 1})`, bonus, damage: pd, reachFt: 5, kind: 'spell', damageType: /[a-z]+$/.exec(plan.damage ?? '')?.[0] }, t, '', { mode: mods.mode, reasons: mods.reasons, toHitDice: mods.toHitDice, attacker: caster, quiet: true });
        if (typeof r === 'string') return { status: 404, body: { error: r } };
        lines.push(r.text);
        steps.push((st) => r.apply(st));
      }
    }
  } else if (heal) {
    const who = targets.length ? targets : [caster];
    const mod = (nums.attack ?? 0) - (Number(/[+-]?\d+/.exec(sheet.combat.find((c) => /proficiency/i.test(c.label))?.value ?? '')?.[0]) || 2);
    for (const t of who.slice(0, count)) {
      const r = rollDice(parseDamage(heal.dice)!);
      const amount = Math.max(1, r.total + (heal.addMod ? mod : 0));
      const tname = positionOf(figures, t)?.name ?? casterName;
      if (t.kind === 'pc') {
        const trow = await repo.loadSheet(user.campaignId, t.tokenId);
        const ts = await sheetOf(ctx, t.tokenId);
        const healed = ts.hitPoints ? applyHealing(ts, amount) : null;
        if (healed?.ok) await repo.saveSheet(user.campaignId, t.tokenId, healed.sheet, trow?.version ?? 0, user.id);
        lines.push(`${tname} regains ${amount} hit points${healed?.ok ? ` (${healed.sheet.hitPoints?.current}/${healed.sheet.hitPoints?.max} HP)` : ''}.`);
      } else {
        lines.push(`${tname} regains ${amount} hit points.`);
        steps.push((st) => { const u = updateEnemy(st, scene.id, t.id, { hpDelta: amount }); return u.ok ? u.state : st; });
      }
    }
  } else if (def?.effect && def.targeting === 'self') {
    await affect(caster, casterName);
  } else if (def?.effect && def.targeting === 'point' && area && point && me) {
    const keys = new Set(areaHexes(map, me, point, area));
    const inside = figures.filter((f) => !f.down && keys.has(hexKeyAt(map, f)));
    lines.push(`${area.sizeFt}-ft ${area.shape}: ${inside.length ? inside.map((f) => f.name).join(', ') : 'nobody inside'}.`);
    for (const f of inside) await affect(f.kind === 'pc' ? { kind: 'pc', tokenId: f.id } : { kind: 'npc', id: f.id }, f.name);
  } else if (def?.effect && (def.targeting === 'ally' || def.targeting === 'enemy')) {
    if (!targets.length) return { status: 422, body: { error: `Choose ${count > 1 ? `up to ${count} targets` : 'a target'} for ${plan.spell.name}.` } };
    for (const t of targets) await affect(t, positionOf(figures, t)!.name);
  } else if (area && plan.mode === 'save' && point && me && dc !== null) {
    // area damage spell aimed at a point: every creature in the area saves, damage is applied
    const r = await resolveArea(user, repo, ctx, map, me, point, { name: `${plan.spell.name}${slotText}`, area, save: (plan.save?.slice(0, 3) ?? 'dex') as AbilityKey, dc, damage: plan.damage ?? '0', damageType: /[a-z]+$/.exec(plan.damage ?? '')?.[0] ?? '', source: casterName });
    lines.splice(0, lines.length, ...r.lines);
    steps.push((st) => r.apply(st, true));
  } else if (plan.mode === 'attack' && targets[0] && nums.attack !== null && dmg) {
    const tf = positionOf(figures, targets[0])!;
    const mods = attackMods(ctx.state, scene.id, { attacker: casterActor, target: actorOf(targets[0]), melee: /melee spell attack/i.test(plan.spell.description), distanceFt: me ? feetBetween(map)(me, tf) : 30, hostileAdjacent: !!me && figures.some((f) => !f.down && f.side !== 'party' && feetBetween(map)(f, me) <= 5), manual: v.adv === 'adv' || v.adv === 'dis' ? v.adv : undefined });
    const r = await rollAgainst(user, repo, ctx, casterName, { name: plan.spell.name, bonus, damage: dmg, reachFt: 5, kind: 'spell', damageType: /[a-z]+$/.exec(plan.damage ?? '')?.[0] }, targets[0], slotText, { mode: mods.mode, reasons: mods.reasons, toHitDice: mods.toHitDice, attacker: caster, quiet: true });
    if (typeof r === 'string') return { status: 404, body: { error: r } };
    lines.splice(0, lines.length, r.text);
    steps.push((st) => r.apply(st));
  } else {
    if (plan.mode === 'attack' && nums.attack === null) lines.push('No spell attack bonus on the sheet – roll by hand.');
    if (plan.mode === 'save') {
      const rolled = dmg ? rollDice(dmg) : null;
      lines.push(`${plan.save ? `${plan.save[0].toUpperCase()}${plan.save.slice(1)}` : ''} save${dc !== null ? ` DC ${dc}` : ''}${there[0] ? ` for ${there[0].name}` : ''}${rolled ? `: ${rolled.total} damage on a failed save, half (${Math.floor(rolled.total / 2)}) on a success – the GM applies it.` : ' – the GM resolves the effect.'}`);
    } else if (there[0]) lines.push(`Target: ${there[0].name}.`);
  }
  const text = lines.join(' ');
  return mutate(user, repo, (s) => {
    let st = structuredClone(s);
    const e = st.sceneEncounters?.[scene.id];
    const err = useEconomy(e?.status === 'active' ? e : null, casterActor, kind, { gm: user.role === 'gm' });
    if (err) return { ok: false, error: err };
    if (conc) { const old = startConcentration(st, scene.id, casterActor, plan.spell.name); if (old) lines.push(`(${old} ends.)`); }
    for (const step of steps) st = step(st);
    const enc = st.sceneEncounters?.[scene.id];
    if (enc?.status === 'active') { spend(enc, casterActor, { last: 'spell' }); enc.version++; }
    logCombat(st, scene.id, lines.join(' '));
    return { ok: true, state: st, message: text };
  });
}

function rollDice(d: { count: number; sides: number; mod: number }) {
  const rolls = Array.from({ length: d.count }, () => die(d.sides));
  return { rolls, total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + d.mod) };
}

/**
 * Path check for opportunity attacks (battle map, initiative): where the move must stop because a hostile may
 * react. `points` = start followed by every entered hex. Returns null when the move can run to the end.
 */
export async function planInterruption(repo: Repo, campaignId: string, sceneId: string, map: SceneMap, mover: Side, points: Array<{ x: number; y: number }>, declined: string[] = []): Promise<{ stop: number; reactors: Figure[] } | null> {
  const ctx = { ...(await sceneContext(repo, campaignId)), sceneId };
  if (!ctx.state || !activeEncounter(ctx.state, sceneId)) return null;
  const figures = await battleFigures(ctx, sceneId, map);
  const me = positionOf(figures, mover);
  if (!me) return null;
  return firstOpportunity({ ...me, ...points[0] }, points, figures.filter((f) => f !== me), feetBetween(map), activeEncounter(ctx.state, sceneId), declined);
}

/** Stores the offers and the paused move (state write). */
export function registerInterruption(state: GameState, sceneId: string, mover: Side, moverName: string, stopAt: { x: number; y: number }, to: { x: number; y: number }, reactors: Figure[], declined: string[]): GameState {
  const st = structuredClone(state);
  const e = activeEncounter(st, sceneId);
  const moveId = `mv-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const target = { kind: mover.kind, id: mover.kind === 'pc' ? mover.tokenId : mover.id, name: moverName };
  addOffers(st, sceneId, reactors.map((r) => ({ id: `ro-${crypto.randomUUID().slice(0, 8)}`, kind: 'opportunity' as const, reactor: { kind: r.kind, id: r.id, name: r.name }, target, turnSerial: e?.turnSerial ?? 0, at: now, from: stopAt, moveId })));
  const pending = (st.scenePendingMoves?.[sceneId] ?? []).filter((m) => m.turnSerial === (e?.turnSerial ?? 0));
  st.scenePendingMoves = { ...(st.scenePendingMoves ?? {}), [sceneId]: [...pending, { id: moveId, mover: target, to, declined, turnSerial: e?.turnSerial ?? 0 }].slice(-10) };
  for (const r of reactors) logCombat(st, sceneId, `${moverName} leaves the reach of ${r.name} – movement paused for an opportunity attack (reaction).`);
  if (e) st.sceneEncounters![sceneId].version++;
  return st;
}

/** A creature with a paused move cannot start another one until the reactions are decided. */
export const pausedMoveOf = (state: GameState, sceneId: string, mover: Side) => (state.scenePendingMoves?.[sceneId] ?? []).find((m) => m.turnSerial === (state.sceneEncounters?.[sceneId]?.turnSerial ?? 0) && m.mover.kind === mover.kind && m.mover.id === (mover.kind === 'pc' ? mover.tokenId : mover.id) && reactionsOf(state, sceneId).some((o) => o.moveId === m.id));

/**
 * The GM moves an NPC along the cheapest path. In initiative only on its own turn and within its speed (Dash
 * doubles it); leaving a hostile's reach pauses the move for an opportunity attack.
 */
export async function moveNpc(user: AuthUser, repo: Repo, scene: Scene, map: SceneMap, npcId: string, at: { x: number; y: number }, declined: string[] = []): Promise<SceneResult> {
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  const state = ctx.state;
  const npc = state ? enemiesOf(state, scene.id).find((e) => e.id === npcId) : undefined;
  if (!state || !npc || npc.defeated) return { status: 404, body: { error: 'Creature not found.' } };
  const e = activeEncounter(state, scene.id);
  const actor = npcActor(npc.id);
  if (e && !isActiveActor(e, actor)) return { status: 409, body: { error: `Wait for ${npc.name}'s turn – only the creature whose turn it is can move.` } };
  if (pausedMoveOf(state, scene.id, { kind: 'npc', id: npc.id }) && !declined.length) return { status: 409, body: { error: 'Decide the opportunity attack first.' } };
  const path = hexMovementCost(map, npc, at);
  if (!path.ok) return { status: 422, body: { error: path.error } };
  const b = budgetOf(e, actor);
  if (speedZero(state, scene.id, actor)) return { status: 422, body: { error: `${npc.name} cannot move (speed 0: ${effectsOf(state, scene.id, actor).filter((x) => x.mods.speedZero).map((x) => x.name).join(', ')}).` } };
  const allowance = npc.speedFt * (b.dash ? 2 : 1);
  if (e && (b.moved ?? 0) + path.cost > allowance + 1e-9) return { status: 422, body: { error: `${npc.name} has only ${Math.max(0, allowance - (b.moved ?? 0))} ft of movement left this turn.` } };
  const points = [{ x: npc.x, y: npc.y }, ...path.steps];
  const stop = await planInterruption(repo, user.campaignId, scene.id, map, { kind: 'npc', id: npc.id }, points, declined);
  const dest = stop ? points[stop.stop] : path.to;
  const cost = stop ? (stop.stop === 0 ? 0 : path.steps[stop.stop - 1].cost) : path.cost;
  return mutate(user, repo, (s) => {
    let st = structuredClone(s);
    if (cost > 0 || !stop) {
      const r = updateEnemy(st, scene.id, npc.id, dest);
      if (!r.ok) return r;
      st = r.state;
    }
    const enc = st.sceneEncounters?.[scene.id];
    if (enc?.status === 'active') spend(enc, actor, { moved: (budgetOf(enc, actor).moved ?? 0) + cost });
    if (stop) st = registerInterruption(st, scene.id, { kind: 'npc', id: npc.id }, npc.name, dest, path.to, stop.reactors, declined);
    return { ok: true, state: st, message: stop ? `${npc.name} stops – ${stop.reactors.map((r) => r.name).join(', ')} may make an opportunity attack.` : `${npc.name} moves ${cost} ft.` };
  });
}

/** Take or skip an offered reaction (opportunity attack); a paused move continues once all its offers are decided. */
async function reactionRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.offerId !== 'string' || typeof v.accept !== 'boolean') return { status: 400, body: { error: 'Invalid reaction.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state) return { status: 409, body: { error: 'Campaign unavailable.' } };
  const offer = reactionsOf(ctx.state, scene.id).find((o) => o.id === v.offerId);
  if (!offer) return { status: 409, body: { error: 'This reaction is no longer available.' } };
  const reactor: Side = offer.reactor.kind === 'pc' ? { kind: 'pc', tokenId: offer.reactor.id } : { kind: 'npc', id: offer.reactor.id };
  const target: Side = offer.target.kind === 'pc' ? { kind: 'pc', tokenId: offer.target.id } : { kind: 'npc', id: offer.target.id };
  if (!controls(user, reactor)) return { status: 403, body: { error: 'Only the reacting creature’s controller can decide.' } };
  if (offer.kind === 'shield') return shieldDecision(user, repo, ctx, scene, offer, v.accept);
  if (v.accept && incapacitated(ctx.state, scene.id, actorOf(reactor))) return { status: 409, body: { error: `${offer.reactor.name} is incapacitated.` } };
  let result: SceneResult;
  if (!v.accept) {
    result = await mutate(user, repo, (s) => { const st = structuredClone(s); dropOffer(st, scene.id, offer.id); logCombat(st, scene.id, `${offer.reactor.name} lets ${offer.target.name} go.`); return { ok: true, state: st, message: 'Reaction skipped.' }; });
  } else {
    const strike = await strikeOf(ctx, reactor, Number.isSafeInteger(v.attackIndex) ? (v.attackIndex as number) : undefined);
    if (typeof strike === 'string') return { status: 422, body: { error: strike } };
    if (strike.rangeFt && strike.rangeFt > 15) return { status: 422, body: { error: 'An opportunity attack is a melee attack – choose a melee weapon.' } };
    if (reactionUsed(activeEncounter(ctx.state, scene.id), actorOf(reactor))) return { status: 409, body: { error: 'The reaction was already used this round.' } };
    const r = await rollAgainst(user, repo, ctx, offer.reactor.name, strike, target, ' (opportunity attack)');
    if (typeof r === 'string') return { status: 404, body: { error: r } };
    result = await mutate(user, repo, (s) => {
      if (!reactionsOf(s, scene.id).some((o) => o.id === offer.id)) return { ok: false, error: 'This reaction is no longer available.' };
      const st = r.apply(s);
      dropOffer(st, scene.id, offer.id);
      const e = st.sceneEncounters?.[scene.id];
      const err = useEconomy(e?.status === 'active' ? e : null, actorOf(reactor), 'reaction', { gm: user.role === 'gm' });
      if (err) return { ok: false, error: err };
      if (e) e.version++;
      return { ok: true, state: st, message: r.text };
    });
  }
  if (result.status !== 200 || !offer.moveId) return result;
  // all offers of the paused move decided → the move continues (if the mover can still move)
  const after = await repo.loadState(user.campaignId);
  if (!after || reactionsOf(after.state, scene.id).some((o) => o.moveId === offer.moveId)) return result;
  const pending = (after.state.scenePendingMoves?.[scene.id] ?? []).find((m) => m.id === offer.moveId);
  if (!pending) return result;
  const declined = [...pending.declined, ...reactionsOf(ctx.state, scene.id).filter((o) => o.moveId === offer.moveId).map((o) => (o.reactor.kind === 'pc' ? pcActor(o.reactor.id) : npcActor(o.reactor.id)))];
  await mutate(user, repo, (s) => { const st = structuredClone(s); st.scenePendingMoves = { ...(st.scenePendingMoves ?? {}), [scene.id]: (st.scenePendingMoves?.[scene.id] ?? []).filter((m) => m.id !== pending.id) }; return { ok: true, state: st }; });
  const map = parseMap(scene.published_metadata)!;
  let cont: SceneResult;
  if (pending.mover.kind === 'npc') {
    const alive = enemiesOf(after.state, scene.id).some((x) => x.id === pending.mover.id && !x.defeated);
    cont = alive ? await moveNpc(user, repo, scene, map, pending.mover.id, pending.to, declined) : { status: 200, body: { ok: true } };
  } else {
    const sheet = await sheetOf({ ...ctx, state: after.state }, pending.mover.id);
    const down = !!sheet.hitPoints && sheet.hitPoints.current <= 0;
    cont = down ? { status: 200, body: { ok: true } } : await continuePcMove(user, repo, scene.id, pending.mover.id, pending.to, declined);
  }
  const msg = (result.body as { message?: string }).message ?? '';
  const contMsg = cont.status === 200 ? ((cont.body as { message?: string }).message ?? `${offer.target.name} continues moving.`) : `The move could not continue: ${(cont.body as { error?: string }).error ?? 'blocked'}.`;
  return { status: 200, body: { ...(result.body as object), message: `${msg} ${contMsg}`.trim() } };
}

// ---------------------------------------------------------------- areas of effect (APEX 1.2)

const ABILITY_NAME: Record<AbilityKey, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/** Saving throw bonus of a character from the sheet (save row, else the ability modifier). */
function pcSaveBonus(sheet: CharacterSheet, ability: AbilityKey): number {
  const row = sheet.saves.find((x) => x.name.toLowerCase().startsWith(ABILITY_NAME[ability].toLowerCase().slice(0, 3)));
  const m = row ? /([+-]?\d{1,2})/.exec(row.value) : null;
  if (m) return Number(m[1]);
  return abilityMods(sheet)[ability] ?? 0;
}

interface AreaEffect { name: string; area: AreaSpec; save: AbilityKey; dc: number; damage: string; damageType: string; source: string; condition?: ConditionId; sourceActor?: string }

/**
 * Resolves an area: one damage roll, every creature in the area saves (d20 + its save bonus vs DC): full damage on
 * a failure, half on a success. NPC hit points change on the scene, characters' on their sheets.
 */
async function resolveArea(user: AuthUser, repo: Repo, ctx: Ctx, map: SceneMap, origin: { x: number; y: number }, point: { x: number; y: number }, fx: AreaEffect): Promise<{ lines: string[]; apply: (s: GameState, quiet?: boolean) => GameState }> {
  const sceneId = ctx.sceneId!;
  const state = ctx.state!;
  const keys = new Set(areaHexes(map, origin, point, fx.area));
  const figures = (await battleFigures(ctx, sceneId, map)).filter((f) => !f.down && keys.has(hexKeyAt(map, f)));
  const dice = parseDamage(fx.damage);
  const rolled = dice ? rollDice(dice) : { rolls: [], total: 0 };
  const lines = [`${fx.source}: ${fx.name} – ${fx.area.sizeFt}-ft ${fx.area.shape}, DC ${fx.dc} ${ABILITY_NAME[fx.save]} save${rolled.total ? `, ${rolled.total} ${fx.damageType} damage (${rolled.rolls.join('+')}${dice?.mod ? `+${dice.mod}` : ''})` : ''}${fx.condition ? `, ${fx.condition} on a failure` : ''}.${figures.length ? '' : ' Nobody is in the area.'}`];
  const npcHits: Array<{ id: string; dmg: number }> = [];
  const conditionHits: Array<{ actor: string; name: string }> = [];
  for (const f of figures) {
    let bonus = 0;
    if (f.kind === 'npc') {
      const e = enemiesOf(state, sceneId).find((x) => x.id === f.id)!;
      bonus = e.abilities ? (e.saves?.[fx.save] ?? Math.floor((e.abilities[fx.save] - 10) / 2)) : 0;
    } else bonus = pcSaveBonus(await sheetOf(ctx, f.id), fx.save);
    const d20 = die(20);
    const saved = d20 + bonus >= fx.dc;
    const dmg = saved ? Math.floor(rolled.total / 2) : rolled.total;
    let hp = '';
    if (f.kind === 'npc') npcHits.push({ id: f.id, dmg });
    else if (dmg > 0) {
      const row = await repo.loadSheet(user.campaignId, f.id);
      const sheet = await sheetOf(ctx, f.id);
      const hurt = sheet.hitPoints ? applyDamage(sheet, dmg) : null;
      if (hurt?.ok) {
        const ok = await repo.saveSheet(user.campaignId, f.id, hurt.sheet, row?.version ?? 0, user.id);
        hp = ok === null ? ' (sheet changed – apply by hand)' : ` (${hurt.sheet.hitPoints?.current}/${hurt.sheet.hitPoints?.max} HP)`;
      } else hp = ' (apply by hand)';
    }
    const noDamage = !dice || rolled.total === 0;
    if (!saved && fx.condition) conditionHits.push({ actor: f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id), name: f.name });
    lines.push(`${f.name}: d20 ${d20} ${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${d20 + bonus} → ${saved ? (noDamage ? 'saved' : 'saved, half') : 'failed'}${noDamage ? '' : `: ${dmg} damage${hp}`}${!saved && fx.condition ? ` – ${fx.condition}` : ''}.`);
  }
  return {
    lines,
    apply: (s, quiet = false) => {
      let st = structuredClone(s);
      for (const h of npcHits) {
        if (!h.dmg) continue;
        const r = updateEnemy(st, sceneId, h.id, { hpDelta: -h.dmg });
        if (r.ok) st = r.state;
        const after = enemiesOf(st, sceneId).find((x) => x.id === h.id);
        if (after?.defeated) lines.push(`${after.name} is defeated.`);
      }
      for (const c of conditionHits) addEffect(st, sceneId, c.actor, conditionEffect(fx.condition!, fx.sourceActor ? { actor: fx.sourceActor, name: fx.source } : undefined, () => `fx-${crypto.randomUUID().slice(0, 8)}`));
      if (!quiet) for (const l of lines) logCombat(st, sceneId, l);
      return st;
    },
  };
}

/** GM: an NPC uses an area ability of its stat block (on its turn, uses per encounter counted). */
async function npcAreaRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.id !== 'string' || !Number.isSafeInteger(v.area) || typeof (v.point as { x?: unknown })?.x !== 'number' || typeof (v.point as { y?: unknown })?.y !== 'number') return { status: 400, body: { error: 'Invalid area ability.' } };
  const map = parseMap(scene.published_metadata);
  if (!map?.hex) return { status: 400, body: { error: 'Areas need a battle map.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  const npc = ctx.state ? enemiesOf(ctx.state, scene.id).find((e) => e.id === v.id && !e.defeated) : undefined;
  const area = npc?.areas?.[v.area as number];
  if (!npc || !area) return { status: 404, body: { error: 'Unknown area ability.' } };
  if (area.uses && (npc.areaUsed?.[area.name] ?? 0) >= area.uses) return { status: 409, body: { error: `${area.name} is used up for this encounter.` } };
  const point = v.point as { x: number; y: number };
  if (area.rangeFt && feetApart(map, npc, point) > area.rangeFt) return { status: 422, body: { error: `Out of range (${area.rangeFt} ft).` } };
  const pre = useEconomy(activeEncounter(structuredClone(ctx.state!), scene.id), npcActor(npc.id), 'action', { gm: true });
  if (pre) return { status: 409, body: { error: pre } };
  const r = await resolveArea(user, repo, ctx, map, npc, area.rangeFt ? point : point, { name: area.name, area: { shape: area.shape, sizeFt: area.sizeFt }, save: area.save, dc: area.dc, damage: area.damage, damageType: area.damageType, source: npc.name, condition: area.condition, sourceActor: npcActor(npc.id) });
  return mutate(user, repo, (s) => {
    const st = r.apply(s);
    const e = st.sceneEncounters?.[scene.id];
    const err = useEconomy(e?.status === 'active' ? e : null, npcActor(npc.id), 'action', { gm: true });
    if (err) return { ok: false, error: err };
    const me = enemiesOf(st, scene.id).find((x) => x.id === npc.id);
    if (me) me.areaUsed = { ...(me.areaUsed ?? {}), [area.name]: (me.areaUsed?.[area.name] ?? 0) + 1 };
    if (e) e.version++;
    return { ok: true, state: st, message: r.lines.join(' ') };
  });
}

/** Shield (reaction): +5 AC until the start of the caster's next turn, also against the triggering attack. */
async function shieldDecision(user: AuthUser, repo: Repo, ctx: Ctx, scene: Scene, offer: ReactionOffer, accept: boolean): Promise<SceneResult> {
  const state = ctx.state!;
  const hit = (state.scenePendingHits?.[scene.id] ?? []).find((h) => h.id === offer.hitId);
  if (!hit) return { status: 409, body: { error: 'This attack was already resolved.' } };
  const tokenId = hit.target.id, actor = pcActor(tokenId);
  let text: string;
  let shielded = false;
  if (accept) {
    const sheet = await sheetOf(ctx, tokenId);
    if (!shieldReady(state, scene.id, sheet, tokenId)) return { status: 409, body: { error: 'Shield cannot be cast now (prepared spell, a slot and the reaction are needed).' } };
    const slot = spellSlots(sheet).find((x) => x.current > 0)!;
    const row = await repo.loadSheet(user.campaignId, tokenId);
    if ((await repo.saveSheet(user.campaignId, tokenId, spendSlot(sheet, slot.level), row?.version ?? 0, user.id)) === null) return { status: 409, body: { error: 'The character sheet changed meanwhile – try again.' } };
    shielded = true;
    const stillHits = hit.natural20 || hit.total >= hit.ac + 5;
    text = `${hit.target.name} casts Shield (${ordinal(slot.level)}-level slot): AC ${hit.ac} → ${hit.ac + 5}. ${hit.attacker.name}'s ${hit.total} ${stillHits ? 'still hits' : 'misses'}.`;
    if (stillHits) text += ` ${hit.damage} damage${await damagePc(user, repo, ctx, tokenId, hit.damage)}${(await concentrationCheck(ctx, actor, hit.damage))?.text ?? ''}`;
  } else {
    const conc = await concentrationCheck(ctx, actor, hit.damage);
    text = `${hit.target.name} takes the hit: ${hit.damage} damage${await damagePc(user, repo, ctx, tokenId, hit.damage)}${conc?.text ?? ''}`;
    if (conc?.broken) text += ' ';
  }
  const lostConc = / → lost\.$/.test(text.trim());
  return mutate(user, repo, (s) => {
    const st = structuredClone(s);
    if (!(st.scenePendingHits?.[scene.id] ?? []).some((h) => h.id === hit.id)) return { ok: false, error: 'This attack was already resolved.' };
    st.scenePendingHits = { ...(st.scenePendingHits ?? {}), [scene.id]: (st.scenePendingHits?.[scene.id] ?? []).filter((h) => h.id !== hit.id) };
    dropOffer(st, scene.id, offer.id);
    if (shielded) {
      const e = activeEncounter(st, scene.id);
      if (e) useEconomy(st.sceneEncounters![scene.id], actor, 'reaction', { gm: true });
      addEffect(st, scene.id, actor, { id: `fx-shield-${crypto.randomUUID().slice(0, 6)}`, name: 'Shield', key: 'shield', mods: { ac: 5 }, untilStartOf: actor, source: { actor, name: hit.target.name, spell: 'Shield' } });
    }
    if (lostConc) endConcentration(st, scene.id, actor);
    logCombat(st, scene.id, text);
    return { ok: true, state: st, message: text };
  });
}

/** Class features in battle: Action Surge, Second Wind, Rage, Wild Shape / revert, Lay on Hands, Bardic Inspiration. */
async function featureRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.tokenId !== 'string' || typeof v.feature !== 'string') return { status: 400, body: { error: 'Invalid feature.' } };
  const me: Side = { kind: 'pc', tokenId: v.tokenId };
  const actor = actorOf(me);
  if (!controls(user, me)) return { status: 403, body: { error: 'This is not your character.' } };
  if (!(await playerInScene(user, repo, scene.id))) return { status: 409, body: { error: 'You are not in this scene.' } };
  const map = parseMap(scene.published_metadata);
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state?.tokens[v.tokenId] || !map) return { status: 404, body: { error: 'Character unavailable.' } };
  if (incapacitated(ctx.state, scene.id, actor)) return { status: 409, body: { error: 'Incapacitated.' } };
  const row = await repo.loadSheet(user.campaignId, v.tokenId);
  const sheet = await sheetOf(ctx, v.tokenId);
  const info = battleFeatures(sheet).find((f) => f.id === v.feature);
  if (!info) return { status: 422, body: { error: 'This feature is not on the character sheet.' } };
  const name = ctx.state.tokens[v.tokenId].name;
  const e = activeEncounter(ctx.state, scene.id);
  const econ = info.cost === 'action' ? 'action' : info.cost === 'bonus' ? 'bonus' : null;
  if (econ) { const pre = useEconomy(activeEncounter(structuredClone(ctx.state), scene.id), actor, econ, { gm: user.role === 'gm' }); if (pre) return { status: 409, body: { error: pre } }; }
  else if (e && !isActiveActor(e, actor)) return { status: 409, body: { error: 'Only on your turn.' } };
  let next: CharacterSheet | string = sheet;
  let text = '';
  const steps: Array<(st: GameState) => void> = [];
  const save = async (sh: CharacterSheet) => (await repo.saveSheet(user.campaignId, v.tokenId as string, sh, row?.version ?? 0, user.id)) !== null;
  const fighter = classLevel(sheet, 'fighter') ?? 1, barb = classLevel(sheet, 'barbarian') ?? 1, bard = classLevel(sheet, 'bard') ?? 1;
  switch (info.id) {
    case 'actionSurge': {
      if (budgetOf(e, actor).surged) return { status: 409, body: { error: 'Action Surge was already used this turn.' } };
      next = spendUse(sheet, info);
      text = `${name} uses Action Surge – one more action this turn.`;
      steps.push((st) => { const enc = st.sceneEncounters?.[scene.id]; if (enc?.status === 'active') spend(enc, actor, { action: false, attackAction: false, attacks: 0, surged: true }); });
      break;
    }
    case 'secondWind': {
      next = spendUse(sheet, info);
      if (typeof next !== 'string') {
        const r = rollDice({ count: 1, sides: 10, mod: fighter });
        const healed = next.hitPoints ? applyHealing(next, r.total) : null;
        if (healed?.ok) next = healed.sheet;
        text = `${name} uses Second Wind: +${r.total} HP (${r.rolls[0]}+${fighter})${healed?.ok ? ` → ${healed.sheet.hitPoints?.current}/${healed.sheet.hitPoints?.max}` : ''}.`;
      }
      break;
    }
    case 'rage': {
      next = spendUse(sheet, info);
      text = `${name} rages! Resistance to bludgeoning, piercing and slashing damage, +${rageDamage(barb)} melee damage for 10 rounds.`;
      steps.push((st) => addEffect(st, scene.id, actor, { id: `fx-rage-${crypto.randomUUID().slice(0, 6)}`, name: 'Raging', key: 'rage', mods: { resistPhysical: true, meleeDamage: rageDamage(barb) }, turns: 10, source: { actor, name } }));
      break;
    }
    case 'wildShape': {
      const form = typeof v.formId === 'string' ? findBeast(ctx.state.customBeasts, v.formId) : undefined;
      if (!form) return { status: 422, body: { error: 'Choose a beast form.' } };
      const r = transform(sheet, form);
      if (!r.ok) return { status: 422, body: { error: r.error } };
      next = r.sheet;
      text = `${name} turns into a ${form.name} (AC ${form.ac}, ${form.hp} HP).`;
      if (concentrationOf(ctx.state, scene.id, actor)) text += ' (Concentration continues – no new spells in beast form.)';
      break;
    }
    case 'revertShape': {
      const r = revert(sheet);
      if (!r.ok) return { status: 422, body: { error: r.error } };
      next = r.sheet;
      text = `${name} returns to normal form.`;
      break;
    }
    case 'layOnHands':
    case 'bardicInspiration': {
      const target = sideOf(v.target) ?? me;
      const figures = await battleFigures(ctx, scene.id, map);
      const from = positionOf(figures, me), to = positionOf(figures, target);
      if (!from || !to || to.down && info.id === 'bardicInspiration') return { status: 404, body: { error: 'Target not on the map.' } };
      if (feetBetween(map)(from, to) > (info.rangeFt ?? 5)) return { status: 422, body: { error: `${to.name} is out of range (${info.rangeFt} ft).` } };
      if (info.id === 'layOnHands') {
        const amount = Number.isSafeInteger(v.amount) ? Math.max(1, v.amount as number) : 5;
        next = spendUse(sheet, info, amount);
        if (typeof next === 'string') break;
        if (target.kind === 'pc' && target.tokenId !== v.tokenId) {
          const trow = await repo.loadSheet(user.campaignId, target.tokenId);
          const ts = await sheetOf(ctx, target.tokenId);
          const h = ts.hitPoints ? applyHealing(ts, amount) : null;
          if (h?.ok) await repo.saveSheet(user.campaignId, target.tokenId, h.sheet, trow?.version ?? 0, user.id);
        } else if (target.kind === 'pc') { const h = next.hitPoints ? applyHealing(next, amount) : null; if (h?.ok) next = h.sheet; }
        else steps.push((st) => { const u = updateEnemy(st, scene.id, target.id, { hpDelta: amount }); if (u.ok) Object.assign(st, u.state); });
        text = `${name} lays hands on ${to.name}: +${amount} HP.`;
      } else {
        if (target.kind === 'pc' && target.tokenId === v.tokenId) return { status: 422, body: { error: 'Bardic Inspiration goes to another creature.' } };
        next = spendUse(sheet, info);
        const d = inspirationDie(bard);
        text = `${name} inspires ${to.name}: +1${d} on its next attack roll.`;
        steps.push((st) => addEffect(st, scene.id, actorOf(target), { id: `fx-insp-${crypto.randomUUID().slice(0, 6)}`, name: `Inspired (1${d})`, key: 'inspired', mods: { toHitDie: `1${d}`, once: true }, source: { actor, name } }));
      }
      break;
    }
  }
  if (typeof next === 'string') return { status: 422, body: { error: next } };
  if (next !== sheet && !(await save(next))) return { status: 409, body: { error: 'The character sheet changed meanwhile – try again.' } };
  return mutate(user, repo, (s) => {
    const st = structuredClone(s);
    const enc = st.sceneEncounters?.[scene.id];
    if (econ) { const err = useEconomy(enc?.status === 'active' ? enc : null, actor, econ, { gm: user.role === 'gm' }); if (err) return { ok: false, error: err }; }
    for (const f of steps) f(st);
    if (enc) enc.version++;
    logCombat(st, scene.id, text);
    return { ok: true, state: st, message: text };
  });
}
