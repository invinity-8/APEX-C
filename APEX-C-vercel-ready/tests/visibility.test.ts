import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/game/commands';
import { buildPlayerView } from '../src/game/visibility';
import { createDemoState } from '../src/data/demo';
import { distance } from '../src/game/hex';
import { flatState, place } from './helpers';

const GM = { role: 'gm' } as const;

describe('Fog of War & Sichtbarkeit', () => {
  it('Startsicht: Radius 2 sichtbar, Rest unerforscht ohne Geländeinformation', () => {
    const s = flatState(8);
    for (const t of Object.values(s.tokens)) if (t.kind === 'player') t.sharesWithParty = false;
    place(s, 'livia', { q: 0, r: 0 });
    const v = buildPlayerView(s, 'livia');
    const visible = v.hexes.filter((h) => h.fog === 'visible');
    expect(visible).toHaveLength(19); // 1 + 6 + 12
    const far = v.hexByKey['6,0'];
    expect(far.fog).toBe('unexplored');
    expect(far.terrain).toBeNull();
  });

  it('erforschte Felder bleiben bekannt, sind aber nicht mehr sichtbar', () => {
    let s = flatState(8);
    s = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 4, r: 0 } }).state;
    s = executeCommand(s, GM, { type: 'place', tokenId: 'livia', to: { q: 4, r: 0 } }).state;
    for (const t of Object.values(s.tokens)) if (t.id !== 'livia') t.sharesWithParty = false;
    const v = buildPlayerView(s, 'livia');
    // Startfeld liegt jetzt außerhalb der eigenen Sicht? (0,0)→(4,0) Abstand 4 > 2
    expect(v.hexByKey['-1,0'].fog).toBe('explored');
    expect(v.hexByKey['-1,0'].terrain).toBe('plains');
    expect(v.hexByKey['4,0'].fog).toBe('visible');
  });

  it('auch unterwegs wird aufgeklärt (nicht nur am Ziel)', () => {
    let s = flatState(10);
    s = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 8, r: 0 } }).state;
    expect(s.knowledge.livia.explored['4,-2']).toBe('plains');
  });

  it('Sichtbonus des GM vergrößert die Sicht', () => {
    let s = flatState(8);
    for (const t of Object.values(s.tokens)) t.sharesWithParty = false;
    s = executeCommand(s, GM, { type: 'adjustVisionBonus', tokenId: 'livia', delta: 2 }).state;
    const v = buildPlayerView(s, 'livia');
    expect(v.hexes.filter((h) => h.fog === 'visible')).toHaveLength(61); // Radius 4
  });

  it('Rivalen sind nur im Sichtfeld sichtbar; danach bleibt nur die letzte Sichtung', () => {
    let s = flatState(8);
    place(s, 'r-ferrata', { q: 2, r: 0 });
    let v = buildPlayerView(s, 'livia');
    expect(v.tokens.some((t) => t.id === 'r-ferrata')).toBe(true);
    s = executeCommand(s, GM, { type: 'place', tokenId: 'r-ferrata', to: { q: 7, r: 0 } }).state;
    v = buildPlayerView(s, 'livia');
    expect(v.tokens.some((t) => t.id === 'r-ferrata')).toBe(false);
    const team = v.teams.find((t) => t.id === 'ferrata')!;
    expect(team.lastSeen?.pos).toEqual({ q: 2, r: 0 });
    expect(team.currentlyVisible).toBe(false);
  });

  it('vom GM verborgene Teams bleiben selbst im Sichtfeld unsichtbar', () => {
    let s = flatState(8);
    s = executeCommand(s, GM, { type: 'setTeamVisibility', teamId: 'vesperia', visibility: 'hidden' }).state;
    place(s, 'r-vesperia', { q: 1, r: 0 });
    const v = buildPlayerView(s, 'livia');
    expect(v.tokens.some((t) => t.teamId === 'vesperia')).toBe(false);
    expect(v.teams.some((t) => t.id === 'vesperia')).toBe(false);
  });

  it('Tracking zeigt einen Marker, deckt aber kein Gelände auf', () => {
    let s = flatState(8);
    place(s, 'r-aquaeductus', { q: -6, r: 0 });
    s = executeCommand(s, GM, { type: 'setTracking', teamId: 'aquaeductus', mode: 'exact' }).state;
    const v = buildPlayerView(s, 'livia');
    expect(v.trackers).toHaveLength(1);
    expect(v.trackers[0].pos).toEqual({ q: -6, r: 0 });
    expect(v.hexByKey['-6,0'].terrain).toBeNull();
    expect(v.tokens.some((t) => t.id === 'r-aquaeductus')).toBe(false);
  });

  it('ungenaues Tracking liegt höchstens 2 Felder neben der echten Position', () => {
    let s = flatState(8);
    place(s, 'r-aquaeductus', { q: -5, r: 1 });
    s = executeCommand(s, GM, { type: 'setTracking', teamId: 'aquaeductus', mode: 'approx' }).state;
    const tr = s.teams.aquaeductus.tracking!;
    expect(distance(tr.pos, { q: -5, r: 1 })).toBeLessThanOrEqual(2);
  });

  it('Spieleransicht enthält keine geheimen GM-Daten', () => {
    const s = createDemoState();
    const v = buildPlayerView(s, 'livia');
    const json = JSON.stringify(v);
    expect(json).not.toContain('Templum Oblitum'); // versteckter Ort
    expect(json).not.toContain('Informantin'); // GM-Notiz
    expect(json).not.toContain('"seed"');
    expect(json).not.toContain('Arena erzeugt'); // GM-Logeintrag
    expect(v.tokens.every((t) => t.kind === 'player')).toBe(true); // keine Rivalen in Startsicht
    expect(v.sites.every((site) => !('gmNotes' in site))).toBe(true);
  });

  it('nicht teilende Gruppenmitglieder sind unsichtbar', () => {
    let s = flatState(8);
    s = executeCommand(s, GM, { type: 'toggleShare', tokenId: 'nyx' }).state;
    s = executeCommand(s, GM, { type: 'place', tokenId: 'nyx', to: { q: -6, r: 0 } }).state;
    const v = buildPlayerView(s, 'livia');
    expect(v.tokens.some((t) => t.id === 'nyx')).toBe(false);
    expect(v.hexByKey['-6,0'].fog).toBe('unexplored');
  });
});
