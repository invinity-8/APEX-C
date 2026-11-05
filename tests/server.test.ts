import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import { SESSION_COOKIE } from '../src/server/auth';
import type { AdminOverview, GmPayload, PlayerPayload, PublicProfile, SessionInfo, SheetPayload } from '../src/server/protocol';
import { emptySheet } from '../src/game/sheet';
import { MemoryRepo } from './memoryRepo';
import { activate, addSetupCode, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;

describe('scene API authentication and privacy', () => {
  it('requires authentication and GM authority for library and preview', async () => {
    expect((await call('GET', 'scenes')).status).toBe(401);
    const cookie = await login('hannah', 'hannah-pass-1');
    expect((await as(cookie).get('scenes')).status).toBe(403);
    expect((await as(cookie).post('scenes', { category: 'battle', name: 'Private' })).status).toBe(403);
  });
  it('retains CSRF protection for GM scene writes', async () => {
    const cookie = await login('gm', 'gm-secret-pass');
    expect((await call('POST', 'scenes', { name: 'Map', category: 'world' }, {}, { cookie, headers: { 'x-apex-csrf': undefined as unknown as string } })).status).toBe(403);
  });
});

type Opts = { cookie?: string | null; headers?: Record<string, string>; ip?: string };
const call = (method: string, op: string, body: unknown = null, query: Record<string, string> = {}, o: Opts = {}) =>
  handleApi(
    {
      method,
      op,
      query,
      body,
      ip: o.ip ?? '203.0.113.7',
      headers: {
        host: 'apex.test',
        ...(method === 'POST' ? { 'x-apex-csrf': '1', origin: 'https://apex.test' } : {}),
        ...(o.cookie ? { cookie: o.cookie } : {}),
        ...o.headers,
      },
    } as ApiRequest,
    repo,
  );

/** Signs in and returns the "Cookie" header value for later requests. */
async function login(profile: string, password: string, ip?: string): Promise<string> {
  const r = await call('POST', 'login', { profile, password }, {}, { ip });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const set = r.cookies?.[0] ?? '';
  expect(set).toMatch(/HttpOnly/);
  expect(set).toMatch(/Secure/);
  expect(set).toMatch(/SameSite=Strict/);
  return set.split(';')[0];
}
const as = (cookie: string) => ({
  get: (op: string, query: Record<string, string> = {}) => call('GET', op, null, query, { cookie }),
  post: (op: string, body: unknown) => call('POST', op, body, {}, { cookie }),
  cmd: (command: unknown) => call('POST', 'command', { campaignId: CID, command }, {}, { cookie }),
  admin: (body: Record<string, unknown>) => call('POST', 'admin', { campaignId: CID, ...body }, {}, { cookie }),
});

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX Main Campaign' });
  seedProfiles(repo, CID);
  const s = createDemoState({ radius: 12, seed: 5 });
  // Keep each player's knowledge private for the leak tests.
  for (const t of Object.values(s.tokens)) t.sharesWithParty = false;
  repo.states.set(CID, { state: s, version: 1 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  await activate(repo, CID, 'jean', 'jean-pass-12');
});

describe('Password login', () => {
  it('the GM signs in with profile + password, no email involved', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    const s = (await gm.get('session')).body as SessionInfo;
    expect(s.user.role).toBe('gm');
    expect(s.campaigns[0].role).toBe('gm');
    expect(s.syncTopic).toMatch(/^apex-sync-/);
    expect(JSON.stringify(s)).not.toMatch(/@|argon2/);
  });

  it('Hannah plays Sinna and Jean plays Aster', async () => {
    const h = (await as(await login('hannah', 'hannah-pass-1')).get('state')).body as PlayerPayload;
    expect(h.role).toBe('player');
    expect(h.activeCharacter).toBe('sinna');
    expect(h.characters.map((c) => c.id)).toEqual(['sinna']);
    const j = (await as(await login('jean', 'jean-pass-12')).get('state')).body as PlayerPayload;
    expect(j.activeCharacter).toBe('aster');
  });

  it('rejects wrong passwords without creating a session', async () => {
    const r = await call('POST', 'login', { profile: 'hannah', password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect((r.body as { code: string }).code).toBe('wrong_password');
    expect(r.cookies).toBeUndefined();
    expect(repo.sessions.size).toBe(0);
  });

  it('a player cannot become GM: GM card needs the GM password; role comes only from the database', async () => {
    expect((await call('POST', 'login', { profile: 'gm', password: 'hannah-pass-1' })).status).toBe(401);
    const h = as(await login('hannah', 'hannah-pass-1'));
    // forged fields are ignored
    const s = (await call('GET', 'session', null, { role: 'gm', profile: 'gm' }, { cookie: (await login('hannah', 'hannah-pass-1')) })).body as SessionInfo;
    expect(s.user.role).toBe('player');
    expect((await h.admin({ action: 'overview', role: 'gm' })).status).toBe(403);
    expect((await h.cmd({ type: 'endDay' })).status).toBe(403);
    expect((await h.admin({ action: 'setPassword', profile: 'gm', password: 'takeover-123' })).status).toBe(403);
  });

  it('profiles without a password stay locked; the public list reveals no account data', async () => {
    const r = await call('POST', 'login', { profile: 'simon', password: 'anything-123' });
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe('profile_locked');
    const list = (await call('GET', 'profiles')).body as { profiles: PublicProfile[] };
    expect(Object.fromEntries(list.profiles.map((p) => [p.key, p.active]))).toEqual({ gm: true, hannah: true, jean: true, simon: false, jerba: false });
    expect(JSON.stringify(list)).not.toMatch(/argon|hash|@/);
  });

  it('rejects requests without a valid session cookie (and forged tokens)', async () => {
    for (const op of ['session', 'state', 'sheet']) expect((await call('GET', op)).status).toBe(401);
    expect((await call('GET', 'state', null, {}, { cookie: `${SESSION_COOKIE}=${'x'.repeat(43)}` })).status).toBe(401);
    expect((await call('GET', 'state', null, {}, { cookie: `${SESSION_COOKIE}=bad` })).status).toBe(401);
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'endDay' } })).status).toBe(401);
  });

  it('rate-limits wrong passwords per profile, without blocking other profiles', async () => {
    for (let i = 0; i < 5; i++) expect((await call('POST', 'login', { profile: 'hannah', password: `nope-${i}xxxx` })).status).toBe(401);
    const blocked = await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' });
    expect(blocked.status).toBe(429);
    expect((blocked.body as { retryAfter: number }).retryAfter).toBeGreaterThan(60);
    await login('jean', 'jean-pass-12'); // Jean is not affected
    repo.now = () => Date.now() + 16 * 60_000; // window passes
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60_000;
    try {
      await login('hannah', 'hannah-pass-1');
    } finally {
      Date.now = realNow;
    }
  });

  it('rate-limits many failures from one IP across profiles', async () => {
    const { createHash } = await import('node:crypto');
    const ipHash = createHash('sha256').update('apex-ip:198.51.100.9').digest('hex');
    for (let i = 0; i < 19; i++) repo.attempts.push({ profileKey: `p${i}`, ipHash, ok: false, at: Date.now() - 1000 });
    expect((await call('POST', 'login', { profile: 'gm', password: 'wrong-pass-x' }, {}, { ip: '198.51.100.9' })).status).toBe(401);
    expect((await call('POST', 'login', { profile: 'jean', password: 'jean-pass-12' }, {}, { ip: '198.51.100.9' })).status).toBe(429);
    expect((await call('POST', 'login', { profile: 'jean', password: 'jean-pass-12' }, {}, { ip: '198.51.100.10' })).status).toBe(200);
  });

  it('logout revokes the session on the server and clears the cookie', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    const r = await call('POST', 'logout', null, {}, { cookie: c });
    expect(r.cookies?.[0]).toMatch(/Max-Age=0/);
    expect((await as(c).get('state')).status).toBe(401);
  });

  it('sessions expire', async () => {
    const c = await login('jean', 'jean-pass-12');
    for (const s of repo.sessions.values()) s.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await as(c).get('state')).status).toBe(401);
  });

  it('blocks cross-site POSTs (CSRF)', async () => {
    const c = await login('hannah', 'hannah-pass-1');
    const noHeader = await call('POST', 'command', { campaignId: CID, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } }, {}, { cookie: c, headers: { 'x-apex-csrf': '' } });
    expect(noHeader.status).toBe(403);
    const foreign = await call('POST', 'command', { campaignId: CID, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } }, {}, { cookie: c, headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    expect((await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' }, {}, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('a player can change their own password; other devices are signed out', async () => {
    const phone = await login('hannah', 'hannah-pass-1');
    const laptop = await login('hannah', 'hannah-pass-1');
    expect((await as(laptop).post('password', { current: 'wrong', next: 'new-password-9' })).status).toBe(401);
    expect((await as(laptop).post('password', { current: 'hannah-pass-1', next: 'short' })).status).toBe(400);
    expect((await as(laptop).post('password', { current: 'hannah-pass-1', next: 'new-password-9' })).status).toBe(200);
    expect((await as(laptop).get('state')).status).toBe(200);
    expect((await as(phone).get('state')).status).toBe(401);
    await login('hannah', 'new-password-9');
  });
});

