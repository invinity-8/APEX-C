import { describe, expect, it, vi } from 'vitest';
import { sceneRequest, type SceneCatalog } from '../src/server/scenes';
import type { AuthUser } from '../src/server/repo';
import { emptyMap } from '../src/campaign/maps';
import { publicMap } from '../src/server/sceneRuntime';

const gm = { id: 'gm', role: 'gm', campaignId: 'trusted-campaign' } as AuthUser;
const player = { ...gm, role: 'player' } as AuthUser;
const catalog = (): SceneCatalog => ({ list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'draft' }), update: vi.fn().mockResolvedValue(null) });

describe('GM scene preparation boundary', () => {
  it('rejects player reads, previews and writes before any storage access', async () => {
    const store = catalog();
    for (const method of ['GET', 'POST']) {
      expect((await sceneRequest(player, method, { id: 'private-draft' }, {}, store)).status).toBe(403);
    }
    expect(store.get).not.toHaveBeenCalled(); expect(store.create).not.toHaveBeenCalled();
  });
  it('uses session campaign and whitelists creation fields for all categories', async () => {
    const store = catalog();
    for (const category of ['celestial', 'world', 'region', 'battle']) {
      expect((await sceneRequest(gm, 'POST', {}, { name: '  Map  ', category, campaign_id: 'victim', is_draft: false, is_legacy_arena: true, metadata: { secret: 'injection' } }, store)).status).toBe(201);
      expect(store.create).toHaveBeenLastCalledWith('trusted-campaign', { name: 'Map', category });
    }
  });
  it('bounds pagination and rejects malformed definitions', async () => {
    const store = catalog();
    for (const offset of ['-1', 'NaN', '1.5', '100001']) expect((await sceneRequest(gm, 'GET', { offset }, null, store)).status).toBe(400);
    for (const input of [null, [], {}, { category: 'space', name: 'Map' }, { category: 'world', name: ' ' }, { category: 'battle', name: 'a'.repeat(121) }]) expect((await sceneRequest(gm, 'POST', {}, input, store)).status).toBe(400);
    expect(store.list).not.toHaveBeenCalled(); expect(store.create).not.toHaveBeenCalled();
  });
  it('scopes preview to the caller campaign and returns 404 for inaccessible IDs', async () => {
    const store = catalog();
    const id = '00000000-0000-4000-8000-000000000001';
    expect((await sceneRequest(gm, 'GET', { id }, null, store)).status).toBe(404);
    expect(store.get).toHaveBeenCalledWith(gm.campaignId, id);
  });
  it('returns bounded library pages and continuation offsets', async () => {
    const store = catalog(); vi.mocked(store.list).mockResolvedValue(Array.from({ length: 50 }, () => ({ id: 'scene' })) as never);
    const result = await sceneRequest(gm, 'GET', { offset: '50' }, null, store);
    expect(store.list).toHaveBeenCalledWith(gm.campaignId, 50, { category:undefined, search:undefined, archived:undefined, sort:undefined });
    expect(result.body).toMatchObject({ nextOffset: 100 });
  });
  it('updates published marker visibility live while preserving other draft edits', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    const draft = emptyMap('battle');
    draft.gmNotes = 'Unsaved GM prep note';
    draft.nodes = [{ id: 'hidden-door', x: 300, y: 200, label: 'Secret door', description: 'A hidden passage', kind: 'location', visible: false, width: 60, height: 60, targetScene: null }];
    const published = { ...draft, gmNotes: 'Published GM note', nodes: draft.nodes.map(node => ({ ...node })) };
    const scene = { id, category: 'battle', name: 'Crypt', is_draft: false, is_legacy_arena: false, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', revision: 4, published_revision: 2, archived: false, metadata: draft, published_metadata: published };
    const store = catalog();
    vi.mocked(store.get).mockResolvedValue(scene as never);
    vi.mocked(store.update).mockImplementation(async (_campaign, _id, revision, patch) => ({ ...scene, ...patch, revision: revision + 1, published_revision: 3 }) as never);

    const result = await sceneRequest(gm, 'POST', {}, { action: 'set_visibility', id, revision: 4, publishedRevision: 2, nodeId: 'hidden-door', visible: true }, store);

    expect(result.status).toBe(200);
    const patch = vi.mocked(store.update).mock.calls[0][3];
    expect((patch.metadata as typeof draft).gmNotes).toBe('Unsaved GM prep note');
    expect((patch.published_metadata as typeof published).gmNotes).toBe('Published GM note');
    expect((patch.metadata as typeof draft).nodes[0].visible).toBe(true);
    expect((patch.published_metadata as typeof published).nodes[0].visible).toBe(true);
    expect(patch).not.toHaveProperty('is_draft');
    expect(patch).not.toHaveProperty('parent_scene_id');
    expect(publicMap(patch.published_metadata)?.nodes.map(node => node.id)).toContain('hidden-door');
    expect(publicMap(patch.published_metadata)).not.toHaveProperty('gmNotes');
  });
  it('rejects stale or draft-conflicting live visibility changes without writing', async () => {
    const id = '00000000-0000-4000-8000-000000000003';
    const draft = emptyMap('battle');
    draft.nodes = [{ id: 'gate', x: 100, y: 100, label: 'Gate', description: '', kind: 'area', visible: true, width: 80, height: 80, targetScene: null }];
    const published = { ...draft, nodes: draft.nodes.map(node => ({ ...node, visible: false })) };
    const scene = { id, category: 'battle', name: 'Gatehouse', is_draft: false, is_legacy_arena: false, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', revision: 4, published_revision: 2, archived: false, metadata: draft, published_metadata: published };
    const store = catalog(); vi.mocked(store.get).mockResolvedValue(scene as never);

    const stale = await sceneRequest(gm, 'POST', {}, { action: 'set_visibility', id, revision: 4, publishedRevision: 1, nodeId: 'gate', visible: true }, store);
    expect(stale.status).toBe(409);
    const conflict = await sceneRequest(gm, 'POST', {}, { action: 'set_visibility', id, revision: 4, publishedRevision: 2, nodeId: 'gate', visible: true }, store);
    expect(conflict.status).toBe(409);
    expect(store.update).not.toHaveBeenCalled();
  });
});
