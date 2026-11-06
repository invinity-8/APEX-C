import { describe, expect, it, vi } from 'vitest';
import { journalMarkdown, journalRequest, parseJournal, type JournalDraft, type JournalEntry, type JournalStore } from '../src/server/journals';
import type { AuthUser } from '../src/server/repo';

const id = '00000000-0000-4000-8000-000000000001';
const user = { id, campaignId: 'campaign', role: 'player' } as AuthUser;
const draft: JournalDraft = { title: 'Personal secret', body: '# Memories\n\nText', category: 'Personal Notes', tags: ['quest'], pinned: false, sharing: 'private', scene_id: null, game_date: 'Day 3' };
const entry = { ...draft, id, owner_id: user.id, created_at: '2026-11-05T12:00:00Z', updated_at: '2026-11-05T12:00:00Z', version: 1 } as JournalEntry;
const storage = (): JournalStore => ({ list: vi.fn().mockResolvedValue([entry]), get: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(entry), remove: vi.fn().mockResolvedValue(true) });

describe('personal campaign journals', () => {
  it('validates sizes, visibility and references without trusting ownership fields', () => {
    expect(parseJournal({ ...draft, owner_id: 'victim', campaign_id: 'victim', tags: ['quest', 'quest'] })).toEqual(draft);
    for (const patch of [{ title: '' }, { title: 'a'.repeat(201) }, { body: 'a'.repeat(100001) }, { sharing: 'public' }, { tags: [12] }, { tags: ['a'.repeat(41)] }, { scene_id: 'invalid' }, { pinned: 'true' }]) expect(parseJournal({ ...draft, ...patch })).toBeNull();
  });
  it('binds reads and writes to the authenticated identity', async () => {
    const store = storage();
    const result = await journalRequest(user, 'GET', {}, null, store);
    expect(result.status).toBe(200); expect(store.list).toHaveBeenCalledWith(user, 0, false, { search:undefined, category:undefined, tag:undefined, sort:undefined });
    expect((await journalRequest(user, 'POST', {}, { action: 'save', id, version: 0, owner_id: 'victim', entry: draft }, store)).status).toBe(200);
    expect(store.save).toHaveBeenCalledWith(user, id, 0, draft);
  });
  it('reads one journal reference only through the visibility-filtered store lookup', async () => {
    const store = storage();
    vi.mocked(store.get).mockResolvedValue(entry);
    expect(await journalRequest(user, 'GET', { id }, null, store)).toEqual({ status: 200, body: { entry } });
    expect(store.get).toHaveBeenCalledWith(user, id);
    vi.mocked(store.get).mockResolvedValue(null);
    expect((await journalRequest(user, 'GET', { id }, null, store)).status).toBe(404);
    expect((await journalRequest(user, 'GET', { id: 'not-an-id' }, null, store)).status).toBe(400);
  });
  it('rejects stale saves and deletes without acknowledging success', async () => {
    const store = storage(); vi.mocked(store.save).mockResolvedValue(null); vi.mocked(store.remove).mockResolvedValue(false);
    expect((await journalRequest(user, 'POST', {}, { action: 'save', id, version: 4, entry: draft }, store)).status).toBe(409);
    expect((await journalRequest(user, 'POST', {}, { action: 'delete', id, version: 4 }, store)).status).toBe(409);
  });
  it('does not permit unvalidated scene references or malformed revisions', async () => {
    const store = storage();
    expect((await journalRequest(user, 'POST', {}, { action: 'save', id, version: 0, entry: { ...draft, scene_id: id } }, store)).status).toBe(400);
    for (const version of [-1, 1.5, '0', null]) expect((await journalRequest(user, 'POST', {}, { action: 'save', id, version, entry: draft }, store)).status).toBe(400);
    expect(store.save).not.toHaveBeenCalled();
  });
  it('exports portable text including the full body and date', () => {
    const markdown = journalMarkdown([entry]);
    expect(markdown).toContain('# Personal secret'); expect(markdown).toContain(draft.body); expect(markdown).toContain(entry.created_at); expect(markdown).toContain('#quest');
  });
});
