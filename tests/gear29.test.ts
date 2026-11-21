/** APEX 2.9: the figure in the equipped gear – mapping, the switch, who sees what. */
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/game/commands';
import { gearLook } from '../src/game/gearLook';
import { DEFAULT_LOOK } from '../src/game/figure';
import { buildPlayerView } from '../src/game/visibility';
import { createDemoState } from '../src/data/demo';
import type { EquipSlot } from '../src/game/equipment';

const w = (slot: EquipSlot, name: string, equip?: object) => ({ slot, item: { name, ...(equip ? { equip: equip as never } : {}) }, active: true });

describe('gear look', () => {
  it('armour, helmet, boots, cloak, weapons and shield come from the slots; clothes and face stay', () => {
    const base = { ...DEFAULT_LOOK, torso: 'robe' as const, hair: 'braids' as const, hairColor: '#a33a22', main: 'staff' as const, hat: 'wizard' as const };
    const plate = gearLook(base, [w('chest', 'Full Plate'), w('head', 'Great Helm'), w('main1', 'Longsword'), w('off1', 'Tower Shield')]);
    expect(plate).toMatchObject({ torso: 'plate', shoulders: 'plate', legs: 'greaves', boots: 'armored', hat: 'greathelm', main: 'longsword', off: 'towershield', hair: 'braids', hairColor: '#a33a22' });
    const leather = gearLook(base, [w('chest', 'Studded Leather'), w('main1', 'Longbow', { kind: 'weapon', properties: ['two-handed', 'ranged'] }), w('cloak', 'Cloak of Elvenkind')]);
    expect(leather).toMatchObject({ torso: 'studded', main: 'bow', off: 'none', back: 'quiver', cloak: 'long', hat: 'wizard' });
    // nothing equipped: own clothes, empty hands
    expect(gearLook(base, [])).toMatchObject({ torso: 'robe', main: 'none', off: 'none' });
    // the other weapon set does not show
    expect(gearLook(base, [{ ...w('main2', 'Greataxe'), active: false }]).main).toBe('none');
    // unknown armour by its weight class
    expect(gearLook(base, [w('chest', 'Ancient Shell', { kind: 'armor', armorType: 'heavy' })]).torso).toBe('plate');
  });
});

describe('the switch', () => {
  it('the owner turns it on; everyone then sees the figure in its gear; the Appearance look stays private', () => {
    let s = createDemoState({ radius: 8, seed: 3 });
    const me = Object.values(s.tokens).find((t) => t.kind === 'player')!;
    const other = Object.values(s.tokens).find((t) => t.kind === 'player' && t.id !== me.id)!;
    s.tokens[me.id].figure = { ...DEFAULT_LOOK, torso: 'dress' };
    s.tokens[me.id].inventory.push({ id: 'arm', name: 'Chain Mail', kind: 'armor', description: '', quantity: 1, equip: { kind: 'armor', armorType: 'heavy', armorBase: 16 } });
    s.tokens[me.id].equipment = { slots: { chest: 'arm' }, activeSet: 1, resting: false, restingKeep: [] };
    expect(executeCommand(s, { role: 'player', tokenId: other.id }, { type: 'setFigureGear', tokenId: me.id, on: true }).ok).toBe(false);
    const r = executeCommand(s, { role: 'player', tokenId: me.id }, { type: 'setFigureGear', tokenId: me.id, on: true });
    expect(r.ok).toBe(true);
    if (r.ok) s = r.state;
    const mine = buildPlayerView(s, me.id).tokens.find((t) => t.id === me.id)!;
    expect(mine.figure!.torso).toBe('chain');
    expect(mine.details!.figureGear).toBe(true);
    expect(mine.details!.appearanceFigure!.torso).toBe('dress');
    const seen = buildPlayerView(s, other.id).tokens.find((t) => t.id === me.id);
    if (seen) { expect(seen.figure!.torso).toBe('chain'); expect(seen.details?.appearanceFigure).toBeUndefined(); }
  });
});
