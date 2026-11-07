import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, Repo } from '../src/server/repo';
import { emptyMap } from '../src/campaign/maps';
import { runtimeRequest, type RuntimeScene } from '../src/server/sceneRuntime';
import { assignmentLocation } from '../src/components/CampaignMapDirector';

const gm: AuthUser = {
  id: 'gm-user', campaignId: 'campaign', profileKey: 'gm', displayName: 'GM',
  role: 'gm', tokenIds: [], sessionHash: 'session', campaignName: 'Test', syncTopic: 'topic',
};
const player = {
  campaignId: 'campaign', key: 'player', displayName: 'Sinna', characterName: 'Sinna',
  role: 'player' as const, tokenIds: ['token-1'], userId: 'player-user', active: true,
};
const sceneId = '11111111-1111-4111-8111-111111111111';

describe('Map assignment locations', () => {
  const scenes = [{ id: sceneId, name: 'Forest' }];

  it('shows Sanctuary even when the GM has no scene focus', () => {
    expect(assignmentLocation({ sceneId: null }, null, scenes)).toBe('Sanctuary');
  });

  it('distinguishes focused, named other, and unavailable scenes', () => {
    expect(assignmentLocation({ sceneId }, sceneId, scenes)).toBe('here');
    expect(assignmentLocation({ sceneId }, null, scenes)).toBe('Forest');
    expect(assignmentLocation({ sceneId: '22222222-2222-4222-8222-222222222222' }, sceneId, scenes)).toBe('another scene');
  });
});

function repoFor(scenePatch: Partial<RuntimeScene> | null) {
  const map = emptyMap('region');
  map.gmNotes = 'private gm notes';
  map.nodes = [{ id: 'spawn', kind: 'spawn', x: 100, y: 100, width: 30, height: 30, label: 'Spawn', description: '', visible: false, targetScene: null }];
  const motion = { tokens: [{ tokenId: 'token-1', x: 100, y: 100, version: 4, tacticalSpent: 0, regionSpent: 0 }], round: 2, hour: 3, known: [], budgets: {} };
  const repo = {
    sceneRuntime: {
      scene: vi.fn(async () => scenePatch ? {
        id: sceneId, name: 'Forest', category: 'region', revision: 5,
        is_legacy_arena: false, is_draft: false, archived: false,
        published_metadata: map, ...scenePatch,
      } as RuntimeScene : null),
      assignments: vi.fn(async () => [{ user_id: 'player-user', scene_id: sceneId, revision: 7, spawn_x: 100, spawn_y: 100 }]),
      assignment: vi.fn(async () => null),
    },
    profiles: vi.fn(async () => [player]),
    loadState: vi.fn(async () => ({ state: { tokens: { 'token-1': {} } } })),
    sceneMotion: { snapshot: vi.fn(async () => motion) },
  } as unknown as Repo;
  return { repo, map, motion };
}

describe('GM published scene focus', () => {
  it('loads only the published map and positions for characters already assigned there', async () => {
    const { repo, map, motion } = repoFor({});
    const result = await runtimeRequest(gm, 'GET', { focus: sceneId }, undefined, repo);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: 'scene', scene: { id: sceneId, name: 'Forest', revision: 5, map }, motion });
    expect(repo.sceneMotion!.snapshot).toHaveBeenCalledWith('campaign', sceneId, 'gm-user', ['token-1']);
  });

  it.each([
    { is_draft: true },
    { archived: true },
    { is_legacy_arena: true },
  ])('does not expose an unpublished, archived, or legacy scene as live focus (%o)', async patch => {
    const { repo } = repoFor(patch);
    expect((await runtimeRequest(gm, 'GET', { focus: sceneId }, undefined, repo)).status).toBe(404);
  });

  it('rejects malformed focus identifiers before reading scene data', async () => {
    const { repo } = repoFor({});
    expect((await runtimeRequest(gm, 'GET', { focus: 'bad-id' }, undefined, repo)).status).toBe(400);
    expect(repo.sceneRuntime!.scene).not.toHaveBeenCalled();
  });

  it('does not grant a player the GM focus query path', async () => {
    const { repo } = repoFor({});
    const result = await runtimeRequest({ ...gm, ...player, role: 'player' }, 'GET', { focus: sceneId }, undefined, repo);
    expect(result.body).toMatchObject({ kind: 'sanctuary' });
    expect(repo.sceneRuntime!.scene).not.toHaveBeenCalled();
  });
});
