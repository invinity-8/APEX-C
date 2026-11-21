/** APEX 2.9: individual creatures – coats, markings, camouflage, descriptive and unique names. */
import { describe, expect, it } from 'vitest';
import { BUILTIN_BESTIARY } from '../src/game/bestiary';
import { describeCreature, familyOf, individualName, individualOf, lookAdjective, sceneTone, uniqueIndividual } from '../src/game/individual';
import { addEnemy, enemiesOf } from '../src/game/sceneCombat';
import { createDemoState } from '../src/data/demo';
import { PALETTE_PRESETS } from '../src/campaign/palette';
import { DEFAULT_LOOK } from '../src/game/figure';

const block = (id: string) => BUILTIN_BESTIARY.find((b) => b.id === id)!;

describe('coats and markings', () => {
  it('families, determinism, variety', () => {
    expect(familyOf('Giant spider beast')?.id).toBe('spider');
    expect(familyOf('Dire wolf beast')?.id).toBe('canine');
    expect(familyOf('Giant frog beast')?.id).toBe('amphibian');
    expect(familyOf('Owlbear monstrosity')?.id).toBe('bear');
    expect(familyOf('Gelatinous cube ooze')).toBeNull();
    expect(individualOf('giant spider', 'en-1')).toEqual(individualOf('giant spider', 'en-1'));
    const coats = new Set(Array.from({ length: 40 }, (_, i) => individualOf('giant spider', `en-${i}`).coat!.name));
    const patterns = new Set(Array.from({ length: 40 }, (_, i) => individualOf('giant spider', `en-${i}`).pattern));
    expect(coats.size).toBeGreaterThanOrEqual(5);
    expect(patterns.size).toBeGreaterThanOrEqual(4);
  });
  it('the land tilts coats towards camouflage (ochre spiders in a mesa, white wolves on the tundra)', () => {
    const count = (text: string, tone: string | undefined, coat: string) => Array.from({ length: 300 }, (_, i) => individualOf(text, `s${i}`, tone)).filter((x) => x.coat!.name === coat).length;
    const mesa = sceneTone(PALETTE_PRESETS.find((p) => p.id === 'mesa')!.palette);
    const tundra = sceneTone(PALETTE_PRESETS.find((p) => p.id === 'tundra')!.palette);
    expect(mesa).toBeTruthy();
    expect(count('giant spider', mesa, 'ochre')).toBeGreaterThan(count('giant spider', undefined, 'ochre') * 1.5);
    expect(count('wolf', tundra, 'white') + count('wolf', tundra, 'silver')).toBeGreaterThan(count('wolf', undefined, 'white') + count('wolf', undefined, 'silver'));
    expect(sceneTone({ colors: ['#000000', '#ffffff'], strength: 0.1 })).toBeUndefined();
  });
  it('names say what you see', () => {
    expect(describeCreature({ family: 'spider', coat: { name: 'yellow-green', c: '#000000', c2: '#ffffff' }, pattern: 'striped', shimmer: false, jitter: 0 }, 'Giant spider')).toBe('Striped yellow-green giant spider');
    expect(describeCreature({ family: 'canine', coat: { name: 'grey', c: '#000000', c2: '#ffffff' }, pattern: 'plain', shimmer: false, jitter: 0 }, 'Wolf')).toBe('Grey wolf');
    expect(describeCreature({ family: 'other', coat: null, pattern: 'plain', shimmer: false, jitter: 0.8 }, 'Gelatinous cube')).toBe('Pale gelatinous cube');
    expect(lookAdjective({ ...DEFAULT_LOOK, eyes: 'patch' })).toBe('one-eyed');
    expect(lookAdjective({ ...DEFAULT_LOOK, hairColor: '#a33a22' })).toBe('red-haired');
    expect(lookAdjective({ ...DEFAULT_LOOK, hat: 'greathelm', hairColor: '#a33a22' })).toBeNull();
    expect(individualName(block('wolf'), 'en-7')).toMatch(/wolf$/i);
    expect(individualName(block('bandit'), 'en-7')).toMatch(/bandit$/i);
    // humanoids without a figure preset keep their plain name
    expect(individualName({ name: 'Gnoll', type: 'humanoid (gnoll)' }, 'en-1')).toBe('Gnoll');
  });
  it('every creature on a map gets its own name – no “Wolf 3”', () => {
    let st = createDemoState({ radius: 8, seed: 2 });
    for (let i = 0; i < 8; i++) { const r = addEnemy(st, 'sc', `en-w${i}`, 'wolf', { x: i * 50, y: 0 }, undefined, null); expect(r.ok).toBe(true); if (r.ok) st = r.state; }
    for (let i = 0; i < 4; i++) { const r = addEnemy(st, 'sc', `en-b${i}`, 'bandit', { x: i * 50, y: 90 }, undefined, null); if (r.ok) st = r.state; }
    const names = enemiesOf(st, 'sc').map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => /wolf/i.test(n))).toHaveLength(8);
    expect(enemiesOf(st, 'sc').every((e) => !!e.seed)).toBe(true);
    // a given name still wins
    const r = addEnemy(st, 'sc', 'en-x', 'wolf', { x: 0, y: 200 }, 'Fang', null);
    expect(r.ok && enemiesOf(r.state, 'sc').at(-1)!.name).toBe('Fang');
    // uniqueness falls back to a numeral when every look is taken
    expect(uniqueIndividual({ name: 'Ooze', type: 'ooze' }, 'x', () => true).name).toMatch(/ \d+$|[IVX]+$/);
  });
});
