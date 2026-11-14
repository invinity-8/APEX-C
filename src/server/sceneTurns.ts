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
import { carriedLights, clockFor, hexKeyAt, parseStoredSheet, sheetOf, visionFor, type SceneViewContext } from './sceneLocal.js';
import { spellSlots, STANDARD_ACTIONS, addOffers, attacksPerAction, budgetOf, characterLevel, dropOffer, firstOpportunity, activeActors, isActiveActor, npcActor, ordinal, pcActor, planSpell, reactionUsed, reactionsOf, spellNumbers, spend, spendSlot, withShillelagh, takeStandardAction, useEconomy, type Figure, type ReactionOffer, type StandardAction } from '../game/sceneActions.js';
import { bestiary, statBlock, type AbilityKey } from '../game/bestiary.js';
import { effectiveAc, effectiveSpeed, flanks, hiddenEffect, hiddenOf, reveal, CONDITIONS, type ConditionId, type EffectMods, PHYSICAL, addEffect, attackMods, conditionEffect, startConcentration, effectsOf, speedZero, concentrationDc, concentrationOf, endConcentration, incapacitated, removeEffect, resistsPhysical } from '../game/combatEffects.js';
import type { AttackOptions } from '../game/sceneCombat.js';
import { attackExtras } from './combatFeatures.js';
import { areaHexes, parseArea, type AreaSpec } from '../campaign/hexArea.js';
import { abilityMods } from '../game/equipment.js';
import type { CharacterSheet } from '../game/sheet.js';
import { addEnemy, enemiesOf, npcAttacks, npcReach, logCombat, parseBonus, parseDamage, parseRangeFt, resolveAttack, setCarriedLight, updateEnemy, grantEnemyTempHp } from '../game/sceneCombat.js';
import { activeEncounter } from '../game/sceneTurns.js';
import { heightLookup, hexAt, hexCentre, hexMovementCost, passable, pathDrops, tileLookup } from '../campaign/hexScene.js';
import { continuePcMove, placePc } from './sceneMotion.js';
import { lineOfSight, sightRules } from '../campaign/hexVision.js';
import { distance, hexKey } from '../game/hex.js';
import { applyDamage, applyHealing, classLevel, revert, setTempHp, transform } from '../game/abilities.js';
import { battleFeatures, inspirationDie, rageDamage, spendUse } from '../game/classFeatures.js';
import { findBeast } from '../game/beastCatalog.js';
import { elementOf, pushFx, type SceneFx } from '../game/sceneFx.js';
import { planEncounter, placeEncounter, SITUATIONS, type Difficulty, type Situation } from '../game/encounters.js';
import { allGroups, groupTemplates, spotsAround } from '../game/groups.js';
import { WEATHERS, WEATHER_FX, type WeatherFx, changeWorldTime, clockText, dayOf, parseWorldTimeChange } from '../game/worldTime.js';
import { flightCost, altitudeOf, distance3d, fallDice, npcSpeeds, pendingFalls, setAltitude, MAX_ALTITUDE_FT } from '../game/altitude.js';
import { npcPerception, npcStealth, pcAbilityMod, pcAcrobatics, pcAthletics, pcPerception, pcStealth } from '../game/perception.js';
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
    // APEX 1.9: whoever can't stay in the air any more falls (prone, 1d6 per 10 ft)
    const falls = applyFalls(r.state);
    const version = await repo.saveState(user.campaignId, r.state, stored.version, user.id);
    if (version !== null) {
      let extra = falls.map((f) => f.text).join(' ');
      for (const f of falls) if (f.tokenId && f.damage) {
        const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: f.sceneId };
        extra += await damagePc(user, repo, ctx, f.tokenId, f.damage);
      }
      return { status: 200, body: { ok: true, message: [r.message, extra].filter(Boolean).join(' '), version } };
    }
  }
  return { status: 409, body: { error: 'The scene changed at the same time. Please try again.' } };
}

/**
 * A creature falls `ft` feet onto the ground (jumping down a cliff, pushed over an edge): 1d6 per 10 ft (max 20d6),
 * prone if it took damage. Characters lose hit points on their sheet. Returns the log text.
 */
export async function fallDamage(user: AuthUser, repo: Repo, sceneId: string, who: Side, ft: number, why: string): Promise<string> {
  const dice = fallDice(ft);
  if (!dice) return '';
  const r = rollDice(parseDamage(dice)!);
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId };
  const name = ctx.state ? nameOf(ctx.state, sceneId, who) : 'A creature';
  let text = `${name} falls ${ft} ft (${why}): ${r.total} bludgeoning damage (${dice})${r.total ? ' and lands prone' : ''}.`;
  if (who.kind === 'pc') text += await damagePc(user, repo, ctx, who.tokenId, r.total);
  await mutate(user, repo, (s) => {
    let st = structuredClone(s);
    if (who.kind === 'npc' && r.total) { const u = updateEnemy(st, sceneId, who.id, { hpDelta: -r.total }); if (u.ok) st = u.state; }
    if (r.total && !effectsOf(st, sceneId, actorOf(who)).some((e) => e.key === 'prone')) addEffect(st, sceneId, actorOf(who), conditionEffect('prone', undefined, () => `fx-${crypto.randomUUID().slice(0, 8)}`));
    pushFx(st, sceneId, [{ kind: 'hit', to: actorOf(who), amount: r.total, label: 'Fall', element: 'physical' }]);
    logCombat(st, sceneId, text);
    return { ok: true, state: st, message: text };
  });
  return text;
}

/**
 * Encounter generator (GM, APEX 2.0): `op: 'plan'` returns monsters for a theme, difficulty and party (nothing is
 * stored); `op: 'apply'` places the (possibly edited) list on the map for the situation – an ambush rolls Stealth and
 * hides each creature.
 */
