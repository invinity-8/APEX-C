import { describe, expect, it, vi } from 'vitest';
import { sceneRequest, type SceneCatalog } from '../src/server/scenes';
import type { AuthUser } from '../src/server/repo';

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
    expect(store.list).toHaveBeenCalledWith(gm.campaignId, 50);
    expect(result.body).toMatchObject({ nextOffset: 100 });
  });
});
