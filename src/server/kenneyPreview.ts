import type { AuthUser, Repo } from './repo.js';
import { sceneSnapshot } from './sceneRuntime.js';
import type { SceneResult } from './scenes.js';

/** Signs only a small, fixed, CC0 Nature Isometric preview set from a private bucket. */
export async function kenneyPreviewRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, repo: Repo): Promise<SceneResult> {
  if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed.' } };
  if (!repo.sceneRuntime || !repo.kenneyPreview) return { status: 503, body: { error: 'Kenney preview unavailable.' } };
  const sceneId = query.sceneId;
  if (!sceneId || !/^[0-9a-f-]{36}$/i.test(sceneId)) return { status: 400, body: { error: 'Invalid scene.' } };

  const scene = await repo.sceneRuntime.scene(user.campaignId, sceneId);
  if (!scene || scene.is_legacy_arena || scene.is_draft || scene.archived) return { status: 404, body: { error: 'Published scene not found.' } };
  if (user.role !== 'gm') {
    const assigned = await sceneSnapshot(user, repo.sceneRuntime, repo.sceneMotion, repo.sceneTravel);
    if (assigned.kind !== 'scene' || assigned.scene?.id !== scene.id) return { status: 404, body: { error: 'Published scene not found.' } };
  }

  const signed = await repo.kenneyPreview.signPreviewAssets();
  return { status: 200, body: signed };
}