describe('GM password management', () => {
  it('stores only Argon2id hashes', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    await gm.admin({ action: 'setPassword', profile: 'simon', password: 'simon-first-1' });
    const c = await repo.credential(CID, 'simon');
    expect(c?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(c?.passwordHash).not.toContain('simon-first-1');
  });

  it('initialising a password activates the profile; Simon can then play Elwin', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    const ov = (await gm.admin({ action: 'setPassword', profile: 'simon', password: 'simon-first-1' })).body as AdminOverview;
    const simon = ov.profiles.find((p) => p.key === 'simon')!;
    expect(simon.passwordSet && simon.active).toBe(true);
    expect(JSON.stringify(ov)).not.toMatch(/argon|simon-first/);
    const s = (await as(await login('simon', 'simon-first-1')).get('state')).body as PlayerPayload;
    expect(s.activeCharacter).toBe('elwin');
  });

  it('resetting a password revokes all sessions of that profile', async () => {
    const hannah = await login('hannah', 'hannah-pass-1');
    const gm = as(await login('gm', 'gm-secret-pass'));
    await gm.admin({ action: 'setPassword', profile: 'hannah', password: 'hannah-reset-2' });
    expect((await as(hannah).get('state')).status).toBe(401);
    expect((await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' })).status).toBe(401);
    await login('hannah', 'hannah-reset-2');
  });

  it('deactivating a profile revokes access immediately and blocks new logins', async () => {
    const jean = await login('jean', 'jean-pass-12');
    const gm = as(await login('gm', 'gm-secret-pass'));
    const topicBefore = ((await gm.get('session')).body as SessionInfo).syncTopic;
    await gm.admin({ action: 'setActive', profile: 'jean', active: false });
    expect((await as(jean).get('state')).status).toBe(401);
    expect((await as(jean).cmd({ type: 'move', tokenId: 'aster', to: { q: 1, r: 0 } })).status).toBe(401);
    expect((await call('POST', 'login', { profile: 'jean', password: 'jean-pass-12' })).status).toBe(403);
    // the live-update topic is rotated so the removed device stops receiving pings
    expect(((await gm.get('session')).body as SessionInfo).syncTopic).not.toBe(topicBefore);
    await gm.admin({ action: 'setActive', profile: 'jean', active: true });
    await login('jean', 'jean-pass-12');
  });

  it('the GM cannot lock themselves out', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    expect((await gm.admin({ action: 'setActive', profile: 'gm', active: false })).status).toBe(400);
    expect((await gm.admin({ action: 'clearPassword', profile: 'gm' })).status).toBe(400);
  });

  it('removing a password locks the profile again', async () => {
    const jean = await login('jean', 'jean-pass-12');
    const gm = as(await login('gm', 'gm-secret-pass'));
    await gm.admin({ action: 'clearPassword', profile: 'jean' });
    expect((await as(jean).get('state')).status).toBe(401);
    expect((await call('POST', 'login', { profile: 'jean', password: 'jean-pass-12' })).status).toBe(403);
  });

  it('assigns or changes the character of a profile; one character belongs to one profile', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    expect((await gm.admin({ action: 'setProfileCharacters', profile: 'jean', tokenIds: ['sinna'] })).status).toBe(400);
    expect((await gm.admin({ action: 'setProfileCharacters', profile: 'simon', tokenIds: ['r-ferrata'] })).status).toBe(400);
    expect((await gm.admin({ action: 'setProfileCharacters', profile: 'jean', tokenIds: ['aster', 'elwin'] })).status).toBe(400); // Elwin is Simon's
    await gm.admin({ action: 'setProfileCharacters', profile: 'simon', tokenIds: [] });
    expect((await gm.admin({ action: 'setProfileCharacters', profile: 'jean', tokenIds: ['aster', 'elwin'] })).status).toBe(200);
    const j = as(await login('jean', 'jean-pass-12'));
    expect(((await j.get('state')).body as PlayerPayload).characters.map((c) => c.id)).toEqual(['aster', 'elwin']);
    expect((await j.cmd({ type: 'move', tokenId: 'elwin', to: { q: -1, r: 1 } })).status).toBe(200);
  });

  it('shows online status and signed-in devices to the GM only', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    await h.get('ping');
    const gm = as(await login('gm', 'gm-secret-pass'));
    const ov = (await gm.admin({ action: 'overview' })).body as AdminOverview;
    const hp = ov.profiles.find((p) => p.key === 'hannah')!;
    expect(hp.online).toBe(true);
    expect(hp.sessions).toBe(1);
    expect((await h.admin({ action: 'overview' })).status).toBe(403);
    await gm.admin({ action: 'revokeSessions', profile: 'hannah' });
    expect((await h.get('state')).status).toBe(401);
  });
});

