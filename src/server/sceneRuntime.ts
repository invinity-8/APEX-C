import { parseMap, type SceneMap } from '../campaign/maps.js';
import type { AuthUser, Repo } from './repo.js';
import type { SceneCategory, SceneResult } from './scenes.js';

export interface SceneSnapshot {
  kind: 'arena' | 'sanctuary' | 'scene'; assignmentRevision: number;
  scene?: { id: string; name: string; category: SceneCategory; revision: number; map: Omit<SceneMap, 'gmNotes'> };
  spawn?: { x: number; y: number };
}
export interface SceneAssignment { user_id: string; scene_id: string | null; revision: number; spawn_x: number | null; spawn_y: number | null }
export interface RuntimeScene { id: string; name: string; category: SceneCategory; revision: number; is_legacy_arena: boolean; is_draft: boolean; archived: boolean; published_metadata: unknown }
export interface SceneRuntime {
  assignments(campaignId: string): Promise<SceneAssignment[]>;
  assignment(campaignId: string, userId: string): Promise<SceneAssignment | null>;
  scene(campaignId: string, id: string): Promise<RuntimeScene | null>;
  transition(user: AuthUser, sceneId: string | null, targets: { userId: string; revision: number }[], requestId: string): Promise<{ ok: boolean; error?: string }>;
}
export function publicMap(value: unknown): Omit<SceneMap, 'gmNotes'> | null {
  const map = parseMap(value); if (!map) return null;
  const { gmNotes: _private, ...rest } = map;
  const nodes = map.nodes.filter(n => n.visible && n.kind !== 'spawn').map(n => ({ ...n, targetScene: null }));
  const ids = new Set(nodes.map(n => n.id));
  return { ...rest, nodes, routes: map.routes.filter(r => r.visible && ids.has(r.from) && ids.has(r.to)) };
}
export async function sceneSnapshot(user: AuthUser, runtime?: SceneRuntime): Promise<SceneSnapshot> {
  if (!runtime) return { kind: 'arena', assignmentRevision: 0 };
  const a = await runtime.assignment(user.campaignId, user.id);
  // Existing campaign memberships inherit the unchanged Arena until the GM explicitly assigns them.
  if (!a) return { kind: 'arena', assignmentRevision: 0 };
  if (!a.scene_id) return { kind: 'sanctuary', assignmentRevision: a.revision };
  const s = await runtime.scene(user.campaignId, a.scene_id);
  if (!s || s.archived || s.is_draft) return { kind: 'sanctuary', assignmentRevision: a.revision };
  if (s.is_legacy_arena) return { kind: 'arena', assignmentRevision: a.revision };
  const map = publicMap(s.published_metadata);
  if (!map) return { kind: 'sanctuary', assignmentRevision: a.revision };
  return { kind: 'scene', assignmentRevision: a.revision, scene: { id: s.id, name: s.name, category: s.category, revision: s.revision, map }, ...(a.spawn_x !== null && a.spawn_y !== null ? { spawn: { x: a.spawn_x, y: a.spawn_y } } : {}) };
}

export async function runtimeRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sceneRuntime) return { status: 503, body: { error: 'Scene runtime unavailable.' } };
  if (method === 'GET') {
    if (user.role !== 'gm') return { status: 200, body: await sceneSnapshot(user, repo.sceneRuntime) };
    const profiles = (await repo.profiles(user.campaignId)).filter(p => p.active && p.role === 'player');
    if (query.player) {
      const p = profiles.find(p => p.userId === query.player);
      if (!p) return { status: 404, body: { error: 'Player not found.' } };
      return { status: 200, body: await sceneSnapshot({ ...user, id: p.userId, role: 'player', tokenIds: p.tokenIds }, repo.sceneRuntime) };
    }
    const assignments = await repo.sceneRuntime.assignments(user.campaignId);
    const players = profiles.slice(0, 100).map(p => { const a = assignments.find(a => a.user_id === p.userId); return { userId: p.userId, name: p.displayName, sceneId: a?.scene_id ?? null, revision: a?.revision ?? 0, inheritedArena: !a }; });
    return { status: 200, body: { players } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can assign scenes.' } };
  const v = body as Record<string, unknown> | null;
  const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  if (!v || (v.sceneId !== null && !uuid(v.sceneId)) || !uuid(v.requestId) || !Array.isArray(v.targets) || !v.targets.length || v.targets.length > 100) return { status: 400, body: { error: 'Invalid transition.' } };
  const targets: { userId: string; revision: number }[] = [];
  for (const item of v.targets) {
    if (!item || typeof item !== 'object' || !uuid(item.userId) || !Number.isSafeInteger(item.revision) || item.revision < 0 || targets.some(t => t.userId === item.userId)) return { status: 400, body: { error: 'Invalid target revision.' } };
    targets.push({ userId: item.userId, revision: item.revision });
  }
  const result = await repo.sceneRuntime.transition(user, v.sceneId as string | null, targets, v.requestId);
  return { status: result.ok ? 200 : 409, body: result };
}
