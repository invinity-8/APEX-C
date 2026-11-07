/**
 * /api/apex?op=scene-turn – scene time and initiative (server-authorised, version-checked).
 *   endTurn          player (own active character) or GM
 *   startInitiative  GM: everyone assigned to the battle map rolls d20 + initiative (server dice)
 *   endInitiative    GM: free movement until initiative starts again
 *   clock            GM: region day/night, next day; battle lighting
 * All changes are compare-and-swap writes of the game state; scene movement re-checks the turn
 * inside the database transaction.
 */
import { endInitiative, endTurn, initiativeBonus, joinInitiative, setClock, type InitiativeEntry } from '../game/sceneTurns.js';
import type { GameState } from '../game/types.js';
import type { AuthUser, Repo } from './repo.js';
import { sceneContext } from './sceneRuntime.js';
import { sheetOf } from './sceneLocal.js';
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
    out.push({ tokenId: id, name: token.name, roll: d20(), bonus: initiativeBonus(await sheetOf(ctx, id)) });
  }
  return out;
}

/** Called after a successful transfer to a battle map. Returns a short status line. */
export async function initiativeForArrivals(user: AuthUser, repo: Repo, sceneId: string, userIds: string[]): Promise<string | undefined> {
  const entries = await rollFor(user, repo, sceneId, userIds);
  if (!entries.length) return undefined;
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
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can do that.' } };
  if (v.action === 'startInitiative') {
    if (scene.category !== 'battle') return { status: 400, body: { error: 'Initiative runs on battle maps.' } };
    const entries = await rollFor(user, repo, sceneId);
    if (!entries.length) return { status: 409, body: { error: 'No characters are assigned to this battle map.' } };
    const encounterId = crypto.randomUUID();
    return mutate(user, repo, (s) => joinInitiative(s, sceneId, encounterId, entries));
  }
  if (v.action === 'endInitiative') return mutate(user, repo, (s) => endInitiative(s, sceneId));
  if (v.action === 'clock') {
    if (!Number.isSafeInteger(v.expectedVersion)) return { status: 400, body: { error: 'Invalid version.' } };
    const phase = v.phase === 'day' || v.phase === 'night' ? v.phase : undefined;
    const lighting = v.lighting === 'bright' || v.lighting === 'dim' || v.lighting === 'dark' ? v.lighting : undefined;
    if (!phase && !lighting && v.nextDay !== true) return { status: 400, body: { error: 'Nothing to change.' } };
    return mutate(user, repo, (s) => setClock(s, sceneId, v.expectedVersion as number, { phase, lighting, nextDay: v.nextDay === true }));
  }
  return { status: 400, body: { error: 'Invalid scene action.' } };
}
