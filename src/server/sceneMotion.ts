import { parseMap, regionMilesPerHour, type MapNode } from '../campaign/maps.js';
import { movementCost, snappedPoint } from '../campaign/sceneMovement.js';
import { characterMovementLoad } from '../game/items/weight.js';
import { emptySheet, parseSheet } from '../game/sheet.js';
import type { AuthUser, Repo } from './repo.js';
import type { SceneResult } from './scenes.js';
export interface SceneTokenPosition { tokenId: string; x: number; y: number; version: number; tacticalSpent: number; regionSpent: number }
export interface MotionSnapshot { tokens: SceneTokenPosition[]; round: number; hour: number; known: MapNode[]; budgets: Record<string, { tacticalSpent: number; regionSpent: number }> }
export interface SceneMotion {
  snapshot(campaignId: string, sceneId: string, userId: string, tokenIds: string[]): Promise<MotionSnapshot>;
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
  const motion = await repo.sceneMotion.snapshot(user.campaignId, scene.id, user.id, [token.id]);
  const old = motion.tokens.find(p => p.tokenId === token.id);
  const start = old ?? { x: assignment?.spawn_x ?? 0, y: assignment?.spawn_y ?? 0 };
  const to = snappedPoint(map, { x: v.x, y: v.y });
  const checked = movementCost(map, v.action === 'place' ? to : start, to);
  if (!checked.ok) return { status: 422, body: { error: checked.error } };
  if (v.action === 'move') {
    const savedSheet = await repo.loadSheet(user.campaignId, token.id);
    const parsedSheet = parseSheet(savedSheet?.data ?? emptySheet());
    const movement = characterMovementLoad(state!.state, token, parsedSheet.ok ? parsedSheet.sheet : emptySheet());
    if (movement.load.state === 'over') return { status: 422, body: { error: `${token.name} is over carrying capacity; reduce the carried load before moving.` } };
    const speedFt = Math.max(0, Math.min(token.speedFt ?? 30, movement.speedFt));
    const intervalAllowance = scene.category === 'battle' ? speedFt : speedFt * 600 / 5280;
    const baseSpent = scene.category === 'battle' ? (old?.tacticalSpent ?? 0) : (old?.regionSpent ?? 0);
    const allowance = intervalAllowance / (token.sneaking ? 2 : 1);
    if (baseSpent + checked.cost > allowance + 1e-9) return { status: 422, body: { error: `Encumbrance leaves ${Math.max(0, allowance - baseSpent)} movement unit(s) in this interval.` } };
  }
  const observed = map.nodes.filter(n => n.kind !== 'spawn' && (n.visible || (n.discoverable && Math.hypot(n.x - to.x, n.y - to.y) <= (token.visionRadius + token.visionBonus) * map.cell))).map(n => ({ ...n, targetScene: null, discoverable: false }));
  const input = { action: v.action, sceneId: scene.id, sceneRevision: v.sceneRevision, tokenId: token.id, tokenVersion: v.tokenVersion, assignmentRevision: v.assignmentRevision, epoch: v.epoch, x: to.x, y: to.y, requestId: v.requestId };
  const result = await repo.sceneMotion.write(user, input, v.action === 'place' ? 0 : checked.cost, observed);
  return { status: result.ok ? 200 : 409, body: { ...result, ...(result.ok ? { position: to, hourlyMilesAtBaseSpeed: scene.category === 'region' ? regionMilesPerHour(token.speedFt ?? 30) : undefined } : {}) } };
}
