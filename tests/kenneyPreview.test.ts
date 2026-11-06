import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, Repo } from '../src/server/repo';
import { emptyMap } from '../src/campaign/maps';
import { kenneyPreviewRequest } from '../src/server/kenneyPreview';
import type { RuntimeScene } from '../src/server/sceneRuntime';

const sceneId = '11111111-1111-4111-8111-111111111111';
const otherSceneId = '22222222-2222-4222-8222-222222222222';
const gm: AuthUser = { id: 'gm', campaignId: 'campaign', profileKey: 'gm', displayName: 'GM', role: 'gm', tokenIds: [], sessionHash: 'session', campaignName: 'Test', syncTopic: 'topic' };
const player: AuthUser = { ...gm, id: 'player', role: 'player', tokenIds: ['token-1'] };
const signed = { assets: { ground: 'signed-ground', tree: 'signed-tree', bush: 'signed-bush' }, expiresIn: 60 };

function repoFor(patch: Partial<RuntimeScene> = {}, assignedScene = sceneId) {
  const map = emptyMap('region');
  const scene = { id: sceneId, name: 'Forest', category: 'region', revision: 2, is_legacy_arena: false, is_draft: false, archived: false, published_metadata: map, ...patch } as RuntimeScene;
  const signPreviewAssets = vi.fn(async () => signed);
  const repo = {
    kenneyPreview: { signPreviewAssets },
    sceneRuntime: {
      scene: vi.fn(async (_campaignId: string, id: string) => id === sceneId ? scene : { ...scene, id }),
      assignment: vi.fn(async () => ({ user_id: player.id, scene_id: assignedScene, revision: 1, spawn_x: 20, spawn_y: 20 })),
    },
  } as unknown as Repo;
  return { repo, signPreviewAssets };
}

describe('private Kenney preview access', () => {
  it('signs the fixed preview set for the GM on a published scene', async () => {
    const { repo, signPreviewAssets } = repoFor();
    const result = await kenneyPreviewRequest(gm, 'GET', { sceneId }, repo);
    expect(result).toEqual({ status: 200, body: signed });
    expect(signPreviewAssets).toHaveBeenCalledTimes(1);
  });

  it('allows a player only for their currently assigned published scene', async () => {
    const { repo, signPreviewAssets } = repoFor();
    expect((await kenneyPreviewRequest(player, 'GET', { sceneId }, repo)).status).toBe(200);
    expect(signPreviewAssets).toHaveBeenCalledTimes(1);
  });

  it('does not sign assets for a scene outside the player assignment', async () => {
    const { repo, signPreviewAssets } = repoFor({}, otherSceneId);
    expect((await kenneyPreviewRequest(player, 'GET', { sceneId }, repo)).status).toBe(404);
    expect(signPreviewAssets).not.toHaveBeenCalled();
  });

  it.each([{ is_draft: true }, { archived: true }, { is_legacy_arena: true }])('rejects non-live scenes before signing (%o)', async patch => {
    const { repo, signPreviewAssets } = repoFor(patch);
    expect((await kenneyPreviewRequest(gm, 'GET', { sceneId }, repo)).status).toBe(404);
    expect(signPreviewAssets).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs and non-GET requests', async () => {
    const { repo, signPreviewAssets } = repoFor();
    expect((await kenneyPreviewRequest(gm, 'GET', { sceneId: 'bad' }, repo)).status).toBe(400);
    expect((await kenneyPreviewRequest(gm, 'POST', { sceneId }, repo)).status).toBe(405);
    expect(signPreviewAssets).not.toHaveBeenCalled();
  });
});
