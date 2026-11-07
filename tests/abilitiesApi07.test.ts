import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { refreshAllKnowledge, buildPlayerView } from '../src/game/visibility';
import { viewReach } from '../src/game/viewRules';
import { hexKey } from '../src/game/hex';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { SheetPayload } from '../src/server/protocol';
import { emptySheet } from '../src/game/sheet';
import { flatState } from './helpers';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const P = { role: 'player' as const, tokenId: 'sinna' };

describe('Sneak (APEX rule: half speed = double cost per step)', () => {
  it('doubles movement cost, never refills on toggling, and the reach display matches', () => {
    let s = flatState();
    s.tokens.sinna.movePoints = 3;
    refreshAllKnowledge(s);
    s = executeCommand(s, P, { type: 'setSneak', tokenId: 'sinna', on: true }).state;
    expect(s.tokens.sinna.movePoints).toBe(3);
    const r = executeCommand(s, P, { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } });
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.tokens.sinna.movePoints).toBe(1); // plains cost 1, sneaking 2
    expect(executeCommand(s, P, { type: 'move', tokenId: 'sinna', to: { q: 2, r: 0 } }).ok).toBe(false); // needs 2
    // toggling off and on does not create movement
    s = executeCommand(s, P, { type: 'setSneak', tokenId: 'sinna', on: false }).state;
    s = executeCommand(s, P, { type: 'setSneak', tokenId: 'sinna', on: true }).state;
    expect(s.tokens.sinna.movePoints).toBe(1);
    const view = buildPlayerView(s, 'sinna');
    const me = view.tokens.find((t) => t.id === 'sinna')!;
    expect(me.details!.sneaking).toBe(true);
    expect(viewReach(view, me).has(hexKey({ q: 2, r: 0 }))).toBe(false);
    s = executeCommand(s, P, { type: 'setSneak', tokenId: 'sinna', on: false }).state;
    const v2 = buildPlayerView(s, 'sinna');
    expect(viewReach(v2, v2.tokens.find((t) => t.id === 'sinna')!).has(hexKey({ q: 2, r: 0 }))).toBe(true);
    expect(executeCommand(s, { role: 'player', tokenId: 'aster' }, { type: 'setSneak', tokenId: 'sinna', on: true }).ok).toBe(false);
  });
});

