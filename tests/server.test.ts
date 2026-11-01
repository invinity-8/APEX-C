import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, type ApiRequest } from '../src/server/api';
import type { CampaignPayload, GmPayload, PlayerPayload, SessionInfo } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';

const CID = 'c-main';
let repo: MemoryRepo;

const call = (token: string | null, method: string, op: string, body: unknown = null, query: Record<string, string> = {}) =>
  handleApi({ method, op, token, query, body } as ApiRequest, repo);

beforeEach(() => {
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX Main Campaign' });
  repo.users.set('t-gm', { id: 'u-gm', email: 'gm@example.com', emailConfirmed: true });
  repo.users.set('t-p1', { id: 'u-p1', email: 'p1@example.com', emailConfirmed: true });
  repo.users.set('t-p2', { id: 'u-p2', email: 'p2@example.com', emailConfirmed: true });
  repo.users.set('t-stranger', { id: 'u-x', email: 'stranger@example.com', emailConfirmed: true });
  repo.users.set('t-unconfirmed', { id: 'u-uc', email: 'p3@example.com', emailConfirmed: false });
  repo.inviteList.push(
    { campaignId: CID, email: 'gm@example.com', role: 'gm', tokenIds: [], acceptedAt: null },
    { campaignId: CID, email: 'p1@example.com', role: 'player', tokenIds: ['livia'], acceptedAt: null },
    { campaignId: CID, email: 'p2@example.com', role: 'player', tokenIds: ['marcus'], acceptedAt: null },
    { campaignId: CID, email: 'p3@example.com', role: 'player', tokenIds: ['nyx'], acceptedAt: null },
  );
  const s = createDemoState({ radius: 12, seed: 5 });
  // Keep each player's knowledge private for the leak tests.
  for (const t of Object.values(s.tokens)) t.sharesWithParty = false;
  repo.states.set(CID, { state: s, version: 1 });
});

describe('Online API – authentication & authorisation', () => {
  it('rejects unauthenticated requests', async () => {
    for (const op of ['session', 'state']) expect((await call(null, 'GET', op)).status).toBe(401);
    expect((await call('forged-token', 'GET', 'state')).status).toBe(401);
    expect((await call(null, 'POST', 'command', { campaignId: CID, command: { type: 'endDay' } })).status).toBe(401);
  });

  it('rejects authenticated users without an invitation or membership', async () => {
    const res = await call('t-stranger', 'GET', 'state');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('Livia');
  });

  it('does not redeem invitations for unconfirmed email addresses', async () => {
    expect((await call('t-unconfirmed', 'GET', 'state')).status).toBe(403);
  });

  it('resolves roles from server-side invitations, not from the client', async () => {
    const gm = (await call('t-gm', 'GET', 'session')).body as SessionInfo;
    expect(gm.campaigns[0].role).toBe('gm');
    const p1 = (await call('t-p1', 'GET', 'session', { role: 'gm' }, { role: 'gm' })).body as SessionInfo;
    expect(p1.campaigns[0].role).toBe('player');
    expect(repo.assignmentList).toContainEqual({ campaignId: CID, tokenId: 'livia', userId: 'u-p1' });
  });
});

describe('Online API – filtered state', () => {
  it('only the GM receives the full GameState', async () => {
    const gm = (await call('t-gm', 'GET', 'state')).body as GmPayload;
    expect(gm.role).toBe('gm');
    expect(gm.state?.config.seed).toBe(5);
    const p1 = (await call('t-p1', 'GET', 'state')).body as PlayerPayload;
    expect(p1.role).toBe('player');
    expect(p1).not.toHaveProperty('state');
    const json = JSON.stringify(p1);
    for (const secret of ['"seed"', 'Templum Oblitum', 'informant', 'Arena generated', 'gmNotes', 'mapRadius":12']) {
      expect(json).not.toContain(secret);
    }
    expect(p1.view?.mapRadius).toBeNull();
  });

  it('players cannot request another player’s perspective', async () => {
    const res = (await call('t-p1', 'GET', 'state', null, { as: 'marcus' })).body as PlayerPayload;
    expect(res.activeCharacter).toBe('livia');
    expect(res.characters.map((c) => c.id)).toEqual(['livia']);
  });
});

