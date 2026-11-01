/**
 * Regression tests for the production incident of 2026-11-01 (request storm → Supabase overload).
 * They pin the database round-trip budget of the hot endpoints and the idempotency of actions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { AdminOverview, GmPayload } from '../src/server/protocol';
import { actionKey, nextBeatDelay, SYNC_TIMING } from '../src/online/useOnlineGame';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;
const call = (method: string, op: string, body: unknown = null, query: Record<string, string> = {}, cookie?: string) =>
  handleApi(
    {
      method,
      op,
      query,
      body,
      ip: '203.0.113.9',
      headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1' } : {}), ...(cookie ? { cookie } : {}) },
    } as ApiRequest,
    repo,
  );
async function login(profile: string, password: string) {
  const r = await call('POST', 'login', { profile, password });
  expect(r.status).toBe(200);
  return r.cookies![0].split(';')[0];
}
/** Repository calls (≈ Supabase round trips) made by one request. */
async function budget(fn: () => Promise<{ status: number }>) {
  const before = repo.calls;
  const r = await fn();
  expect(r.status).toBe(200);
  return repo.calls - before;
}

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX' });
  seedProfiles(repo, CID);
  repo.states.set(CID, { state: createDemoState({ radius: 10, seed: 3 }), version: 1 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  await call('GET', 'profiles'); // warm the schema-version cache like a running instance
});

describe('Database round-trip budget per request', () => {
  it('heartbeat (ping) = 2 round trips and never loads the game state', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    let loaded = 0;
    const load = repo.loadState.bind(repo);
    repo.loadState = async (id) => (loaded++, load(id));
    expect(await budget(() => call('GET', 'ping', null, {}, c))).toBeLessThanOrEqual(2);
    expect(loaded).toBe(0);
  });

  it('state refresh with an unchanged version transfers no state', async () => {
    const c = await login('gm', 'gm-secret-pass');
    let loaded = 0;
    const load = repo.loadState.bind(repo);
    repo.loadState = async (id) => (loaded++, load(id));
    const r = await call('GET', 'state', null, { since: '1' }, c);
    expect(r.body).toEqual({ unchanged: true, version: 1 });
    expect(loaded).toBe(0);
    const full = (await call('GET', 'state', null, { since: '0' }, c)).body as GmPayload;
    expect(full.state).toBeTruthy();
  });

  it('session = 1 round trip; GM overview ≤ 5 and without loading the game state', async () => {
    const c = await login('gm', 'gm-secret-pass');
    expect(await budget(() => call('GET', 'session', null, {}, c))).toBe(1);
    let loaded = 0;
    const load = repo.loadState.bind(repo);
    repo.loadState = async (id) => (loaded++, load(id));
    expect(await budget(() => call('POST', 'admin', { campaignId: CID, action: 'overview' }, {}, c))).toBeLessThanOrEqual(5);
    expect(loaded).toBe(0);
  });

  it('public profile list = 2 round trips regardless of the number of profiles', async () => {
    expect(await budget(() => call('GET', 'profiles'))).toBeLessThanOrEqual(2);
  });

  it('presence comes from the session (no extra member writes per request)', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    const g = await login('gm', 'gm-secret-pass');
    await call('GET', 'ping', null, {}, c);
    const ov = (await call('POST', 'admin', { campaignId: CID, action: 'overview' }, {}, g)).body as AdminOverview;
    expect(ov.profiles.find((p) => p.key === 'hannah')).toMatchObject({ online: true, sessions: 1 });
  });
});

describe('Idempotent actions', () => {
  it('a command repeated with the same request id is applied once', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    const body = { campaignId: CID, requestId: 'req-move-0001', command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } };
    expect((await call('POST', 'command', body, {}, c)).status).toBe(200);
    const again = await call('POST', 'command', body, {}, c);
    expect(again.status).toBe(200);
    expect((again.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect(repo.states.get(CID)!.version).toBe(2); // not 3
    const st = (await call('GET', 'command-status', null, { requestId: 'req-move-0001' }, c)).body as { state: string; version: number };
    expect(st).toMatchObject({ state: 'ok', version: 2 });
    expect(((await call('GET', 'command-status', null, { requestId: 'req-never-sent' }, c)).body as { state: string }).state).toBe('unknown');
  });

  it('a rejected command keeps its rejection; an in-flight duplicate is refused', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    const bad = { campaignId: CID, requestId: 'req-bad-00001', command: { type: 'move', tokenId: 'sinna', to: { q: 30, r: 0 } } };
    expect((await call('POST', 'command', bad, {}, c)).status).toBe(422);
    expect((await call('POST', 'command', bad, {}, c)).status).toBe(422);
    expect(((await call('GET', 'command-status', null, { requestId: 'req-bad-00001' }, c)).body as { state: string }).state).toBe('failed');
    repo.requests.set(`${CID}:req-pending-01`, { state: 'pending', version: null, error: null });
    const p = await call('POST', 'command', { ...bad, requestId: 'req-pending-01' }, {}, c);
    expect((p.body as { code: string }).code).toBe('in_progress');
  });

  it('two "new arena" clicks with the same request id create one world', async () => {
    const c = await login('gm', 'gm-secret-pass');
    const body = { campaignId: CID, action: 'initCampaign', radius: 6, seed: 7, requestId: 'req-world-0001' };
    await call('POST', 'admin', body, {}, c);
    const v = repo.states.get(CID)!.version;
    const second = await call('POST', 'admin', body, {}, c);
    expect((second.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect(repo.states.get(CID)!.version).toBe(v);
    expect(repo.snapshots.filter((s) => s.label === 'Before new arena')).toHaveLength(1);
  });

  it('invalid request ids are rejected', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    const r = await call('POST', 'command', { campaignId: CID, requestId: 'x', command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } }, {}, c);
    expect(r.status).toBe(400);
  });
});

describe('Client synchronisation schedule', () => {
  it('uses regular intervals when healthy and exponential backoff with jitter after failures', () => {
    expect(nextBeatDelay(0, true)).toBe(SYNC_TIMING.live);
    expect(nextBeatDelay(0, false)).toBe(SYNC_TIMING.noRealtime);
    const mid = () => 0.5;
    expect(nextBeatDelay(1, true, mid)).toBe(4_000);
    expect(nextBeatDelay(2, true, mid)).toBe(8_000);
    expect(nextBeatDelay(3, true, mid)).toBe(16_000);
    expect(nextBeatDelay(10, true, mid)).toBe(60_000); // capped
    expect(nextBeatDelay(3, true, () => 0)).toBe(12_000); // −25 %
    expect(nextBeatDelay(3, true, () => 1)).toBe(20_000); // +25 %
  });

  it('only conflicting actions share a pending slot', () => {
    expect(actionKey({ type: 'move', tokenId: 'a', to: { q: 0, r: 0 } })).toBe('move');
    expect(actionKey({ type: 'advancePhase' })).toBe('phase');
    expect(actionKey({ type: 'endDay' })).toBe('phase');
    expect(actionKey({ type: 'invAddItem', tokenId: 'sinna', itemId: 'x1', name: 'Key' })).toBe('char:sinna');
    expect(actionKey({ type: 'toggleShare', tokenId: 'sinna' })).toBe('gm:toggleShare');
  });
});
