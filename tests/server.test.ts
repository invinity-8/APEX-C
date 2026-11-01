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
    { campaignId: CID, email: 'p1@example.com', role: 'player', tokenIds: ['sinna'], acceptedAt: null },
    { campaignId: CID, email: 'p2@example.com', role: 'player', tokenIds: ['aster'], acceptedAt: null },
    { campaignId: CID, email: 'p3@example.com', role: 'player', tokenIds: ['elwin'], acceptedAt: null },
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
    expect(JSON.stringify(res.body)).not.toContain('Sinna');
  });

  it('does not redeem invitations for unconfirmed email addresses', async () => {
    expect((await call('t-unconfirmed', 'GET', 'state')).status).toBe(403);
  });

  it('resolves roles from server-side invitations, not from the client', async () => {
    const gm = (await call('t-gm', 'GET', 'session')).body as SessionInfo;
    expect(gm.campaigns[0].role).toBe('gm');
    const p1 = (await call('t-p1', 'GET', 'session', { role: 'gm' }, { role: 'gm' })).body as SessionInfo;
    expect(p1.campaigns[0].role).toBe('player');
    expect(repo.assignmentList).toContainEqual({ campaignId: CID, tokenId: 'sinna', userId: 'u-p1' });
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
    const res = (await call('t-p1', 'GET', 'state', null, { as: 'aster' })).body as PlayerPayload;
    expect(res.activeCharacter).toBe('sinna');
    expect(res.characters.map((c) => c.id)).toEqual(['sinna']);
  });
});

