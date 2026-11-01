import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/game/commands';
import { buildGmView, buildPlayerView } from '../src/game/visibility';
import { createDemoState } from '../src/data/demo';
import { distance, hexKey } from '../src/game/hex';
import { flatState, place } from './helpers';

const GM = { role: 'gm' } as const;

describe('Fog of War & visibility', () => {
  it('starting view: radius 2 visible, unexplored hexes are not sent at all', () => {
    const s = flatState(8);
    for (const t of Object.values(s.tokens)) if (t.kind === 'player') t.sharesWithParty = false;
    place(s, 'livia', { q: 0, r: 0 });
    const v = buildPlayerView(s, 'livia');
    const visible = v.hexes.filter((h) => h.fog === 'visible');
    expect(visible).toHaveLength(19); // 1 + 6 + 12
    expect(v.hexes).toHaveLength(19);
    expect(v.hexByKey['6,0']).toBeUndefined();
  });

  it('explored hexes stay known but are no longer visible', () => {
    let s = flatState(8);
    s = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 4, r: 0 } }).state;
    for (const t of Object.values(s.tokens)) if (t.id !== 'livia') t.sharesWithParty = false;
    const v = buildPlayerView(s, 'livia');
    expect(v.hexByKey['-1,0'].fog).toBe('explored');
    expect(v.hexByKey['-1,0'].terrain).toBe('plains');
    expect(v.hexByKey['4,0'].fog).toBe('visible');
  });

  it('terrain is revealed along the way (not only at the destination)', () => {
    let s = flatState(10);
    s = executeCommand(s, GM, { type: 'move', tokenId: 'livia', to: { q: 8, r: 0 } }).state;
    expect(s.knowledge.livia.explored['4,-2']).toBe('plains');
  });

  it('the GM vision bonus increases vision', () => {
    let s = flatState(8);
    for (const t of Object.values(s.tokens)) t.sharesWithParty = false;
    s = executeCommand(s, GM, { type: 'adjustVisionBonus', tokenId: 'livia', delta: 2 }).state;
    const v = buildPlayerView(s, 'livia');
    expect(v.hexes.filter((h) => h.fog === 'visible')).toHaveLength(61); // radius 4
  });

  it('rivals are visible only in sight; afterwards only the last sighting remains', () => {
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

  it('teams hidden by the GM stay invisible even in sight', () => {
    let s = flatState(8);
    s = executeCommand(s, GM, { type: 'setTeamVisibility', teamId: 'vesperia', visibility: 'hidden' }).state;
    place(s, 'r-vesperia', { q: 1, r: 0 });
    const v = buildPlayerView(s, 'livia');
    expect(v.tokens.some((t) => t.teamId === 'vesperia')).toBe(false);
    expect(v.teams.some((t) => t.id === 'vesperia')).toBe(false);
  });

  it('tracking shows a marker but does not reveal terrain', () => {
    let s = flatState(8);
    place(s, 'r-aquaeductus', { q: -6, r: 0 });
    s = executeCommand(s, GM, { type: 'setTracking', teamId: 'aquaeductus', mode: 'exact' }).state;
    const v = buildPlayerView(s, 'livia');
    expect(v.trackers).toHaveLength(1);
    expect(v.trackers[0].pos).toEqual({ q: -6, r: 0 });
    expect(v.hexByKey['-6,0']).toBeUndefined();
    expect(v.tokens.some((t) => t.id === 'r-aquaeductus')).toBe(false);
  });

  it('approximate tracking lies at most 2 hexes from the true position', () => {
    let s = flatState(8);
    place(s, 'r-aquaeductus', { q: -5, r: 1 });
    s = executeCommand(s, GM, { type: 'setTracking', teamId: 'aquaeductus', mode: 'approx' }).state;
    const tr = s.teams.aquaeductus.tracking!;
    expect(distance(tr.pos, { q: -5, r: 1 })).toBeLessThanOrEqual(2);
  });

  it('the player view contains no secret GM data', () => {
    const s = createDemoState();
    const v = buildPlayerView(s, 'livia');
    const json = JSON.stringify(v);
    expect(json).not.toContain('Templum Oblitum'); // hidden site
    expect(json).not.toContain('informant'); // GM note
    expect(json).not.toContain('"seed"');
    expect(json).not.toContain('Arena generated'); // GM-only log entry
    expect(v.tokens.every((t) => t.kind === 'player')).toBe(true); // no rivals at the start
    expect(v.sites.every((site) => !('gmNotes' in site))).toBe(true);
    expect(json).not.toContain('Breach of the Aqueduct'); // future event
  });

  it('the player view does not leak the map size or outline', () => {
    const s = createDemoState();
    const v = buildPlayerView(s, 'livia');
    expect(v.mapRadius).toBeNull();
    expect(v.hexes.length).toBeLessThan(40);
    expect(v.hexes.every((h) => h.terrain !== null && h.fog !== 'unexplored')).toBe(true);
    // None of the known central hexes touches the boundary, so no edge information is sent.
    expect(v.hexes.some((h) => h.edges)).toBe(false);
    // Same knowledge on a different map size → identical hex set.
    const small = createDemoState({ radius: 20 });
    const vs = buildPlayerView(small, 'livia');
    expect(vs.hexes.map((h) => h.key).sort()).toEqual(v.hexes.map((h) => h.key).sort());
  });

  it('the arena boundary becomes known locally once explored', () => {
    let s = flatState(6);
    for (const t of Object.values(s.tokens)) if (t.id !== 'livia') t.sharesWithParty = false;
    s = executeCommand(s, GM, { type: 'place', tokenId: 'livia', to: { q: 5, r: 0 } }).state;
    const v = buildPlayerView(s, 'livia');
    const edge = v.hexByKey[hexKey({ q: 6, r: 0 })];
    expect(edge.edges).toBeGreaterThan(0);
    // Hexes far from the explored edge carry no boundary data
    expect(v.hexByKey['-6,0']).toBeUndefined();
    // The GM sees the whole boundary
    expect(buildGmView(s).hexes.filter((h) => h.edges).length).toBe(36);
  });

  it('characters that do not share are invisible to the party', () => {
    let s = flatState(8);
    s = executeCommand(s, GM, { type: 'toggleShare', tokenId: 'nyx' }).state;
    s = executeCommand(s, GM, { type: 'place', tokenId: 'nyx', to: { q: -6, r: 0 } }).state;
    const v = buildPlayerView(s, 'livia');
    expect(v.tokens.some((t) => t.id === 'nyx')).toBe(false);
    expect(v.hexByKey['-6,0']).toBeUndefined();
  });
});