async function encounterRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  const map = parseMap(scene.published_metadata);
  if (!map?.hex) return { status: 400, body: { error: 'Encounters are placed on hex battle maps.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state) return { status: 409, body: { error: 'Campaign unavailable.' } };
  const situation = (SITUATIONS.find((x) => x.id === v.situation)?.id ?? 'camp') as Situation;
  const difficulty = (['easy', 'medium', 'hard', 'deadly'].includes(v.difficulty as string) ? v.difficulty : 'medium') as Difficulty;
  const partySize = Number.isSafeInteger(v.partySize) ? Math.max(1, Math.min(10, v.partySize as number)) : 4;
  const partyLevel = Number.isSafeInteger(v.partyLevel) ? Math.max(1, Math.min(20, v.partyLevel as number)) : 1;
  const seed = Number.isSafeInteger(v.seed) ? (v.seed as number) : 1;
  const blocks = bestiary(ctx.state);
  // APEX 2.1 – spawn the enemy group of one spawn marker (or of all markers) on the free hexes around it
  if (v.op === 'spawnGroup' || v.op === 'spawnAll') {
    const markers = map.nodes.filter((n) => n.kind === 'enemies' && n.group && (v.op === 'spawnAll' || n.id === v.nodeId));
    if (!markers.length) return { status: 404, body: { error: 'No enemy spawn marker on the published map.' } };
    const groups = allGroups(ctx.state.enemyGroups);
    const pcs = await ctx.pcs!(scene.id, map);
    const occupied = new Set([...pcs.map((p) => hexKeyAt(map, p)), ...enemiesOf(ctx.state, scene.id).filter((e) => !e.defeated).map((e) => hexKeyAt(map, e))]);
    const plan: Array<{ templateId: string; at: { x: number; y: number } }> = [];
    for (const m of markers) {
      const gr = groups.find((x) => x.id === m.group);
      if (!gr) continue;
      const ids = groupTemplates(gr).filter((id) => !!statBlock(ctx.state!, id));
      const spots = spotsAround(map, m, ids.length, occupied);
      spots.forEach((at, i) => { occupied.add(hexKeyAt(map, at)); plan.push({ templateId: ids[i], at }); });
    }
    if (!plan.length) return { status: 422, body: { error: 'No free hexes near the marker(s).' } };
    return mutate(user, repo, (s) => {
      let st = structuredClone(s);
      const names: string[] = [];
      for (const item of plan) {
        const newId = `en-${crypto.randomUUID().slice(0, 8)}`;
        const r = addEnemy(st, scene.id, newId, item.templateId, item.at, undefined, d20());
        if (!r.ok) return r;
        st = r.state;
        names.push(enemiesOf(st, scene.id).find((x) => x.id === newId)!.name);
      }
      const label = markers.map((m) => m.label).join(', ');
      const text = `${label}: ${names.join(', ')} appear${names.length === 1 ? 's' : ''}.`;
      logCombat(st, scene.id, text);
      return { ok: true, state: st, message: text };
    });
  }
  if (v.op === 'plan') {
    const plan = planEncounter({ theme: typeof v.theme === 'string' ? v.theme : 'bandits', situation, difficulty, partySize, partyLevel, seed, blocks });
    return { status: 200, body: { ok: true, plan } };
  }
  if (v.op !== 'apply' || !Array.isArray(v.entries)) return { status: 400, body: { error: 'Invalid encounter.' } };
  const ids = (v.entries as unknown[]).map((e) => (e as { templateId?: unknown })?.templateId).filter((id): id is string => typeof id === 'string' && !!statBlock(ctx.state!, id)).slice(0, 20);
  if (!ids.length) return { status: 422, body: { error: 'Nothing to place.' } };
  const pcs = await ctx.pcs!(scene.id, map);
  const spawn = map.nodes.find((n) => n.kind === 'spawn');
  const party = pcs.length ? { x: pcs.reduce((a, p) => a + p.x, 0) / pcs.length, y: pcs.reduce((a, p) => a + p.y, 0) / pcs.length } : spawn ?? hexCentre(map, { q: 0, r: 0 });
  const occupied = new Set([...pcs.map((p) => hexKeyAt(map, p)), ...enemiesOf(ctx.state, scene.id).filter((e) => !e.defeated).map((e) => hexKeyAt(map, e))]);
  const ranged = ids.map((id) => { const b = statBlock(ctx.state!, id)!; return b.attacks[0]?.kind === 'ranged'; });
  const spots = placeEncounter(map, situation, ids.length, party, seed, occupied, ranged);
  if (spots.length < ids.length) return { status: 422, body: { error: `Only ${spots.length} free spots for ${ids.length} creatures on this map.` } };
  return mutate(user, repo, (s) => {
    let st = structuredClone(s);
    const names: string[] = [];
    for (const [i, id] of ids.entries()) {
      const newId = `en-${crypto.randomUUID().slice(0, 8)}`;
      const r = addEnemy(st, scene.id, newId, id, spots[i], undefined, d20());
      if (!r.ok) return r;
      st = r.state;
      const e = enemiesOf(st, scene.id).find((x) => x.id === newId)!;
      names.push(e.name);
      if (spots[i].hidden) addEffect(st, scene.id, npcActor(newId), hiddenEffect(die(20) + npcStealth(e), () => `fx-${crypto.randomUUID().slice(0, 8)}`));
    }
    const text = `Encounter (${SITUATIONS.find((x) => x.id === situation)!.label.toLowerCase()}): ${names.join(', ')}.`;
    logCombat(st, scene.id, text);
    return { ok: true, state: st, message: text };
  });
}

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
/**
 * Shove (5e, APEX 2.0): replaces one attack of the Attack action. Athletics against the target's Athletics or
 * Acrobatics (its choice: the higher); the target may be at most one size larger. On a success it is pushed 5 ft
 * straight away (off a cliff or into a pit: it falls) or knocked prone (in the air: it falls).
 */
async function shoveRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  const attacker = sideOf(v.attacker), target = sideOf(v.target);
  const mode = v.mode === 'prone' ? 'prone' : 'push';
  if (!attacker || !target) return { status: 400, body: { error: 'Invalid shove.' } };
  if (!controls(user, attacker)) return { status: 403, body: { error: 'This is not your creature.' } };
  if (!(await playerInScene(user, repo, scene.id))) return { status: 409, body: { error: 'You are not in this scene.' } };
  const map = parseMap(scene.published_metadata);
  if (!map?.hex) return { status: 400, body: { error: 'Shoving works on hex battle maps.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state) return { status: 409, body: { error: 'Campaign unavailable.' } };
  const state = ctx.state;
  const figures = await battleFigures(ctx, scene.id, map);
  const a = positionOf(figures, attacker), t = positionOf(figures, target);
  if (!a || !t || t.down) return { status: 404, body: { error: 'Target or attacker not on the map.' } };
  if (feetBetween(map)(a, t) > 5) return { status: 422, body: { error: `${t.name} is not within 5 ft.` } };
  const sizeOf = (s: Side) => s.kind === 'pc' ? 2 : SIZES.indexOf((statBlock(state, enemiesOf(state, scene.id).find((e) => e.id === s.id)?.templateId ?? '')?.size ?? 'medium').toLowerCase());
  if (sizeOf(target) > sizeOf(attacker) + 1) return { status: 422, body: { error: `${t.name} is too big to shove.` } };
  const pre = useEconomy(activeEncounter(structuredClone(state), scene.id), actorOf(attacker), 'attack', { gm: user.role === 'gm', attacksAllowed: attacker.kind === 'npc' ? enemiesOf(state, scene.id).find((x) => x.id === attacker.id)?.multiattack ?? 1 : attacksPerAction(await sheetOf(ctx, attacker.tokenId)) });
  if (pre) return { status: 409, body: { error: pre } };
  const mod = (n: number) => Math.floor((n - 10) / 2);
  const athletics = async (s: Side) => s.kind === 'pc' ? pcAthletics(await sheetOf(ctx, s.tokenId)) : (() => { const e = enemiesOf(state, scene.id).find((x) => x.id === s.id); return e?.abilities ? mod(e.abilities.str) : 0; })();
  const defence = async (s: Side) => s.kind === 'pc' ? Math.max(pcAthletics(await sheetOf(ctx, s.tokenId)), pcAcrobatics(await sheetOf(ctx, s.tokenId))) : (() => { const e = enemiesOf(state, scene.id).find((x) => x.id === s.id); return e?.abilities ? Math.max(mod(e.abilities.str), mod(e.abilities.dex)) : 0; })();
  const ab = await athletics(attacker), db = await defence(target);
  // an incapacitated creature can't resist: the shove succeeds
  const ra = die(20), rd = incapacitated(state, scene.id, actorOf(target)) ? 0 : die(20);
  const won = ra + ab >= rd + db || rd === 0;
  let text = `${a.name} shoves ${t.name} (${mode === 'prone' ? 'knock prone' : 'push 5 ft'}): Athletics d20 ${ra} ${ab >= 0 ? '+' : '−'} ${Math.abs(ab)} = ${ra + ab} vs ${rd === 0 ? 'incapacitated' : `d20 ${rd} ${db >= 0 ? '+' : '−'} ${Math.abs(db)} = ${rd + db}`} → ${won ? 'success' : 'fails'}.`;
  // where a push goes: one hex straight away from the attacker
  let dest: { x: number; y: number } | null = null, fallFt = 0;
  if (won && mode === 'push') {
    const ha = hexAt(map, a), ht = hexAt(map, t);
    const to = { q: 2 * ht.q - ha.q, r: 2 * ht.r - ha.r };
    const tile = tileLookup(map)(hexKey(to));
    const altT = altitudeOf(state, scene.id, actorOf(target));
    const occupied = figures.some((f) => !f.down && hexKeyAt(map, f) === hexKey(to) && (f.z ?? 0) - groundFt(map)(f) === altT);
    if (!tile || tile.id === 'wall' || tile.id === 'cavewall' || occupied || (distance(ha, to) !== 2)) text += ` ${t.name} can't be pushed there (blocked) – it stays put.`;
    else {
      dest = hexCentre(map, to);
      const h = heightLookup(map);
      const drop = (h(hexKey(ht)) - h(hexKey(to))) * 5 + (tile.id === 'pit' ? 20 : 0);
      if (altT === 0 && drop >= 10) fallFt = drop;
      text += ` ${t.name} is pushed 5 ft${fallFt ? ` – over the edge!` : '.'}`;
    }
  }
  const res = await mutate(user, repo, (s) => {
    let st = structuredClone(s);
    const e = st.sceneEncounters?.[scene.id];
    const err = useEconomy(e?.status === 'active' ? e : null, actorOf(attacker), 'attack', { gm: user.role === 'gm', attacksAllowed: 99 });
    if (err) return { ok: false, error: err };
    if (won && mode === 'prone' && !effectsOf(st, scene.id, actorOf(target)).some((x) => x.key === 'prone')) addEffect(st, scene.id, actorOf(target), conditionEffect('prone', { actor: actorOf(attacker), name: a.name }, () => `fx-${crypto.randomUUID().slice(0, 8)}`));
    if (dest && target.kind === 'npc') { const u = updateEnemy(st, scene.id, target.id, dest); if (u.ok) st = u.state; }
    reveal(st, scene.id, actorOf(attacker));
    pushFx(st, scene.id, [{ kind: won ? 'debuff' : 'miss', from: actorOf(attacker), to: actorOf(target), label: won ? (mode === 'prone' ? 'Prone' : 'Shoved') : 'Shove', element: 'physical' }]);
    if (e?.status === 'active') e.version++;
    logCombat(st, scene.id, text);
    return { ok: true, state: st, message: text };
  });
  if (res.status !== 200) return res;
  if (dest && target.kind === 'pc') await placePc(user, repo, scene.id, target.tokenId, dest);
  if (fallFt) { const f = await fallDamage(user, repo, scene.id, target, fallFt, 'pushed over the edge'); (res.body as { message?: string }).message = `${text} ${f}`; }
  return res;
}

/** Falls of creatures that can't stay in the air (state step inside a write; characters' damage is applied after). */
function applyFalls(state: GameState): Array<{ sceneId: string; tokenId?: string; damage: number; text: string }> {
  const out: Array<{ sceneId: string; tokenId?: string; damage: number; text: string }> = [];
  for (const sceneId of Object.keys(state.sceneAltitude ?? {})) {
    for (const f of pendingFalls(state, sceneId)) {
      const dice = fallDice(f.ft);
      const rolled = dice ? rollDice(parseDamage(dice)!) : { rolls: [], total: 0 };
      setAltitude(state, sceneId, f.actor, 0);
      if (!effectsOf(state, sceneId, f.actor).some((e) => e.key === 'prone')) addEffect(state, sceneId, f.actor, conditionEffect('prone', undefined, () => `fx-${crypto.randomUUID().slice(0, 8)}`));
      const name = f.actor.startsWith('pc-') ? state.tokens[f.actor.slice(3)]?.name ?? 'A character' : enemiesOf(state, sceneId).find((e) => `npc-${e.id}` === f.actor)?.name ?? 'A creature';
      const text = `${name} falls ${f.ft} ft (${f.why})${rolled.total ? `: ${rolled.total} bludgeoning damage (${dice})` : ''} and lands prone.`;
      if (f.actor.startsWith('npc-') && rolled.total) {
        const u = updateEnemy(state, sceneId, f.actor.slice(4), { hpDelta: -rolled.total });
        if (u.ok) Object.assign(state, u.state);
      }
      pushFx(state, sceneId, [{ kind: rolled.total ? 'hit' : 'debuff', to: f.actor, ...(rolled.total ? { amount: rolled.total } : {}), label: 'Fall', element: 'physical' }]);
      logCombat(state, sceneId, text);
      out.push({ sceneId, ...(f.actor.startsWith('pc-') ? { tokenId: f.actor.slice(3) } : {}), damage: rolled.total, text });
    }
  }
  return out;
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
    if (positions.length) await repo.sceneMotion.rememberVision(user.campaignId, sceneId, p.userId, [...(await visionFor(ctx, map, clock, positions.map((x) => pcs.find((q) => q.tokenId === x.tokenId) ?? x), ctx.state ? carriedLights(ctx.state, sceneId, pcs) : [], sceneId))]);
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
    const res = await mutate(user, repo, (s) => {
      const r = endTurn(s, sceneId, v.encounterId as string, v.turnSerial as number, controls, user.role === 'gm' && !only && v.force !== false, only);
      if (r.ok && (activeEncounter(r.state, sceneId)?.turnSerial ?? 0) !== (activeEncounter(s, sceneId)?.turnSerial ?? 0)) turnStartNpcs(r.state, sceneId);
      return r;
    });
    if (res.status === 200) await turnStartSheets(user, repo, sceneId, v.turnSerial as number);
    return res;
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
  if (v.action === 'shove') return shoveRequest(user, repo, scene, v);
  if (v.action === 'strike') {
    const attacker = sideOf(v.attacker), target = sideOf(v.target);
    if (!attacker || !target || (v.attackIndex !== undefined && !Number.isSafeInteger(v.attackIndex))) return { status: 400, body: { error: 'Invalid attack.' } };
    return strikeRequest(user, repo, scene, attacker, target, v.attackIndex as number | undefined, v.bonus === true, v.adv, Number.isSafeInteger(v.smite) ? (v.smite as number) : undefined, false, v.sneak === false ? false : undefined);
  }
  if (v.action === 'standard') return standardRequest(user, repo, scene, v);
  if (v.action === 'cast') return castRequest(user, repo, scene, v);
  if (v.action === 'reaction') return reactionRequest(user, repo, scene, v);
  if (v.action === 'feature') return featureRequest(user, repo, scene, v);
  if (v.action === 'hide') return hideRequest(user, repo, scene, v);
  if (v.action === 'partySneak') {
    // GM: the whole party sneaks (everyone rolls Stealth) or stops sneaking
    if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM starts a party sneak.' } };
    const map = parseMap(scene.published_metadata);
    const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId };
    if (!map?.hex || !ctx.state) return { status: 400, body: { error: 'Needs a battle map.' } };
    const pcs = (await battleFigures(ctx, sceneId, map)).filter((f) => f.kind === 'pc' && !f.down);
    const rolls: Array<{ actor: string; name: string; total: number }> = [];
    if (v.on === true) for (const f of pcs) { const b = pcStealth(await sheetOf(ctx, f.id)); const d = die(20); rolls.push({ actor: pcActor(f.id), name: f.name, total: d + b }); }
    return mutate(user, repo, (s) => {
      const st = structuredClone(s);
      for (const f of pcs) reveal(st, sceneId, pcActor(f.id));
      for (const r of rolls) addEffect(st, sceneId, r.actor, hiddenEffect(r.total, () => `fx-${crypto.randomUUID().slice(0, 8)}`));
      const text = v.on === true ? `The party sneaks: ${rolls.map((r) => `${r.name} Stealth ${r.total}`).join(', ')}.` : 'The party stops sneaking.';
      logCombat(st, sceneId, text);
      return { ok: true, state: st, message: text };
    });
  }
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
    let lostMax = 0;
    const res = await mutate(user, repo, (s) => {
      const st = structuredClone(s);
      const name = nameOf(st, sceneId, who);
      lostMax = 0;
      if (v.add === true && cond) { addEffect(st, sceneId, actor, conditionEffect(cond, undefined, () => `fx-${crypto.randomUUID().slice(0, 8)}`)); logCombat(st, sceneId, `${name} is ${cond}.`); return { ok: true, state: st, message: `${name}: ${cond}.` }; }
      const list = effectsOf(st, sceneId, actor).filter((e) => (typeof v.effectId === 'string' ? e.id === v.effectId : e.key === cond));
      if (!list.length) return { ok: false, error: 'Not on this creature.' };
      for (const e of list) removeEffect(st, sceneId, actor, e.id);
      // Aid ends: the raised hit point maximum goes back down
      lostMax = list.reduce((n, e) => n + (e.mods.maxHp ?? 0), 0);
      if (lostMax && who.kind === 'npc') { const en = enemiesOf(st, sceneId).find((x) => x.id === who.id); if (en) { en.maxHp = Math.max(1, en.maxHp - lostMax); en.hp = Math.min(en.hp, en.maxHp); } }
      logCombat(st, sceneId, `${name}: ${list.map((e) => e.name).join(', ')} ends.`);
      return { ok: true, state: st, message: `${list.map((e) => e.name).join(', ')} removed.` };
    });
    if (res.status === 200 && lostMax && who.kind === 'pc') await lowerMaxHp(user, repo, who.tokenId, lostMax);
    return res;
  }
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can do that.' } };
  if (v.action === 'encounter') return encounterRequest(user, repo, scene, v);
  if (v.action === 'enemyAdd' || v.action === 'enemyMove') {
    const map = parseMap(scene.published_metadata);
    if (!map?.hex || typeof v.x !== 'number' || typeof v.y !== 'number') return { status: 400, body: { error: 'Choose a hex on a published hex map.' } };
    const h = hexAt(map, { x: v.x, y: v.y });
    const ctx = await sceneContext(repo, user.campaignId);
    // APEX 1.9: a flyer may hover over water, trees or a creature – figures only share a hex at different altitudes
    const moverAlt = v.action === 'enemyMove' && typeof v.id === 'string' && ctx.state ? (typeof v.alt === 'number' ? Math.max(0, Math.round(v.alt / 5) * 5) : altitudeOf(ctx.state, sceneId, npcActor(v.id))) : 0;
    if (!passable(map, h) && !(moverAlt > 0 && tileLookup(map)(hexKey(h))?.id !== 'wall')) return { status: 422, body: { error: 'That hex cannot hold a figure.' } };
    const at = hexCentre(map, h);
    const pcs = await ctx.pcs!(sceneId, map);
    const key = hexKeyAt(map, at);
    const altOf = (actor: string) => (ctx.state ? altitudeOf(ctx.state, sceneId, actor) : 0);
    if (pcs.some((p) => hexKeyAt(map, p) === key && altOf(pcActor(p.tokenId)) === moverAlt) || (ctx.state ? enemiesOf(ctx.state, sceneId) : []).some((e) => !e.defeated && e.id !== v.id && hexKeyAt(map, e) === key && altOf(npcActor(e.id)) === moverAlt)) return { status: 409, body: { error: 'Another figure is at that spot.' } };
    if (v.action === 'enemyAdd') {
      if (typeof v.templateId !== 'string' || !statBlock(ctx.state ?? {}, v.templateId)) return { status: 400, body: { error: 'Unknown enemy.' } };
      const id = `en-${crypto.randomUUID().slice(0, 8)}`, roll = d20();
      return mutate(user, repo, (s) => addEnemy(s, sceneId, id, v.templateId as string, at, typeof v.name === 'string' ? v.name : undefined, roll, v.side === 'ally' ? 'ally' : 'enemy'));
    }
    if (typeof v.id !== 'string') return { status: 400, body: { error: 'Invalid enemy.' } };
    return moveNpc(user, repo, scene, map, v.id, at, [], typeof v.alt === 'number' ? v.alt : undefined);
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
    const weather = WEATHERS.find((w) => w === v.weather);
    const weatherFx = Array.isArray(v.weatherFx) && v.weatherFx.every((x) => (WEATHER_FX as readonly string[]).includes(x as string)) ? [...new Set(v.weatherFx as WeatherFx[])] : undefined;
    const followTime = typeof v.followTime === 'boolean' ? v.followTime : undefined;
    if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM changes time and weather.' } };
    if (!phase && !lighting && !weather && !weatherFx && followTime === undefined && v.nextDay !== true) return { status: 400, body: { error: 'Nothing to change.' } };
    await rememberCurrentVision(user, repo, sceneId).catch(() => undefined);
    return mutate(user, repo, (s) => setClock(s, sceneId, v.expectedVersion as number, { phase, lighting, nextDay: v.nextDay === true, weather, weatherFx, followTime }));
  }
  if (v.action === 'time') {
    // APEX 2.5 – campaign time (dial, real time, skip to dawn), season and snow – GM only
    if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM changes the time.' } };
    const c = parseWorldTimeChange(v);
    if (typeof c === 'string') return { status: 400, body: { error: c } };
    await rememberCurrentVision(user, repo, sceneId).catch(() => undefined);
    return mutate(user, repo, (s) => {
      const st = structuredClone(s);
      st.worldTime = changeWorldTime(s.worldTime, c);
      const m = st.worldTime.minute;
      const text = c.skipTo !== undefined ? `Time skips to day ${dayOf(m)}, ${clockText(m)}.` : c.season ? `Season: ${c.season}.` : c.snow !== undefined ? `Snow: ${Math.round(c.snow * 100)} %.` : c.run !== undefined ? (c.run ? `Time runs (×${st.worldTime.rate ?? 1}).` : `Time stops at ${clockText(m)}.`) : `Time: day ${dayOf(m)}, ${clockText(m)}.`;
      return { ok: true, state: st, message: text };
    });
  }
  return { status: 400, body: { error: 'Invalid scene action.' } };
}