describe('API: abilities, HP and beast pictures', () => {
  const CID = 'c-main';
  let repo: MemoryRepo;
  const call = (method: string, op: string, body: unknown, cookie?: string, query: Record<string, string> = {}) =>
    handleApi({ method, op, query, body, ip: '203.0.113.5', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1', origin: 'https://apex.test' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
  const login = async (p: string, pw: string) => (await call('POST', 'login', { profile: p, password: pw })).cookies![0].split(';')[0];
  let gm: string, hannah: string, jean: string;
  const sheet = (cookie: string) => call('GET', 'sheet', null, cookie, { token: 'sinna' }).then((r) => r.body as SheetPayload);
  beforeEach(async () => {
    resetSchemaCache();
    repo = new MemoryRepo();
    repo.campaigns.push({ id: CID, slug: 'main', name: 'T' });
    seedProfiles(repo, CID);
    repo.states.set(CID, { state: createDemoState({ radius: 8, seed: 2 }), version: 1 });
    await activate(repo, CID, 'gm', 'gm-secret-pass');
    await activate(repo, CID, 'hannah', 'hannah-pass-1');
    await activate(repo, CID, 'jean', 'jean-pass-12');
    gm = await login('gm', 'gm-secret-pass');
    hannah = await login('hannah', 'hannah-pass-1');
    jean = await login('jean', 'jean-pass-12');
    const s = { ...emptySheet(), hitPoints: { current: 20, max: 24, temp: 0 }, details: [{ id: 'd', label: 'Class', value: 'Druid 4 / Sorcerer 2' }], resources: [{ id: 's1', name: 'Spell slots (level 1)', current: 3, max: 4 }] };
    await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: s, expectedVersion: 0 }, hannah);
  });

  it('Wild Shape through the server: version-checked, separate HP, revert with carry-over, owner/GM only', async () => {
    expect((await call('POST', 'sheet', { action: 'wildShape', tokenId: 'sinna', formId: 'crocodile', expectedVersion: 1 }, jean)).status).toBe(403);
    expect((await call('POST', 'sheet', { action: 'wildShape', tokenId: 'sinna', formId: 'giant-eagle', expectedVersion: 1 }, hannah)).status).toBe(422); // CR 1 at druid 4
    const r = await call('POST', 'sheet', { action: 'wildShape', tokenId: 'sinna', formId: 'crocodile', expectedVersion: 1 }, hannah);
    expect(r.status).toBe(200);
    expect((r.body as SheetPayload).sheet.wildShape).toMatchObject({ formId: 'crocodile', hp: 19 });
    // a repeated click with the same version is refused (no second use spent)
    expect((await call('POST', 'sheet', { action: 'wildShape', tokenId: 'sinna', formId: 'wolf', expectedVersion: 1 }, hannah)).status).toBe(409);
    expect((await call('POST', 'sheet', { action: 'tempHp', tokenId: 'sinna', mode: 'grant', amount: 4, expectedVersion: 2 }, gm)).status).toBe(200);
    const hit = await call('POST', 'sheet', { action: 'damage', tokenId: 'sinna', amount: 30, expectedVersion: 3 }, gm);
    const after = (hit.body as SheetPayload).sheet;
    expect(after.wildShape).toBeUndefined(); // 4 temp + 19 beast, 7 carried over
    expect(after.hitPoints).toEqual({ current: 13, max: 24, temp: 0 });
    expect((await sheet(hannah)).sheet.resources.find((x) => x.name === 'Wild Shape')).toMatchObject({ current: 1, max: 2 });
  });

  it('Font of Magic uses the sorcerer level, not the character level', async () => {
    const r = await call('POST', 'sheet', { action: 'sorcery', tokenId: 'sinna', direction: 'toPoints', level: 1, expectedVersion: 1 }, hannah);
    expect(r.status).toBe(422); // SP created at max 2 → 2 + 1 > 2
    const ok = await call('POST', 'sheet', { action: 'sorcery', tokenId: 'sinna', direction: 'toSlot', level: 1, expectedVersion: 1 }, hannah);
    expect(ok.status).toBe(200);
    const s = (ok.body as SheetPayload).sheet;
    expect(s.resources.find((x) => x.name === 'Sorcery Points')).toMatchObject({ current: 0, max: 2 });
    expect(s.resources.find((x) => x.id === 's1')!.current).toBe(4);
  });

  it('Mage Armor cast is server-validated, versioned, consumes a slot once, and refreshes instead of stacking', async () => {
    const spell = { id: 'mage-armor', name: 'Mage Armor', level: 1, prepared: true, source: 'Wizard', notes: '', school: 'Abjuration', castingTime: '1 action', range: 'Touch', components: 'V, S, M', duration: '8 hours', concentration: false, ritual: false, description: '' };
    const initial = (await sheet(hannah)).sheet;
    const saved = await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...initial, spells: [spell] }, expectedVersion: 1 }, hannah);
    expect(saved.status).toBe(200);
    expect((await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 2 }, jean)).status).toBe(403);

    // Ordinary client sheet saves cannot create or extend server-managed effects.
    const forged = await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...initial, spells: [spell], spellEffects: [{ id: 'mage-armor', kind: 'mageArmor', spellId: 'mage-armor', castAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }] }, expectedVersion: 2 }, hannah);
    expect(forged.status).toBe(200);
    expect((forged.body as SheetPayload).sheet.spellEffects).toEqual([]);

    const cast = await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 3 }, hannah);
    expect(cast.status).toBe(200);
    const first = (cast.body as SheetPayload).sheet;
    expect(first.resources.find((resource) => resource.id === 's1')?.current).toBe(2);
    expect(first.spellEffects).toHaveLength(1);
    expect(Date.parse(first.spellEffects[0].expiresAt) - Date.parse(first.spellEffects[0].castAt)).toBe(8 * 60 * 60 * 1000);

    expect((await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 3 }, hannah)).status).toBe(409);
    const forgedExtension = await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...first, spellEffects: [{ ...first.spellEffects[0], expiresAt: new Date(Date.now() + 86_400_000).toISOString() }] }, expectedVersion: 4 }, hannah);
    expect(forgedExtension.status).toBe(200);
    expect((forgedExtension.body as SheetPayload).sheet.spellEffects[0].expiresAt).toBe(first.spellEffects[0].expiresAt);
    const refreshed = await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 5 }, hannah);
    expect(refreshed.status).toBe(200);
    expect((refreshed.body as SheetPayload).sheet.resources.find((resource) => resource.id === 's1')?.current).toBe(1);
    expect((refreshed.body as SheetPayload).sheet.spellEffects).toHaveLength(1);
  });

  it('Mage Armor refuses unprepared spells, empty slots and worn armor without spending resources', async () => {
    const spell = { id: 'mage-armor', name: 'Mage Armor', level: 1, prepared: false, source: 'Wizard', notes: '' };
    const initial = (await sheet(hannah)).sheet;
    await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...initial, spells: [spell] }, expectedVersion: 1 }, hannah);
    const unprepared = await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 2 }, hannah);
    expect(unprepared.status).toBe(422);
    expect((await sheet(hannah)).sheet.resources[0].current).toBe(3);

    const ready = { ...spell, prepared: true };
    await call('POST', 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...initial, spells: [ready], resources: [{ id: 's1', name: 'Spell slots (level 1)', current: 0, max: 4 }] }, expectedVersion: 2 }, hannah);
    expect((await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 3 }, hannah)).status).toBe(422);

    const campaign = repo.states.get(CID)!.state;
    campaign.tokens.sinna.inventory = [{ id: 'plate', kind: 'armor', name: 'Plate armor', description: '', quantity: 1, equip: { kind: 'armor', armorType: 'heavy', armorBase: 18 } }];
    campaign.tokens.sinna.equipment = { slots: {}, activeSet: 1, resting: false, restingKeep: [] };
    repo.states.set(CID, { state: campaign, version: repo.states.get(CID)!.version + 1 });
    const equip = await call('POST', 'command', { campaignId: CID, command: { type: 'equipItem', tokenId: 'sinna', itemId: 'plate', slot: 'chest' } }, hannah);
    expect(equip.status).toBe(200);
    expect(repo.states.get(CID)!.state.tokens.sinna.armorWornAt).toBeTruthy();
    expect((await call('POST', 'sheet', { action: 'castMageArmor', tokenId: 'sinna', spellId: 'mage-armor', expectedVersion: 3 }, hannah)).status).toBe(422);
    expect((await sheet(hannah)).sheet.resources[0].current).toBe(0);
  });

  it('beast pictures: owner or GM upload, validated, path never exposed', async () => {
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    expect((await call('POST', 'beast-image', { tokenId: 'sinna', formId: 'wolf', image: png }, jean)).status).toBe(403);
    expect((await call('POST', 'beast-image', { tokenId: 'sinna', formId: 'dragon', image: png }, hannah)).status).toBe(404);
    expect((await call('POST', 'beast-image', { tokenId: 'sinna', formId: 'wolf', image: 'data:image/png;base64,SGVsbG8=' }, hannah)).status).toBe(415);
    expect((await call('POST', 'beast-image', { tokenId: 'sinna', formId: 'wolf', image: png }, hannah)).status).toBe(200);
    const st = (await call('GET', 'state', null, hannah)).body as { view: { tokens: Array<{ id: string; details?: { beastImageV?: Record<string, number> } }> } };
    const me = st.view.tokens.find((t) => t.id === 'sinna')!;
    expect(me.details!.beastImageV).toEqual({ wolf: 1 });
    expect(JSON.stringify(st)).not.toMatch(/beast-wolf-/);
    expect((await call('GET', 'beast-image', null, jean, { token: 'sinna', form: 'wolf' })).status).toBe(302);
  });

  it('GM custom beasts are GM-only and validated', async () => {
    const cid = (await call('GET', 'state', null, gm)).body as { campaignId: string };
    const add = (cookie: string, beast: unknown) => call('POST', 'command', { campaignId: cid.campaignId, command: { type: 'gmSetBeast', beast } }, cookie);
    const lion = { id: 'arena-lion', name: 'Arena Lion', cr: 1, ac: 12, hp: 26, str: 17, dex: 15, con: 13, int: 3, wis: 12, cha: 8, speed: { walk: 50 } };
    expect((await add(hannah, lion)).status).toBe(403);
    expect((await add(gm, { ...lion, cr: 99 })).status).toBe(400);
    expect((await add(gm, lion)).status).toBe(200);
    expect(repo.states.get(CID)!.state.customBeasts![0].id).toBe('gm-arena-lion');
  });
});
