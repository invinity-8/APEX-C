import { parseMap, type SceneMap } from '../campaign/maps.js';
import type { AuthUser, Repo } from './repo.js';
import type { SceneCategory, SceneResult } from './scenes.js';

export interface SceneSnapshot {
  viewer?: { tokenId: string; name: string; color: string };
  kind: 'arena' | 'sanctuary' | 'scene'; assignmentRevision: number;
  scene?: { id: string; name: string; category: SceneCategory; revision: number; map: Omit<SceneMap, 'gmNotes'> };
  spawn?: { x: number; y: number };
  motion?: import('./sceneMotion.js').MotionSnapshot;
  travel?: import('./sceneTravel.js').TravelSnapshot;
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
  const nodes = map.nodes.filter(n => n.visible && n.kind !== 'spawn').map(({ generatedBy: _provenance, ...n }) => ({ ...n, targetScene: null }));
  const ids = new Set(nodes.map(n => n.id));
  return { ...rest, backgroundAsset: map.playerBackgroundAsset, revealBackground: false, nodes, routes: map.routes.filter(r => r.visible && ids.has(r.from) && ids.has(r.to)) };
}
export async function sceneSnapshot(user: AuthUser, runtime?: SceneRuntime, motionStore?: import('./sceneMotion.js').SceneMotion, travelStore?: import('./sceneTravel.js').SceneTravel): Promise<SceneSnapshot> {
  if (!runtime) return { kind: 'arena', assignmentRevision: 0 };
  const a = await runtime.assignment(user.campaignId, user.id);
  // The migration explicitly backfills existing memberships. Missing/new assignments are safe Sanctuary.
  if (!a) return { kind: 'sanctuary', assignmentRevision: 0 };
  if (!a.scene_id) return { kind: 'sanctuary', assignmentRevision: a.revision };
  const s = await runtime.scene(user.campaignId, a.scene_id);
  if (!s || s.archived || s.is_draft) return { kind: 'sanctuary', assignmentRevision: a.revision };
  if (s.is_legacy_arena) return { kind: 'arena', assignmentRevision: a.revision };
  const map = publicMap(s.published_metadata);
  if (!map) return { kind: 'sanctuary', assignmentRevision: a.revision };
  const motion = await motionStore?.snapshot(user.campaignId, s.id, user.id, user.tokenIds);
  if (motion) {
    const known = motion.known.filter(n => n.kind !== 'spawn').map(n => ({ ...n, targetScene: null, discoverable: false }));
    map.nodes = [...known.filter(n => !map.nodes.some(current => current.id === n.id)), ...map.nodes];
    const ids = new Set(map.nodes.map(n => n.id));
    map.routes = (parseMap(s.published_metadata)?.routes ?? []).filter(r => r.visible && ids.has(r.from) && ids.has(r.to));
  }
  const travel = s.category === 'world' ? await travelStore?.snapshot(user, s.id) : undefined;
  if (travel) { const known = new Set(map.nodes.map(n => n.id)); if (!known.has(travel.partyNode ?? '')) travel.partyNode = null; travel.proposals = travel.proposals.filter(p => known.has(p.from_node) && known.has(p.to_node)); }
  return { kind: 'scene', assignmentRevision: a.revision, scene: { id: s.id, name: s.name, category: s.category, revision: s.revision, map }, motion, travel, ...(a.spawn_x !== null && a.spawn_y !== null ? { spawn: { x: a.spawn_x, y: a.spawn_y } } : {}) };
}

export async function runtimeRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sceneRuntime) return { status: 503, body: { error: 'Scene runtime unavailable.' } };
  if (method === 'GET') {
    if (user.role !== 'gm') return { status: 200, body: await sceneSnapshot(user, repo.sceneRuntime, repo.sceneMotion, repo.sceneTravel) };
    const profiles = (await repo.profiles(user.campaignId)).filter(p => p.active && p.role === 'player');
    if (query.focus) {
      if (!/^[0-9a-f-]{36}$/i.test(query.focus)) return { status: 400, body: { error: 'Invalid focus scene.' } };
      const focus = await repo.sceneRuntime.scene(user.campaignId, query.focus);
      // GM focus always uses the published revision. A private draft cannot accidentally
      // become live to players just because the GM opens the Map page.
      if (!focus || focus.is_legacy_arena || focus.archived || focus.is_draft) return { status: 404, body: { error: 'Published scene not found.' } };
      const map = parseMap(focus.published_metadata);
      if (!map) return { status: 404, body: { error: 'Published scene is unavailable.' } };
      const [assignments, profiles, stored] = await Promise.all([
        repo.sceneRuntime.assignments(user.campaignId),
        repo.profiles(user.campaignId),
        repo.loadState(user.campaignId),
      ]);
      const assignedProfiles = profiles.filter(p => p.active && p.role === 'player' && assignments.some(a => a.user_id === p.userId && a.scene_id === focus.id));
      const tokenIds = [...new Set(assignedProfiles.flatMap(p => p.tokenIds))].filter(id => !!stored?.state.tokens[id]).slice(0, 100);
      const motion = tokenIds.length && repo.sceneMotion
        ? await repo.sceneMotion.snapshot(user.campaignId, focus.id, user.id, tokenIds)
        : undefined;
      const focusMap = { ...map, playerBackgroundAsset: map.backgroundAsset ?? map.playerBackgroundAsset };
      return { status: 200, body: {
        kind: 'scene', assignmentRevision: 0,
        scene: { id: focus.id, name: focus.name, category: focus.category, revision: focus.revision, map: focusMap },
        ...(motion ? { motion } : {}),
      } };
    }
    if (query.player) {
      const p = profiles.find(p => p.userId === query.player);
      if (!p) return { status: 404, body: { error: 'Player not found.' } };
      const snapshot = await sceneSnapshot({ ...user, id: p.userId, role: 'player', tokenIds: p.tokenIds }, repo.sceneRuntime, repo.sceneMotion, repo.sceneTravel);
      const state = await repo.loadState(user.campaignId);
      const character = state?.state.tokens[p.tokenIds[0]];
      if (character) snapshot.viewer = { tokenId: character.id, name: character.name, color: character.color };
      return { status: 200, body: snapshot };
    }
    const [assignments, members] = await Promise.all([repo.sceneRuntime.assignments(user.campaignId), repo.members(user.campaignId)]);
    // Only campaign members can be assigned (apex_assign_scene joins apex_campaign_members). A player
    // profile that never signed in is listed, but marked so the GM is not offered a transfer that must fail.
    const players = profiles.slice(0, 100).map(p => { const a = assignments.find(a => a.user_id === p.userId); return { userId: p.userId, name: p.displayName, tokenIds: p.tokenIds, sceneId: a?.scene_id ?? null, revision: a?.revision ?? 0, inheritedArena: false, joined: members.some(m => m.userId === p.userId && m.role === 'player') }; });
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