describe('Online API – commands', () => {
  const move = (token: string, tokenId: string, q: number, r: number) =>
    call(token, 'POST', 'command', { campaignId: CID, command: { type: 'move', tokenId, to: { q, r } } });

  it('a player moves their own character; the move is validated, saved and visible to others', async () => {
    await call('t-gm', 'GET', 'session');
    const res = await move('t-p1', 'sinna', 1, 0);
    expect(res.status).toBe(200);
    const body = res.body as PlayerPayload;
    expect(body.version).toBe(2);
    expect(body.view?.tokens.find((t) => t.id === 'sinna')?.pos).toEqual({ q: 1, r: 0 });
    // Persisted: a fresh request (e.g. after a page refresh) returns the same shared state.
    const gm = (await call('t-gm', 'GET', 'state')).body as GmPayload;
    expect(gm.state?.tokens.sinna.pos).toEqual({ q: 1, r: 0 });
    expect(gm.state!.tokens.sinna.movePoints).toBeLessThan(8);
    const again = (await call('t-p1', 'GET', 'state')).body as PlayerPayload;
    expect(again.view?.tokens.find((t) => t.id === 'sinna')?.pos).toEqual({ q: 1, r: 0 });
  });

  it('players cannot move characters that are not assigned to them', async () => {
    await call('t-p2', 'GET', 'session');
    const res = await move('t-p1', 'aster', 1, 0);
    expect(res.status).toBe(403);
    expect(repo.states.get(CID)!.version).toBe(1);
    expect((await move('t-p1', 'r-ferrata', 1, 0)).status).toBe(403);
  });

  it('players cannot run GM commands, even with forged fields', async () => {
    for (const command of [
      { type: 'endDay' },
      { type: 'advancePhase' },
      { type: 'place', tokenId: 'sinna', to: { q: 5, r: 0 } },
      { type: 'adjustMovePoints', tokenId: 'sinna', delta: 50 },
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
    for (const command of [null, 'move', { type: 'move', tokenId: 'sinna', to: { q: 'x', r: 0 } }, { type: 'nuke' }, { type: 'move', tokenId: '../../x', to: { q: 1, r: 0 } }]) {
      expect((await call('t-gm', 'POST', 'command', { campaignId: CID, command })).status).toBe(400);
    }
  });

  it('rule violations are rejected with a readable message', async () => {
    const res = await move('t-p1', 'sinna', 9, 0); // unexplored
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/Unexplored/);
  });

  it('concurrent writes are re-validated instead of overwriting each other', async () => {
    await call('t-p2', 'GET', 'session');
    // While Player 1's move is being saved, Player 2's move lands first.
    repo.beforeSave = () => {
      const cur = repo.states.get(CID)!;
      const s = structuredClone(cur.state);
      s.tokens.aster.pos = { q: -1, r: 0 };
      repo.states.set(CID, { state: s, version: cur.version + 1 });
    };
    const res = await move('t-p1', 'sinna', 1, 0);
    expect(res.status).toBe(200);
    const final = repo.states.get(CID)!;
    expect(final.version).toBe(3);
    expect(final.state.tokens.sinna.pos).toEqual({ q: 1, r: 0 });
    expect(final.state.tokens.aster.pos).toEqual({ q: -1, r: 0 }); // not lost
  });

  it('the GM advances the phase and a dawn snapshot is created', async () => {
    await call('t-gm', 'POST', 'command', { campaignId: CID, command: { type: 'advancePhase' } });
    const night = (await call('t-p1', 'GET', 'state')).body as PlayerPayload;
    expect(night.view?.phase).toBe('night');
    await call('t-gm', 'POST', 'command', { campaignId: CID, command: { type: 'advancePhase' } });
    expect(repo.snapshots.map((s) => s.label)).toContain('Dawn of Day 2');
  });

  it('every command attempt is written to the audit log', async () => {
    await move('t-p1', 'aster', 1, 0);
    await move('t-p1', 'sinna', 1, 0);
    expect(repo.log.map((e) => [e.userId, e.ok])).toEqual([
      ['u-p1', false],
      ['u-p1', true],
    ]);
  });
});

describe('Online API – GM administration', () => {
  it('the GM invites a future player and assigns a character; the player gets it on first login', async () => {
    await call('t-gm', 'GET', 'session');
    const r = await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'invite', email: 'New.Player@Example.com', role: 'player', tokenIds: ['javi'] });
    expect(r.status).toBe(200);
    repo.users.set('t-new', { id: 'u-new', email: 'new.player@example.com', emailConfirmed: true });
    const p = (await call('t-new', 'GET', 'state')).body as PlayerPayload;
    expect(p.activeCharacter).toBe('javi');
  });

  it('characters can be reassigned between users', async () => {
    await call('t-gm', 'GET', 'session');
    await call('t-p1', 'GET', 'session');
    await call('t-p2', 'GET', 'session');
    await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'assign', tokenId: 'sinna', userId: 'u-p2' });
    expect(((await call('t-p1', 'GET', 'state')).body as PlayerPayload).characters).toEqual([]);
    const p2 = (await call('t-p2', 'GET', 'state')).body as PlayerPayload;
    expect(p2.characters.map((c) => c.id).sort()).toEqual(['aster', 'sinna']);
    // Player 2 now controls Sinna, Player 1 no longer does.
    const cmd = { campaignId: CID, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } };
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
    await call('t-p1', 'POST', 'command', { campaignId: CID, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } });
    const gm = (await call('t-gm', 'GET', 'state')).body as GmPayload;
    const p2 = (await call('t-p2', 'GET', 'state')).body as PlayerPayload;
    expect(gm.version).toBe(before + 1);
    expect(p2.version).toBe(before + 1);
    expect(gm.state!.tokens.sinna.pos).toEqual({ q: 1, r: 0 });
    // Player 2 does not share knowledge with Sinna in this setup → Sinna's details stay hidden.
    expect(p2.view!.tokens.find((t) => t.id === 'sinna')?.details).toBeUndefined();
  });
});

describe('Online API – email code login', () => {
  it('sends a code only to invited or member addresses, with an identical answer for everyone', async () => {
    const invited = await call(null, 'POST', 'request-code', { email: 'P1@Example.com' });
    const stranger = await call(null, 'POST', 'request-code', { email: 'nobody@example.com' });
    expect(invited.status).toBe(200);
    expect(stranger.status).toBe(200);
    expect(invited.body).toEqual(stranger.body); // no account enumeration
    expect(repo.sentCodes).toEqual(['p1@example.com']);
    expect(repo.authAccounts.has('nobody@example.com')).toBe(false); // no self-registration
  });

  it('existing members (invite already redeemed) can request codes again', async () => {
    await call('t-p1', 'GET', 'session');
    await call(null, 'POST', 'request-code', { email: 'p1@example.com' });
    expect(repo.sentCodes).toContain('p1@example.com');
  });

  it('an authenticated account without invitation gets no campaign data', async () => {
    expect((await call('t-stranger', 'GET', 'state')).status).toBe(403);
    expect((await call('t-stranger', 'GET', 'ping')).status).toBe(403);
  });

  it('reports rate limiting and sending failures visibly', async () => {
    repo.nextSendResult = { ok: false, reason: 'rate_limited' };
    expect((await call(null, 'POST', 'request-code', { email: 'p1@example.com' })).status).toBe(429);
    repo.nextSendResult = { ok: false, reason: 'failed', detail: 'smtp' };
    const r = await call(null, 'POST', 'request-code', { email: 'p1@example.com' });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('smtp');
  });

  it('rejects malformed emails', async () => {
    expect((await call(null, 'POST', 'request-code', { email: 'not-an-email' })).status).toBe(400);
  });

  it('the health check is public but reveals no campaign data', async () => {
    const h = await call(null, 'GET', 'health');
    expect(h.status).toBe(200);
    expect(JSON.stringify(h.body)).not.toMatch(/sinna|@example/i);
  });
});

