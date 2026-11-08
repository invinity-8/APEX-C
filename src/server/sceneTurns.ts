/**
 * /api/apex?op=scene-turn – scene time and initiative (server-authorised, version-checked).
 *   endTurn          player (own active character) or GM
 *   startInitiative  GM: everyone assigned to the battle map rolls d20 + initiative (server dice)
 *   endInitiative    GM: free movement until initiative starts again
 *   clock            GM: region day/night, next day; battle lighting
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
import { carriedLights, clockFor, hexKeyAt, sheetOf, visionFor } from './sceneLocal.js';
import { ENEMY_TEMPLATES, addEnemy, attackUsed, enemiesOf, logCombat, markAttack, parseBonus, parseDamage, parseRangeFt, resolveAttack, setCarriedLight, updateEnemy } from '../game/sceneCombat.js';
import { activeEncounter } from '../game/sceneTurns.js';
import { hexAt, hexCentre, passable, tileLookup } from '../campaign/hexScene.js';
import { lineOfSight } from '../campaign/hexVision.js';
import { distance } from '../game/hex.js';
import { applyDamage } from '../game/abilities.js';
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
    return mutate(user, repo, (s) => endTurn(s, sceneId, v.encounterId as string, v.turnSerial as number, controls));
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
      if (typeof v.templateId !== 'string' || !ENEMY_TEMPLATES.some((t) => t.id === v.templateId)) return { status: 400, body: { error: 'Unknown enemy.' } };
      const id = `en-${crypto.randomUUID().slice(0, 8)}`, roll = d20();
      return mutate(user, repo, (s) => addEnemy(s, sceneId, id, v.templateId as string, at, typeof v.name === 'string' ? v.name : undefined, roll));
    }
    if (typeof v.id !== 'string') return { status: 400, body: { error: 'Invalid enemy.' } };
    return mutate(user, repo, (s) => updateEnemy(s, sceneId, v.id as string, at));
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

/** A player (own turn, one attack per turn) or the GM attacks an enemy with an attack from the sheet. */
async function attackRequest(user: AuthUser, repo: Repo, scene: NonNullable<Awaited<ReturnType<NonNullable<Repo['sceneRuntime']>['scene']>>>, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.tokenId !== 'string' || typeof v.enemyId !== 'string' || !Number.isSafeInteger(v.attackIndex)) return { status: 400, body: { error: 'Invalid attack.' } };
  if (user.role !== 'gm' && !user.tokenIds.includes(v.tokenId)) return { status: 403, body: { error: 'This is not your character.' } };
  const map = parseMap(scene.published_metadata);
  if (!map?.hex || scene.category !== 'battle') return { status: 400, body: { error: 'Attacks happen on battle maps.' } };
  const ctx = await sceneContext(repo, user.campaignId);
  const state = ctx.state;
  if (!state) return { status: 409, body: { error: 'Campaign unavailable.' } };
  const enc = activeEncounter(state, scene.id);
  if (user.role !== 'gm') {
    if ((await repo.sceneRuntime!.assignment(user.campaignId, user.id))?.scene_id !== scene.id) return { status: 409, body: { error: 'You are not in this scene.' } };
    if (enc && enc.participants[enc.turnIndex]?.tokenId !== v.tokenId) return { status: 409, body: { error: 'Attack on your own turn.' } };
    if (attackUsed(state, scene.id, v.tokenId)) return { status: 409, body: { error: 'You already attacked this turn.' } };
  }
  const sheet = await sheetOf(ctx, v.tokenId);
  const attack = combatAttacks(sheet, state.tokens[v.tokenId], itemRulesOf(state))[v.attackIndex as number];
  if (!attack) return { status: 400, body: { error: 'Choose an attack from your character sheet.' } };
  const bonus = parseBonus(attack.bonus), damage = parseDamage(attack.damage);
  if (bonus === null || !damage) return { status: 422, body: { error: `“${attack.name}” has no readable attack bonus or damage (e.g. +5, 1d8+3). Resolve it by hand.` } };
  const pcs = await ctx.pcs!(scene.id, map);
  const me = pcs.find((p) => p.tokenId === v.tokenId);
  const enemy = enemiesOf(state, scene.id).find((e) => e.id === v.enemyId && !e.defeated);
  if (!me || !enemy) return { status: 404, body: { error: 'Target or attacker not on the map.' } };
  const range = parseRangeFt(`${attack.range} ${attack.notes}`);
  const reach = inReach(map, me, enemy, range.reachFt, range.rangeFt);
  if (!reach.ok) return { status: 422, body: { error: `${enemy.name} is out of reach or not in line of sight (${reach.distanceFt} ft, ${attack.name}: ${range.rangeFt ?? range.reachFt} ft).` } };
  const roll = resolveAttack(state.tokens[v.tokenId]?.name ?? 'Character', enemy.name, attack.name, bonus, damage, enemy.ac, die);
  return mutate(user, repo, (s) => {
    if (user.role !== 'gm' && attackUsed(s, scene.id, v.tokenId as string)) return { ok: false, error: 'You already attacked this turn.' };
    const r = roll.hit ? updateEnemy(s, scene.id, enemy.id, { hpDelta: -roll.damage }) : { ok: true as const, state: structuredClone(s) };
    if (!r.ok) return r;
    markAttack(r.state, scene.id, v.tokenId as string);
    const after = enemiesOf(r.state, scene.id).find((e) => e.id === enemy.id);
    logCombat(r.state, scene.id, roll.text + (after?.defeated ? ` ${enemy.name} is defeated.` : ''));
    return { ok: true, state: r.state, message: roll.text };
  });
}