const die = (sides: number) => (crypto.getRandomValues(new Uint32Array(1))[0] % Math.max(1, sides)) + 1;
const inReach = (map: SceneMap, from: { x: number; y: number; z?: number }, to: { x: number; y: number; z?: number }, reachFt: number, rangeFt?: number) => {
  const d = feetBetween(map)(from, to);
  const sight = sightRules(map);
  const ground = groundFt(map);
  // flying creatures look from (and are seen at) their altitude
  const eye = { a: ((from.z ?? ground(from)) - ground(from)) / 5, b: ((to.z ?? ground(to)) - ground(to)) / 5 };
  return { ok: d <= (rangeFt ?? reachFt) && lineOfSight(hexAt(map, from), hexAt(map, to), sight.blocks, sight.height, eye), distanceFt: d };
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
  const ground = groundFt(map);
  const out: Figure[] = pcs.map((p) => ({ kind: 'pc', id: p.tokenId, name: state.tokens[p.tokenId]?.name ?? 'Character', side: 'party', x: p.x, y: p.y, z: ground(p) + altitudeOf(state, sceneId, pcActor(p.tokenId)), reachFt: 5 }));
  for (const e of enemiesOf(state, sceneId)) out.push({ kind: 'npc', id: e.id, name: e.name, side: e.side === 'ally' ? 'party' : 'enemy', x: e.x, y: e.y, z: ground(e) + altitudeOf(state, sceneId, npcActor(e.id)), reachFt: npcReach(e), down: e.defeated });
  return out;
}
/**
 * Altitude for a move (APEX 1.9): the requested altitude above the destination's ground (or the current one), the
 * movement mode (flying while in the air or taking off, climbing with a climb speed) and the vertical feet it costs.
 */
