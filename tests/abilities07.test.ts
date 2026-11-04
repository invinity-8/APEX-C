import { describe, expect, it } from 'vitest';
import { applyDamage, applyHealing, classLevel, convertSorcery, formAllowed, revert, setTempHp, transform, wildShapeLimits, wildShapeView } from '../src/game/abilities';
import { SRD_BEASTS, parseBeast } from '../src/game/beasts';
import { emptySheet, parseSheet, type CharacterSheet } from '../src/game/sheet';

const beast = (id: string) => SRD_BEASTS.find((b) => b.id === id)!;
const druid = (level: number, extra: Partial<CharacterSheet> = {}): CharacterSheet => ({
  ...emptySheet(),
  hitPoints: { current: 20, max: 24, temp: 0 },
  details: [{ id: 'd', label: 'Race, class & level', value: `Level ${level} Kor Druid` }],
  attributes: [
    { id: 'a1', name: 'Strength', value: '10', modifier: '+0' },
    { id: 'a4', name: 'Intelligence', value: '12', modifier: '+1' },
    { id: 'a5', name: 'Wisdom', value: '18', modifier: '+4' },
    { id: 'a6', name: 'Charisma', value: '8', modifier: '-1' },
  ],
  saves: [{ id: 's1', name: 'Wisdom', value: '+6', proficient: true }],
  combat: [{ id: 'c', label: 'Proficiency bonus', value: '+2' }],
  ...extra,
});

describe('class levels', () => {
  it('reads single and multiclass strings', () => {
    expect(classLevel(druid(4), 'druid')).toBe(4);
    expect(classLevel({ details: [{ id: 'a', label: 'Class', value: 'Druid 3 / Sorcerer 2' }] }, 'sorcerer')).toBe(2);
    expect(classLevel({ details: [{ id: 'a', label: 'Class', value: 'Druid 3 / Sorcerer 2' }] }, 'druid')).toBe(3);
    expect(classLevel({ details: [{ id: 'a', label: 'Class', value: 'Fighter 5' }] }, 'druid')).toBeNull();
  });
});

