import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { baseItem } from '../src/game/items/bases';
import { seededRng } from '../src/game/items/generate';
import { createItem } from '../src/game/items/instance';
import { medianLevel } from '../src/game/items/lootDraft';
import { ranking, rollOff } from '../src/game/items/partyLoot';
import type { GameState, Item } from '../src/game/types';
import { buildGmView, buildPlayerView } from '../src/game/visibility';
import { parseCommand } from '../src/server/validate';

const GM = { role: 'gm' as const };
const as = (tokenId: string) => ({ role: 'player' as const, tokenId });
const T0 = Date.parse('2026-11-05T10:00:00Z');
let seed = 1;
function run(s: GameState, c: Command, actor: { role: 'gm' } | { role: 'player'; tokenId: string } = GM) {
  const r = executeCommand(s, actor, { seed: seed++, now: T0, ...c } as Command);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const refuse = (s: GameState, c: Command, actor: { role: 'gm' } | { role: 'player'; tokenId: string } = GM) => {
  const r = executeCommand(s, actor, { seed: 7, now: T0, ...c } as Command);
  return r.ok ? null : r.error;
};
const sword = (id: string): Item => createItem(baseItem('srd-longsword')!, { id, rarity: 'rare', itemLevel: 10, rng: seededRng(3), identified: false });

function fresh(): GameState {
  const s = createDemoState({ radius: 6, seed: 3 });
  for (const t of Object.values(s.tokens)) {
    t.inventory = [];
    t.currency = {};
  }
  s.arsenal = { staged: [sword('loot-a'), sword('loot-b'), { id: 'bundle', name: '9 Arcane Fragments', kind: 'misc', description: '', quantity: 1, grant: { currency: 'fragment', amount: 9 } }] };
  return s;
}
const players = (s: GameState) => Object.values(s.tokens).filter((t) => t.kind === 'player').map((t) => t.id);
const start = (s: GameState, stagedIds = ['loot-a'], tokenIds = players(s).slice(0, 3)) => run(s, { type: 'lootRollStart', rollId: 'r1', stagedIds, tokenIds, minutes: 5 });

describe('d100 roll-off', () => {
  it('re-rolls ties for the top until there is one winner, deterministically per seed', () => {
    for (let sd = 1; sd < 300; sd++) {
      const res = rollOff(['a', 'b', 'c', 'd', 'e', 'f'], sd);
      expect(res.every((r) => r.rolls.every((n) => n >= 1 && n <= 100))).toBe(true);
      const order = ranking(res);
      const [w, second] = order.map((id) => res.find((r) => r.tokenId === id)!.rolls);
      expect(w.join() === second.join()).toBe(false);
      expect(rollOff(['a', 'b', 'c', 'd', 'e', 'f'], sd)).toEqual(res);
    }
    // a forced tie: with 101 rollers at least two share a value, and still exactly one winner
    const many = rollOff(Array.from({ length: 101 }, (_, i) => `p${i}`), 5);
    expect(many.some((r) => r.rolls.length > 1)).toBe(true);
    const order = ranking(many);
    expect(many.find((r) => r.tokenId === order[0])!.rolls.join()).not.toBe(many.find((r) => r.tokenId === order[1])!.rolls.join());
  });
  it('median party level uses the lower middle', () => {
    expect(medianLevel([])).toBe(1);
    expect(medianLevel([3, 9, 5])).toBe(5);
    expect(medianLevel([2, 4, 6, 8])).toBe(4);
    expect(medianLevel([25])).toBe(20);
  });
});

describe('Need / Distribute / Pass', () => {
  it('only the GM starts rolls; the item leaves the tray and exists exactly once', () => {
    const s0 = fresh();
    expect(refuse(s0, { type: 'lootRollStart', rollId: 'r', stagedIds: ['loot-a'], tokenIds: ['sinna'], minutes: 5 }, as('sinna'))).toMatch(/Game Master/);
    const s = start(s0);
    expect(s.arsenal!.staged.map((i) => i.id)).toEqual(['loot-b', 'bundle']);
    expect(s.lootRolls![0]).toMatchObject({ id: 'r1-1', status: 'open', deadline: new Date(T0 + 300_000).toISOString() });
    expect(s.log.at(-1)!.text).toMatch(/Loot roll: .* may choose Need, Distribute or Pass \(5 min\)/);
    expect(refuse(s, { type: 'lootRollStart', rollId: 'r2', stagedIds: ['loot-a'], tokenIds: ['sinna'], minutes: 5 })).toMatch(/no longer in the Arsenal tray/);
    // client cannot inject seed/now
    const p = parseCommand({ type: 'lootRollChoose', rollId: 'r1-1', tokenId: 'sinna', choice: 'need', seed: 1, now: 0 });
    expect(p.ok && !('seed' in p.command) && !('now' in p.command)).toBe(true);
    expect(parseCommand({ type: 'lootRollChoose', rollId: 'r1-1', tokenId: 'sinna', choice: 'greed' }).ok).toBe(false);
  });

  it('Need beats Distribute; the winner gets the item atomically; results are public in the Chronicle', () => {
    let s = start(fresh());
    const [a, b, c] = players(s);
    s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: a, choice: 'distribute' }, as(a));
    s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: b, choice: 'need' }, as(b));
    expect(s.lootRolls![0].status).toBe('open');
    // players only see their own choice and who has decided
    const pv = buildPlayerView(s, c).lootRolls[0];
    expect(pv.choices).toEqual({});
    expect(pv.decided!.sort()).toEqual([a, b].sort());
    expect(pv.item!.mods).toBeUndefined(); // unidentified stays redacted
    expect(buildGmView(s).lootRolls[0].choices).toEqual({ [a]: 'distribute', [b]: 'need' });
    s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: c, choice: 'pass' }, as(c));
    const roll = s.lootRolls![0];
    expect(roll.status).toBe('won');
    expect(roll.winner).toBe(b); // the only Need
    expect(roll.item).toBeUndefined();
    expect(s.tokens[b].inventory.map((i) => i.id)).toEqual(['loot-a']);
    expect([a, c].every((id) => !s.tokens[id].inventory.length)).toBe(true);
    expect(roll.results!.find((r) => r.tokenId === b)!.rolls.length).toBeGreaterThan(0);
    expect(roll.results!.find((r) => r.tokenId === a)!.rolls).toEqual([]); // Distribute does not roll when someone needs it
    expect(s.log.at(-1)!.text).toMatch(new RegExp(`${s.tokens[b].name} wins \\(Need`));
    expect(buildPlayerView(s, a).lootRolls[0].choices[b]).toBe('need'); // public after resolution
    // retries after resolution are refused, never applied twice
    expect(refuse(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: a, choice: 'need' }, as(a))).toMatch(/already been resolved/);
    expect(refuse(s, { type: 'lootRollResolve', rollId: 'r1-1' })).toMatch(/already been resolved/);
  });

  it('all Distribute: highest d100 wins; everybody passes → back to the tray', () => {
    let s = start(fresh(), ['loot-a', 'loot-b']);
    const [a, b, c] = players(s);
    for (const id of [a, b, c]) s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: id, choice: 'distribute' }, as(id));
    const r = s.lootRolls!.find((x) => x.id === 'r1-1')!;
    const best = ranking(r.results!)[0];
    expect(r.winner).toBe(best);
    for (const id of [a, b, c]) s = run(s, { type: 'lootRollChoose', rollId: 'r1-2', tokenId: id, choice: 'pass' }, as(id));
    const r2 = s.lootRolls!.find((x) => x.id === 'r1-2')!;
    expect(r2).toMatchObject({ status: 'returned', note: 'Everybody passed.' });
    expect(s.arsenal!.staged.some((i) => i.id === 'loot-b')).toBe(true);
  });

  it('disconnected players: after the deadline unanswered counts as Pass, and any eligible player (or the GM) closes it', () => {
    let s = start(fresh());
    const [a, b] = players(s);
    s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: a, choice: 'need' }, as(a));
    expect(refuse(s, { type: 'lootRollClaimExpired', rollId: 'r1-1', tokenId: a }, as(a))).toMatch(/still open/);
    const late = { now: T0 + 301_000 };
    expect(refuse(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: b, choice: 'need', ...late }, as(b))).toMatch(/time for this loot roll is up/);
    s = run(s, { type: 'lootRollClaimExpired', rollId: 'r1-1', tokenId: b, ...late }, as(b));
    expect(s.lootRolls![0]).toMatchObject({ status: 'won', winner: a, resolvedBy: 'deadline' });
    expect(s.lootRolls![0].results!.find((r) => r.tokenId === b)!.choice).toBe('pass');
    // a character outside the roll cannot close it
    let s2 = start(fresh(), ['loot-a'], [a]);
    const outsider = players(s2)[2];
    expect(refuse(s2, { type: 'lootRollClaimExpired', rollId: 'r1-1', tokenId: outsider, ...late }, as(outsider))).toMatch(/Only characters/);
    s2 = run(s2, { type: 'lootRollResolve', rollId: 'r1-1' }); // GM, before the deadline
    expect(s2.lootRolls![0]).toMatchObject({ status: 'returned', resolvedBy: 'GM' });
  });

  it('a full inventory passes the item to the next roller; currency bundles go to the purse', () => {
    let s = start(fresh(), ['loot-a', 'bundle']);
    const [a, b, c] = players(s);
    const filler = (n: number): Item => ({ id: `f${n}`, name: 'Pebble', kind: 'misc', description: '', quantity: 1 });
    s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: c, choice: 'pass' }, as(c));
    s = run(s, { type: 'lootRollChoose', rollId: 'r1-1', tokenId: a, choice: 'need' }, as(a));
    // make whoever ranks first unable to carry it: fill both inventories, then free b
    s = structuredClone(s);
    s.tokens[a].inventory = Array.from({ length: 300 }, (_, n) => filler(n));
    // find a server seed for which the full character (a) rolls highest – the item must still go to b
    let hit = false;
    for (let sd = 1; sd < 200 && !hit; sd++) {
      const r = executeCommand(s, as(b), { type: 'lootRollChoose', rollId: 'r1-1', tokenId: b, choice: 'need', seed: sd, now: T0 });
      if (!r.ok) throw new Error(r.error);
      const roll = r.state.lootRolls![0];
      if (ranking(roll.results!.filter((x) => x.rolls.length))[0] !== a) continue;
      hit = true;
      expect(roll).toMatchObject({ status: 'won', winner: b });
      expect(r.state.tokens[a].inventory).toHaveLength(300);
      s = r.state;
    }
    expect(hit).toBe(true);
    for (const id of [a, b, c]) s = run(s, { type: 'lootRollChoose', rollId: 'r1-2', tokenId: id, choice: id === c ? 'need' : 'pass' }, as(id));
    expect(s.tokens[c].currency?.fragment).toBe(9);
  });

  it('cancel returns the item to the tray; history keeps at most 20 resolved rolls', () => {
    let s = start(fresh());
    s = run(s, { type: 'lootRollCancel', rollId: 'r1-1' });
    expect(s.lootRolls![0]).toMatchObject({ status: 'returned', note: 'Cancelled by the Game Master.' });
    expect(s.arsenal!.staged.some((i) => i.id === 'loot-a')).toBe(true);
    expect(refuse(s, { type: 'lootRollCancel', rollId: 'r1-1' })).toMatch(/already been resolved/);
    for (let n = 0; n < 25; n++) {
      s = run(s, { type: 'lootRollStart', rollId: `x${n}`, stagedIds: ['loot-a'], tokenIds: [players(s)[0]], minutes: 1 });
      s = run(s, { type: 'lootRollCancel', rollId: `x${n}-1` });
    }
    expect(s.lootRolls!.length).toBe(20);
  });
});