export function planAltitude(map: SceneMap, from: { x: number; y: number }, to: { x: number; y: number }, current: number, wanted: number | undefined, speeds: { fly: number; climb: number }): { from: number; to: number; verticalFt: number; mode: { fly?: boolean; climb?: boolean }; verb: string } | string {
  const target = Math.max(0, Math.min(MAX_ALTITUDE_FT, Math.round((typeof wanted === 'number' && Number.isFinite(wanted) ? wanted : speeds.fly ? current : 0) / 5) * 5));
  if (target > 0 && !speeds.fly) return 'cannot fly (no flying speed).';
  const flying = speeds.fly > 0 && (current > 0 || target > 0);
  const ground = groundFt(map);
  const verticalFt = flying ? Math.abs(ground(to) + target - (ground(from) + current)) : 0;
  return { from: current, to: flying ? target : 0, verticalFt, mode: { ...(flying ? { fly: true } : {}), ...(speeds.climb ? { climb: true } : {}) }, verb: flying ? (target === 0 ? 'lands after flying' : 'flies') : 'moves' };
}

/** Ground height in feet under a point (5-ft levels). */
const groundFt = (map: SceneMap) => { const h = heightLookup(map); return (p: { x: number; y: number }) => h(hexKeyAt(map, p)) * 5; };
/** Feet between two points – 3D when they carry a height `z` (the larger of horizontal and vertical, APEX 1.9). */
const feetBetween = (map: SceneMap) => { const ground = groundFt(map); return (a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }) => distance3d(distance(hexAt(map, a), hexAt(map, b)) * 5, a.z ?? ground(a), b.z ?? ground(b)); };

/** Visual feedback of one attack roll (APEX 1.6). */
const strikeFx = (strike: Pick<Strike, 'name' | 'kind' | 'damageType' | 'reachFt'>, attacker: Side | undefined, target: string, roll: { hit: boolean; crit?: boolean; damage: number }): Omit<SceneFx, 'id' | 'at'> => ({
  kind: roll.hit ? (roll.crit ? 'crit' : 'hit') : 'miss', ...(attacker ? { from: actorOf(attacker) } : {}), to: target, ...(roll.hit ? { amount: roll.damage } : {}),
  label: strike.name, element: elementOf(`${strike.damageType ?? ''} ${strike.name}`, strike.kind === 'spell'), ranged: strike.kind === 'ranged' || strike.kind === 'spell' || strike.reachFt > 10,
});

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
  const attack = withShillelagh(combatAttacks(sheet, state.tokens[attacker.tokenId], itemRulesOf(state)), sheet, !sheet.wildShape && effectsOf(state, ctx.sceneId!, pcActor(attacker.tokenId)).some((e) => e.key === 'shillelagh'))[attackIndex ?? 0];
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

