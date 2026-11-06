import type { AuthUser } from './repo.js';
import type { SceneResult } from './scenes.js';

export type JournalSharing = 'private' | 'gm' | 'party';
export interface JournalEntry {
  image_id?: string | null;
  id: string; owner_id: string; title: string; body: string; category: string;
  tags: string[]; pinned: boolean; sharing: JournalSharing; scene_id: string | null;
  game_date: string; created_at: string; updated_at: string; version: number;
}
export type JournalDraft = Pick<JournalEntry, 'title' | 'body' | 'category' | 'tags' | 'pinned' | 'sharing' | 'scene_id' | 'game_date' | 'image_id'>;
export interface JournalStore {
  list(user: AuthUser, offset: number, mine?: boolean, filters?: JournalFilters): Promise<JournalEntry[]>;
  get(user: AuthUser, id: string): Promise<JournalEntry | null>;
  save(user: AuthUser, id: string, version: number, draft: JournalDraft): Promise<JournalEntry | null>;
  remove(user: AuthUser, id: string, version: number): Promise<boolean>;
}
export interface JournalFilters { search?:string; category?:string; tag?:string; sort?:'newest'|'oldest' }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function parseJournal(value: unknown): JournalDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 200 || typeof v.body !== 'string' || v.body.length > 100_000 || typeof v.category !== 'string' || !v.category.trim() || v.category.length > 80 || typeof v.game_date !== 'string' || v.game_date.length > 120 || typeof v.pinned !== 'boolean' || !['private', 'gm', 'party'].includes(v.sharing as string) || !Array.isArray(v.tags) || v.tags.length > 20 || v.tags.some(t => typeof t !== 'string' || t.length > 40) || (v.scene_id !== null && !uuid(v.scene_id))) return null;
  if (v.image_id != null && !uuid(v.image_id)) return null;
  return { title: v.title.trim(), body: v.body, category: v.category.trim(), game_date: v.game_date, pinned: v.pinned, tags: [...new Set(v.tags as string[])], sharing: v.sharing as JournalSharing, scene_id: v.scene_id as string | null, ...(v.image_id !== undefined ? { image_id: v.image_id as string | null } : {}) };
}
export async function journalRequest(user: AuthUser, method: string, query: Record<string, string | undefined>, body: unknown, store?: JournalStore, repo?: import('./repo.js').Repo): Promise<SceneResult> {
  if (!store) return { status: 503, body: { error: 'Journal storage unavailable.' } };
  if (method === 'GET') {
    if (query.id) {
      if (!uuid(query.id)) return { status: 400, body: { error: 'Invalid entry ID.' } };
      const entry = await store.get(user, query.id);
      return entry ? { status: 200, body: { entry } } : { status: 404, body: { error: 'Journal entry not found.' } };
    }
    const offset = Number(query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return { status: 400, body: { error: 'Invalid page.' } };
    if ((query.search?.length ?? 0)>200 || (query.category?.length ?? 0)>80 || (query.tag?.length ?? 0)>40 || (query.sort && !['newest','oldest'].includes(query.sort))) return {status:400,body:{error:'Invalid journal search.'}};
    const filters:JournalFilters={ search:query.search?.trim()||undefined, category:query.category||undefined, tag:query.tag?.trim()||undefined, sort:query.sort as JournalFilters['sort'] };
    const entries = await store.list(user, offset, query.mine === '1', filters);
    return { status: 200, body: { entries, nextOffset: entries.length === 50 ? offset + 50 : null, ownerId: user.id } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  const v = body as Record<string, unknown> | null;
  if (!v || !uuid(v.id) || !Number.isSafeInteger(v.version) || (v.version as number) < 0) return { status: 400, body: { error: 'Invalid entry or revision.' } };
  if (v.action === 'delete') {
    const removed = await store.remove(user, v.id, v.version as number);
    return removed ? { status: 200, body: { deleted: true } } : { status: 409, body: { error: 'Entry changed or unavailable. Reload before deleting.' } };
  }
  if (v.action !== 'save') return { status: 400, body: { error: 'Invalid journal action.' } };
  const draft = parseJournal(v.entry);
  if (!draft) return { status: 400, body: { error: 'Invalid journal content.' } };
  if (draft.scene_id !== null) {
    const previous = await store.get(user, v.id);
    const assigned = await repo?.sceneRuntime?.assignment(user.campaignId, user.id);
    const scene = await repo?.sceneCatalog?.get(user.campaignId, draft.scene_id);
    if (!scene || scene.is_draft || (user.role !== 'gm' && assigned?.scene_id !== scene.id && !(previous?.owner_id === user.id && previous.scene_id === scene.id))) return { status: 400, body: { error: 'Scene reference is not authorized.' } };
  }
  if (draft.image_id) { const image = await repo?.journalImages?.get(user.campaignId, draft.image_id); if (!image || image.owner_id !== user.id || image.entry_id !== v.id) return { status: 400, body: { error: 'Image attachment is not owned by this entry.' } }; }
  const entry = await store.save(user, v.id, v.version as number, draft);
  return entry ? { status: 200, body: { entry } } : { status: 409, body: { error: 'Entry changed or unavailable. Reload before saving.' } };
}

export function journalMarkdown(entries: JournalEntry[], attachments: Record<string,string> = {}): string {
  return entries.map(e => `# ${e.title.replace(/[\r\n]/g, ' ')}\n\n${e.created_at} · ${e.category} · ${e.sharing}${e.game_date ? '\n\nIn-game: ' + e.game_date : ''}${e.scene_id ? '\n\nScene: ' + e.scene_id : ''}\n\n${e.tags.map(t => '#' + t).join(' ')}\n\n${e.body}\n${e.image_id ? '\n![Journal attachment](' + (attachments[e.image_id] ?? `attachments/${e.image_id}`) + ')\n' : ''}`).join('\n---\n\n');
}
