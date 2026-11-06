import type { AuthUser, Repo } from './repo.js';
import type { SceneResult } from './scenes.js';
import { decodeMapImage } from './sceneAssets.js';
export interface JournalImage { id: string; entry_id: string; owner_id: string; source_path: string; thumbnail_path: string; mime: string }
export interface JournalImageStore {
  get(campaignId: string, id: string): Promise<JournalImage | null>;
  upload(user: AuthUser, entryId: string, image: NonNullable<ReturnType<typeof decodeMapImage>>, thumbnail: NonNullable<ReturnType<typeof decodeMapImage>>): Promise<JournalImage>;
  url(path: string): Promise<string | null>;
}
export async function journalImageRequest(user: AuthUser, method: string, query: Record<string,string | undefined>, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.journalImages || !repo.journalStore) return { status: 503, body: { error: 'Journal images unavailable.' } };
  if (method === 'GET') {
    if (!query.id || !/^[0-9a-f-]{36}$/i.test(query.id)) return { status: 400, body: { error: 'Invalid image.' } };
    const image = await repo.journalImages.get(user.campaignId, query.id);
    const entry = image ? await repo.journalStore.get(user, image.entry_id) : null;
    if (!image || !entry || (entry.owner_id !== user.id && entry.image_id !== image.id)) return { status: 404, body: { error: 'Image not found.' } };
    const url = await repo.journalImages.url(query.thumbnail === '1' ? image.thumbnail_path : image.source_path);
    return url ? { status: 200, body: { url, mime: image.mime, expiresIn: 60 } } : { status: 503, body: { error: 'Image temporarily unavailable.' } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const v = body as Record<string,unknown> | null;
  if (!v || typeof v.entryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.entryId)) return { status: 400, body: { error: 'Save an entry before attaching an image.' } };
  const entry = await repo.journalStore.get(user, v.entryId);
  if (!entry || entry.owner_id !== user.id) return { status: 404, body: { error: 'Entry not found.' } };
  const image = decodeMapImage(v.image), thumbnail = decodeMapImage(v.thumbnail,150_000);
  if (!image || !thumbnail || thumbnail.width > 512 || thumbnail.height > 512) return { status: 400, body: { error: 'Use a valid JPG, PNG or WebP image within the upload limits.' } };
  const uploaded = await repo.journalImages.upload(user, entry.id, image, thumbnail);
  return { status: 201, body: { id: uploaded.id } };
}