describe('Wild Shape (SRD 5.1)', () => {
  it('limits CR and movement by druid level', () => {
    expect(wildShapeLimits(1)).toBeNull();
    expect(formAllowed(beast('wolf'), 2)).toBeNull();
    expect(formAllowed(beast('crocodile'), 2)).toMatch(/CR too high/);
    expect(formAllowed(beast('hawk'), 2)).toMatch(/flying/);
    expect(formAllowed(beast('crocodile'), 4)).toBeNull();
    expect(formAllowed(beast('giant-eagle'), 4)).toMatch(/CR too high/);
    expect(formAllowed(beast('giant-eagle'), 8)).toBeNull();
    expect(wildShapeLimits(5)!.hours).toBe(2);
  });

  it('transforms with separate beast HP, keeps mental scores and save proficiency, spends a use', () => {
    const r = transform(druid(2), beast('wolf'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheet.wildShape).toMatchObject({ formId: 'wolf', hp: 11, maxHp: 11 });
    expect(r.sheet.hitPoints).toEqual({ current: 20, max: 24, temp: 0 }); // original HP untouched
    expect(r.sheet.resources.find((x) => x.name === 'Wild Shape')).toMatchObject({ current: 1, max: 2 });
    const v = wildShapeView(r.sheet, beast('wolf'));
    expect(v.scores).toMatchObject({ str: 12, dex: 15, con: 12, int: 12, wis: 18, cha: 8 });
    expect(v.saves.wis).toBe(4 + 2);
    expect(transform(r.sheet, beast('wolf')).ok).toBe(false); // no double transformation
    expect(transform(druid(1), beast('cat')).ok).toBe(false);
  });

  it('temporary HP first, then beast HP; at 0 the druid reverts and excess damage carries over', () => {
    let s = (transform(druid(2), beast('wolf')) as { sheet: CharacterSheet }).sheet;
    s = (setTempHp(s, 'grant', 5) as { sheet: CharacterSheet }).sheet;
    s = (applyDamage(s, 7) as { sheet: CharacterSheet }).sheet; // 5 temp + 2 beast
    expect(s.hitPoints!.temp).toBe(0);
    expect(s.wildShape!.hp).toBe(9);
    s = (applyHealing(s, 50) as { sheet: CharacterSheet }).sheet;
    expect(s.wildShape!.hp).toBe(11); // healing heals the beast, capped at its maximum
    s = (applyDamage(s, 15) as { sheet: CharacterSheet }).sheet; // 11 beast + 4 carried over
    expect(s.wildShape).toBeUndefined();
    expect(s.hitPoints!.current).toBe(16);
  });

  it('reverting restores the original form; uses run out', () => {
    let s = (transform(druid(2), beast('wolf')) as { sheet: CharacterSheet }).sheet;
    s = (revert(s) as { sheet: CharacterSheet }).sheet;
    expect(s.wildShape).toBeUndefined();
    s = (transform(s, beast('panther')) as { sheet: CharacterSheet }).sheet;
    s = (revert(s) as { sheet: CharacterSheet }).sheet;
    expect(transform(s, beast('cat'))).toMatchObject({ ok: false, error: expect.stringMatching(/No Wild Shape use/) });
  });

  it('wild shape state survives validation; an import never ends it', () => {
    const s = (transform(druid(2), beast('wolf')) as { sheet: CharacterSheet }).sheet;
    const p = parseSheet(JSON.parse(JSON.stringify(s)));
    expect(p.ok && p.sheet.wildShape?.formId).toBe('wolf');
    expect(parseSheet({ ...s, wildShape: { formId: 'wolf', formName: 'Wolf', hp: 50, maxHp: 11, since: 'x' } }).ok).toBe(false);
  });

  it('temporary HP do not stack', () => {
    let s = druid(2);
    s = (setTempHp(s, 'grant', 8) as { sheet: CharacterSheet }).sheet;
    s = (setTempHp(s, 'grant', 5) as { sheet: CharacterSheet }).sheet;
    expect(s.hitPoints!.temp).toBe(8);
    s = (setTempHp(s, 'replace', 5) as { sheet: CharacterSheet }).sheet;
    expect(s.hitPoints!.temp).toBe(5);
    expect(s.hitPoints!.max).toBe(24); // never added to maximum HP
  });

  it('GM custom beasts are validated', () => {
    expect(parseBeast({ id: 'arena-lion', name: 'Arena Lion', cr: 1, ac: 12, hp: 26, str: 17, dex: 15, con: 13, int: 3, wis: 12, cha: 8, speed: { walk: 50 } })).toMatchObject({ id: 'gm-arena-lion', source: 'GM' });
    expect(typeof parseBeast({ id: 'x', name: 'X', cr: 0.3, ac: 1, hp: 1 })).toBe('string');
  });
});

describe('Font of Magic (SRD 5.1)', () => {
  const sorc = (lvl: number, sp: number, slots: Array<[number, number, number]>) => ({
    ...emptySheet(),
    details: [{ id: 'd', label: 'Class', value: `Sorcerer ${lvl}` }],
    resources: [{ id: 'sp', name: 'Sorcery Points', current: sp, max: lvl }, ...slots.map(([l, c, m]) => ({ id: `s${l}`, name: `Spell slots (level ${l})`, current: c, max: m }))],
  });
  it('uses the SRD conversion table and limits', () => {
    const r = convertSorcery(sorc(5, 5, [[1, 4, 4], [3, 2, 2]]), 'toSlot', 3);
    expect(r.ok && r.sheet.resources.find((x) => x.id === 'sp')!.current).toBe(0); // 3rd level costs 5
    expect(r.ok && r.sheet.resources.find((x) => x.id === 's3')!.current).toBe(3); // extra slot above max
    expect(convertSorcery(sorc(5, 5, []), 'toSlot', 6)).toMatchObject({ ok: false });
    expect(convertSorcery(sorc(5, 1, []), 'toSlot', 1)).toMatchObject({ ok: false, error: expect.stringMatching(/Needs 2/) });
    const back = convertSorcery(sorc(5, 2, [[3, 1, 2]]), 'toPoints', 3);
    expect(back.ok && back.sheet.resources.find((x) => x.id === 'sp')!.current).toBe(5);
    expect(convertSorcery(sorc(5, 3, [[3, 1, 2]]), 'toPoints', 3)).toMatchObject({ ok: false, error: expect.stringMatching(/exceed/) });
    expect(convertSorcery(sorc(1, 0, [[1, 2, 2]]), 'toPoints', 1)).toMatchObject({ ok: false, error: expect.stringMatching(/level 2/) });
  });
  it('round trips never create resources', () => {
    let s = sorc(6, 6, [[1, 4, 4], [2, 3, 3]]) as CharacterSheet;
    const total = (x: CharacterSheet) => x.resources.find((r) => r.id === 'sp')!.current + x.resources.filter((r) => r.id !== 'sp').reduce((a, r) => a + r.current * Number(r.id.slice(1)), 0);
    for (let i = 0; i < 3; i++) {
      const a = convertSorcery(s, 'toPoints', 2);
      if (a.ok) s = a.sheet;
      const b = convertSorcery(s, 'toSlot', 2);
      if (b.ok) s = b.sheet;
    }
    expect(total(s)).toBeLessThanOrEqual(6 + 4 + 6);
  });
});
