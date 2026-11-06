import type { AuthUser, Repo } from './repo.js';
import { imageDimensions, safeDimensions } from '../campaign/images.js';
import { sceneSnapshot } from './sceneRuntime.js';
import type { SceneResult } from './scenes.js';

export interface SceneAsset { id: string; scene_id: string; audience: 'gm' | 'players'; source_path: string; thumbnail_path: string; width: number; height: number }
export interface SceneAssetStore {
  get(campaignId: string, id: string): Promise<SceneAsset | null>;
  upload(user: AuthUser, sceneId: string, audience: 'gm' | 'players', image: { bytes: Uint8Array; mime: string; width: number; height: number }, thumbnail: { bytes: Uint8Array; mime: string }): Promise<SceneAsset>;
  url(path: string): Promise<string | null>;
}
export function decodeMapImage(input: unknown, maxBytes = 2_600_000) {
  if (typeof input !== 'string' || input.length > Math.ceil(maxBytes * 4 / 3) + 100) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxBytes) return null;
  const d = imageDimensions(bytes, match[1]);
  if (!safeDimensions(d) || d.width > 4096 || d.height > 4096) return null;
  return { bytes, mime: match[1], ...d };
}
export async function assetRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sceneAssets) return { status: 503, body: { error: 'Map storage unavailable.' } };
  if (method === 'GET') {
    if (!query.id || !/^[0-9a-f-]{36}$/i.test(query.id)) return { status: 400, body: { error: 'Invalid asset.' } };
    const asset = await repo.sceneAssets.get(user.campaignId, query.id);
    if (!asset) return { status: 404, body: { error: 'Asset not found.' } };
    if (user.role !== 'gm') {
      if (asset.audience !== 'players') return { status: 404, body: { error: 'Asset not found.' } };
      const snapshot = await sceneSnapshot(user, repo.sceneRuntime);
      const inScene = snapshot.kind === 'scene' && snapshot.scene?.map.playerBackgroundAsset === asset.id;
      if (!inScene && !(await repo.sanctuary?.get(user.campaignId))?.backgrounds.some(b => b.assetId === asset.id)) return { status: 404, body: { error: 'Asset not found.' } };
    }
    const url = await repo.sceneAssets.url(query.thumbnail === '1' ? asset.thumbnail_path : asset.source_path);
    return url ? { status: 200, body: { url, expiresIn: 60 } } : { status: 503, body: { error: 'Map image temporarily unavailable.' } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can upload maps.' } };
  const v = body as Record<string, unknown> | null;
  if (!v || typeof v.sceneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.sceneId) || !['gm', 'players'].includes(v.audience as string)) return { status: 400, body: { error: 'Invalid upload destination.' } };
  const scene = await repo.sceneCatalog?.get(user.campaignId, v.sceneId);
  if (!scene || scene.is_legacy_arena || scene.archived) return { status: 404, body: { error: 'Scene unavailable for upload.' } };
  const image = decodeMapImage(v.image), thumbnail = decodeMapImage(v.thumbnail, 150_000);
  if (!image || !thumbnail || thumbnail.width > 512 || thumbnail.height > 512) return { status: 400, body: { error: 'Use a valid JPG, PNG or WebP map (processed ≤2.6 MB) and thumbnail (≤150 KB).' } };
  const asset = await repo.sceneAssets.upload(user, scene.id, v.audience as 'gm' | 'players', image, thumbnail);
  return { status: 201, body: { id: asset.id, width: asset.width, height: asset.height } };
}
