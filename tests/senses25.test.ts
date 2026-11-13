/** APEX 2.5: darkvision, blindsight and ancestry senses in scene vision. */
import { describe, expect, it } from 'vitest';
import { ancestryDarkvision, sensesFromText } from '../src/game/senses';
import { sceneVision } from '../src/campaign/hexVision';
import { generateBattleScene, hexCentre, hexSceneMap } from '../src/campaign/hexScene';
import { emptyMap } from '../src/campaign/maps';

describe('senses', () => {
  it('reads darkvision, blindsight, tremorsense and truesight', () => {
    expect(sensesFromText('darkvision 60 ft., passive Perception 10')).toEqual({ darkvisionFt: 60, blindFt: 0 });
    expect(sensesFromText('blindsight 60 ft. (blind beyond this radius), passive Perception 8')).toEqual({ darkvisionFt: 0, blindFt: 60 });
    expect(sensesFromText('Tremorsense 30 ft.').blindFt).toBe(30);
    expect(sensesFromText('truesight 120 ft.')).toEqual({ darkvisionFt: 120, blindFt: 120 });
    expect(ancestryDarkvision('Hill Dwarf')).toBe(60);
    expect(ancestryDarkvision('Drow')).toBe(120);
    expect(ancestryDarkvision('Human')).toBe(0);
  });
  it('in darkness: darkvision and blindsight see, others only next to them', () => {
    const map = hexSceneMap(emptyMap('battle'), generateBattleScene('blank', 26, 1));
    const at = hexCentre(map, { q: 0, r: 0 });
    const dark = { day: 1, phase: 'night' as const, lighting: 'dark' as const, version: 0 };
    const none = sceneVision(map, dark, [{ at, darkvisionFt: 0 }]).size;
    const dv = sceneVision(map, dark, [{ at, darkvisionFt: 60 }]).size;
    const blind = sceneVision(map, dark, [{ at, darkvisionFt: 0, blindFt: 30 }]).size;
    expect(none).toBe(7);
    expect(dv).toBeGreaterThan(blind);
    expect(blind).toBeGreaterThan(none);
    // dim light: darkvision 120 sees farther than the usual 60 ft
    const dim = { ...dark, lighting: 'dim' as const };
    expect(sceneVision(map, dim, [{ at, darkvisionFt: 120 }]).size).toBeGreaterThan(sceneVision(map, dim, [{ at, darkvisionFt: 0 }]).size);
  });
});