describe('Online API – commands', () => {
  const move = (token: string, tokenId: string, q: number, r: number) =>
    call(token, 'POST', 'command', { campaignId: CID, command: { type: 'move', tokenId, to: { q, r } } });

  it('a player moves their own character; the move is validated, saved and visible to others', async () => {
    await call('t-gm', 'GET', 'session');
    const res = await move('t-p1', 'livia', 1, 0);
    expect(res.status).toBe(200);
    const body = res.body as PlayerPayload;
    expect(body.version).toBe(2);
    expect(body.view?.tokens.find((t) => t.id === 'livia')?.pos).toEqual({ q: 1, r: 0 });
    // Persisted: a fresh request (e.g. after a page refresh) returns the same shared state.
    const gm = (await call('t-gm', 'GET', 'state')).body as GmPayload;
    expect(gm.state?.tokens.livia.pos).toEqual({ q: 1, r: 0 });
    expect(gm.state!.tokens.livia.movePoints).toBeLessThan(8);
    const again = (await call('t-p1', 'GET', 'state')).body as PlayerPayload;
    expect(again.view?.tokens.find((t) => t.id === 'livia')?.pos).toEqual({ q: 1, r: 0 });
  });

  it('players cannot move characters that are not assigned to them', async () => {
    await call('t-p2', 'GET', 'session');
    const res = await move('t-p1', 'marcus', 1, 0);
    expect(res.status).toBe(403);
    expect(repo.states.get(CID)!.version).toBe(1);
    expect((await move('t-p1', 'r-ferrata', 1, 0)).status).toBe(403);
  });

  it('players cannot run GM commands, even with forged fields', async () => {
    for (const command of [
      { type: 'endDay' },
      { type: 'advancePhase' },
      { type: 'place', tokenId: 'livia', to: { q: 5, r: 0 } },
      { type: 'adjustMovePoints', tokenId: 'livia', delta: 50 },
      { type: 'setTeamVisibility', teamId: 'ferrata', visibility: 'revealed' },
      { type: 'triggerEvent', eventId: 'willstorm' },
    ]) {
      const res = await call('t-p1', 'POST', 'command', { campaignId: CID, command, actor: { role: 'gm' }, role: 'gm' });
      expect(res.status).toBe(403);
    }
    expect((await call('t-p1', 'POST', 'admin', { campaignId: CID, action: 'overview' })).status).toBe(403);
    expect((await call('t-p1', 'POST', 'admin', { campaignId: CID, action: 'invite', email: 'x@y.de', role: 'gm' })).status).toBe(403);
    expect(repo.states.get(CID)!.version).toBe(1);
  });

  it('malformed commands are rejected before reaching the game logic', async () => {
    for (const command of [null, 'move', { type: 'move', tokenId: 'livia', to: { q: 'x', r: 0 } }, { type: 'nuke' }, { type: 'move', tokenId: '../../x', to: { q: 1, r: 0 } }]) {
      expect((await call('t-gm', 'POST', 'command', { campaignId: CID, command })).status).toBe(400);
    }
  });

  it('rule violations are rejected with a readable message', async () => {
    const res = await move('t-p1', 'livia', 9, 0); // unexplored
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/Unexplored/);
  });

  it('concurrent writes are re-validated instead of overwriting each other', async () => {
    await call('t-p2', 'GET', 'session');
    // While Player 1's move is being saved, Player 2's move lands first.
    repo.beforeSave = () => {
      const cur = repo.states.get(CID)!;
      const s = structuredClone(cur.state);
      s.tokens.marcus.pos = { q: -1, r: 0 };
      repo.states.set(CID, { state: s, version: cur.version + 1 });
    };
    const res = await move('t-p1', 'livia', 1, 0);
    expect(res.status).toBe(200);
    const final = repo.states.get(CID)!;
    expect(final.version).toBe(3);
    expect(final.state.tokens.livia.pos).toEqual({ q: 1, r: 0 });
    expect(final.state.tokens.marcus.pos).toEqual({ q: -1, r: 0 }); // not lost
  });

  it('the GM advances the phase and a dawn snapshot is created', async () => {
    await call('t-gm', 'POST', 'command', { campaignId: CID, command: { type: 'advancePhase' } });
    const night = (await call('t-p1', 'GET', 'state')).body as PlayerPayload;
    expect(night.view?.phase).toBe('night');
    await call('t-gm', 'POST', 'command', { campaignId: CID, command: { type: 'advancePhase' } });
    expect(repo.snapshots.map((s) => s.label)).toContain('Dawn of Day 2');
  });

  it('every command attempt is written to the audit log', async () => {
    await move('t-p1', 'marcus', 1, 0);
    await move('t-p1', 'livia', 1, 0);
    expect(repo.log.map((e) => [e.userId, e.ok])).toEqual([
      ['u-p1', false],
      ['u-p1', true],
    ]);
  });
});

