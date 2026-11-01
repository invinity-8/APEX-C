import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { GmPayload, PlayerPayload } from '../src/server/protocol';
import type { ArchiveInfo } from '../src/server/repo';
import { carryCharacters, newWorldMeta, reconcileRestore } from '../src/game/world';
import { emptySheet } from '../src/game/sheet';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;
let gm: string;
let pl: string;
let rid = 0;
const call = (method: string, op: string, body: unknown = null, query: Record<string, string> = {}, cookie?: string) =>
  handleApi(
    { method, op, query, body, ip: '203.0.113.20', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest,
    repo,
  );
const admin = (body: Record<string, unknown>, cookie = gm, requestId = `req-world-${++rid}-xx`) => call('POST', 'admin', { campaignId: CID, requestId, ...body }, {}, cookie);
const state = () => repo.states.get(CID)!;
async function login(profile: string, password: string) {
  const r = await call('POST', 'login', { profile, password });
  return r.cookies![0].split(';')[0];
}

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX' });
  seedProfiles(repo, CID);
  const s = { ...createDemoState({ radius: 10, seed: 3 }), world: newWorldMeta('First world') };
  s.tokens.sinna.inventory.push({ id: 'key', name: 'Old iron key', kind: 'misc', description: '', quantity: 1, container: 'pockets', rev: 0 });
  s.tokens.sinna.will.current = 2;
  s.tokens.sinna.pos = { q: 2, r: -1 };
  repo.states.set(CID, { state: s, version: 7 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  gm = await login('gm', 'gm-secret-pass');
  pl = await login('hannah', 'hannah-pass-1');
  repo.sheets.set(`${CID}:sinna`, { data: { ...emptySheet(), notes: 'Sinna sheet' }, version: 3, updatedAt: '', updatedBy: null });
});

describe('Archive World', () => {
  it('stores a complete, restorable copy only after the database confirms it', async () => {
    const r = await admin({ action: 'archiveWorld', name: 'Before the storm', description: 'Day 1 checkpoint' });
    expect(r.status).toBe(200);
    const body = r.body as { archiveId: string; archives: ArchiveInfo[] };
    expect(body.archives[0]).toMatchObject({ id: body.archiveId, name: 'Before the storm', description: 'Day 1 checkpoint', kind: 'manual', stateVersion: 7, worldName: 'First world', radius: 10, seed: 3, day: 1 });
    const stored = await repo.loadArchive(CID, body.archiveId);
    expect(stored!.state).toEqual(state().state); // hexes, positions, knowledge, events, log, inventories
    expect(state().version).toBe(7); // archiving does not change the world
  });

  it('a failed archive reports failure', async () => {
    repo.failNextTransition = new Error('database timeout after 8000 ms');
    const r = await admin({ action: 'archiveWorld', name: 'x' });
    expect(r.status).toBe(503);
    expect(repo.archives).toHaveLength(0);
  });
});

describe('Create New World / Reset Current World', () => {
  it('creates a new world, archives the old one, keeps accounts, characters, inventories and sheets', async () => {
    const credsBefore = new Map(repo.credentials);
    const profilesBefore = structuredClone(repo.profileList);
    const r = await admin({ action: 'createWorld', name: 'Second world', radius: 8, seed: 99, keepProgress: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = state();
    expect(s.version).toBe(8);
    expect(s.state.world?.name).toBe('Second world');
    expect(s.state.config).toMatchObject({ mapRadius: 8, seed: 99 });
    // character-level data carried over
    expect(s.state.tokens.sinna.inventory.some((i) => i.id === 'key')).toBe(true);
    expect(s.state.tokens.sinna.will).toEqual({ current: 10, max: 10 }); // fresh start: refilled
    // world-level data initialised by the rules
    expect(s.state.tokens.sinna.pos).not.toEqual({ q: 2, r: -1 });
    expect(s.state.tokens.sinna.movePoints).toBe(s.state.tokens.sinna.maxMovePoints);
    expect(Object.keys(s.state.knowledge.sinna?.explored ?? {}).length).toBeLessThan(40);
    // archive of the previous world
    expect(repo.archives[0]).toMatchObject({ kind: 'before-create', worldName: 'First world', stateVersion: 7 });
    // untouched: accounts, passwords, profiles, permissions, sheets
    expect(repo.credentials).toEqual(credsBefore);
    expect(repo.profileList).toEqual(profilesBefore);
    expect(repo.sheets.get(`${CID}:sinna`)?.version).toBe(3);
    expect((await call('GET', 'session', null, {}, pl)).status).toBe(200); // sessions stay valid
    const view = (await call('GET', 'state', null, {}, pl)).body as PlayerPayload;
    expect(view.view?.worldName).toBe('Second world');
  });

  it('can keep per-world progress of consumable resources', async () => {
    await admin({ action: 'createWorld', name: 'Keep', keepProgress: true });
    expect(state().state.tokens.sinna.will).toEqual({ current: 2, max: 10 });
  });

  it('reset requires explicit confirmation and archives first', async () => {
    expect((await admin({ action: 'resetWorld', keepProgress: true })).status).toBe(400);
    const r = await admin({ action: 'resetWorld', keepProgress: true, confirm: 'RESET' });
    expect(r.status).toBe(200);
    expect(state().state.world?.name).toBe('First world');
    expect(state().state.config.seed).not.toBe(3);
    expect(repo.archives[0].kind).toBe('before-reset');
  });

  it('a failed reset leaves the previous world active and loadable', async () => {
    const before = structuredClone(state());
    repo.failNextTransition = new Error('database timeout after 8000 ms');
    expect((await admin({ action: 'resetWorld', keepProgress: true, confirm: 'RESET' })).status).toBe(503);
    expect(state()).toEqual(before);
    expect(((await call('GET', 'state', null, {}, gm)).body as GmPayload).state?.world?.name).toBe('First world');
  });

  it('a concurrent change aborts the switch without touching either world', async () => {
    // a move lands between reading the world and the transition
    const load = repo.loadState.bind(repo);
    let first = true;
    repo.loadState = async (id) => {
      const r = await load(id);
      if (first && r) {
        first = false;
        repo.states.set(CID, { state: r.state, version: r.version + 1 });
      }
      return r;
    };
    const r = await admin({ action: 'createWorld', name: 'Racy', keepProgress: true });
    expect(r.status).toBe(409);
    expect(state().state.world?.name).toBe('First world');
    expect(repo.archives).toHaveLength(0);
  });

  it('the same request id never creates two worlds', async () => {
    const body = { action: 'createWorld', name: 'Once', keepProgress: true };
    await admin(body, gm, 'req-world-once-1');
    const v = state().version;
    const again = await admin(body, gm, 'req-world-once-1');
    expect((again.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect(state().version).toBe(v);
    expect(repo.archives).toHaveLength(1);
  });
});

describe('Restore Archived World', () => {
  it('archives the current world first and restores the target; inventories are reconciled explicitly', async () => {
    const a = (await admin({ action: 'archiveWorld', name: 'Checkpoint' })).body as { archiveId: string };
    await admin({ action: 'createWorld', name: 'Elsewhere', keepProgress: true });
    // the character finds something in the new world
    state().state.tokens.sinna.inventory.push({ id: 'gem', name: 'Glowing gem', kind: 'misc', description: '', quantity: 1, rev: 0 });
    const r = await admin({ action: 'restoreArchive', archiveId: a.archiveId, inventory: 'keep-current' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = state().state;
    expect(s.world?.name).toBe('First world');
    expect(s.tokens.sinna.pos).toEqual({ q: 2, r: -1 }); // archived position & map
    expect(s.tokens.sinna.inventory.map((i) => i.id)).toContain('gem'); // current inventory kept
    expect(repo.archives[0]).toMatchObject({ kind: 'before-restore', worldName: 'Elsewhere' });
    // the alternative: inventory as archived
    const b = repo.archives.find((x) => x.name === 'Checkpoint')!;
    await admin({ action: 'restoreArchive', archiveId: b.id, inventory: 'use-archived' });
    expect(state().state.tokens.sinna.inventory.map((i) => i.id)).not.toContain('gem');
  });

  it('requires a reconciliation choice and an existing archive', async () => {
    expect((await admin({ action: 'restoreArchive', archiveId: 'nope' })).status).toBe(400);
    expect((await admin({ action: 'restoreArchive', archiveId: '00000000-0000-4000-8000-000000009999', inventory: 'keep-current' })).status).toBe(404);
  });
});

describe('Security and stale clients', () => {
  it('players cannot list, archive, create, reset or restore worlds', async () => {
    for (const action of ['listArchives', 'archiveWorld', 'createWorld', 'resetWorld', 'restoreArchive']) {
      expect((await admin({ action, name: 'x', keepProgress: true, confirm: 'RESET', archiveId: 'x', inventory: 'keep-current' }, pl)).status).toBe(403);
    }
    expect(repo.archives).toHaveLength(0);
    expect(state().version).toBe(7);
  });

  it('commands prepared for a replaced world are rejected', async () => {
    const oldWorld = state().state.world!.id;
    await admin({ action: 'createWorld', name: 'New', keepProgress: true });
    const r = await call('POST', 'command', { campaignId: CID, worldId: oldWorld, requestId: 'req-stale-0001', command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } }, {}, pl);
    expect(r.status).toBe(409);
    expect((r.body as { code: string }).code).toBe('world_changed');
    const ok = await call('POST', 'command', { campaignId: CID, worldId: state().state.world!.id, command: { type: 'setWill', tokenId: 'sinna', current: 1 } }, {}, pl);
    expect(ok.status).toBe(200);
  });

  it('the first world of a campaign gets world metadata; a second initCampaign never destroys without archive', async () => {
    repo.states.delete(CID);
    await admin({ action: 'initCampaign', radius: 6, seed: 5, name: 'Opening' });
    expect(state().state.world?.name).toBe('Opening');
    await admin({ action: 'initCampaign', radius: 6, seed: 6 });
    expect(repo.archives[0]).toMatchObject({ worldName: 'Opening', kind: 'before-create' });
  });
});

describe('Character carry-over rules', () => {
  it('keeps identity, inventory and traits; resets world values', () => {
    const prev = createDemoState({ radius: 8, seed: 1 });
    prev.tokens.aster.name = 'Aster the Bold';
    prev.tokens.aster.visionRadius = 4;
    prev.tokens.aster.movePoints = 0;
    prev.tokens.aster.visionBonus = 3;
    const next = carryCharacters(prev, createDemoState({ radius: 8, seed: 2 }), { keepProgress: true });
    expect(next.tokens.aster).toMatchObject({ name: 'Aster the Bold', visionRadius: 4, visionBonus: 0, movePoints: next.tokens.aster.maxMovePoints });
    expect(next.config.seed).toBe(2);
    const restored = reconcileRestore(next, prev, 'keep-current');
    expect(restored.tokens.aster.name).toBe('Aster the Bold');
    expect(restored.config.seed).toBe(1);
  });
});
