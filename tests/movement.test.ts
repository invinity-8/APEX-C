import { describe, expect, it } from 'vitest';
import { executeCommand, validateMove } from '../src/game/commands';
import { findPath, reachable } from '../src/game/movement';
import { hexKey } from '../src/game/hex';
import { flatState, place, setTerrain } from './helpers';

const GM = { role: 'gm' } as const;
const asLivia = { role: 'player', tokenId: 'livia' } as const;

describe('Bewegung', () => {
  it('Ebene kostet 1 BP pro Feld', () => {
    const s = flatState();
    const res = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 3, r: 0 } });
    expect(res.ok).toBe(true);
    expect(res.state.tokens.livia.pos).toEqual({ q: 3, r: 0 });
    expect(res.state.tokens.livia.movePoints).toBe(5);
    // Ursprünglicher Zustand bleibt unverändert
    expect(s.tokens.livia.pos).toEqual({ q: 0, r: 0 });
  });

  it('Geländekosten werden berücksichtigt (Wald 2, Gebirge 3, Straße 0,5)', () => {
    const s = flatState();
    setTerrain(s, { q: 1, r: 0 }, 'forest');
    setTerrain(s, { q: 2, r: 0 }, 'mountain');
    const lookup = (k: string) => s.hexes[k]?.terrain;
    expect(reachable({ q: 0, r: 0 }, 99, lookup).get('1,0')!.cost).toBe(2);
    // Gebirge betreten kostet 3: bester Weg ist 1 (Ebene) + 1 + 3 bzw. 2 (Wald) + 3 = 5
    expect(findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, lookup)!.cost).toBe(5);
    // Direkt durch Wald + Gebirge (2+3+1=6) ist teurer als der Umweg über Ebene (4)
    expect(findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup)!.cost).toBe(4);
    setTerrain(s, { q: 0, r: 1 }, 'road');
    expect(reachable({ q: 0, r: 0 }, 99, lookup).get('0,1')!.cost).toBe(0.5);
  });

  it('Wasser ist unpassierbar – mit verständlicher Begründung', () => {
    const s = flatState();
    setTerrain(s, { q: 1, r: 0 }, 'water');
    const check = validateMove(s, GM, 'livia', { q: 1, r: 0 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/Wasser ist nicht passierbar/);
  });

  it('Wege führen um Wasser herum', () => {
    const s = flatState();
    for (const h of [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: 1 }]) setTerrain(s, h, 'water');
    const p = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, (k) => s.hexes[k]?.terrain);
    expect(p).not.toBeNull();
    expect(p!.path.every((h) => s.hexes[hexKey(h)].terrain !== 'water')).toBe(true);
  });

  it('zu wenig Bewegungspunkte → Bewegung abgelehnt', () => {
    const s = flatState();
    s.tokens.livia.movePoints = 2;
    const res = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 3, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Zu wenig Bewegungspunkte: Der Weg kostet 3 BP/);
  });

  it('außerhalb der Arena ist ungültig', () => {
    const s = flatState(4);
    const c = validateMove(s, GM, 'livia', { q: 9, r: 0 });
    expect(c.ok).toBe(false);
  });

  it('Spieler dürfen nur die eigene Figur bewegen', () => {
    const s = flatState();
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'marcus', to: { q: 1, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nur deine eigene Figur/);
  });

  it('GM kann Steuerrechte erteilen', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'toggleController', tokenId: 'marcus', controllerId: 'livia' }).state;
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'marcus', to: { q: 1, r: 0 } });
    expect(res.ok).toBe(true);
  });

  it('Spieler können nicht durch unerforschtes Gelände ziehen', () => {
    const s = flatState(8);
    place(s, 'livia', { q: 0, r: 0 });
    const res = executeCommand(s, asLivia, { type: 'move', tokenId: 'livia', to: { q: 5, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Unerforscht/);
  });

  it('Spieler dürfen keine GM-Befehle ausführen', () => {
    const s = flatState();
    expect(executeCommand(s, asLivia, { type: 'endDay' }).ok).toBe(false);
    expect(executeCommand(s, asLivia, { type: 'place', tokenId: 'livia', to: { q: 2, r: 0 } }).ok).toBe(false);
  });

  it('GM kann frei platzieren (auch über Distanz)', () => {
    const s = flatState();
    const res = executeCommand(s, GM, { type: 'place', tokenId: 'livia', to: { q: -5, r: 2 } });
    expect(res.ok).toBe(true);
    expect(res.state.tokens.livia.pos).toEqual({ q: -5, r: 2 });
    expect(res.state.tokens.livia.movePoints).toBe(8);
  });
});