describe('One-time GM setup code', () => {
  beforeEach(async () => {
    await repo.setCredential(CID, 'gm', null);
    await repo.updateProfile(CID, 'gm', { active: false });
  });

  it('the GM profile needs setup until a password is set', async () => {
    const list = (await call('GET', 'profiles')).body as { profiles: PublicProfile[] };
    expect(list.profiles.find((p) => p.key === 'gm')).toEqual({ key: 'gm', active: false, needsSetup: true });
    expect(((await call('POST', 'login', { profile: 'gm', password: 'whatever-123' })).body as { code: string }).code).toBe('needs_setup');
  });

  it('a valid code sets the GM password once and signs the GM in', async () => {
    const code = addSetupCode(repo, CID);
    const r = await call('POST', 'setup', { code: code.toLowerCase(), password: 'my-gm-password' });
    expect(r.status).toBe(200);
    const s = (await as(r.cookies![0].split(';')[0]).get('session')).body as SessionInfo;
    expect(s.user.role).toBe('gm');
    // single use
    expect((await call('POST', 'setup', { code, password: 'attacker-pass1' })).status).toBe(401);
    await login('gm', 'my-gm-password');
  });

  it('rejects wrong and expired codes, and validates the password before using up the code', async () => {
    expect((await call('POST', 'setup', { code: 'FFFF-FFFF-FFFF-FFFF-FFFF-FFFF', password: 'my-gm-password' })).status).toBe(401);
    const code = addSetupCode(repo, CID, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', 1000);
    expect((await call('POST', 'setup', { code, password: 'short' })).status).toBe(400);
    expect(repo.setupCodes.at(-1)?.usedAt).toBeNull();
    repo.now = () => Date.now() + 5000;
    expect((await call('POST', 'setup', { code, password: 'my-gm-password' })).status).toBe(401);
  });

  it('setup attempts are rate-limited', async () => {
    for (let i = 0; i < 5; i++) await call('POST', 'setup', { code: `${i}AAA-BBBB-CCCC-DDDD-EEEE-FFFF`, password: 'my-gm-password' });
    const code = addSetupCode(repo, CID);
    expect((await call('POST', 'setup', { code, password: 'my-gm-password' })).status).toBe(429);
  });
});

describe('Filtered state and commands (unchanged multiplayer rules)', () => {
  it('only the GM receives the full GameState', async () => {
    const gm = (await as(await login('gm', 'gm-secret-pass')).get('state')).body as GmPayload;
    expect(gm.role).toBe('gm');
    expect(gm.state?.config.seed).toBe(5);
    const p1 = (await as(await login('hannah', 'hannah-pass-1')).get('state')).body as PlayerPayload;
    expect(p1).not.toHaveProperty('state');
    const json = JSON.stringify(p1);
    for (const secret of ['"seed"', 'Templum Oblitum', 'informant', 'Arena generated', 'gmNotes', 'mapRadius":12']) expect(json).not.toContain(secret);
    expect(p1.view?.mapRadius).toBeNull();
  });

  it('players cannot request another player’s perspective', async () => {
    const res = (await as(await login('hannah', 'hannah-pass-1')).get('state', { as: 'aster' })).body as PlayerPayload;
    expect(res.activeCharacter).toBe('sinna');
  });

  it('a player moves their own character; the move is saved and visible to the GM', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    const r = await h.cmd({ type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } });
    expect(r.status).toBe(200);
    expect(repo.states.get(CID)!.version).toBe(2);
    const gm = (await as(await login('gm', 'gm-secret-pass')).get('state')).body as GmPayload;
    expect(gm.state!.tokens.sinna.pos).toEqual({ q: 1, r: 0 });
  });

  it('players cannot move characters that are not assigned to them', async () => {
    const r = await as(await login('hannah', 'hannah-pass-1')).cmd({ type: 'move', tokenId: 'aster', to: { q: 1, r: 1 } });
    expect(r.status).toBe(403);
  });

  it('players cannot run GM commands, even with forged fields', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    for (const command of [{ type: 'endDay' }, { type: 'place', tokenId: 'sinna', to: { q: 5, r: 0 } }, { type: 'adjustMovePoints', tokenId: 'sinna', delta: 50 }]) {
      expect((await h.cmd(command)).status).toBe(403);
    }
    expect(repo.states.get(CID)!.version).toBe(1);
  });

  it('malformed commands are rejected before reaching the game logic', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    expect((await gm.cmd({ type: 'move', tokenId: 'sinna', to: { q: 'x' } })).status).toBe(400);
    expect((await gm.cmd({ type: 'invAddItem', tokenId: 'sinna', itemId: 'a b', name: 'x' })).status).toBe(400);
  });

  it('concurrent writes are re-validated instead of overwriting each other', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    const gm = as(await login('gm', 'gm-secret-pass'));
    repo.beforeSave = () => {
      const cur = repo.states.get(CID)!;
      const s = structuredClone(cur.state);
      s.tokens.aster.pos = { q: 2, r: -1 };
      repo.states.set(CID, { state: s, version: cur.version + 1 });
    };
    expect((await h.cmd({ type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } })).status).toBe(200);
    const st = ((await gm.get('state')).body as GmPayload).state!;
    expect(st.tokens.aster.pos).toEqual({ q: 2, r: -1 });
    expect(st.tokens.sinna.pos).toEqual({ q: 1, r: 0 });
  });

  it('the GM advances the phase; a dawn snapshot is created; ping reports the version', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    await gm.cmd({ type: 'advancePhase' });
    await gm.cmd({ type: 'advancePhase' });
    expect(repo.snapshots.some((s) => s.label.startsWith('Dawn'))).toBe(true);
    const ping = (await gm.get('ping')).body as { version: number; syncTopic: string };
    expect(ping.version).toBe(3);
    expect(ping.syncTopic).toMatch(/^apex-sync-/);
  });

  it('every command attempt is written to the audit log with the profile id', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    await h.cmd({ type: 'endDay' });
    await h.cmd({ type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } });
    expect(repo.log.map((l) => [l.userId, l.ok])).toEqual([
      ['00000000-0000-4000-8000-000000000002', false],
      ['00000000-0000-4000-8000-000000000002', true],
    ]);
  });

  it('a new arena archives the old world first; snapshots can still be restored', async () => {
    const gm = as(await login('gm', 'gm-secret-pass'));
    await gm.admin({ action: 'createSnapshot', label: 'Manual' });
    await gm.admin({ action: 'initCampaign', radius: 8, seed: 42 });
    expect(repo.states.get(CID)!.state.config.mapRadius).toBe(8);
    expect(repo.archives[0]).toMatchObject({ radius: 12, kind: 'before-create' });
    const id = repo.snapshots.find((s) => s.label === 'Manual')!.id;
    await gm.admin({ action: 'restoreSnapshot', id });
    expect(repo.states.get(CID)!.state.config.mapRadius).toBe(12);
  });
});

