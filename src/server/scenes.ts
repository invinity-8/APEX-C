/** Scene preparation is independent of the legacy Arena and character state. */
import type { AuthUser } from './repo.js';
import { emptyMap, parseMap } from '../campaign/maps.js';
import { sceneTemplate } from '../campaign/templates.js';

export const SCENE_CATEGORIES = ['celestial', 'world', 'region', 'battle'] as const;
export type SceneCategory = typeof SCENE_CATEGORIES[number];
export interface SceneSummary {
  parent_scene_id?: string | null;
  thumbnail_asset_id?: string | null;
  published_revision?: number;
  id: string;
  category: SceneCategory;
  name: string;
  is_draft: boolean;
  is_legacy_arena: boolean;
  created_at: string;
  revision: number;
  archived: boolean;
  updated_at: string;
}
export interface SceneDefinition extends SceneSummary { metadata: Record<string, unknown> }
export interface SceneCatalog {
  list(campaignId: string, offset: number, filters?:SceneFilters): Promise<SceneSummary[]>;
  get(campaignId: string, id: string): Promise<SceneDefinition | null>;
  create(campaignId: string, scene: { category: SceneCategory; name: string }): Promise<SceneDefinition>;
  update(campaignId: string, id: string, revision: number, patch: Record<string, unknown>): Promise<SceneDefinition | null>;
}
export interface SceneFilters { category?:SceneCategory; search?:string; archived?:boolean; sort?:'name'|'updated' }
export interface SceneResult { status: number; body: unknown }

/** Called only after the existing session, CSRF and schema checks. No client campaign ID is trusted. */
export async function sceneRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, catalog?: SceneCatalog, assets?: import('./sceneAssets.js').SceneAssetStore): Promise<SceneResult> {
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
    if ((query.category && !SCENE_CATEGORIES.includes(query.category as SceneCategory)) || (query.search?.length??0)>120 || (query.archived && !['0','1'].includes(query.archived)) || (query.sort && !['name','updated'].includes(query.sort))) return {status:400,body:{error:'Invalid scene filters.'}};
    const filters:SceneFilters={category:query.category as SceneCategory|undefined,search:query.search?.trim()||undefined,archived:query.archived===undefined?undefined:query.archived==='1',sort:query.sort as SceneFilters['sort']};
    const scenes = await catalog.list(user.campaignId, offset, filters);
    return { status: 200, body: { scenes, nextOffset: scenes.length === 50 ? offset + 50 : null } };
  }
  if (method === 'POST') {
    const input = body as Record<string, unknown> | null;
    if (input && typeof input === 'object' && typeof input.action === 'string') {
      if (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id) || !Number.isSafeInteger(input.revision) || (input.revision as number) < 1) return { status: 400, body: { error: 'Invalid scene or revision.' } };
      const existing = await catalog.get(user.campaignId, input.id);
      if (!existing) return { status: 404, body: { error: 'Scene not found.' } };
      if (existing.revision !== input.revision) return { status: 409, body: { error: 'Scene changed. Reload before editing.' } };
      if (input.action === 'duplicate') {
        const copy = await catalog.create(user.campaignId, { category: existing.category, name: (existing.name + ' (copy)').slice(0, 120) });
        const map = parseMap(existing.metadata) ?? emptyMap(existing.category);
        const scene = await catalog.update(user.campaignId, copy.id, copy.revision, { metadata: map });
        return { status: 201, body: { scene: scene ?? copy } };
      }
      if (existing.is_legacy_arena && input.action !== 'parent') return { status: 409, body: { error: 'The existing Arena is managed with the legacy world tools.' } };
      let patch: Record<string, unknown>;
      if (input.action === 'parent') {
        if (input.parentId === null) patch = { parent_scene_id: null };
        else {
          const parent = typeof input.parentId === 'string' ? await catalog.get(user.campaignId, input.parentId) : null;
          const expected = { world: 'celestial', region: 'world', battle: 'region', celestial: null }[existing.category];
          if (!parent || parent.id === existing.id || parent.archived || parent.category !== expected) return { status: 400, body: { error: 'Choose a celestial parent for a world, a world for a region, or a region for a battle.' } };
          patch = { parent_scene_id: parent.id };
        }
      }
      else if (input.action === 'archive') patch = { archived: true };
      else if (input.action === 'restore') patch = { archived: false };
      else if (input.action === 'rename' && typeof input.name === 'string' && input.name.trim() && input.name.trim().length <= 120) patch = { name: input.name.trim() };
      else if (input.action === 'save' || input.action === 'publish') {
        const map = parseMap(input.map);
        if (!map) return { status: 400, body: { error: 'Invalid map definition.' } };
        if(input.action==='publish') {
          const spawns=map.nodes.filter(n=>n.kind==='spawn');
          if(!spawns.length || spawns.some(s=>map.nodes.some(w=>w.kind==='wall' && s.x>=w.x && s.y>=w.y && s.x<=w.x+w.width && s.y<=w.y+w.height))) return {status:400,body:{error:'Publish at least one spawn point outside blocking walls.'}};
        }
        const expectedInterval = emptyMap(existing.category).interval;
        if (map.interval !== expectedInterval || (existing.category === 'battle' && map.unit !== 'feet') || (existing.category === 'region' && map.unit !== 'miles')) return { status: 400, body: { error: 'Movement scale does not match this scene category.' } };
        for (const [id, audience] of [[map.backgroundAsset, 'gm'], [map.playerBackgroundAsset, 'players']] as const) {
          if (id) { const asset = await assets?.get(user.campaignId, id); if (!asset || asset.audience !== audience) return { status: 400, body: { error: 'Map image is not authorized for this campaign and audience.' } }; }
        }
        patch = { metadata: map, thumbnail_asset_id: map.backgroundAsset, ...(input.action === 'publish' ? { is_draft: false, published_metadata: map, published_revision: (existing.published_revision ?? 0) + 1 } : {}) };
      } else return { status: 400, body: { error: 'Invalid scene action.' } };
      const scene = await catalog.update(user.campaignId, input.id, input.revision as number, patch);
      return scene ? { status: 200, body: { scene } } : { status: 409, body: { error: 'Scene changed. Reload before editing.' } };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 || !SCENE_CATEGORIES.includes(input.category as SceneCategory)) {
      return { status: 400, body: { error: 'Provide a name (1–120 characters) and a valid scene category.' } };
    }
    // Drafts only: this endpoint never activates a scene or changes player assignments.
    const template = typeof input.template === 'string' ? sceneTemplate(input.template, input.category as string) : null;
    if (input.template && !template) return { status: 400, body: { error: 'Template does not match the scene category.' } };
    const scene = await catalog.create(user.campaignId, { name: input.name.trim(), category: input.category as SceneCategory });
    if (template) { const saved = await catalog.update(user.campaignId, scene.id, scene.revision, { metadata: template }); return { status: 201, body: { scene: saved ?? scene } }; }
    return { status: 201, body: { scene } };
  }
  return { status: 405, body: { error: 'Method not allowed.' } };
}
