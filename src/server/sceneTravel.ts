import type { AuthUser, Repo } from './repo.js';
import type { SceneResult } from './scenes.js';
export interface TravelRecord { id: string; proposed_by: string; from_node: string; to_node: string; route_id: string; total_hours: number; elapsed_hours: number; status: 'proposed' | 'traveling' | 'complete' | 'cancelled'; version: number; scene_revision: number }
export interface TravelSnapshot { partyNode: string | null; revision: number; proposals: TravelRecord[] }
export interface SceneTravel {
  snapshot(user: AuthUser, sceneId: string): Promise<TravelSnapshot>;
  action(user: AuthUser, sceneId: string, input: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
}
export async function travelRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sceneTravel || !repo.sceneRuntime) return { status: 503, body: { error: 'World travel unavailable.' } };
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const sceneId = method === 'GET' ? query.sceneId : input.sceneId;
  if (typeof sceneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sceneId)) return { status: 400, body: { error: 'Invalid world scene.' } };
  const scene = await repo.sceneRuntime.scene(user.campaignId, sceneId);
  if (!scene || scene.category !== 'world' || scene.archived || scene.is_draft) return { status: 404, body: { error: 'World scene unavailable.' } };
  if (user.role !== 'gm') {
    const a = await repo.sceneRuntime.assignment(user.campaignId, user.id);
    if (!a || a.scene_id !== sceneId) return { status: 404, body: { error: 'World scene unavailable.' } };
  }
  if (method === 'GET') return { status: 200, body: await repo.sceneTravel.snapshot(user, sceneId) };
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (!['locate', 'propose', 'confirm', 'progress', 'cancel'].includes(input.action as string) || typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.requestId) || !Number.isSafeInteger(input.sceneRevision)) return { status: 400, body: { error: 'Invalid travel action.' } };
  if (user.role !== 'gm' && input.action !== 'propose') return { status: 403, body: { error: 'Only the GM can confirm and progress travel.' } };
  const v: Record<string, unknown> = { action: input.action, requestId: input.requestId, sceneRevision: input.sceneRevision };
  if (input.action === 'locate' || input.action === 'propose') {
    const key = input.action === 'locate' ? 'nodeId' : 'routeId';
    if (typeof input[key] !== 'string' || !/^[\w-]{1,64}$/.test(input[key] as string) || !Number.isSafeInteger(input.partyRevision) || (input.partyRevision as number) < 0) return { status: 400, body: { error: 'Invalid location or route.' } };
    v[key] = input[key]; v.partyRevision = input.partyRevision;
    if (input.action === 'propose') { if (!Number.isSafeInteger(input.assignmentRevision) || (input.assignmentRevision as number) < 0) return { status: 400, body: { error: 'Invalid assignment revision.' } }; v.assignmentRevision = input.assignmentRevision; }
  } else {
    if (typeof input.proposalId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.proposalId) || !Number.isSafeInteger(input.version) || (input.version as number) < 1) return { status: 400, body: { error: 'Invalid proposal revision.' } };
    v.proposalId = input.proposalId; v.version = input.version;
    if (input.action === 'progress') { if (typeof input.hours !== 'number' || !Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 1e6) return { status: 400, body: { error: 'Invalid travel time.' } }; v.hours = input.hours; }
  }
  const result = await repo.sceneTravel.action(user, sceneId, v);
  return { status: result.ok ? 200 : 409, body: result };
}