describe('Online API – GM administration', () => {
  it('the GM invites a future player and assigns a character; the player gets it on first login', async () => {
    await call('t-gm', 'GET', 'session');
    const r = await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'invite', email: 'New.Player@Example.com', role: 'player', tokenIds: ['cassius'] });
    expect(r.status).toBe(200);
    repo.users.set('t-new', { id: 'u-new', email: 'new.player@example.com', emailConfirmed: true });
    const p = (await call('t-new', 'GET', 'state')).body as PlayerPayload;
    expect(p.activeCharacter).toBe('cassius');
  });

  it('characters can be reassigned between users', async () => {
    await call('t-gm', 'GET', 'session');
    await call('t-p1', 'GET', 'session');
    await call('t-p2', 'GET', 'session');
    await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'assign', tokenId: 'livia', userId: 'u-p2' });
    expect(((await call('t-p1', 'GET', 'state')).body as PlayerPayload).characters).toEqual([]);
    const p2 = (await call('t-p2', 'GET', 'state')).body as PlayerPayload;
    expect(p2.characters.map((c) => c.id).sort()).toEqual(['livia', 'marcus']);
    // Player 2 now controls Livia, Player 1 no longer does.
    const cmd = { campaignId: CID, command: { type: 'move', tokenId: 'livia', to: { q: 1, r: 0 } } };
    expect((await call('t-p1', 'POST', 'command', cmd)).status).toBe(403);
    expect((await call('t-p2', 'POST', 'command', cmd)).status).toBe(200);
  });

  it('the GM can start a new arena and restore a snapshot', async () => {
    const init = (await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'initCampaign', radius: 8, seed: 99 })).body as CampaignPayload;
    expect(init.role).toBe('gm');
    expect((init as GmPayload).state?.config.mapRadius).toBe(8);
    const snap = repo.snapshots.find((s) => s.label === 'Before new arena')!;
    const restored = (await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'restoreSnapshot', id: snap.id })).body as GmPayload;
    expect(restored.state?.config.mapRadius).toBe(12);
  });

  it('the GM cannot accidentally remove their own GM role', async () => {
    await call('t-gm', 'GET', 'session');
    const res = await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'setRole', userId: 'u-gm', role: 'player' });
    expect(res.status).toBe(400);
  });
});

describe('Online API – multiple clients', () => {
  it('all clients see the same version after a move; each only gets its permitted view', async () => {
    for (const t of ['t-gm', 't-p1', 't-p2']) await call(t, 'GET', 'session');
    const before = ((await call('t-p2', 'GET', 'state')).body as PlayerPayload).version;
    await call('t-p1', 'POST', 'command', { campaignId: CID, command: { type: 'move', tokenId: 'livia', to: { q: 1, r: 0 } } });
    const gm = (await call('t-gm', 'GET', 'state')).body as GmPayload;
    const p2 = (await call('t-p2', 'GET', 'state')).body as PlayerPayload;
    expect(gm.version).toBe(before + 1);
    expect(p2.version).toBe(before + 1);
    expect(gm.state!.tokens.livia.pos).toEqual({ q: 1, r: 0 });
    // Player 2 does not share knowledge with Livia in this setup → Livia's details stay hidden.
    expect(p2.view!.tokens.find((t) => t.id === 'livia')?.details).toBeUndefined();
  });
});