/** Effects that act at the start of a creature's turn: temporary hit points (Heroism) – NPCs in the state write. */
function turnStartNpcs(state: GameState, sceneId: string) {
  const e = activeEncounter(state, sceneId);
  if (!e) return;
  for (const id of activeActors(e)) {
    if (!id.startsWith('npc-')) continue;
    const t = effectsOf(state, sceneId, id).reduce((n, x) => Math.max(n, x.mods.tempHpTurn ?? 0), 0);
    if (t > 0) { grantEnemyTempHp(state, sceneId, id.slice(4), t); logCombat(state, sceneId, `${nameOf(state, sceneId, { kind: 'npc', id: id.slice(4) })} gains ${t} temporary hit points (Heroism).`); }
  }
}

/** …and characters on their sheets, once per new turn (after the turn changed). */
async function turnStartSheets(user: AuthUser, repo: Repo, sceneId: string, previousSerial: number) {
  const ctx = await sceneContext(repo, user.campaignId);
  const e = ctx.state ? activeEncounter(ctx.state, sceneId) : null;
  if (!ctx.state || !e || (e.turnSerial ?? 0) === previousSerial) return;
  for (const id of activeActors(e)) {
    if (!id.startsWith('pc-')) continue;
    const t = effectsOf(ctx.state, sceneId, id).reduce((n, x) => Math.max(n, x.mods.tempHpTurn ?? 0), 0);
    if (t <= 0) continue;
    const tokenId = id.slice(3);
    const row = await repo.loadSheet(user.campaignId, tokenId);
    const sheet = row ? parseStoredSheet(row.data) : null;
    if (!sheet?.hitPoints || sheet.hitPoints.temp >= t) continue;
    const r = setTempHp(sheet, 'grant', t);
    if (r.ok) await repo.saveSheet(user.campaignId, tokenId, r.sheet, row?.version ?? 0, user.id);
  }
}

/** Aid ends: the character's hit point maximum (and current HP above it) go back down. */
async function lowerMaxHp(user: AuthUser, repo: Repo, tokenId: string, by: number) {
  const row = await repo.loadSheet(user.campaignId, tokenId);
  const sheet = row ? parseStoredSheet(row.data) : null;
  if (!sheet?.hitPoints) return;
  sheet.hitPoints.max = Math.max(1, sheet.hitPoints.max - by);
  sheet.hitPoints.current = Math.min(sheet.hitPoints.current, sheet.hitPoints.max);
  await repo.saveSheet(user.campaignId, tokenId, sheet, row?.version ?? 0, user.id);
}

