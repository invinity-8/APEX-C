import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand, validateMove } from '../src/game/commands';
import { findPath, reachable } from '../src/game/movement';
import { hexKey } from '../src/game/hex';
import { TERRAIN } from '../src/game/terrain';
import { flatState, place, setTerrain } from './helpers';

const GM = { role: 'gm' } as const;
const asLivia = { role: 'player', tokenId: 'livia' } as const;

describe('Movement', () => {
  it('grassland costs 1 MP per hex', () => {
    const s = flatState();
    const res = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 3, r: 0 } });
    expect(res.ok).toBe(true);
    expect(res.state.tokens.livia.pos).toEqual({ q: 3, r: 0 });
    expect(res.state.tokens.livia.movePoints).toBe(5);
    // The original state is untouched
    expect(s.tokens.livia.pos).toEqual({ q: 0, r: 0 });
  });

  it('terrain costs are respected (forest 2, mountains 3, road 0.5, river 3)', () => {
    const s = flatState();
    setTerrain(s, { q: 1, r: 0 }, 'forest');
    setTerrain(s, { q: 2, r: 0 }, 'mountain');
    const lookup = (k: string) => s.hexes[k]?.terrain;
    expect(reachable({ q: 0, r: 0 }, 99, lookup).get('1,0')!.cost).toBe(2);
    expect(findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, lookup)!.cost).toBe(5);
    // Straight through forest + mountains (2+3+1=6) is more expensive than the detour over grassland (4)
    expect(findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup)!.cost).toBe(4);
    setTerrain(s, { q: 0, r: 1 }, 'road');
    expect(reachable({ q: 0, r: 0 }, 99, lookup).get('0,1')!.cost).toBe(0.5);
    setTerrain(s, { q: -1, r: 0 }, 'river');
    expect(reachable({ q: 0, r: 0 }, 99, lookup).get('-1,0')!.cost).toBe(TERRAIN.river.cost);
  });

  it('lakes are impassable – with a clear explanation', () => {
    const s = flatState();
    setTerrain(s, { q: 1, r: 0 }, 'water');
    const check = validateMove(s, GM, 'livia', { q: 1, r: 0 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/Lake is impassable/);
  });

  it('paths lead around water', () => {
    const s = flatState();
    for (const h of [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: 1 }]) setTerrain(s, h, 'water');
    const p = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, (k) => s.hexes[k]?.terrain);
    expect(p).not.toBeNull();
    expect(p!.path.every((h) => s.hexes[hexKey(h)].terrain !== 'water')).toBe(true);
  });

  it('not enough movement points → move rejected', () => {
    const s = flatState();
    s.tokens.livia.movePoints = 2;
    const res = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 3, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Not enough movement points: the path costs 3 MP/);
  });

  it('outside the arena is invalid', () => {
    const s = flatState(4);
    const c = validateMove(s, GM, 'livia', { q: 9, r: 0 });
    expect(c.ok).toBe(false);
  });

  it('players may only move their own character', () => {
    const s = flatState();
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'marcus', to: { q: 1, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only characters assigned to you/);
  });

  it('players can never move rival tokens', () => {
    const s = flatState();
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'r-ferrata', to: { q: 1, r: 0 } });
    expect(res.ok).toBe(false);
  });

  it('the GM can grant control permissions', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'toggleController', tokenId: 'marcus', controllerId: 'livia' }).state;
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'marcus', to: { q: 1, r: 0 } });
    expect(res.ok).toBe(true);
  });

  it('players cannot travel through unexplored terrain', () => {
    const s = flatState(8);
    place(s, 'livia', { q: 0, r: 0 });
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'livia', to: { q: 5, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Unexplored/);
  });

  it('players may not run GM commands', () => {
    const s = flatState();
    for (const cmd of [
      { type: 'endDay' },
      { type: 'advancePhase' },
      { type: 'place', tokenId: 'livia', to: { q: 2, r: 0 } },
      { type: 'adjustMovePoints', tokenId: 'livia', delta: 5 },
      { type: 'setTeamVisibility', teamId: 'ferrata', visibility: 'revealed' },
      { type: 'triggerEvent', eventId: 'willstorm' },
    ] as const) {
      const res = executeCommand(s, asLivia, cmd);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('Only the Game Master can do that.');
    }
  });

  it('the GM can place freely (any distance)', () => {
    const s = flatState();
    const res = executeCommand(s, GM, { type: 'place', tokenId: 'livia', to: { q: -5, r: 2 } });
    expect(res.ok).toBe(true);
    expect(res.state.tokens.livia.pos).toEqual({ q: -5, r: 2 });
    expect(res.state.tokens.livia.movePoints).toBe(8);
  });

  it('travel scale: crossing the full arena takes about a week or more', () => {
    const s = createDemoState();
    const R = s.config.mapRadius;
    const lookup = (k: string) => s.hexes[k]?.terrain;
    const mpPerDay = s.config.defaultMovePoints;
    // Cheapest known route from the west edge to the east edge (GM knowledge, all terrain).
    const west = Object.values(s.hexes).filter((h) => h.q === -R && lookup(hexKey(h)) && TERRAIN[h.terrain].cost !== null);
    const east = Object.values(s.hexes).filter((h) => h.q === R && TERRAIN[h.terrain].cost !== null);
    const from = west[Math.floor(west.length / 2)];
    const to = east[Math.floor(east.length / 2)];
    const path = findPath(from, to, lookup)!;
    expect(path).not.toBeNull();
    expect(path.cost / mpPerDay).toBeGreaterThanOrEqual(6);
    expect(mpPerDay).toBeLessThan(2 * R); // nobody crosses the arena within one day
  });
});
