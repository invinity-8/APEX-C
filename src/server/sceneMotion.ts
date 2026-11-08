import { parseMap, regionMilesPerHour, type MapNode } from '../campaign/maps.js';
import { movementCost, snappedPoint } from '../campaign/sceneMovement.js';
import type { AuthUser, Repo } from './repo.js';
import { carriedLights, clockFor, hexKeyAt, movementFor, sheetOf, visionFor } from './sceneLocal.js';
import { enemiesOf } from '../game/sceneCombat.js';
import { sceneContext } from './sceneRuntime.js';
import type { SceneResult } from './scenes.js';
export interface SceneTokenPosition { tokenId: string; x: number; y: number; version: number; tacticalSpent: number; regionSpent: number }
export interface MotionSnapshot { tokens: SceneTokenPosition[]; round: number; hour: number; known: MapNode[]; budgets: Record<string, { tacticalSpent: number; regionSpent: number }> }
/** Scene-local motion (schema 7): budget per scene and epoch (turn / free / day), explored hexes. */
export interface LedgerPosition { tokenId: string; x: number; y: number; version: number; epoch: string | null; spent: number }
export interface LocalMotionSnapshot { tokens: LedgerPosition[]; known: MapNode[]; seen: string[] }
export interface SceneMotion {
  snapshot(campaignId: string, sceneId: string, userId: string, tokenIds: string[]): Promise<MotionSnapshot>;
  localSnapshot(campaignId: string, sceneId: string, userId: string, tokenIds: string[]): Promise<LocalMotionSnapshot>;
  /** Merge hexes into a player's remembered view of a scene (no movement). */
  rememberVision(campaignId: string, sceneId: string, userId: string, seen: string[]): Promise<void>;
  localWrite(user: AuthUser, input: Record<string, unknown>, cost: number, allowance: number, epoch: string, discovered: MapNode[], seen: string[]): Promise<{ ok: boolean; error?: string }>;
  write(user: AuthUser, input: Record<string, unknown>, cost: number, discovered: MapNode[]): Promise<{ ok: boolean; error?: string }>;
  advance(user: AuthUser, interval: 'round' | 'hour', expected: number, requestId: string): Promise<{ ok: boolean; error?: string }>;
}
export async function motionRequest(user: AuthUser, method: string, body: unknown, repo: Repo, query: Record<string, string | undefined> = {}): Promise<SceneResult> {
  if (!repo.sceneMotion || !repo.sceneRuntime) return { status: 503, body: { error: 'Scene movement unavailable.' } };
  if (method === 'GET') {
    if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can inspect scene token placement.' } };
    if (!query.sceneId || !/^[0-9a-f-]{36}$/i.test(query.sceneId) || !query.tokenId || query.tokenId.length > 64) return { status: 400, body: { error: 'Invalid scene or token.' } };
    const s = await repo.sceneRuntime.scene(user.campaignId, query.sceneId);
    const stored = await repo.loadState(user.campaignId);
    if (!s || !stored?.state.tokens[query.tokenId]) return { status: 404, body: { error: 'Scene or token unavailable.' } };
    return { status: 200, body: await repo.sceneMotion.snapshot(user.campaignId, s.id, user.id, [query.tokenId]) };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const v = body as Record<string, unknown> | null;
  const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x);
  if (!v || !uuid(v.requestId)) return { status: 400, body: { error: 'Invalid movement request.' } };
  if (v.action === 'advance') {
    if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can advance the movement interval.' } };
    if (!['round', 'hour'].includes(v.interval as string) || !Number.isSafeInteger(v.expected) || (v.expected as number) < 0) return { status: 400, body: { error: 'Invalid interval.' } };
    const result = await repo.sceneMotion.advance(user, v.interval as 'round' | 'hour', v.expected as number, v.requestId);
    return { status: result.ok ? 200 : 409, body: result };
  }
  if (!['move', 'place'].includes(v.action as string) || !uuid(v.sceneId) || typeof v.tokenId !== 'string' || v.tokenId.length > 64 || typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isSafeInteger(v.sceneRevision) || !Number.isSafeInteger(v.assignmentRevision) || !Number.isSafeInteger(v.tokenVersion) || (v.tokenVersion as number) < 0 || !Number.isSafeInteger(v.epoch) || (v.epoch as number) < 0) return { status: 400, body: { error: 'Invalid movement coordinates or revision.' } };
  if (v.action === 'place' && user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can place tokens.' } };
  if (user.role !== 'gm' && !user.tokenIds.includes(v.tokenId)) return { status: 403, body: { error: 'This is not your character.' } };
  const [scene, state] = await Promise.all([repo.sceneRuntime.scene(user.campaignId, v.sceneId), repo.loadState(user.campaignId)]);
  const token = state?.state.tokens[v.tokenId];
  if (!token || !scene || scene.is_legacy_arena || scene.archived || scene.is_draft) return { status: 404, body: { error: 'Token or scene unavailable.' } };
  const map = parseMap(scene.published_metadata);
  if (!map || !['battle', 'region'].includes(scene.category)) return { status: 400, body: { error: 'This scene uses GM navigation or route travel.' } };
  const assignment = await repo.sceneRuntime.assignment(user.campaignId, user.id);
  if (user.role !== 'gm' && (!assignment || assignment.scene_id !== scene.id || assignment.revision !== v.assignmentRevision)) return { status: 409, body: { error: 'Scene assignment changed.' } };
  // Scene-local budgets (schema 7): per scene and per turn / free / day – nothing is shared with the Arena.
  const ctx = await sceneContext(repo, user.campaignId, state!.state);
  const local = await repo.sceneMotion.localSnapshot(user.campaignId, scene.id, user.id, [token.id]);
  const old = local.tokens.find(p => p.tokenId === token.id);
  const ownerAssignment = user.role === 'gm' ? await ownerAssignmentOf(repo, user.campaignId, token.id) : assignment;
  const pcs = ctx.pcs ? await ctx.pcs(scene.id, map) : [];
  const start = old ?? pcs.find(p => p.tokenId === token.id) ?? { x: ownerAssignment?.spawn_x ?? 0, y: ownerAssignment?.spawn_y ?? 0 };
  const to = snappedPoint(map, { x: v.x, y: v.y });
  // Two figures never share a hex (battle and region hex maps).
  if (map.hex) {
    const target = hexKeyAt(map, to);
    const occupied = pcs.some(p => p.tokenId !== token.id && hexKeyAt(map, p) === target) || enemiesOf(state!.state, scene.id).some(e => !e.defeated && hexKeyAt(map, e) === target);
    if (occupied) return { status: 409, body: { error: 'Another figure stands on that hex.' } };
  }
  const checked = movementCost(map, v.action === 'place' ? to : start, to);
  if (!checked.ok) return { status: 422, body: { error: checked.error } };
  const category = scene.category as 'battle' | 'region';
  const mv = movementFor(state!.state, scene.id, category, token.id, user.role === 'gm', await sheetOf(ctx, token.id), local);
  if (v.action === 'move') {
    if (mv.overloaded) return { status: 422, body: { error: `${token.name} is over carrying capacity; reduce the carried load before moving.` } };
    if (!mv.canMove) return { status: 409, body: { error: mv.reason ?? 'You cannot move right now.' } };
    if (mv.spent + checked.cost > mv.allowance + 1e-9) {
      const left = Math.max(0, mv.allowance - mv.spent);
      return { status: 422, body: { error: `Only ${Math.round(left * 100) / 100} ${mv.unit} of movement left ${mv.mode === 'turn' ? 'this turn' : 'today'}.` } };
    }
  }
  // Exploration: hexes the character sees from start and destination are remembered for its player.
  const clock = clockFor(state!.state, scene.id);
  const seen = map.hex ? [...await visionFor(ctx, map, clock, [{ tokenId: token.id, ...start }, { tokenId: token.id, ...to }], carriedLights(state!.state, scene.id, pcs.map(p => (p.tokenId === token.id ? { ...p, ...to } : p))))] : [];
  const seenSet = new Set(seen);
  const observed = map.nodes.filter(n => n.kind !== 'spawn' && (n.visible || (n.discoverable && (map.hex ? seenSet.has(hexKeyAt(map, n)) : Math.hypot(n.x - to.x, n.y - to.y) <= (token.visionRadius + token.visionBonus) * map.cell)))).map(n => ({ ...n, targetScene: null, discoverable: false }));
  const input = { action: v.action, sceneId: scene.id, sceneRevision: v.sceneRevision, tokenId: token.id, tokenVersion: v.tokenVersion, assignmentRevision: v.assignmentRevision, epoch: v.epoch, x: to.x, y: to.y, requestId: v.requestId };
  const result = await repo.sceneMotion.localWrite(user, input, v.action === 'place' ? 0 : checked.cost, mv.allowance, mv.epoch, observed, seen);
  return { status: result.ok ? 200 : 409, body: { ...result, ...(result.ok ? { position: to, spent: mv.spent + (v.action === 'place' ? 0 : checked.cost), allowance: mv.allowance, hourlyMilesAtBaseSpeed: scene.category === 'region' ? regionMilesPerHour(token.speedFt ?? 30) : undefined } : {}) } };
}

async function ownerAssignmentOf(repo: Repo, campaignId: string, tokenId: string) {
  const owner = (await repo.profiles(campaignId)).find(p => p.active && p.role === 'player' && p.tokenIds.includes(tokenId));
  return owner ? repo.sceneRuntime!.assignment(campaignId, owner.userId) : null;
}
