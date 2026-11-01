import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/game/commands';
import { createDemoState } from '../src/data/demo';
import { zoneStatus } from '../src/game/zone';
import { buildPlayerView } from '../src/game/visibility';
import { flatState } from './helpers';

const GM = { role: 'gm' } as const;

describe('Tageswechsel', () => {
  it('setzt Bewegungspunkte zurück und erhöht den Tag', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 3, r: 0 } }).state;
    expect(s.tokens.livia.movePoints).toBe(5);
    s = executeCommand(s, GM, { type: 'endDay' }).state;
    expect(s.day).toBe(2);
    expect(s.tokens.livia.movePoints).toBe(8);
    expect(s.log.some((e) => e.kind === 'day' && e.text.includes('Tag 2'))).toBe(true);
  });

  it('temporärer Sichtbonus verfällt bei Tageswechsel', () => {
    let s = flatState();
    s = executeCommand(s, GM, { type: 'adjustVisionBonus', tokenId: 'nyx', delta: 2 }).state;
    s = executeCommand(s, GM, { type: 'endDay' }).state;
    expect(s.tokens.nyx.visionBonus).toBe(0);
  });

  it('tagesgebundene Events lösen automatisch aus', () => {
    let s = createDemoState();
    const floodKey = s.events.flood.hexes[0];
    expect(s.hexes[floodKey].terrain).not.toBe('water');
    s = executeCommand(s, GM, { type: 'endDay' }).state; // Tag 2
    expect(s.events.flood.status).toBe('done');
    expect(s.hexes[floodKey].terrain).toBe('water');
    s = executeCommand(s, GM, { type: 'endDay' }).state; // Tag 3
    expect(s.sites['donum-imperatoris'].visibility).toBe('public');
    expect(buildPlayerView(s, 'livia').sites.some((x) => x.id === 'donum-imperatoris')).toBe(true);
  });

  it('manuelle Events lassen sich genau einmal auslösen', () => {
    let s = createDemoState();
    const r1 = executeCommand(s, GM, { type: 'triggerEvent', eventId: 'willstorm' });
    expect(r1.ok).toBe(true);
    expect(r1.state.tokens.livia.movePoints).toBe(6);
    s = r1.state;
    expect(executeCommand(s, GM, { type: 'triggerEvent', eventId: 'willstorm' }).ok).toBe(false);
  });

  it('Arena schrumpft ab dem konfigurierten Tag', () => {
    const s = createDemoState();
    const edge = { q: 12, r: 0 };
    expect(zoneStatus(s.config, 3, edge)).toBe('safe');
    expect(zoneStatus(s.config, 4, edge)).toBe('warning');
    expect(zoneStatus(s.config, 5, edge)).toBe('danger');
    expect(zoneStatus(s.config, 6, { q: 11, r: 0 })).toBe('warning');
    expect(zoneStatus(s.config, 7, { q: 11, r: 0 })).toBe('danger');
    expect(zoneStatus(s.config, 99, { q: 0, r: 0 })).toBe('safe');
  });

  it('gesperrte Zone verhindert Bewegung hinein', () => {
    let s = flatState(6);
    s.config.shrink = { ...s.config.shrink, enabled: true, startDay: 1, mode: 'closed' };
    s.tokens.livia.pos = { q: 3, r: 0 };
    const res = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 6, r: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/gesperrten Zone/);
  });
});
