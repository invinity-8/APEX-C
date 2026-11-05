import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { baseItem } from '../src/game/items/bases';
import { seededRng } from '../src/game/items/generate';
import { createItem } from '../src/game/items/instance';
import { itemValue, sellOffer, DEFAULT_MERCHANT } from '../src/game/items/merchant';
import type { GameState, Item } from '../src/game/types';
import { buildPlayerView } from '../src/game/visibility';
import { handleApi, resetSchemaCache, type ApiRequest } from '../src/server/api';
import { parseCommand } from '../src/server/validate';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';

const GM = { role: 'gm' as const };
const P = { role: 'player' as const, tokenId: 'sinna' };
const run = (s: GameState, c: Command, actor: typeof GM | typeof P = GM) => {
  const r = executeCommand(s, actor, c);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const refuse = (s: GameState, c: Command, actor: typeof GM | typeof P = P) => {
  const r = executeCommand(s, actor, c);
  return r.ok ? null : r.error;
};
const potion = (id: string, q: number): Item => createItem(baseItem('srd-potion-of-healing')!, { id, rarity: 'normal', itemLevel: 1, rng: seededRng(1), quantity: q });
const sword = (id: string, rarity: 'normal' | 'magic' = 'normal'): Item => createItem(baseItem('srd-longsword')!, { id, rarity, itemLevel: 5, rng: seededRng(2) });

function shop(): GameState {
  let s = createDemoState({ radius: 6, seed: 3 });
  for (const t of Object.values(s.tokens)) {
    t.inventory = [];
    t.currency = {};
    t.currencyRev = 0;
  }
  s.tokens.sinna.currency = { gold: 200 };
  s.arsenal = { staged: [potion('pot', 5), sword('sw')] };
  s = run(s, { type: 'merchantSetup', active: true, gold: 100, buyRate: 50 });
  s = run(s, { type: 'merchantStockAdd', stagedId: 'pot', price: 50, currency: 'gold' });
  s = run(s, { type: 'merchantStockAdd', stagedId: 'sw', price: 30, currency: 'gold' });
  return s;
}
const rev = (s: GameState) => s.merchant!.rev;

describe('GM merchant', () => {
  it('only the GM configures it; stock is moved from the tray; closed merchants are invisible', () => {
    const s0 = createDemoState({ radius: 6, seed: 3 });
    expect(refuse(s0, { type: 'merchantSetup', active: true })).toMatch(/Game Master/);
    const s = shop();
    expect(s.arsenal!.staged).toHaveLength(0);
    expect(s.merchant!.stock.map((x) => x.id)).toEqual(['pot', 'sw']);
    expect(buildPlayerView(s, 'sinna').merchant!.stock).toHaveLength(2);
    const closed = run(s, { type: 'merchantSetup', active: false });
    expect(buildPlayerView(closed, 'sinna').merchant).toBeNull();
    expect(refuse(closed, { type: 'merchantBuy', tokenId: 'sinna', stockId: 'pot', quantity: 1, merchantRev: rev(closed), currencyRev: 0 })).toMatch(/not open/);
    const back = run(s, { type: 'merchantStockRemove', stockId: 'sw' });
    expect(back.arsenal!.staged.map((i) => i.id)).toEqual(['sw']);
  });

  it('buying part of a stack: atomic, no duplicate, no double spend', () => {
    let s = shop();
    expect(refuse(s, { type: 'merchantBuy', tokenId: 'sinna', stockId: 'pot', quantity: 5, merchantRev: rev(s), currencyRev: 0 })).toMatch(/need 250 Gold Pieces/);
    const buy: Command = { type: 'merchantBuy', tokenId: 'sinna', stockId: 'pot', quantity: 2, merchantRev: rev(s), currencyRev: 0 };
    s = run(s, buy, P);
    const t = s.tokens.sinna;
    expect(t.currency!.gold).toBe(100);
    expect(t.inventory.map((i) => [i.name, i.quantity])).toEqual([['Potion of Healing', 2]]);
    expect(s.merchant!.stock.find((x) => x.id === 'pot')!.item.quantity).toBe(3);
    expect(s.merchant!.gold).toBe(200);
    // the exact same request again (retry / double click) is refused: purse and merchant revisions moved on
    expect(refuse(s, buy)).toMatch(/changed in the meantime/);
    expect(refuse(s, { ...buy, merchantRev: rev(s) } as Command)).toMatch(/purse changed/);
    // somebody else bought the last sword first
    const aster = { role: 'player' as const, tokenId: 'aster' };
    s.tokens.aster.currency = { gold: 50 };
    const s2 = run(s, { type: 'merchantBuy', tokenId: 'aster', stockId: 'sw', quantity: 1, merchantRev: rev(s), currencyRev: 0 }, aster);
    expect(refuse(s2, { type: 'merchantBuy', tokenId: 'sinna', stockId: 'sw', quantity: 1, merchantRev: rev(s2), currencyRev: s2.tokens.sinna.currencyRev ?? 0 })).toMatch(/gone/);
    expect(s2.tokens.aster.inventory.map((i) => i.id)).toEqual(['sw']);
  });

  it('selling: value × rate, merchant gold limit, refused items, item moves into the stock', () => {
    let s = shop();
    const magic = sword('ms', 'magic');
    s.tokens.sinna.inventory = [{ ...magic, container: 'backpack' }, { ...potion('mine', 4), container: 'backpack' }, { id: 'q', name: 'Signet', kind: 'misc', description: '', quantity: 1, quest: {}, locked: true, baseId: 'apex-quest-token' }];
    expect(itemValue(magic)).toBe(45); // 15 gp × 3
    expect(sellOffer(s.merchant!, s.tokens.sinna, s.tokens.sinna.inventory[2])).toEqual({ refused: 'Quest items cannot be sold.' });
    expect(refuse(s, { type: 'merchantSell', tokenId: 'sinna', itemId: 'q', quantity: 1, rev: 0, merchantRev: rev(s) })).toMatch(/Quest/);
    s = run(s, { type: 'merchantSell', tokenId: 'sinna', itemId: 'ms', quantity: 1, rev: 0, merchantRev: rev(s) }, P);
    expect(s.tokens.sinna.currency!.gold).toBe(222); // 45 × 50 % = 22
    expect(s.merchant!.gold).toBe(78);
    expect(s.merchant!.stock.some((x) => x.id === 'ms' && x.price === 45)).toBe(true);
    expect(s.tokens.sinna.inventory.some((i) => i.id === 'ms')).toBe(false);
    // stack: sell 3 of 4 potions (3 × 50 × 50 % = 75 ≤ 78)
    s = run(s, { type: 'merchantSell', tokenId: 'sinna', itemId: 'mine', quantity: 3, rev: 0, merchantRev: rev(s) }, P);
    expect(s.tokens.sinna.inventory.find((i) => i.id === 'mine')!.quantity).toBe(1);
    expect(s.merchant!.gold).toBe(3);
    // now the merchant cannot pay for the last one (25 gold) – and the item revision changed anyway
    expect(refuse(s, { type: 'merchantSell', tokenId: 'sinna', itemId: 'mine', quantity: 1, rev: 1, merchantRev: rev(s) })).toMatch(/only has 3 gold/);
    expect(refuse(s, { type: 'merchantSell', tokenId: 'sinna', itemId: 'mine', quantity: 1, rev: 0, merchantRev: rev(s) })).toMatch(/changed in the meantime/);
    // equipped items are refused
    expect(sellOffer(DEFAULT_MERCHANT, { inventory: [], equipment: undefined }, magic)).toEqual({ refused: 'The merchant is not open.' });
  });

  it('validator drops unknown fields and rejects bad prices', () => {
    expect(parseCommand({ type: 'merchantStockAdd', stagedId: 'a', price: 0, currency: 'gold' }).ok).toBe(false);
    expect(parseCommand({ type: 'merchantStockAdd', stagedId: 'a', price: 5, currency: 'platinum' }).ok).toBe(false);
    const p = parseCommand({ type: 'merchantBuy', tokenId: 'sinna', stockId: 'x', quantity: 1, merchantRev: 0, currencyRev: 0, price: 0 });
    expect(p.ok && !('price' in p.command)).toBe(true);
  });
});

describe('merchant through the API: concurrent buyers', () => {
  const CID = 'c-main';
  let repo: MemoryRepo;
  const call = (body: unknown, cookie: string) =>
    handleApi({ method: 'POST', op: 'command', query: {}, body, ip: '203.0.113.7', headers: { host: 'apex.test', 'x-apex-csrf': '1', origin: 'https://apex.test', cookie } } as ApiRequest, repo);
  const login = async (p: string, pw: string) =>
    (await handleApi({ method: 'POST', op: 'login', query: {}, body: { profile: p, password: pw }, ip: '203.0.113.7', headers: { host: 'apex.test', 'x-apex-csrf': '1', origin: 'https://apex.test' } } as ApiRequest, repo)).cookies![0].split(';')[0];
  beforeEach(async () => {
    resetSchemaCache();
    repo = new MemoryRepo();
    repo.campaigns.push({ id: CID, slug: 'main', name: 'T' });
    seedProfiles(repo, CID);
    const s = shop();
    s.tokens.aster.currency = { gold: 200 };
    repo.states.set(CID, { state: s, version: 1 });
    await activate(repo, CID, 'hannah', 'hannah-pass-1');
    await activate(repo, CID, 'jean', 'jean-pass-12');
  });
  it('two players buying the last sword at once: exactly one gets it and pays', async () => {
    const [h, j] = [await login('hannah', 'hannah-pass-1'), await login('jean', 'jean-pass-12')];
    const m = repo.states.get(CID)!.state.merchant!.rev;
    const [a, b] = await Promise.all([
      call({ campaignId: CID, command: { type: 'merchantBuy', tokenId: 'sinna', stockId: 'sw', quantity: 1, merchantRev: m, currencyRev: 0 } }, h),
      call({ campaignId: CID, command: { type: 'merchantBuy', tokenId: 'aster', stockId: 'sw', quantity: 1, merchantRev: m, currencyRev: 0 } }, j),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const s = repo.states.get(CID)!.state as GameState;
    const owners = ['sinna', 'aster'].filter((id) => s.tokens[id].inventory.some((i) => i.id === 'sw'));
    expect(owners).toHaveLength(1);
    const paid = ['sinna', 'aster'].filter((id) => s.tokens[id].currency!.gold === 170);
    expect(paid).toEqual(owners);
    expect(s.merchant!.stock.some((x) => x.id === 'sw')).toBe(false);
  });
});
