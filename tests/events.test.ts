import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { GmPayload, PlayerPayload } from '../src/server/protocol';
import { previewEvent } from '../src/game/events';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;
let gm: string;
let pl: string;
let n = 0;
const call = (method: string, op: string, body: unknown = null, query: Record<string, string> = {}, cookie?: string) =>
  handleApi({ method, op, query, body, ip: '203.0.113.40', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
const cmd = (command: unknown, cookie = gm, requestId = `req-ev-${++n}-xxxx`) => call('POST', 'command', { campaignId: CID, command, requestId }, {}, cookie);
const st = () => repo.states.get(CID)!.state;

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX' });
  seedProfiles(repo, CID);
  repo.states.set(CID, { state: createDemoState({ radius: 12, seed: 4 }), version: 1 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  gm = (await call('POST', 'login', { profile: 'gm', password: 'gm-secret-pass' })).cookies![0].split(';')[0];
  pl = (await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' })).cookies![0].split(';')[0];
});

describe('GM event approval', () => {
  it('a due event has no effect until approved; approval applies it once, also with a repeated request id', async () => {
    await cmd({ type: 'advancePhase' });
    await cmd({ type: 'advancePhase' }); // Day 2 – flood due
    const key = st().events.flood.hexes[0];
    expect(st().events.flood.status).toBe('awaiting');
    expect(st().hexes[key].terrain).not.toBe('water');
    const pv = (await call('GET', 'state', null, {}, pl)).body as PlayerPayload;
    expect(JSON.stringify(pv)).not.toMatch(/awaiting|Breach of the Aqueduct/); // players see nothing of pending GM decisions
    const r1 = await cmd({ type: 'decideEvent', eventId: 'flood', decision: 'approve' }, gm, 'req-approve-flood-1');
    expect(r1.status).toBe(200);
    const v = repo.states.get(CID)!.version;
    const r2 = await cmd({ type: 'decideEvent', eventId: 'flood', decision: 'approve' }, gm, 'req-approve-flood-1');
    expect((r2.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect(repo.states.get(CID)!.version).toBe(v);
    expect(st().hexes[key].terrain).toBe('water');
    expect((await cmd({ type: 'decideEvent', eventId: 'flood', decision: 'approve' })).status).toBe(422);
  });

  it('players cannot decide, create or trigger events, nor announce', async () => {
    for (const c of [
      { type: 'decideEvent', eventId: 'flood', decision: 'approve' },
      { type: 'triggerEvent', eventId: 'flood' },
      { type: 'createEvent', eventId: 'x1', name: 'x', description: '', hexes: [], effects: [{ type: 'modifyMovePoints', amount: 1 }], announce: false },
      { type: 'announce', category: 'general', title: 'Fake', text: '' },
    ]) {
      expect((await cmd(c, pl)).status).toBe(403);
    }
  });

  it('the GM creates a custom event; it only takes effect when triggered; preview shows the consequences', async () => {
    const r = await cmd({ type: 'createEvent', eventId: 'ev-custom-1', name: 'Magical storm', description: 'Lightning in the north.', hexes: ['0,1', '1,0', '99,99'], effects: [{ type: 'modifyMovePoints', amount: -2 }], announce: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(st().events['ev-custom-1']).toMatchObject({ status: 'pending', source: 'custom', hexes: ['0,1', '1,0'] });
    expect(st().tokens.sinna.movePoints).toBe(8);
    const p = previewEvent(st(), st().events['ev-custom-1']);
    expect(p.movePoints).toBe(-2);
    expect(p.characters).toContain('Sinna');
    await cmd({ type: 'triggerEvent', eventId: 'ev-custom-1' });
    expect(st().tokens.sinna.movePoints).toBe(6);
    // announce = true → players get an announcement
    const pv = (await call('GET', 'state', null, {}, pl)).body as PlayerPayload;
    expect(pv.view?.announcements.at(-1)).toMatchObject({ category: 'world', title: 'Magical storm' });
    expect((await cmd({ type: 'createEvent', eventId: 'bad', name: 'x', description: '', hexes: [], effects: [{ type: 'setTerrain', terrain: 'lava' }], announce: false })).status).toBe(400);
  });
});

describe('Arena Announcements', () => {
  it('the GM broadcasts; every player receives it (also later, after reconnecting) without GM-only data', async () => {
    expect((await cmd({ type: 'announce', category: 'death', title: 'A TRIBUTE HAS FALLEN', text: 'The cannon sounds once.' })).status).toBe(200);
    const pv = (await call('GET', 'state', null, {}, pl)).body as PlayerPayload;
    const a = pv.view!.announcements.at(-1)!;
    expect(a).toMatchObject({ category: 'death', title: 'A TRIBUTE HAS FALLEN', text: 'The cannon sounds once.', day: 1, phase: 'day' });
    expect(Object.keys(a).sort()).toEqual(['category', 'createdAt', 'day', 'expiresAt', 'id', 'phase', 'text', 'title']);
    // history is bounded
    for (let i = 0; i < 60; i++) await cmd({ type: 'announce', category: 'general', title: `A${i}`, text: '' });
    expect(st().announcements!.length).toBe(50);
    expect(((await call('GET', 'state', null, {}, gm)).body as GmPayload).state!.announcements!.at(-1)!.title).toBe('A59');
  });

  it('rejects empty or invalid announcements', async () => {
    expect((await cmd({ type: 'announce', category: 'general', title: '   ', text: '' })).status).toBe(400);
    expect((await cmd({ type: 'announce', category: 'secret', title: 'x', text: '' })).status).toBe(400);
  });
});

describe('Regression: automatic events never apply without GM approval (APEX 0.4 bug)', () => {
  it('full sequence: due → unchanged → reject (no effect) → next due → approve once; players and reconnects cannot bypass', async () => {
    const s0 = structuredClone(st());
    // 1–3: GM advances to Day 2; the flood is due but the world is unchanged
    await cmd({ type: 'advancePhase' });
    await cmd({ type: 'advancePhase' });
    const s1 = st();
    expect(s1.events.flood.status).toBe('awaiting');
    expect(JSON.stringify(s1.hexes)).toBe(JSON.stringify(s0.hexes));
    expect(s1.announcements ?? []).toEqual([]);
    expect(s1.log.some((l) => l.audience !== 'gm' && /Breach of the Aqueduct/.test(l.text))).toBe(false);
    // 4: the GM payload carries the awaiting event (drives the centred modal)
    const g = (await call('GET', 'state', null, {}, gm)).body as GmPayload;
    expect(g.state!.events.flood.status).toBe('awaiting');
    // 8: a player cannot approve
    expect((await cmd({ type: 'decideEvent', eventId: 'flood', decision: 'approve' }, pl)).status).toBe(403);
    expect((await cmd({ type: 'triggerEvent', eventId: 'flood' }, pl)).status).toBe(403);
    // 9: reconnect / refresh / repeated phase changes do not apply it
    for (let i = 0; i < 3; i++) await call('GET', 'state', null, {}, gm);
    expect(JSON.stringify(st().hexes)).toBe(JSON.stringify(s0.hexes));
    // 5: reject → no effect, never again
    expect((await cmd({ type: 'decideEvent', eventId: 'flood', decision: 'reject' })).status).toBe(200);
    expect(st().events.flood.status).toBe('rejected');
    expect(JSON.stringify(st().hexes)).toBe(JSON.stringify(s0.hexes));
    // 6: Day 3 – the proclamation becomes due; rejected flood stays rejected
    await cmd({ type: 'advancePhase' });
    await cmd({ type: 'advancePhase' });
    expect(st().events.flood.status).toBe('rejected');
    expect(st().events.proclamation.status).toBe('awaiting');
    const announcementsBefore = (st().announcements ?? []).length;
    // postpone keeps it pending (no effect), it becomes due again
    expect((await cmd({ type: 'decideEvent', eventId: 'proclamation', decision: 'postpone', postpone: 'nextPhase' })).status).toBe(200);
    expect(st().events.proclamation.status).toBe('postponed');
    await cmd({ type: 'advancePhase' });
    expect(st().events.proclamation.status).toBe('awaiting');
    expect((st().announcements ?? []).length).toBe(announcementsBefore);
    // 7: approve → applied exactly once, even if the same request is retried
    const before = repo.states.get(CID)!.version;
    expect((await cmd({ type: 'decideEvent', eventId: 'proclamation', decision: 'approve' }, gm, 'req-procl-approve')).status).toBe(200);
    const after = repo.states.get(CID)!.version;
    await cmd({ type: 'decideEvent', eventId: 'proclamation', decision: 'approve' }, gm, 'req-procl-approve');
    expect(repo.states.get(CID)!.version).toBe(after);
    expect(after).toBe(before + 1);
    expect(st().events.proclamation.status).toBe('done');
    const name = st().events.proclamation.name;
    expect(st().log.filter((l) => l.kind === 'event' && l.text.includes(name)).length).toBe(1);
    // further phase changes never re-apply decided events
    await cmd({ type: 'advancePhase' });
    await cmd({ type: 'advancePhase' });
    expect(st().events.proclamation.status).toBe('done');
    expect(st().events.flood.status).toBe('rejected');
    // built-in dawn mechanics still work without approval: movement points restored
    expect(Object.values(st().tokens).filter((t) => t.kind === 'player').every((t) => t.movePoints === t.maxMovePoints)).toBe(true);
  });
});
