import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { modifier } from '../src/game/items/modifiers';
import { salvageReward } from '../src/game/items/loot';
import type { GameState, Item } from '../src/game/types';
import { buildPlayerView } from '../src/game/visibility';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import type { GmPayload, PlayerPayload } from '../src/server/protocol';
import { parseCommand } from '../src/server/validate';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const GM = { role: 'gm' as const };
const SINNA = { role: 'player' as const, tokenId: 'sinna' };
const ASTER = { role: 'player' as const, tokenId: 'aster' };
function run(s: GameState, c: Command, actor: typeof GM | typeof SINNA = GM, seed?: number) {
  const r = executeCommand(s, actor, (seed !== undefined ? { ...c, seed } : c) as Command);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const sinnaItem = (s: GameState, id: string) => s.tokens.sinna.inventory.find((i) => i.id === id);
function fresh() {
  const s = createDemoState({ radius: 6, seed: 3 });
  s.tokens.sinna.inventory = [];
  s.tokens.sinna.equipment = undefined;
  return s;
}
const genSword = (s: GameState, opts: Partial<Extract<Command, { type: 'arsenalGenerate' }>> = {}, seed = 77) =>
  run(s, { type: 'arsenalGenerate', stagedId: 'sw', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 12, identified: false, ...opts }, GM, seed);

describe('GM Arsenal', () => {
  it('generates into the tray (GM-only), previews, gives and audits', () => {
    let s = genSword(fresh());
    const staged = s.arsenal!.staged[0];
    expect(staged).toMatchObject({ baseId: 'srd-longsword', rarity: 'rare', itemLevel: 12, identified: false, name: 'Longsword' });
    expect(staged.mods!.length).toBeGreaterThanOrEqual(3);
    expect(buildPlayerView(s, 'sinna')).not.toHaveProperty('arsenal');
    s = run(s, { type: 'arsenalGive', stagedId: 'sw', tokenId: 'sinna' });
    expect(s.arsenal!.staged).toHaveLength(0);
    expect(sinnaItem(s, 'sw')!.history!.map((h) => h.text)).toEqual(['Created in the GM Arsenal', 'Given to Sinna']);
    expect(s.itemAudit!.map((a) => a.action)).toEqual(['generate', 'give']);
    // giving twice is impossible
    expect(executeCommand(s, GM, { type: 'arsenalGive', stagedId: 'sw', tokenId: 'aster' }).ok).toBe(false);
  });

  it('generates and gives directly, several at once, with different rolls', () => {
    const s = run(fresh(), { type: 'arsenalGenerate', stagedId: 'r', baseId: 'apex-silver-ring', rarity: 'magic', itemLevel: 20, identified: true, count: 3, giveTo: 'sinna' }, GM, 1);
    const rings = s.tokens.sinna.inventory.filter((i) => i.baseId === 'apex-silver-ring');
    expect(rings.map((r) => r.id)).toEqual(['r', 'r-2', 'r-3']);
    expect(new Set(rings.map((r) => JSON.stringify(r.mods))).size).toBeGreaterThan(1);
    expect(rings[0].name).not.toBe('Silver Ring'); // identified magic items carry their affix name
  });

  it('refuses players, missing seeds and unknown bases', () => {
    const s = fresh();
    expect(executeCommand(s, SINNA, { type: 'arsenalGenerate', stagedId: 'x', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 30, identified: true, giveTo: 'sinna', seed: 1 }).ok).toBe(false);
    expect(executeCommand(s, SINNA, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'orb', amount: 99 }).ok).toBe(false);
    expect(executeCommand(s, GM, { type: 'arsenalGenerate', stagedId: 'x', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 30, identified: true }).ok).toBe(false);
    expect(executeCommand(s, GM, { type: 'arsenalGenerate', stagedId: 'x', baseId: 'nope', rarity: 'rare', itemLevel: 30, identified: true, seed: 1 }).ok).toBe(false);
  });

  it('revoking returns generated items to the tray with an audit entry; currency cannot go negative', () => {
    let s = genSword(fresh());
    s = run(s, { type: 'arsenalGive', stagedId: 'sw', tokenId: 'sinna' });
    s = run(s, { type: 'gmRevokeItem', tokenId: 'sinna', itemId: 'sw', reason: 'wrong player' });
    expect(sinnaItem(s, 'sw')).toBeUndefined();
    expect(s.arsenal!.staged.map((i) => i.id)).toEqual(['sw']);
    expect(s.itemAudit!.at(-1)).toMatchObject({ action: 'revoke', itemName: 'Longsword' });
    expect(s.itemAudit!.at(-1)!.detail).toContain('wrong player');
    s = run(s, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'seal', amount: 2 });
    expect(executeCommand(s, GM, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'seal', amount: -3 }).ok).toBe(false);
    s = run(s, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'seal', amount: -1 });
    expect(s.tokens.sinna.currency!.seal).toBe(1);
  });
});