describe('Inventory (authoritative game state)', () => {
  it('a player adds a free-text item to their own inventory; the GM sees the same record', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    const r = await h.cmd({ type: 'invAddItem', tokenId: 'sinna', itemId: 'itm-key', name: 'Old iron key, wrapped in red cloth', container: 'pockets' });
    expect(r.status).toBe(200);
    const mine = (r.body as PlayerPayload).view!.tokens.find((t) => t.id === 'sinna')!.details!;
    expect(mine.inventory.find((i) => i.id === 'itm-key')).toMatchObject({ name: 'Old iron key, wrapped in red cloth', quantity: 1, container: 'pockets' });
    // existing items are preserved and get a default container
    expect(mine.inventory.find((i) => i.name === 'Aqueduct-Stone Staff')?.container).toBe('equipped');
    const gmState = ((await as(await login('gm', 'gm-secret-pass')).get('state')).body as GmPayload).state!;
    expect(gmState.tokens.sinna.inventory.some((i) => i.id === 'itm-key')).toBe(true);
  });

  it('custom containers can be created, renamed and deleted only when empty', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    expect((await h.cmd({ type: 'invAddContainer', tokenId: 'sinna', containerId: 'c-chest', name: 'Hidden Chest' })).status).toBe(200);
    await h.cmd({ type: 'invAddItem', tokenId: 'sinna', itemId: 'itm-1', name: 'Silver ring', container: 'c-chest' });
    expect((await h.cmd({ type: 'invRemoveContainer', tokenId: 'sinna', containerId: 'c-chest' })).status).toBe(422);
    await h.cmd({ type: 'invUpdateItem', tokenId: 'sinna', itemId: 'itm-1', rev: 0, container: 'backpack' });
    expect((await h.cmd({ type: 'invRenameContainer', tokenId: 'sinna', containerId: 'c-chest', name: 'Old Chest' })).status).toBe(200);
    expect((await h.cmd({ type: 'invRemoveContainer', tokenId: 'sinna', containerId: 'c-chest' })).status).toBe(200);
  });

  it('players cannot touch another character’s inventory; the GM can', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    expect((await h.cmd({ type: 'invAddItem', tokenId: 'aster', itemId: 'itm-x', name: 'Planted evidence' })).status).toBe(403);
    expect((await h.cmd({ type: 'invRemoveItem', tokenId: 'aster', itemId: 'i4', rev: 0 })).status).toBe(403);
    const gm = as(await login('gm', 'gm-secret-pass'));
    expect((await gm.cmd({ type: 'invUpdateItem', tokenId: 'aster', itemId: 'i4', rev: 0, quantity: 2, notes: 'Notched' })).status).toBe(200);
  });

  it('inventories are private: party members never receive each other’s items', async () => {
    const s = repo.states.get(CID)!;
    for (const t of Object.values(s.state.tokens)) t.sharesWithParty = true;
    const view = ((await as(await login('hannah', 'hannah-pass-1')).get('state')).body as PlayerPayload).view!;
    const aster = view.tokens.find((t) => t.id === 'aster')!;
    expect(aster.details?.inventory).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('Scutum');
  });

  it('simultaneous edits of the same item cannot silently overwrite each other', async () => {
    const phone = as(await login('hannah', 'hannah-pass-1'));
    const gm = as(await login('gm', 'gm-secret-pass'));
    expect((await gm.cmd({ type: 'invUpdateItem', tokenId: 'sinna', itemId: 'i1', rev: 0, quantity: 3 })).status).toBe(200);
    const stale = await phone.cmd({ type: 'invUpdateItem', tokenId: 'sinna', itemId: 'i1', rev: 0, quantity: 7 });
    expect(stale.status).toBe(422);
    expect((stale.body as { error: string }).error).toMatch(/changed on another device/);
    expect(repo.states.get(CID)!.state.tokens.sinna.inventory.find((i) => i.id === 'i1')!.quantity).toBe(3);
    // edits of different items both survive a concurrent write
    repo.beforeSave = () => {
      const cur = repo.states.get(CID)!;
      const st = structuredClone(cur.state);
      st.tokens.sinna.inventory.find((i) => i.id === 'i2')!.notes = 'from the laptop';
      repo.states.set(CID, { state: st, version: cur.version + 1 });
    };
    expect((await phone.cmd({ type: 'invUpdateItem', tokenId: 'sinna', itemId: 'i1', rev: 1, quantity: 4 })).status).toBe(200);
    const inv = repo.states.get(CID)!.state.tokens.sinna.inventory;
    expect(inv.find((i) => i.id === 'i1')!.quantity).toBe(4);
    expect(inv.find((i) => i.id === 'i2')!.notes).toBe('from the laptop');
  });

  it('the legacy Willpower command no longer exists (APEX 0.7)', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    expect((await h.cmd({ type: 'setWill', tokenId: 'sinna', current: 4 })).status).toBe(400);
  });
});