describe('Online API – presence', () => {
  it('records presence on API contact and shows it to the GM only', async () => {
    await call('t-gm', 'GET', 'session');
    await call('t-p1', 'GET', 'ping');
    const ov = (await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'overview' })).body as { members: Array<{ email: string; online: boolean }> };
    expect(ov.members.find((m) => m.email === 'p1@example.com')?.online).toBe(true);
    expect((await call('t-p1', 'POST', 'admin', { campaignId: CID, action: 'overview' })).status).toBe(403);
  });

  it('ping returns the current version so clients can detect missed updates', async () => {
    await call('t-p1', 'GET', 'session');
    const v1 = (await call('t-p1', 'GET', 'ping')).body as { version: number };
    await call('t-p1', 'POST', 'command', { campaignId: CID, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } });
    const v2 = (await call('t-p1', 'GET', 'ping')).body as { version: number };
    expect(v2.version).toBe(v1.version + 1);
  });

  it('a removed player loses access immediately', async () => {
    await call('t-gm', 'GET', 'session');
    await call('t-p1', 'GET', 'session');
    await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'removeMember', userId: 'u-p1' });
    expect((await call('t-p1', 'GET', 'state')).status).toBe(403);
    expect((await call(null, 'POST', 'request-code', { email: 'p1@example.com' })).status).toBe(200);
    expect(repo.sentCodes).not.toContain('p1@example.com');
  });
});

