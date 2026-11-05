/** Scene preparation is independent of the legacy Arena and character state. */
import type { AuthUser } from './repo.js';

export const SCENE_CATEGORIES = ['celestial', 'world', 'region', 'battle'] as const;
export type SceneCategory = typeof SCENE_CATEGORIES[number];
export interface SceneSummary {
  id: string;
  category: SceneCategory;
  name: string;
  is_draft: boolean;
  is_legacy_arena: boolean;
  created_at: string;
}
export interface SceneDefinition extends SceneSummary { metadata: Record<string, unknown> }
export interface SceneCatalog {
  list(campaignId: string, offset: number): Promise<SceneSummary[]>;
  get(campaignId: string, id: string): Promise<SceneDefinition | null>;
  create(campaignId: string, scene: { category: SceneCategory; name: string }): Promise<SceneDefinition>;
}
export interface SceneResult { status: number; body: unknown }

/** Called only after the existing session, CSRF and schema checks. No client campaign ID is trusted. */
export async function sceneRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, catalog?: SceneCatalog): Promise<SceneResult> {
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can prepare or preview scenes.' } };
  if (!catalog) return { status: 503, body: { error: 'Scene catalog is unavailable.' } };
  if (method === 'GET') {
    if (query.id) {
      if (!/^[0-9a-f-]{36}$/i.test(query.id)) return { status: 400, body: { error: 'Invalid scene ID.' } };
      const scene = await catalog.get(user.campaignId, query.id);
      return scene ? { status: 200, body: { scene, preview: true } } : { status: 404, body: { error: 'Scene not found.' } };
    }
    const offset = Number(query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return { status: 400, body: { error: 'Invalid page.' } };
    const scenes = await catalog.list(user.campaignId, offset);
    return { status: 200, body: { scenes, nextOffset: scenes.length === 50 ? offset + 50 : null } };
  }
  if (method === 'POST') {
    const input = body as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 || !SCENE_CATEGORIES.includes(input.category as SceneCategory)) {
      return { status: 400, body: { error: 'Provide a name (1–120 characters) and a valid scene category.' } };
    }
    // Drafts only: this endpoint never activates a scene or changes player assignments.
    const scene = await catalog.create(user.campaignId, { name: input.name.trim(), category: input.category as SceneCategory });
    return { status: 201, body: { scene } };
  }
  return { status: 405, body: { error: 'Method not allowed.' } };
}