describe('Character sheets', () => {
  const sheet = (over: Record<string, unknown> = {}) => ({
    ...emptySheet(),
    hitPoints: { current: 12, max: 20, temp: 0 },
    attributes: [{ id: 'str', name: 'Strength', value: '14', modifier: '+2' }],
    resources: [{ id: 'r-luck', name: 'Luck', current: 3, max: 3 }],
    notes: 'Secret backstory of Sinna',
    ...over,
  });

  it('a player creates and edits their sheet; it persists and the GM can read and edit it', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    const empty = (await h.get('sheet', { token: 'sinna' })).body as SheetPayload;
    expect(empty.version).toBe(0);
    const saved = (await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet(), expectedVersion: 0 })).body as SheetPayload;
    expect(saved.version).toBe(1);
    const again = (await h.get('sheet', { token: 'sinna' })).body as SheetPayload;
    expect(again.sheet.hitPoints).toEqual({ current: 12, max: 20, temp: 0 });
    const gm = as(await login('gm', 'gm-secret-pass'));
    const g = (await gm.get('sheet', { token: 'sinna' })).body as SheetPayload;
    expect(g.sheet.notes).toContain('Secret backstory');
    expect((await gm.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet({ notes: 'GM edit' }), expectedVersion: 1 })).status).toBe(200);
  });

  it('a player cannot read or change another player’s sheet', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet(), expectedVersion: 0 });
    const j = as(await login('jean', 'jean-pass-12'));
    const r = await j.get('sheet', { token: 'sinna' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('Secret backstory');
    expect((await j.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet(), expectedVersion: 1 })).status).toBe(403);
    expect((await j.post('sheet', { action: 'adjust', tokenId: 'sinna', target: 'hp', delta: -5 })).status).toBe(403);
    expect((await j.get('sheet', { token: 'r-ferrata' })).status).toBe(404);
  });

  it('simultaneous saves of the same sheet are rejected with the current version, not overwritten', async () => {
    const phone = as(await login('hannah', 'hannah-pass-1'));
    const laptop = as(await login('hannah', 'hannah-pass-1'));
    await phone.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet(), expectedVersion: 0 });
    await phone.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet({ notes: 'phone' }), expectedVersion: 1 });
    const r = await laptop.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet({ notes: 'laptop' }), expectedVersion: 1 });
    expect(r.status).toBe(409);
    expect((r.body as { code: string; current: SheetPayload }).current.sheet.notes).toBe('phone');
  });

  it('+/- on a resource is applied atomically even when another device saved in between', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet(), expectedVersion: 0 });
    repo.beforeSheetSave = () => {
      const k = `${CID}:sinna`;
      const cur = repo.sheets.get(k)!;
      const d = structuredClone(cur.data) as ReturnType<typeof sheet>;
      d.resources[0].current = 2;
      repo.sheets.set(k, { ...cur, data: d, version: cur.version + 1 });
    };
    const r = (await h.post('sheet', { action: 'adjust', tokenId: 'sinna', target: 'hp', delta: -5 })).body as SheetPayload;
    expect(r.sheet.hitPoints?.current).toBe(7);
    expect(r.sheet.resources[0].current).toBe(2);
  });

  it('imports back up the previous sheet before replacing it', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet(), expectedVersion: 0 });
    await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet({ notes: 'imported', source: { kind: 'pdf', fileName: 'sinna.pdf' } }), expectedVersion: 1, reason: 'import-replace' });
    expect(repo.sheetBackups).toHaveLength(1);
    expect((repo.sheetBackups[0].data as { notes: string }).notes).toBe('Secret backstory of Sinna');
  });

  it('rejects invalid sheets', async () => {
    const h = as(await login('hannah', 'hannah-pass-1'));
    expect((await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: { attributes: 'nope' }, expectedVersion: 0 })).status).toBe(400);
    expect((await h.post('sheet', { action: 'save', tokenId: 'sinna', sheet: sheet({ hitPoints: { current: 'a', max: 3 } }), expectedVersion: 0 })).status).toBe(400);
  });
});