describe('Online API – "Who are you?" profiles', () => {
  const seedProfiles = () => {
    const mk = (key: string, displayName: string, characterName: string, role: 'gm' | 'player', tokenIds: string[], email: string | null = null) => ({
      campaignId: CID,
      key,
      displayName,
      characterName,
      role,
      tokenIds,
      email,
      userId: null,
    });
    repo.profileList = [
      mk('gm', 'GM', 'All characters', 'gm', []),
      mk('hannah', 'Hannah', 'Sinna', 'player', ['sinna'], 'hannah@example.com'),
      mk('jean', 'Jean', 'Aster', 'player', ['aster'], 'jean@example.com'),
      mk('simon', 'Simon', 'Elwin', 'player', ['elwin']),
      mk('jerba', 'Jerba', 'Javi', 'player', ['javi']),
    ];
    repo.users.set('t-hannah', { id: 'u-hannah', email: 'hannah@example.com', emailConfirmed: true });
    repo.users.set('t-jean', { id: 'u-jean', email: 'jean@example.com', emailConfirmed: true });
  };
  const code = (email: string, profile: string) => call(null, 'POST', 'request-code', { email, profile });

  it('lists which profiles are active without revealing any account', async () => {
    seedProfiles();
    const r = (await call(null, 'GET', 'profiles')).body as { profiles: Array<{ key: string; active: boolean }> };
    expect(Object.fromEntries(r.profiles.map((p) => [p.key, p.active]))).toEqual({ gm: true, hannah: true, jean: true, simon: false, jerba: false });
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('sends a code only when the email belongs to the chosen profile', async () => {
    seedProfiles();
    const ok = await code('hannah@example.com', 'hannah');
    const wrong = await code('jean@example.com', 'hannah'); // Jean picks Hannah's profile
    const inactive = await code('someone@example.com', 'simon');
    expect([ok.status, wrong.status, inactive.status]).toEqual([200, 200, 200]);
    expect(ok.body).toEqual(wrong.body); // identical answer: no hint whose email it is
    expect(repo.sentCodes).toEqual(['hannah@example.com']);
  });

  it('the GM profile accepts only Game Master accounts', async () => {
    seedProfiles();
    await code('p1@example.com', 'gm');
    await code('gm@example.com', 'gm');
    expect(repo.sentCodes).toEqual(['gm@example.com']);
  });

  it('first verified sign-in binds the account to its profile and assigns the character', async () => {
    seedProfiles();
    const s = (await call('t-hannah', 'GET', 'state', null, { profile: 'hannah' })).body as PlayerPayload;
    expect(s.activeCharacter).toBe('sinna');
    expect(repo.profileList.find((p) => p.key === 'hannah')?.userId).toBe('u-hannah');
    expect(repo.assignmentList).toContainEqual({ campaignId: CID, tokenId: 'sinna', userId: 'u-hannah' });
  });

  it('choosing someone else’s profile is refused, even when signed in', async () => {
    seedProfiles();
    await call('t-hannah', 'GET', 'session');
    const r = await call('t-jean', 'GET', 'state', null, { profile: 'hannah' });
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe('profile_mismatch');
    expect(JSON.stringify(r.body)).not.toContain('hannah@');
    expect((await call('t-p1', 'GET', 'state', null, { profile: 'gm' })).status).toBe(403); // player → GM profile
    const cmd = { campaignId: CID, profile: 'hannah', command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } };
    expect((await call('t-jean', 'POST', 'command', cmd)).status).toBe(403);
  });

  it('each player controls only the profile character; the GM controls all', async () => {
    seedProfiles();
    await call('t-gm', 'GET', 'session');
    await call('t-hannah', 'GET', 'session');
    await call('t-jean', 'GET', 'session');
    const move = (t: string, profile: string, tokenId: string) =>
      call(t, 'POST', 'command', { campaignId: CID, profile, command: { type: 'move', tokenId, to: { q: 1, r: 1 } } });
    expect((await move('t-hannah', 'hannah', 'aster')).status).toBe(403);
    expect((await move('t-hannah', 'hannah', 'sinna')).status).toBe(200);
    expect((await move('t-gm', 'gm', 'aster')).status).toBe(200);
  });

  it('the GM links Simon later; only then can Simon sign in and play Elwin', async () => {
    seedProfiles();
    await call('t-gm', 'GET', 'session');
    await code('simon@example.com', 'simon');
    expect(repo.sentCodes).toEqual([]);
    const ov = await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'linkProfile', profile: 'simon', email: 'Simon@Example.com' });
    expect(ov.status).toBe(200);
    expect(((ov.body as { profiles: Array<{ key: string; email: string }> }).profiles.find((p) => p.key === 'simon'))?.email).toBe('simon@example.com');
    await code('simon@example.com', 'simon');
    expect(repo.sentCodes).toEqual(['simon@example.com']);
    repo.users.set('t-simon', { id: 'u-simon', email: 'simon@example.com', emailConfirmed: true });
    const s = (await call('t-simon', 'GET', 'state', null, { profile: 'simon' })).body as PlayerPayload;
    expect(s.activeCharacter).toBe('elwin');
  });

  it('relinking a profile moves the character and locks out the previous account', async () => {
    seedProfiles();
    await call('t-gm', 'GET', 'session');
    await call('t-hannah', 'GET', 'state', null, { profile: 'hannah' });
    await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'linkProfile', profile: 'hannah', email: 'p1@example.com' });
    expect((await call('t-hannah', 'GET', 'state', null, { profile: 'hannah' })).status).toBe(403);
    const p1 = (await call('t-p1', 'GET', 'state', null, { profile: 'hannah' })).body as PlayerPayload;
    expect(p1.characters.map((c) => c.id)).toContain('sinna');
    expect(repo.assignmentList.filter((a) => a.tokenId === 'sinna').map((a) => a.userId)).toEqual(['u-p1']);
  });

  it('one email cannot be linked to two profiles; players cannot change profiles', async () => {
    seedProfiles();
    await call('t-gm', 'GET', 'session');
    const r = await call('t-gm', 'POST', 'admin', { campaignId: CID, action: 'linkProfile', profile: 'simon', email: 'hannah@example.com' });
    expect(r.status).toBe(400);
    expect((await call('t-p1', 'POST', 'admin', { campaignId: CID, action: 'linkProfile', profile: 'simon', email: 'p1@example.com' })).status).toBe(403);
  });
});

describe('Online API – infrastructure failures', () => {
  it('an unreachable database is reported as a clear 503, not a generic error', async () => {
    repo.profiles = async () => {
      throw new Error('profiles: TypeError: fetch failed');
    };
    const r = await call(null, 'POST', 'request-code', { email: 'p1@example.com', profile: 'hannah' });
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('db_unreachable');
  });
});