describe('identify, equip, reroll, salvage, combine', () => {
  let s: GameState;
  beforeEach(() => {
    s = genSword(fresh());
    s = run(s, { type: 'arsenalGive', stagedId: 'sw', tokenId: 'sinna' });
    for (const [currency, amount] of [['seal', 2], ['orb', 2], ['fragment', 10]] as const) s = run(s, { type: 'gmGrantCurrency', tokenId: 'sinna', currency, amount });
  });

  it('unidentified: hidden from the player, no bonuses, cannot be equipped or rerolled', () => {
    const view = buildPlayerView(s, 'sinna').tokens.find((t) => t.id === 'sinna')!.details!;
    expect(view.inventory[0].mods).toBeUndefined();
    expect(view.currency).toEqual({ seal: 2, orb: 2, fragment: 10 });
    expect(buildPlayerView(s, 'aster').tokens.find((t) => t.id === 'sinna')?.details?.currency).toBeUndefined();
    expect(executeCommand(s, SINNA, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main1' }).ok).toBe(false);
    expect(executeCommand(s, SINNA, { type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 0, seed: 5 }).ok).toBe(false);
  });

  it('identify spends exactly one seal, reveals the rolled mods once, and a retry cannot spend again', () => {
    const before = sinnaItem(s, 'sw')!.mods;
    const s2 = run(s, { type: 'itemIdentify', tokenId: 'sinna', itemId: 'sw', rev: 0 }, SINNA);
    const sword = sinnaItem(s2, 'sw')!;
    expect(sword.identified).toBeUndefined();
    expect(sword.mods).toEqual(before); // revealed, not rerolled
    expect(sword.name).not.toBe('Longsword');
    expect(s2.tokens.sinna.currency!.seal).toBe(1);
    // the same request again (same rev) and a "fresh" one both fail – nothing is spent twice
    expect(executeCommand(s2, SINNA, { type: 'itemIdentify', tokenId: 'sinna', itemId: 'sw', rev: 0 }).ok).toBe(false);
    expect(executeCommand(s2, SINNA, { type: 'itemIdentify', tokenId: 'sinna', itemId: 'sw', rev: 1 }).ok).toBe(false);
    // the rare name is stable (derived from the item id) – identifying in another world copy gives the same name
    expect(sinnaItem(run(s, { type: 'itemIdentify', tokenId: 'sinna', itemId: 'sw', rev: 0 }, SINNA), 'sw')!.name).toBe(sword.name);
  });

  it('reroll keeps base, level, rarity and slot; spends one orb; uses valid tiers', () => {
    let t = run(s, { type: 'itemIdentify', tokenId: 'sinna', itemId: 'sw', rev: 0 }, SINNA);
    t = run(t, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main1' }, SINNA);
    const before = sinnaItem(t, 'sw')!;
    t = run(t, { type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 1 }, SINNA, 999);
    const after = sinnaItem(t, 'sw')!;
    expect(after).toMatchObject({ baseId: before.baseId, itemLevel: 12, rarity: 'rare', name: before.name });
    expect(after.mods).not.toEqual(before.mods);
    expect(t.tokens.sinna.equipment!.slots.main1).toBe('sw'); // still equipped, not duplicated
    expect(t.tokens.sinna.inventory.filter((i) => i.id === 'sw')).toHaveLength(1);
    expect(t.tokens.sinna.currency!.orb).toBe(1);
    for (const m of after.mods!) expect(modifier(m.modId)!.tiers.find((x) => x.tier === m.tier)!.ilvl).toBeLessThanOrEqual(12);
    expect(executeCommand(t, SINNA, { type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 1, seed: 1 }).ok).toBe(false); // stale rev
    t = run(t, { type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 2 }, SINNA, 1);
    expect(executeCommand(t, SINNA, { type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 3, seed: 2 }).ok).toBe(false); // no orbs left
  });

  it('normal items cannot be rerolled; salvage needs unequipping and pays the shown reward once', () => {
    let t = run(s, { type: 'arsenalGenerate', stagedId: 'club', baseId: 'srd-club', rarity: 'normal', itemLevel: 3, identified: true, giveTo: 'sinna' }, GM, 4);
    expect(executeCommand(t, SINNA, { type: 'itemReroll', tokenId: 'sinna', itemId: 'club', rev: 0, seed: 1 }).ok).toBe(false);
    t = run(t, { type: 'equipItem', tokenId: 'sinna', itemId: 'club', slot: 'main1' }, SINNA);
    expect(executeCommand(t, SINNA, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'club', rev: 0 })).toMatchObject({ ok: false, error: 'Unequip before salvaging.' });
    t = run(t, { type: 'unequipSlot', tokenId: 'sinna', slot: 'main1' }, SINNA);
    t = run(t, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'sw', rev: 0 }, SINNA);
    expect(t.tokens.sinna.currency!.fragment).toBe(10 + 5); // rare ilvl 12 → 5
    expect(executeCommand(t, SINNA, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'sw', rev: 0 }).ok).toBe(false);
    t = run(t, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'club', rev: 0 }, SINNA);
    expect(t.tokens.sinna.currency!.fragment).toBe(16);
  });

  it('salvage refuses free-text, locked and other players’ items', () => {
    let t = run(s, { type: 'invAddItem', tokenId: 'sinna', itemId: 'key', name: 'Old key' }, SINNA);
    expect(executeCommand(t, SINNA, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'key', rev: 0 }).ok).toBe(false);
    expect(executeCommand(t, ASTER, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'sw', rev: 0 }).ok).toBe(false);
    t = run(t, { type: 'gmSetItemLock', tokenId: 'sinna', itemId: 'sw', locked: true });
    expect(executeCommand(t, SINNA, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'sw', rev: 1 }).ok).toBe(false);
    expect(executeCommand(t, SINNA, { type: 'invRemoveItem', tokenId: 'sinna', itemId: 'sw', rev: 1 }).ok).toBe(false);
  });

  it('combines fragments atomically with a purse revision (no double spend)', () => {
    const rev = s.tokens.sinna.currencyRev!;
    const t = run(s, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: rev }, SINNA);
    expect(t.tokens.sinna.currency).toMatchObject({ fragment: 0, orb: 3 });
    expect(executeCommand(t, SINNA, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: rev }).ok).toBe(false);
    expect(executeCommand(s, SINNA, { type: 'combineFragments', tokenId: 'sinna', sets: 2, currencyRev: rev }).ok).toBe(false);
    // GM-configurable ratio
    const cheap = run(s, { type: 'setItemRules', rules: { fragmentsPerOrb: 5 } });
    expect(run(cheap, { type: 'combineFragments', tokenId: 'sinna', sets: 2, currencyRev: rev }, SINNA).tokens.sinna.currency).toMatchObject({ fragment: 0, orb: 4 });
  });

  it('reward table is predictable', () => {
    const r = (rarity: Item['rarity'], itemLevel: number) => salvageReward({ rarity, itemLevel });
    expect([r('normal', 1), r('normal', 30), r('magic', 1), r('magic', 15), r('rare', 1), r('rare', 12), r('rare', 30)]).toEqual([1, 1, 2, 3, 4, 5, 6]);
  });
});