describe('Infrastructure and deployment health', () => {
  it('an unreachable database is reported as a clear 503, not a generic error', async () => {
    repo.profiles = async () => {
      throw new Error('profiles: TypeError: fetch failed');
    };
    const r = await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' });
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('db_unreachable');
  });

  it('reports a complete deployment without email/SMTP checks', async () => {
    const h = (await call('GET', 'health')).body as { migrationsComplete: boolean; errors: string[]; schemaVersion: number };
    expect(h.migrationsComplete).toBe(true);
    expect(h.schemaVersion).toBe(6);
    expect(h.errors).toEqual([]);
    expect(JSON.stringify(h)).not.toMatch(/smtp|email/i);
  });

  it('names missing and unknown migrations instead of claiming success', async () => {
    repo.deploy = { ...repo.deploy, migrations: ['20261101094428'] };
    const h = (await call('GET', 'health')).body as { migrationsComplete: boolean; missingMigrations: string[]; unknownMigrations: string[] };
    expect(h.migrationsComplete).toBe(false);
    expect(h.missingMigrations).toContain('20261101173039');
    expect(h.unknownMigrations).toEqual(['20261101094428']);
  });

  it('reports database-side security problems', async () => {
    repo.deploy = { ...repo.deploy, securityProblems: ['RLS off on apex_sessions'] };
    const h = (await call('GET', 'health')).body as { securityOk: boolean; errors: string[] };
    expect(h.securityOk).toBe(false);
  });

  it('refuses requests while the database schema is older than the code', async () => {
    repo.deploy = { ...repo.deploy, schemaVersion: 3 };
    const r = await call('POST', 'login', { profile: 'hannah', password: 'hannah-pass-1' });
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('schema_outdated');
  });
});