/** GM: an enemy attacks a character; damage is applied to the character sheet. */
async function enemyAttackRequest(user: AuthUser, repo: Repo, scene: NonNullable<Awaited<ReturnType<NonNullable<Repo['sceneRuntime']>['scene']>>>, v: Record<string, unknown>): Promise<SceneResult> {
  if (typeof v.id !== 'string' || typeof v.tokenId !== 'string') return { status: 400, body: { error: 'Invalid attack.' } };
  const map = parseMap(scene.published_metadata);
  const ctx = await sceneContext(repo, user.campaignId);
  const enemy = ctx.state ? enemiesOf(ctx.state, scene.id).find((e) => e.id === v.id && !e.defeated) : undefined;
  if (!map?.hex || !enemy || !ctx.state?.tokens[v.tokenId]) return { status: 404, body: { error: 'Enemy or character not found.' } };
  const pcs = await ctx.pcs!(scene.id, map);
  const target = pcs.find((p) => p.tokenId === v.tokenId);
  if (!target) return { status: 404, body: { error: 'The character is not on this map.' } };
  const reach = inReach(map, enemy, target, enemy.attack.reachFt, enemy.attack.rangeFt);
  if (!reach.ok) return { status: 422, body: { error: `${ctx.state.tokens[v.tokenId].name} is out of reach (${reach.distanceFt} ft).` } };
  const row = await repo.loadSheet(user.campaignId, v.tokenId);
  const sheet = await sheetOf(ctx, v.tokenId);
  // APEX 1.0: equipment counts – the effective AC (armour pieces, shield, modifiers), not the imported number
  const ac = targetAc(sheet, ctx.state.tokens[v.tokenId], itemRulesOf(ctx.state));
  const roll = resolveAttack(enemy.name, ctx.state.tokens[v.tokenId].name, enemy.attack.name, enemy.attack.bonus, parseDamage(enemy.attack.damage)!, ac, die);
  let hpText = '';
  if (roll.hit && sheet.hitPoints) {
    const hurt = applyDamage(sheet, roll.damage);
    if (hurt.ok) {
      const saved = await repo.saveSheet(user.campaignId, v.tokenId, hurt.sheet, row?.version ?? 0, user.id);
      hpText = saved === null ? ' (the sheet changed meanwhile – apply the damage by hand)' : ` (${hurt.sheet.hitPoints?.current}/${hurt.sheet.hitPoints?.max} HP)`;
    }
  } else if (roll.hit) hpText = ' (no hit points on the sheet – apply by hand)';
  return mutate(user, repo, (s) => { const st = structuredClone(s); logCombat(st, scene.id, roll.text + hpText); return { ok: true, state: st, message: roll.text + hpText }; });
}
