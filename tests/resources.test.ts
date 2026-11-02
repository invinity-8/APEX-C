import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { effectiveOrbs, movePointsForSpeed, orbValue, suggestedResources, walkingSpeed, weightedSlots } from '../src/game/resources';
import { emptySheet, mergeSheets, parseSheet, type CharacterSheet } from '../src/game/sheet';

const caster: CharacterSheet = {
  ...emptySheet(),
  details: [{ id: 'd1', label: 'Class & level', value: 'Level 5 Druid' }],
  combat: [{ id: 'c1', label: 'Speed (walking)', value: '30ft.' }],
  resources: [
    { id: 's1', name: 'Spell slots (level 1)', current: 3, max: 4 },
    { id: 's2', name: 'Spell slots (level 2)', current: 1, max: 3 },
    { id: 's3', name: 'Spell slots (level 3)', current: 2, max: 2 },
    { id: 'ws', name: 'Wild Shape', current: 1, max: 2 },
    { id: 'gp', name: 'Gold (gp)', current: 15, max: null },
  ],
};

describe('resource orbs', () => {
  it('weights spell slots by level (L1×1, L2×2, L3×3) and keeps the counts visible', () => {
    const w = weightedSlots(caster)!;
    expect(w).toMatchObject({ current: 3 * 1 + 1 * 2 + 2 * 3, max: 4 * 1 + 3 * 2 + 2 * 3 }); // 11 / 16
    expect(w.detail).toBe('L1 3/4 · L2 1/3 · L3 2/2');
    // spending one level-3 slot lowers the orb by 3 weight
    const spent = { ...caster, resources: caster.resources.map((r) => (r.id === 's3' ? { ...r, current: 1 } : r)) };
    expect(weightedSlots(spent)!.current).toBe(8);
    expect(orbValue(spent, { type: 'spellSlots' })!.fill).toBeCloseTo(8 / 16);
  });

  it('automatic choice: spell slots first; explicit and split configuration', () => {
    expect(effectiveOrbs(caster).primary).toEqual({ type: 'spellSlots' });
    const split: CharacterSheet = { ...caster, orbs: { primary: { type: 'spellSlots' }, secondary: { type: 'resource', resourceId: 'ws' } } };
    expect(orbValue(split, effectiveOrbs(split).secondary)).toMatchObject({ label: 'Wild Shape', current: 1, max: 2, fill: 0.5 });
    const noSlots = { ...caster, resources: caster.resources.filter((r) => !r.id.startsWith('s')) };
    expect(effectiveOrbs(noSlots).primary).toEqual({ type: 'resource', resourceId: 'ws' }); // gold is skipped
  });

  it('class suggestions only propose names (never create resources)', () => {
    expect(suggestedResources({ ...caster, resources: [] })).toEqual(['Wild Shape']);
    expect(suggestedResources(caster)).toEqual([]); // already has it
  });

  it('orb configuration is validated and survives an import merge', () => {
    expect(parseSheet({ ...caster, orbs: { primary: { type: 'spellSlots' }, secondary: { type: 'resource', resourceId: 'ws' } } }).ok).toBe(true);
    expect(parseSheet({ ...caster, orbs: { primary: { type: 'evil' } } }).ok).toBe(false);
    const withOrbs = { ...caster, orbs: { primary: { type: 'resource' as const, resourceId: 'ws' }, secondary: null } };
    expect(mergeSheets(withOrbs, { ...emptySheet(), notes: 'x' }).orbs).toEqual(withOrbs.orbs);
  });
});

describe('movement from walking speed', () => {
  it('round(8 × speed / 30), clamped 4–16', () => {
    expect([20, 25, 30, 35, 40, 50, 60, 120].map(movePointsForSpeed)).toEqual([5, 7, 8, 9, 11, 13, 16, 16]);
    expect(movePointsForSpeed(5)).toBe(4);
    expect(walkingSpeed(caster)).toBe(30);
  });

  it('GM-only; changing the speed never refills the current movement points', () => {
    let s = createDemoState({ radius: 6, seed: 1 });
    s.tokens.sinna.movePoints = 3;
    const p = executeCommand(s, { role: 'player', tokenId: 'sinna' }, { type: 'setWalkingSpeed', tokenId: 'sinna', speedFt: 60 });
    expect(p.ok).toBe(false);
    let r = executeCommand(s, { role: 'gm' }, { type: 'setWalkingSpeed', tokenId: 'sinna', speedFt: 20 });
    s = r.state;
    expect(s.tokens.sinna).toMatchObject({ maxMovePoints: 5, movePoints: 3, speedFt: 20 });
    r = executeCommand(s, { role: 'gm' }, { type: 'setWalkingSpeed', tokenId: 'sinna', speedFt: 60 });
    expect(r.state.tokens.sinna).toMatchObject({ maxMovePoints: 16, movePoints: 3 }); // no refill
    const dawn = executeCommand(executeCommand(r.state, { role: 'gm' }, { type: 'advancePhase' }).state, { role: 'gm' }, { type: 'advancePhase' });
    expect(dawn.state.tokens.sinna.movePoints).toBe(16); // restored only at dawn
  });
});