describe('validator', () => {
  it('drops client seeds and rejects malformed loot commands', () => {
    const p = parseCommand({ type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 1, seed: 42 });
    expect(p.ok && 'seed' in p.command).toBe(false);
    const g = parseCommand({ type: 'arsenalGenerate', stagedId: 'a', baseId: 'srd-club', rarity: 'rare', itemLevel: 5, identified: true, seed: 7 });
    expect(g.ok && 'seed' in g.command).toBe(false);
    expect(parseCommand({ type: 'arsenalGenerate', stagedId: 'a', baseId: 'srd-club', rarity: 'unique', itemLevel: 5, identified: true }).ok).toBe(false);
    expect(parseCommand({ type: 'arsenalGenerate', stagedId: 'a', baseId: 'srd-club', rarity: 'rare', itemLevel: 31, identified: true }).ok).toBe(false);
    expect(parseCommand({ type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'gold', amount: 5 }).ok).toBe(false);
    expect(parseCommand({ type: 'combineFragments', tokenId: 'sinna', sets: 0, currencyRev: 0 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- through the real API handler (MemoryRepo)
describe('API: the full loot loop', () => {
  const CID = 'c-main';
  let repo: MemoryRepo;
  const call = (method: string, op: string, body: unknown, cookie?: string, query: Record<string, string> = {}) =>
    handleApi({ method, op, query, body, ip: '203.0.113.9', headers: { host: 'apex.test', ...(method === 'POST' ? { 'x-apex-csrf': '1', origin: 'https://apex.test' } : {}), ...(cookie ? { cookie } : {}) } } as ApiRequest, repo);
  async function login(profile: string, password: string) {
    const r = await call('POST', 'login', { profile, password });
    expect(r.status).toBe(200);
    return r.cookies![0].split(';')[0];
  }
  const cmd = (cookie: string, command: unknown, requestId?: string) => call('POST', 'command', { campaignId: CID, command, ...(requestId ? { requestId } : {}) }, cookie);

  beforeEach(async () => {
    resetSchemaCache();
    repo = new MemoryRepo();
    repo.campaigns.push({ id: CID, slug: 'main', name: 'Test' });
    seedProfiles(repo, CID);
    const st = createDemoState({ radius: 8, seed: 5 });
    st.tokens.sinna.inventory = [];
    repo.states.set(CID, { state: st, version: 1 });
    await activate(repo, CID, 'gm', 'gm-secret-pass');
    await activate(repo, CID, 'hannah', 'hannah-pass-1');
    await activate(repo, CID, 'jean', 'jean-pass-12');
  });

  it('GM → Sinna: generate, grant, identify, equip, reroll, salvage, combine; persisted and leak-free', async () => {
    const gm = await login('gm', 'gm-secret-pass');
    const hannah = await login('hannah', 'hannah-pass-1');
    const jean = await login('jean', 'jean-pass-12');
    // a client-supplied seed is ignored (two identical requests → different server rolls)
    expect((await cmd(gm, { type: 'arsenalGenerate', stagedId: 'sw', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 12, identified: false, seed: 1 })).status).toBe(200);
    expect((await cmd(gm, { type: 'arsenalGenerate', stagedId: 'sw2', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 12, identified: false, seed: 1 })).status).toBe(200);
    const tray = repo.states.get(CID)!.state.arsenal!.staged;
    expect(JSON.stringify(tray[0].mods)).not.toBe(JSON.stringify(tray[1].mods));
    expect((await cmd(gm, { type: 'arsenalGive', stagedId: 'sw', tokenId: 'sinna' })).status).toBe(200);
    expect((await cmd(gm, { type: 'arsenalGive', stagedId: 'sw2', tokenId: 'sinna' })).status).toBe(200);
    for (const [currency, amount] of [['seal', 2], ['orb', 2], ['fragment', 10]]) expect((await cmd(gm, { type: 'gmGrantCurrency', tokenId: 'sinna', currency, amount })).status).toBe(200);

    // players cannot generate, grant or touch others
    expect((await cmd(hannah, { type: 'arsenalGenerate', stagedId: 'h', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 30, identified: true, giveTo: 'sinna' })).status).toBe(403);
    expect((await cmd(hannah, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'orb', amount: 50 })).status).toBe(403);
    expect((await cmd(jean, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'sw', rev: 0 })).status).toBe(403);
    expect((await cmd(jean, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: 3 })).status).toBe(403);

    // Sinna sees the unidentified sword without its modifiers
    let me = ((await call("GET", "state", null, hannah)).body as PlayerPayload).view!.tokens.find((t) => t.id === 'sinna')!.details!;
    expect(me.inventory.find((i) => i.id === 'sw')!.mods).toBeUndefined();
    expect(JSON.stringify(me)).not.toMatch(/"modId"/);
    expect(me.currency).toEqual({ seal: 2, orb: 2, fragment: 10 });

    // identify – an exact retry (same request id) does not spend a second seal
    const idReq = { type: 'itemIdentify', tokenId: 'sinna', itemId: 'sw', rev: 0 };
    expect((await cmd(hannah, idReq, 'req-identify-0001')).status).toBe(200);
    const dup = await cmd(hannah, idReq, 'req-identify-0001');
    expect(dup.status).toBe(200);
    expect((dup.body as { duplicate?: boolean }).duplicate).toBe(true);
    expect((await cmd(hannah, idReq, 'req-identify-0002')).status).toBe(422);
    expect(repo.states.get(CID)!.state.tokens.sinna.currency!.seal).toBe(1);

    expect((await cmd(hannah, { type: 'equipItem', tokenId: 'sinna', itemId: 'sw', slot: 'main1' })).status).toBe(200);
    const beforeMods = repo.states.get(CID)!.state.tokens.sinna.inventory.find((i) => i.id === 'sw')!.mods;
    expect((await cmd(hannah, { type: 'itemReroll', tokenId: 'sinna', itemId: 'sw', rev: 1, seed: 1 })).status).toBe(200);
    const st = repo.states.get(CID)!.state;
    expect(st.tokens.sinna.inventory.find((i) => i.id === 'sw')!.mods).not.toEqual(beforeMods);
    expect(st.tokens.sinna.currency!.orb).toBe(1);

    expect((await cmd(hannah, { type: 'itemSalvage', tokenId: 'sinna', itemId: 'sw2', rev: 0 })).status).toBe(200);
    expect(repo.states.get(CID)!.state.tokens.sinna.currency!.fragment).toBe(15);
    const rev = repo.states.get(CID)!.state.tokens.sinna.currencyRev!;
    expect((await cmd(hannah, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: rev })).status).toBe(200);
    expect((await cmd(hannah, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: rev })).status).toBe(422);

    // "refresh": a new load sees everything; the GM can inspect inventory + audit
    me = ((await call("GET", "state", null, hannah)).body as PlayerPayload).view!.tokens.find((t) => t.id === 'sinna')!.details!;
    expect(me.currency).toEqual({ seal: 1, orb: 2, fragment: 5 });
    expect(me.inventory.map((i) => i.id)).toEqual(['sw']);
    expect(me.equipment!.slots.main1).toBe('sw');
    const gmState = ((await call("GET", "state", null, gm)).body as GmPayload).state!;
    expect(gmState.itemAudit!.map((a) => a.action)).toEqual(['generate', 'generate', 'give', 'give', 'currency', 'currency', 'currency', 'identify', 'reroll', 'salvage', 'combine']);
  });
});
