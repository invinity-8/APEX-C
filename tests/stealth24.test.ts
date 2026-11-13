/** APEX 2.4: sneaking – awareness rings, spotted / heard marks; sheet actions moved to the Game tab. */
import { describe, expect, it } from 'vitest';
import { awarenessFt, stealthOf, stealthWatch, bearingArrow, type StealthFigure } from '../src/game/stealth';
import { generateBattleScene, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';

const map = hexSceneMap(emptyMap('battle'), generateBattleScene('blank', 10, 1));
const at = (q: number, r: number) => hexCentre(map, { q, r });
const pc = (q: number, r: number, stealth: number): StealthFigure => ({ id: 'pc-a', kind: 'pc', name: 'Ayla', ...at(q, r), effects: [{ key: 'hidden', name: `Hidden (Stealth ${stealth})`, value: stealth }] });
const orc = (q: number, r: number, perception = 10): StealthFigure => ({ id: 'e1', kind: 'enemy', side: 'enemy', name: 'Orc', ...at(q, r), perception });

describe('sneaking aid', () => {
  it('awareness radius: 5 ft × passive Perception, capped by sight', () => {
    expect(awarenessFt(13, 'bright')).toBe(65);
    expect(awarenessFt(30, 'bright')).toBe(120);
    expect(awarenessFt(14, 'dim')).toBe(60);
    expect(awarenessFt(14, 'dark')).toBe(10);
    expect(awarenessFt(14, 'dark', 60)).toBe(60);
    expect(stealthOf({ effects: [{ key: 'hidden', name: 'Hidden (Stealth 17)' }] })).toBe(17);
    expect(stealthOf({ effects: [] })).toBeNull();
  });
  it('no sneakers: no rings', () => {
    expect(stealthWatch(map, [orc(0, 0), { ...pc(2, 0, 5), effects: [] }], 'bright').rings).toEqual([]);
  });
  it('spotted inside the radius with Stealth ≤ passive; heard when barely beaten; nothing far away', () => {
    const spotted = stealthWatch(map, [orc(0, 0, 12), pc(3, 0, 11)], 'bright');
    expect(spotted.rings[0]).toMatchObject({ ft: 60, danger: true });
    expect(spotted.marks).toEqual([expect.objectContaining({ kind: 'spotted', watcherName: 'Orc', targetName: 'Ayla' })]);
    expect(stealthWatch(map, [orc(0, 0, 12), pc(3, 0, 15)], 'bright').marks[0].kind).toBe('heard');
    expect(stealthWatch(map, [orc(0, 0, 12), pc(3, 0, 20)], 'bright').marks).toEqual([]);
    const far = stealthWatch(map, [orc(0, 0, 8), pc(9, 0, 5)], 'bright'); // 40-ft ring, 45 ft away
    expect(far.marks).toEqual([]);
    expect(far.rings[0].danger).toBe(true); // it would notice her – once she comes close
  });
  it('heard: the direction points from the watcher to the noise', () => {
    const m = stealthWatch(map, [orc(0, 0, 12), pc(0, -3, 15)], 'bright').marks[0];
    expect(bearingArrow(m.bearing)).toMatch(/[↑↗↖]/);
  });
});
