import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { ANNOUNCEMENT_TTL_MS, addAnnouncement, announcementDeliverable, announcementExpiry } from '../src/game/events';
import { buildPlayerView } from '../src/game/visibility';

describe('announcement expiry (APEX 0.7)', () => {
  it('broadcasts carry a server expiry 60 minutes after creation', () => {
    const s = createDemoState({ radius: 6, seed: 1 });
    const now = new Date('2026-11-04T10:00:00Z');
    const a = addAnnouncement(s, { category: 'general', title: 'Hear ye', text: '' }, now);
    expect(Date.parse(a.expiresAt!) - now.getTime()).toBe(ANNOUNCEMENT_TTL_MS);
    expect(announcementDeliverable(a, now.getTime() + 59 * 60_000)).toBe(true);
    expect(announcementDeliverable(a, now.getTime() + 90 * 60_000)).toBe(false); // offline for 90 minutes → no popup
  });

  it('legacy announcements without expiry use createdAt + 60 minutes; garbage never pops up', () => {
    const t = Date.parse('2026-11-04T10:00:00Z');
    expect(announcementExpiry({ createdAt: '2026-11-04T10:00:00Z' })).toBe(t + ANNOUNCEMENT_TTL_MS);
    expect(announcementDeliverable({ createdAt: 'not a date' }, t)).toBe(false);
  });

  it('player views keep the history (for the GM log / notifications) and carry the server time', () => {
    const s = createDemoState({ radius: 6, seed: 1 });
    addAnnouncement(s, { category: 'general', title: 'Old', text: '' }, new Date(Date.now() - 3 * 3600_000));
    const v = buildPlayerView(s, 'sinna');
    expect(v.announcements.at(-1)!.title).toBe('Old');
    expect(Math.abs(Date.parse(v.serverTime) - Date.now())).toBeLessThan(5000);
  });
});
