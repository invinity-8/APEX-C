import { stripLegacy } from '../src/game/migrate';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { GmPayload, PlayerPayload } from '../src/server/protocol';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const CID = 'c-main';
let repo: MemoryRepo;
let gm: string;
let hannah: string;
let jean: string;
const call = (method: string, op: string, body: unknown = null, query: Record<string, string> = {}, cookie?: string) =>
  handleApi({ method, op, query, body, ip: '203.0.113.30', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
const login = async (p: string, pw: string) => (await call('POST', 'login', { profile: p, password: pw })).cookies![0].split(';')[0];
// 1×1 images
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const WEBP = btoa('RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00/\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00');

beforeEach(async () => {
  resetSchemaCache();
  repo = new MemoryRepo();
  repo.campaigns.push({ id: CID, slug: 'main', name: 'APEX' });
  seedProfiles(repo, CID);
  repo.states.set(CID, { state: createDemoState({ radius: 8, seed: 2 }), version: 1 });
  await activate(repo, CID, 'gm', 'gm-secret-pass');
  await activate(repo, CID, 'hannah', 'hannah-pass-1');
  await activate(repo, CID, 'jean', 'jean-pass-12');
  gm = await login('gm', 'gm-secret-pass');
  hannah = await login('hannah', 'hannah-pass-1');
  jean = await login('jean', 'jean-pass-12');
});

describe('Character appearance (cosmetic)', () => {
  it('a player sets tag, colours and marker style of their own character; everybody sees it', async () => {
    const r = await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', title: 'Druid of the Wilds', color: '#3A7D44', accent: '#E9C46A', marker: 'gem' } }, {}, hannah);
    expect(r.status).toBe(200);
    const s = repo.states.get(CID)!.state.tokens.sinna;
    expect(s).toMatchObject({ title: 'Druid of the Wilds', color: '#3a7d44', accent: '#e9c46a', marker: 'gem' });
    const jv = (await call('GET', 'state', null, {}, jean)).body as PlayerPayload;
    // Jean sees Sinna's new look if Sinna is in his view (party shares); the view carries only cosmetics.
    const sinna = jv.view?.tokens.find((t) => t.id === 'sinna');
    if (sinna) expect(sinna).toMatchObject({ title: 'Druid of the Wilds', color: '#3a7d44', marker: 'gem' });
  });

  it('cosmetics cannot be used on other characters and never change rules or roles', async () => {
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'aster', title: 'Puppet' } }, {}, hannah)).status).toBe(403);
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', color: 'red' } }, {}, hannah)).status).toBe(400);
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', marker: 'crown' } }, {}, hannah)).status).toBe(400);
    const s0 = structuredClone(repo.states.get(CID)!.state);
    stripLegacy(s0); // the server's legacy reader normalises on read (e.g. rough item weights)
    const before = s0.tokens.sinna;
    await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'sinna', title: 'Game Master', marker: 'crest' } }, {}, hannah);
    const after = repo.states.get(CID)!.state.tokens.sinna;
    expect({ ...after, title: before.title, marker: before.marker, titleCustom: before.titleCustom }).toEqual(before); // nothing but cosmetics changed
    expect(((await call('GET', 'session', null, {}, hannah)).body as { user: { role: string } }).user.role).toBe('player');
    // the GM may restyle any character
    expect((await call('POST', 'command', { campaignId: CID, command: { type: 'setAppearance', tokenId: 'aster', accent: '#ffffff' } }, {}, gm)).status).toBe(200);
  });
});

describe('Portraits (private storage)', () => {
  it('uploads a validated image for the own character and serves it only via a signed URL', async () => {
    const up = await call('POST', 'portrait', { tokenId: 'sinna', image: `data:image/png;base64,${PNG}` }, {}, hannah);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body).toMatchObject({ tokenId: 'sinna', portraitV: 1 });
    const t = repo.states.get(CID)!.state.tokens.sinna;
    expect(t.portrait?.path).toMatch(/^c-main\/sinna\/[0-9a-f-]+\.png$/);
    // the path never reaches clients
    const gs = (await call('GET', 'state', null, {}, gm)).body as GmPayload;
    expect(JSON.stringify((await call('GET', 'state', null, {}, jean)).body)).not.toContain(t.portrait!.path);
    expect(gs.state?.tokens.sinna.portrait?.v).toBe(1);
    // campaign members get a short-lived redirect; strangers nothing
    const r = await call('GET', 'portrait', null, { token: 'sinna' }, jean);
    expect(r.status).toBe(302);
    expect(r.headers?.location).toContain(encodeURIComponent(t.portrait!.path));
    expect((await call('GET', 'portrait', null, { token: 'sinna' })).status).toBe(401);
    // a new upload replaces the old file
    await call('POST', 'portrait', { tokenId: 'sinna', image: WEBP }, {}, hannah);
    expect(repo.states.get(CID)!.state.tokens.sinna.portrait?.v).toBe(2);
    expect(repo.portraits.size).toBe(1);
  });

  it('rejects other characters, fake images and oversized files', async () => {
    expect((await call('POST', 'portrait', { tokenId: 'aster', image: PNG }, {}, hannah)).status).toBe(403);
    expect((await call('POST', 'portrait', { tokenId: 'sinna', image: btoa('<svg onload=alert(1)>') }, {}, hannah)).status).toBe(415);
    expect((await call('POST', 'portrait', { tokenId: 'sinna', image: 'A'.repeat(2_100_000) }, {}, hannah)).status).toBe(413);
    expect((await call('POST', 'portrait', { tokenId: 'aster', image: PNG }, {}, gm)).status).toBe(200); // GM may set any portrait
    expect((await call('GET', 'portrait', null, { token: 'javi' }, hannah)).status).toBe(404);
  });
});