/** Visual: a druid pops back out of the beast form. */
async function recordFx(user: AuthUser, repo: Repo, ctx: Ctx, tokenId: string, formName: string) {
  if (!ctx.sceneId) return;
  await mutate(user, repo, (s) => { const st = structuredClone(s); pushFx(st, ctx.sceneId!, [{ kind: 'debuff', to: pcActor(tokenId), label: `${formName} → normal form`, element: 'force' }]); return { ok: true, state: st }; }).catch(() => undefined);
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
  const reverted = sheet.wildShape && !hurt.sheet.wildShape ? ` – the ${sheet.wildShape.formName} drops to 0 hit points and ${ctx.state?.tokens[tokenId]?.name ?? 'the druid'} reverts to normal form` : '';
  if (saved !== null && reverted) await recordFx(user, repo, ctx, tokenId, sheet.wildShape!.formName);
  return saved === null ? ' (the sheet changed meanwhile – apply the damage by hand)' : `${reverted} (${hurt.sheet.wildShape ? `${hurt.sheet.wildShape.formName} ${hurt.sheet.wildShape.hp}/${hurt.sheet.wildShape.maxHp}, ` : ''}${hurt.sheet.hitPoints?.current}/${hurt.sheet.hitPoints?.max} HP)`;
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
  const physical = PHYSICAL.test(strike.damageType ?? strike.name) || (!strike.damageType && strike.kind !== 'spell');
  const halve = resistsPhysical(state, sceneId, targetActor) && physical ? 'resistance' : undefined;
  if (target.kind === 'npc') {
    const e = enemiesOf(state, sceneId).find((x) => x.id === target.id && !x.defeated);
    if (!e) return 'Target not found.';
    const roll = resolveAttack(attackerName, e.name, strike.name, strike.bonus, strike.damage, effectiveAc(state, sceneId, targetActor, e.ac, e.abilities ? Math.floor((e.abilities.dex - 10) / 2) : 0), die, { ...o, halve });
    const conc = roll.hit ? await concentrationCheck(ctx, targetActor, roll.damage) : null;
    const text = roll.text + extraText + (conc?.text ?? '');
    return {
      text,
      hit: roll.hit,
      apply: (s) => {
        const r = roll.hit ? updateEnemy(s, sceneId, e.id, { hpDelta: -roll.damage }) : { ok: true as const, state: structuredClone(s) };
        const st = r.ok ? r.state : structuredClone(s);
        pushFx(st, sceneId, [strikeFx(strike, o.attacker, targetActor, roll)]);
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
  const ac = effectiveAc(state, sceneId, targetActor, targetAc(sheet, token, itemRulesOf(state)), pcAbilityMod(sheet, /^dex/i));
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
  return { text, hit: roll.hit, apply: (s) => { const st = structuredClone(s); pushFx(st, sceneId, [strikeFx(strike, o.attacker, targetActor, roll)]); if (conc?.broken) endConcentration(st, sceneId, targetActor); if (!o.quiet) logCombat(st, sceneId, text); return st; } };
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
async function strikeRequest(user: AuthUser, repo: Repo, scene: Scene, attacker: Side, target: Side, attackIndex: number | undefined, viaBonus: boolean, adv?: unknown, smite?: number, asReaction = false, sneakWanted?: boolean): Promise<SceneResult> {
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
  const pre = useEconomy(activeEncounter(structuredClone(ctx.state), scene.id), actorOf(attacker), econ, { gm: user.role === 'gm', attacksAllowed: allowed, haste: econ === 'attack' && hasted(ctx.state, scene.id, actorOf(attacker)) });
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
  // hex flanking: an ally of the attacker on the opposite side of the target (both adjacent)
  const flanking = melee && reach.distanceFt <= 5 && figures.some((f) => f !== from && f !== to && !f.down && f.side === from.side && f.reachFt >= 5 && !incapacitated(ctx.state!, scene.id, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id)) && flanks(hexAt(map, from), hexAt(map, to), hexAt(map, f)));
  const mods = attackMods(ctx.state, scene.id, {
    attacker: actorOf(attacker), target: actorOf(target), melee, distanceFt: reach.distanceFt, flanking,
    longRange: !!strike.rangeFt && reach.distanceFt > strike.rangeFt,
    hostileAdjacent: figures.some((f) => !f.down && f.side !== from.side && feetBetween(map)(f, from) <= 5 && !incapacitated(ctx.state!, scene.id, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id))),
    manual: adv === 'adv' || adv === 'dis' ? adv : undefined,
  });
  const extras = await attackExtras(ctx, map, attacker, target, strike, melee, mods, figures, sheet, smite, sneakWanted !== false);
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
    const err = useEconomy(st.sceneEncounters?.[scene.id]?.status === 'active' ? st.sceneEncounters[scene.id] : null, actorOf(attacker), econ, { gm: user.role === 'gm', attacksAllowed: allowed, haste: econ === 'attack' && hasted(st, scene.id, actorOf(attacker)) });
    if (asReaction && st.sceneReadied?.[scene.id]?.[actorOf(attacker)]) { const r = { ...st.sceneReadied[scene.id] }; delete r[actorOf(attacker)]; st.sceneReadied = { ...st.sceneReadied, [scene.id]: r }; }
    if (err) return { ok: false, error: err };
    for (const id of mods.onceUsed) removeEffect(st, scene.id, actorOf(attacker), id);
    if (reveal(st, scene.id, actorOf(attacker))) logCombat(st, scene.id, `${from.name} is no longer hidden (attacked).`);
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
  if (v.act === 'hide') return hideRequest(user, repo, scene, { actor: v.actor, viaBonus });
  // Search: an active Perception check finds hidden opponents in sight
  let search: { lines: string[]; found: string[] } | null = null;
  if (v.act === 'search') {
    const map = parseMap(scene.published_metadata);
    const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
    if (map?.hex && ctx.state) search = await searchFor(ctx, map, actor);
  }
  return mutate(user, repo, (s) => {
    let r = takeStandardAction(s, scene.id, actorOf(actor), nameOf(s, scene.id, actor), v.act as StandardAction, viaBonus, user.role === 'gm', hasted(s, scene.id, actorOf(actor)));
    if (!r.ok && search && !activeEncounter(s, scene.id)) r = { ok: true, state: structuredClone(s) }; // searching is free outside initiative
    if (r.ok && search) { for (const a of search.found) reveal(r.state, scene.id, a); r.message = search.lines.join(' '); }
    if (r.ok && r.message) logCombat(r.state, scene.id, r.message);
    return r;
  });
}

/** Hasted: one extra limited action per turn (APEX 1.6). */
const hasted = (state: GameState, sceneId: string, actor: string) => effectsOf(state, sceneId, actor).some((e) => e.key === 'haste');

const CONCENTRATION_SPELLS = new Set(['bless', 'bane', 'shield of faith', "hunter's mark", 'hex', 'hold person', 'hold monster', 'faerie fire', 'web', 'entangle', 'invisibility', 'blur', 'tasha’s hideous laughter', 'barkskin', 'haste', 'stoneskin', 'greater invisibility', 'heroism', 'divine favor', 'fly']);

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
  const aim = v.point as { x?: unknown; y?: unknown; alt?: unknown } | undefined;
  // APEX 1.9: the point may lie in the air (a Fireball's centre `alt` feet above the ground there)
  const pointAlt = aim && typeof aim.alt === 'number' && Number.isFinite(aim.alt) ? Math.max(0, Math.min(MAX_ALTITUDE_FT, Math.round(aim.alt / 5) * 5)) : 0;
  const point = aim && typeof aim.x === 'number' && typeof aim.y === 'number' ? { x: aim.x, y: aim.y, z: groundFt(map)({ x: aim.x, y: aim.y }) + pointAlt } : null;
  if (me && point && plan.rangeFt !== null && !/^self/i.test(plan.spell.range.trim()) && feetBetween(map)(me, point) > plan.rangeFt) return { status: 422, body: { error: `That point is out of range (${plan.spell.name}: ${plan.rangeFt} ft).` } };
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
  const spellMod = (nums.attack ?? 0) - (Number(/[+-]?\d+/.exec(sheet.combat.find((c) => /proficiency/i.test(c.label))?.value ?? '')?.[0]) || 2);
  const upcast = Math.max(0, (plan.slotLevel || plan.spell.level) - plan.spell.level);
  /** Numbers that depend on the caster or the slot: Heroism's temporary HP, Aid's hit points. */
  const modsOf = (m: EffectMods = {}): EffectMods => ({ ...m, ...(m.tempHpTurn === -1 ? { tempHpTurn: Math.max(1, spellMod) } : {}), ...(m.maxHp ? { maxHp: m.maxHp + (def?.maxHpPerSlot ?? 0) * upcast } : {}) });
  const makeEffect = (d: NonNullable<NonNullable<typeof def>['effect']>) => (d.condition ? { ...conditionEffect(d.condition, source, () => `fx-${crypto.randomUUID().slice(0, 8)}`), name: d.name } : { id: `fx-${crypto.randomUUID().slice(0, 8)}`, name: d.mods?.maxHp ? `${d.name} (+${modsOf(d.mods).maxHp} max HP)` : d.name, key: d.key, mods: modsOf(d.mods), source, ...(d.untilStartOfCaster ? { untilStartOf: casterActor } : {}), ...(d.turns ? { turns: d.turns } : {}) });
  /** Effect with an optional saving throw for one creature. */
  const affect = async (who: Side, name: string) => {
    if (!def?.effect) return;
    if (def.save && dc !== null) {
      const b = await saveOf(ctx, who, def.save), d = die(20);
      const ok = d + b >= dc;
      lines.push(`${name}: ${def.save.toUpperCase()} save d20 ${d} ${b >= 0 ? '+' : '−'} ${Math.abs(b)} = ${d + b} vs DC ${dc} → ${ok ? 'resists' : `${def.effect.name}`}.`);
      if (ok) { steps.push((st) => { pushFx(st, scene.id, [{ kind: 'resist', from: casterActor, to: actorOf(who), label: plan.spell.name, element: elementOf(plan.spell.name, true), ranged: true }]); return st; }); return; }
    } else lines.push(`${name}: ${def.effect.name}.`);
    steps.push((st) => { pushFx(st, scene.id, [{ kind: def.targeting === 'enemy' || def.targeting === 'point' ? 'debuff' : 'buff', from: casterActor, to: actorOf(who), label: def.effect!.name, element: def.targeting === 'enemy' || def.targeting === 'point' ? elementOf(plan.spell.name, true) : 'radiant', ranged: true }]); return st; });
    const fx = makeEffect(def.effect);
    steps.push((st) => { addEffect(st, scene.id, actorOf(who), fx); return st; });
  };

  /** Buffs and support (APEX 1.5): the effect, temporary hit points, ending a condition. */
  const support = async (who: Side, name: string) => {
    const had = def?.effect ? effectsOf(ctx.state!, scene.id, actorOf(who)).some((x) => x.key === def.effect!.key) : false;
    // Aid on a creature that already has it: nothing changes (it does not stack)
    if (def?.effect && !(had && def.effect.mods?.maxHp)) await affect(who, name);
    // Aid: maximum and current hit points rise (once – a second Aid does not stack)
    const raise = def?.effect?.mods?.maxHp ? modsOf(def.effect.mods).maxHp! : 0;
    if (raise && !had) {
      if (who.kind === 'pc') {
        const trow = await repo.loadSheet(user.campaignId, who.tokenId);
        const ts = structuredClone(await sheetOf(ctx, who.tokenId));
        if (ts.hitPoints) { ts.hitPoints.max += raise; ts.hitPoints.current += raise; await repo.saveSheet(user.campaignId, who.tokenId, ts, trow?.version ?? 0, user.id); }
        lines.push(`${name}: hit point maximum +${raise}${ts.hitPoints ? ` (${ts.hitPoints.current}/${ts.hitPoints.max} HP)` : ''}.`);
      } else {
        lines.push(`${name}: hit point maximum +${raise}.`);
        steps.push((st) => { const en = enemiesOf(st, scene.id).find((x) => x.id === who.id); if (en) { en.maxHp += raise; en.hp += raise; } return st; });
      }
    } else if (raise) lines.push(`(${name} already has ${def!.effect!.name} – it does not stack.)`);
    if (def?.tempHp) {
      const base = def.tempHp.amount === 'mod' ? Math.max(1, spellMod) : (() => { const d = parseDamage(def.tempHp!.amount); return d ? rollDice(d).total : Number(def.tempHp!.amount) || 0; })();
      const amount = base + (def.tempHp.perSlot ?? 0) * Math.max(0, (plan.slotLevel || plan.spell.level) - plan.spell.level);
      if (who.kind === 'pc') {
        const trow = await repo.loadSheet(user.campaignId, who.tokenId);
        const ts = await sheetOf(ctx, who.tokenId);
        const r = setTempHp(ts, 'grant', amount);
        if (r.ok) await repo.saveSheet(user.campaignId, who.tokenId, r.sheet, trow?.version ?? 0, user.id);
        steps.push((st) => { pushFx(st, scene.id, [{ kind: 'buff', from: casterActor, to: actorOf(who), amount, label: 'temp HP', element: 'force', ranged: true }]); return st; });
      lines.push(`${name} gains ${amount} temporary hit points${r.ok ? ` (temporary HP ${r.sheet.hitPoints?.temp})` : ' (apply by hand)'}.`);
      } else { lines.push(`${name} gains ${amount} temporary hit points.`); steps.push((st) => { grantEnemyTempHp(st, scene.id, who.id, amount); return st; }); }
    }
    if (def?.removes) {
      const actor = actorOf(who);
      const found = effectsOf(ctx.state!, scene.id, actor).find((x) => (def.removes as string[]).includes(x.key));
      if (found) { lines.push(`${name} is no longer ${found.key}.`); steps.push((st) => { removeEffect(st, scene.id, actor, found.id); return st; }); }
      else lines.push(`${name}: no condition this spell ends (${def.removes.join(', ')}).`);
    }
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
        steps.push((st) => { pushFx(st, scene.id, [{ kind: 'hit', from: casterActor, to: actorOf(t), amount: r.total, label: plan.spell.name, element: elementOf(`${def.projectiles!.damage} ${plan.spell.name}`, true), ranged: true }]); return st; });
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
        steps.push((st) => { pushFx(st, scene.id, [{ kind: 'heal', from: casterActor, to: actorOf(t), amount, label: plan.spell.name, element: 'heal', ranged: true }]); return st; });
        lines.push(`${tname} regains ${amount} hit points${healed?.ok ? ` (${healed.sheet.hitPoints?.current}/${healed.sheet.hitPoints?.max} HP)` : ''}.`);
      } else {
        lines.push(`${tname} regains ${amount} hit points.`);
        steps.push((st) => { pushFx(st, scene.id, [{ kind: 'heal', from: casterActor, to: actorOf(t), amount, label: plan.spell.name, element: 'heal', ranged: true }]); return st; });
        steps.push((st) => { const u = updateEnemy(st, scene.id, t.id, { hpDelta: amount }); return u.ok ? u.state : st; });
      }
    }
  } else if (def && def.targeting === 'self' && (def.effect || def.tempHp || def.removes)) {
    await support(caster, casterName);
  } else if (def?.effect && def.targeting === 'point' && area && point && me) {
    const keys = new Set(areaHexes(map, me, point, area));
    const inside = figures.filter((f) => !f.down && keys.has(hexKeyAt(map, f)));
    lines.push(`${area.sizeFt}-ft ${area.shape}: ${inside.length ? inside.map((f) => f.name).join(', ') : 'nobody inside'}.`);
    for (const f of inside) await affect(f.kind === 'pc' ? { kind: 'pc', tokenId: f.id } : { kind: 'npc', id: f.id }, f.name);
  } else if (def && (def.targeting === 'ally' || def.targeting === 'enemy') && (def.effect || def.tempHp || def.removes)) {
    if (!targets.length) return { status: 422, body: { error: `Choose ${count > 1 ? `up to ${count} targets` : 'a target'} for ${plan.spell.name}.` } };
    for (const t of targets) await (def.targeting === 'ally' ? support(t, positionOf(figures, t)!.name) : affect(t, positionOf(figures, t)!.name));
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
    if (!plan.reaction && reveal(st, scene.id, casterActor)) lines.push(`${casterName} is no longer hidden.`);
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
export async function moveNpc(user: AuthUser, repo: Repo, scene: Scene, map: SceneMap, npcId: string, at: { x: number; y: number }, declined: string[] = [], alt?: number): Promise<SceneResult> {
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  const state = ctx.state;
  const npc = state ? enemiesOf(state, scene.id).find((e) => e.id === npcId) : undefined;
  if (!state || !npc || npc.defeated) return { status: 404, body: { error: 'Creature not found.' } };
  const e = activeEncounter(state, scene.id);
  const actor = npcActor(npc.id);
  if (e && !isActiveActor(e, actor)) return { status: 409, body: { error: `Wait for ${npc.name}'s turn – only the creature whose turn it is can move.` } };
  if (pausedMoveOf(state, scene.id, { kind: 'npc', id: npc.id }) && !declined.length) return { status: 409, body: { error: 'Decide the opportunity attack first.' } };
  // APEX 1.9: flying (altitude) and climbing
  const speeds = npcSpeeds(npc, effectsOf(state, scene.id, actor));
  const air = planAltitude(map, npc, at, altitudeOf(state, scene.id, actor), alt, speeds);
  if (typeof air === 'string') return { status: 422, body: { error: `${npc.name} ${air}` } };
  const path = hexMovementCost(map, npc, at, air.mode);
  if (!path.ok) return { status: 422, body: { error: path.error } };
  const b = budgetOf(e, actor);
  if (speedZero(state, scene.id, actor)) return { status: 422, body: { error: `${npc.name} cannot move (speed 0: ${effectsOf(state, scene.id, actor).filter((x) => x.mods.speedZero).map((x) => x.name).join(', ')}).` } };
  const allowance = effectiveSpeed(state, scene.id, actor, air.mode.fly ? speeds.fly : npc.speedFt) * (b.dash ? 2 : 1);
  const total = air.mode.fly ? flightCost(path.cost, air.verticalFt) : path.cost + air.verticalFt;
  if (e && (b.moved ?? 0) + total > allowance + 1e-9) return { status: 422, body: { error: `${npc.name} has only ${Math.max(0, allowance - (b.moved ?? 0))} ft of movement left this turn${air.verticalFt ? ` (this move: ${total} ft – ${path.cost} ft across, ${air.verticalFt} ft up/down)` : ''}.` } };
  const ground = groundFt(map);
  const points = [{ x: npc.x, y: npc.y, z: ground(npc) + air.from }, ...path.steps.map((p) => ({ ...p, z: ground(p) + air.to }))];
  const stop = await planInterruption(repo, user.campaignId, scene.id, map, { kind: 'npc', id: npc.id }, points, declined);
  const dest = stop ? points[stop.stop] : path.to;
  const cost = stop ? (stop.stop === 0 ? 0 : path.steps[stop.stop - 1].cost) : total;
  const endAlt = stop && stop.stop === 0 ? air.from : air.to;
  // APEX 2.0: jumping down cliffs on the way (walking only)
  const drops = air.mode.fly || air.mode.climb ? [] : pathDrops(map, stop ? path.path.slice(0, stop.stop) : path.path, hexAt(map, npc));
  const moved = await mutate(user, repo, (s) => {
    let st = structuredClone(s);
    if (cost > 0 || !stop) {
      const r = updateEnemy(st, scene.id, npc.id, dest);
      if (!r.ok) return r;
      st = r.state;
    }
    const enc = st.sceneEncounters?.[scene.id];
    if (enc?.status === 'active') spend(enc, actor, { moved: (budgetOf(enc, actor).moved ?? 0) + cost });
    setAltitude(st, scene.id, actor, endAlt, speeds.flySource);
    if (stop) st = registerInterruption(st, scene.id, { kind: 'npc', id: npc.id }, npc.name, dest, path.to, stop.reactors, declined);
    return { ok: true, state: st, message: stop ? `${npc.name} stops – ${stop.reactors.map((r) => r.name).join(', ')} may make an opportunity attack.` : `${npc.name} ${air.verb} ${cost} ft${endAlt ? ` (${endAlt} ft above the ground)` : ''}.` };
  });
  if (moved.status === 200) for (const ft of drops) { const t = await fallDamage(user, repo, scene.id, { kind: 'npc', id: npc.id }, ft, 'jumps down a cliff'); if (t) (moved.body as { message?: string }).message = `${(moved.body as { message?: string }).message ?? ''} ${t}`; }
  return moved;
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
async function resolveArea(user: AuthUser, repo: Repo, ctx: Ctx, map: SceneMap, origin: { x: number; y: number; z?: number }, point: { x: number; y: number; z?: number }, fx: AreaEffect): Promise<{ lines: string[]; apply: (s: GameState, quiet?: boolean) => GameState }> {
  const sceneId = ctx.sceneId!;
  const state = ctx.state!;
  const keys = new Set(areaHexes(map, origin, point, fx.area));
  // APEX 1.9 – 3D: a sphere reaches as far up and down as sideways (from its centre's height); cones, cubes and lines
  // cover the area's size above their origin's height (a ground-level fire doesn't reach a creature 60 ft up)
  const ground = groundFt(map);
  const centreZ = fx.area.shape === 'sphere' && !fx.area.fromSelf ? point.z ?? ground(point) : origin.z ?? ground(origin);
  const reachUp = fx.area.sizeFt;
  const figures = (await battleFigures(ctx, sceneId, map)).filter((f) => !f.down && keys.has(hexKeyAt(map, f)) && Math.abs((f.z ?? ground(f)) - centreZ) <= reachUp);
  const dice = parseDamage(fx.damage);
  const rolled = dice ? rollDice(dice) : { rolls: [], total: 0 };
  const lines = [`${fx.source}: ${fx.name} – ${fx.area.sizeFt}-ft ${fx.area.shape}, DC ${fx.dc} ${ABILITY_NAME[fx.save]} save${rolled.total ? `, ${rolled.total} ${fx.damageType} damage (${rolled.rolls.join('+')}${dice?.mod ? `+${dice.mod}` : ''})` : ''}${fx.condition ? `, ${fx.condition} on a failure` : ''}.${figures.length ? '' : ' Nobody is in the area.'}`];
  const npcHits: Array<{ id: string; dmg: number }> = [];
  const conditionHits: Array<{ actor: string; name: string }> = [];
  const hitsFx: Array<{ actor: string; dmg: number }> = [];
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
    hitsFx.push({ actor: f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id), dmg: noDamage ? 0 : dmg });
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
      pushFx(st, sceneId, [
        { kind: 'area', ...(fx.sourceActor ? { from: fx.sourceActor } : {}), point, hexes: [...keys], sizeFt: fx.area.sizeFt, label: fx.name, element: elementOf(`${fx.damageType} ${fx.name}`, true), ranged: true },
        ...hitsFx.map((h) => ({ kind: (h.dmg > 0 ? 'hit' : 'resist') as SceneFx['kind'], to: h.actor, ...(h.dmg > 0 ? { amount: h.dmg } : {}), element: elementOf(`${fx.damageType} ${fx.name}`, true) })),
      ]);
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
  const raw = v.point as { x: number; y: number; alt?: unknown };
  const point = { x: raw.x, y: raw.y, z: groundFt(map)(raw) + (typeof raw.alt === 'number' && Number.isFinite(raw.alt) ? Math.max(0, Math.min(MAX_ALTITUDE_FT, Math.round(raw.alt / 5) * 5)) : 0) };
  const npcAt = { x: npc.x, y: npc.y, z: groundFt(map)(npc) + altitudeOf(ctx.state!, scene.id, npcActor(npc.id)) };
  if (area.rangeFt && feetBetween(map)(npcAt, point) > area.rangeFt) return { status: 422, body: { error: `Out of range (${area.rangeFt} ft).` } };
  const pre = useEconomy(activeEncounter(structuredClone(ctx.state!), scene.id), npcActor(npc.id), 'action', { gm: true });
  if (pre) return { status: 409, body: { error: pre } };
  const r = await resolveArea(user, repo, ctx, map, npcAt, point, { name: area.name, area: { shape: area.shape, sizeFt: area.sizeFt }, save: area.save, dc: area.dc, damage: area.damage, damageType: area.damageType, source: npc.name, condition: area.condition, sourceActor: npcActor(npc.id) });
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
    const landed = !shielded || hit.natural20 || hit.total >= hit.ac + 5;
    const by = `${hit.attacker.kind === 'pc' ? 'pc' : 'npc'}-${hit.attacker.id}`;
    pushFx(st, scene.id, [
      ...(shielded ? [{ kind: 'buff' as const, to: actor, label: 'Shield', element: 'force' as const }] : []),
      { kind: landed ? (hit.crit ? 'crit' : 'hit') : 'miss', from: by, to: actor, ...(landed ? { amount: hit.damage } : {}), element: 'physical' },
    ]);
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
        steps.push((st) => pushFx(st, scene.id, [{ kind: 'heal', to: actor, amount: r.total, label: 'Second Wind', element: 'heal' }]));
        text = `${name} uses Second Wind: +${r.total} HP (${r.rolls[0]}+${fighter})${healed?.ok ? ` → ${healed.sheet.hitPoints?.current}/${healed.sheet.hitPoints?.max}` : ''}.`;
      }
      break;
    }
    case 'rage': {
      next = spendUse(sheet, info);
      steps.push((st) => pushFx(st, scene.id, [{ kind: 'buff', to: actor, label: 'Rage', element: 'fire' }]));
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
        steps.push((st) => pushFx(st, scene.id, [{ kind: 'heal', from: actor, to: actorOf(target), amount, label: 'Lay on Hands', element: 'heal' }]));
        text = `${name} lays hands on ${to.name}: +${amount} HP.`;
      } else {
        if (target.kind === 'pc' && target.tokenId === v.tokenId) return { status: 422, body: { error: 'Bardic Inspiration goes to another creature.' } };
        next = spendUse(sheet, info);
        const d = inspirationDie(bard);
        steps.push((st) => pushFx(st, scene.id, [{ kind: 'buff', from: actor, to: actorOf(target), label: 'Inspired', element: 'radiant', ranged: true }]));
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

/**
 * Hide (Stealth): in initiative it takes the action (or the bonus action with Cunning Action / Nimble Escape);
 * outside initiative it is free. `off` stops sneaking. Opponents notice a hidden creature when their passive
 * Perception reaches the Stealth total (vision is filtered on the server) or when they Search.
 */
async function hideRequest(user: AuthUser, repo: Repo, scene: Scene, v: Record<string, unknown>): Promise<SceneResult> {
  const who = sideOf(v.actor);
  if (!who) return { status: 400, body: { error: 'Invalid creature.' } };
  if (!controls(user, who)) return { status: 403, body: { error: 'This is not your character.' } };
  if (!(await playerInScene(user, repo, scene.id))) return { status: 409, body: { error: 'You are not in this scene.' } };
  const ctx = { ...(await sceneContext(repo, user.campaignId)), sceneId: scene.id };
  if (!ctx.state) return { status: 409, body: { error: 'Campaign unavailable.' } };
  const actor = actorOf(who);
  const name = nameOf(ctx.state, scene.id, who);
  if (v.off === true) return mutate(user, repo, (s) => { const st = structuredClone(s); reveal(st, scene.id, actor); logCombat(st, scene.id, `${name} stops sneaking.`); return { ok: true, state: st, message: `${name} stops sneaking.` }; });
  let bonus = 0;
  let cunning = false;
  if (who.kind === 'pc') { const sh = await sheetOf(ctx, who.tokenId); bonus = pcStealth(sh); cunning = sh.abilities.some((a) => /cunning action/i.test(a.name)); }
  else { const e = enemiesOf(ctx.state, scene.id).find((x) => x.id === who.id); if (!e) return { status: 404, body: { error: 'Creature not found.' } }; bonus = npcStealth(e); cunning = /nimble escape/i.test(statBlock(ctx.state, e.templateId)?.traits.map((t) => t.name).join(' ') ?? ''); }
  const viaBonus = v.viaBonus === true;
  if (viaBonus && !cunning && user.role !== 'gm') return { status: 422, body: { error: 'Hiding as a bonus action needs Cunning Action.' } };
  const d = die(20), total = d + bonus;
  return mutate(user, repo, (s) => {
    const st = structuredClone(s);
    const e = activeEncounter(st, scene.id);
    if (e) {
      const err = useEconomy(st.sceneEncounters![scene.id], actor, viaBonus ? 'bonus' : 'action', { gm: user.role === 'gm', haste: !viaBonus && hasted(st, scene.id, actor) });
      if (err) return { ok: false, error: err };
      spend(st.sceneEncounters![scene.id], actor, { last: 'hide' });
      st.sceneEncounters![scene.id].version++;
    }
    addEffect(st, scene.id, actor, hiddenEffect(total, () => `fx-${crypto.randomUUID().slice(0, 8)}`));
    const text = `${name} ${e ? 'hides' : 'sneaks'}: Stealth d20 ${d} ${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${total}.`;
    logCombat(st, scene.id, text);
    return { ok: true, state: st, message: text };
  });
}

/** Search: an active Wisdom (Perception) check against every hidden opponent in sight; found ones are revealed. */
export async function searchFor(ctx: Ctx, map: SceneMap, searcher: Side): Promise<{ lines: string[]; found: string[] }> {
  const state = ctx.state!, sceneId = ctx.sceneId!;
  const figures = await battleFigures(ctx, sceneId, map);
  const me = positionOf(figures, searcher);
  if (!me) return { lines: [], found: [] };
  let bonus = 0;
  if (searcher.kind === 'pc') bonus = pcPerception(await sheetOf(ctx, searcher.tokenId));
  else { const e = enemiesOf(state, sceneId).find((x) => x.id === searcher.id); if (e) bonus = npcPerception(state, e); }
  const d = die(20), total = d + bonus;
  const hidden = figures.filter((f) => f.side !== me.side && !f.down && hiddenOf(state, sceneId, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id)));
  const found = hidden.filter((f) => (hiddenOf(state, sceneId, f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id))!.value ?? 0) <= total && inReach(map, me, f, 600).ok);
  return { lines: [`${me.name} searches: Perception d20 ${d} ${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${total}${found.length ? ` – finds ${found.map((f) => f.name).join(', ')}` : ' – finds nothing'}.`], found: found.map((f) => (f.kind === 'pc' ? pcActor(f.id) : npcActor(f.id))) };
}
