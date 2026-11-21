/**
 * APEX 2.9 – individual creatures: every placed creature gets its own coat (colours), markings (stripes, spots,
 * bands, speckles, a dark saddle, scale shimmer) and a name that says what you see – “Yellow-striped giant spider”,
 * “Grey wolf”, “One-eyed bandit” – instead of “Spider 3”.
 *
 * Shared by the server (it names the creature when placing it and stores the seed) and the 3D view (it paints the
 * same coat from the same seed). The scene's colour scheme tilts the odds towards coats that blend in (ochre
 * spiders in a mesa, white wolves on the tundra). Humanoids keep their figure kit look; their name picks its most
 * striking feature (eye patch, scar, tattoos, war paint, hood, hair colour).
 */
import { autoLook, type FigureLook, type FigureSex } from './figure.js';

export interface Coat { name: string; c: string; c2: string }
export const PATTERNS = ['plain', 'striped', 'spotted', 'banded', 'speckled', 'saddled'] as const;
export type Pattern = (typeof PATTERNS)[number];
export interface Individual { family: string; coat: Coat | null; pattern: Pattern; shimmer: boolean; /** Lightness change −1 … 1 when there is no coat. */ jitter: number }

const C = (name: string, c: string, c2: string): Coat => ({ name, c, c2 });
interface Family { id: string; re: RegExp; coats: Coat[]; patterns: Pattern[]; shimmer?: number }
const FAMILIES: Family[] = [
  { id: 'spider', re: /spider|ettercap/, coats: [C('black', '#1e1c1a', '#3a3632'), C('brown', '#5a3a22', '#a07850'), C('green', '#3a5a2a', '#9ac050'), C('ochre', '#8a5a2a', '#e0a850'), C('grey', '#5a5a58', '#b0b0a8'), C('red-black', '#1c1412', '#b3261e'), C('yellow-green', '#6a7a24', '#e0d850'), C('pale', '#c8bca0', '#6a5a40')], patterns: ['plain', 'striped', 'spotted', 'banded', 'speckled'] },
  { id: 'canine', re: /wolf|worg|dog|jackal|hyena|mastiff|coyote|fox/, coats: [C('grey', '#6a6660', '#b0aca4'), C('black', '#262422', '#4a4642'), C('brown', '#6a4a2a', '#a8865a'), C('white', '#dcd8cc', '#f8f6f0'), C('tawny', '#a07a4a', '#e0c08a'), C('rust', '#8a4a2a', '#d8a070'), C('silver', '#8a8e94', '#d8dce0')], patterns: ['plain', 'plain', 'saddled', 'speckled'] },
  { id: 'bear', re: /bear/, coats: [C('brown', '#5a3a22', '#7a5a3a'), C('black', '#1e1c1a', '#3a3632'), C('cinnamon', '#8a5a32', '#b07a4a'), C('grizzled', '#6a5a4a', '#a8988a'), C('white', '#e8e4d8', '#ffffff')], patterns: ['plain', 'plain', 'saddled'] },
  { id: 'cat', re: /\bcat\b|lion|panther|tiger|leopard|sabertooth|lynx|displacer/, coats: [C('tawny', '#b08a4a', '#e8d0a0'), C('golden', '#c89a3a', '#f0dca0'), C('black', '#1e1c1e', '#3a363a'), C('grey', '#7a7672', '#c0bcb4'), C('sandy', '#c8aa7a', '#f0e0c0')], patterns: ['plain', 'spotted', 'striped'] },
  { id: 'hoofed', re: /horse|pony|mule|donkey|camel|deer|elk|stag|goat|antelope|zebra|llama|warhorse|nightmare|unicorn|pegasus/, coats: [C('chestnut', '#8a4a22', '#c08050'), C('bay', '#5a3420', '#1e1814'), C('black', '#1e1c1a', '#3a3632'), C('grey', '#8a8884', '#d0ccc4'), C('white', '#e8e4dc', '#ffffff'), C('dun', '#b8946a', '#5a4430')], patterns: ['plain', 'plain', 'spotted', 'speckled'] },
  { id: 'cattle', re: /\bcow\b|bull|ox\b|bison|buffalo|yak|cattle/, coats: [C('black-and-white', '#f2ecdc', '#1e1c1a'), C('brown', '#6a4428', '#9a6a40'), C('red', '#8a3a1e', '#c07040'), C('cream', '#e0d0b0', '#a08a60'), C('black', '#1e1c1a', '#4a4642')], patterns: ['plain', 'spotted'] },
  { id: 'sheep', re: /sheep|\bram\b|lamb|ewe/, coats: [C('white', '#f2ecdc', '#2a2622'), C('cream', '#e8dcc0', '#3a3026'), C('grey', '#a8a49c', '#2a2622'), C('black', '#2a2826', '#1a1816'), C('brown', '#8a6a4a', '#2a2018')], patterns: ['plain'] },
  { id: 'boar', re: /boar|pig|swine|hog/, coats: [C('brown', '#5a3a26', '#8a6a4a'), C('black', '#262220', '#4a4440'), C('grey', '#6a6460', '#9a948e'), C('rust', '#7a4224', '#b0784a')], patterns: ['plain', 'striped', 'speckled'] },
  { id: 'amphibian', re: /frog|toad|salamander|newt|bullywug/, coats: [C('green', '#3a7a2e', '#c8d84a'), C('brown', '#6a5030', '#c0a060'), C('yellow', '#c8b030', '#1e1c1a'), C('red', '#b3301e', '#1e1c1a'), C('blue', '#2a5a9a', '#1e1c1a'), C('olive', '#5a6a30', '#a8a860')], patterns: ['spotted', 'spotted', 'striped', 'plain'] },
  { id: 'reptile', re: /snake|serpent|viper|constrictor|lizard|crocodile|alligator|basilisk|drake|wyvern|lizardfolk/, coats: [C('green', '#3a5a2a', '#8aa04a'), C('olive', '#5a5a32', '#a09a5a'), C('sand', '#b09a6a', '#6a5a3a'), C('black', '#1e2220', '#5a6a5a'), C('brown', '#5a4228', '#a08050'), C('emerald', '#1e6a4a', '#7ad0a0')], patterns: ['banded', 'spotted', 'plain', 'speckled'], shimmer: 0.4 },
  { id: 'bird', re: /hawk|eagle|raven|crow|owl|vulture|roc|griffon|hippogriff|bat\b|giant bat/, coats: [C('brown', '#6a4a2a', '#d8c49a'), C('grey', '#6a6a6a', '#c8c8c0'), C('black', '#1e1c22', '#3a3a44'), C('rust', '#8a4a22', '#e0b080'), C('pale', '#c8b898', '#7a6a50')], patterns: ['plain', 'striped', 'speckled'] },
  { id: 'vermin', re: /rat\b|giant rat|weasel|badger|centipede|scorpion|beetle|ankheg|crab/, coats: [C('brown', '#5a3a26', '#9a7a5a'), C('black', '#1e1c1a', '#4a4440'), C('grey', '#6a6662', '#a8a49e'), C('amber', '#9a5a1a', '#e0a040'), C('red', '#7a2a1a', '#c0603a')], patterns: ['plain', 'banded', 'speckled'] },
];
const ALL_FAMILIES = FAMILIES.map((f) => f.id);
export { ALL_FAMILIES as CREATURE_FAMILIES };

const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => { let s = seed || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const near = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return 1 - Math.min(1, Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 0.9); };

/** The family of a creature from its name and type (null: no coat – a slight shade change only). */
export const familyOf = (text: string) => FAMILIES.find((f) => f.re.test(text.toLowerCase())) ?? null;
/** The colour a scene's scheme gives its land (for camouflage), or undefined. */
export const sceneTone = (palette?: { colors: string[]; strength: number } | null) => (palette && palette.strength >= 0.3 && palette.colors.length ? palette.colors[Math.floor(palette.colors.length / 2)] : undefined);

/** The coat and markings of one creature. `tone`: the land's colour – coats that blend in are three times likelier. */
export function individualOf(text: string, seed: string, tone?: string): Individual {
  const r = rng(hash(`${seed}|coat`));
  const fam = familyOf(text);
  if (!fam) { const jitter = r() * 2 - 1; return { family: 'other', coat: null, pattern: 'plain', shimmer: false, jitter }; }
  const weights = fam.coats.map((c) => (tone ? 1 + 3 * Math.max(0, near(c.c, tone) * 1.6 - 0.6) : 1));
  let x = r() * weights.reduce((a, b) => a + b, 0), i = 0;
  while (i < weights.length - 1 && x >= weights[i]) { x -= weights[i]; i++; }
  const pattern = fam.patterns[Math.floor(r() * fam.patterns.length)];
  return { family: fam.id, coat: fam.coats[i], pattern, shimmer: !!fam.shimmer && r() < fam.shimmer, jitter: 0 };
}

const PATTERN_WORD: Record<Pattern, string> = { plain: '', striped: 'striped', spotted: 'spotted', banded: 'banded', speckled: 'speckled', saddled: 'saddle-backed' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** “Striped yellow-green giant spider”, “Grey wolf”, “Spotted green frog”. */
export function describeCreature(ind: Individual, noun: string): string {
  const n = noun.toLowerCase();
  if (!ind.coat) return cap(ind.jitter > 0.55 ? `pale ${n}` : ind.jitter < -0.55 ? `dark ${n}` : n);
  const w = PATTERN_WORD[ind.pattern];
  const colour = ind.coat.name;
  const head = w ? `${w} ${colour}` : colour;
  return cap(`${ind.shimmer ? 'shimmering ' : ''}${head} ${n}`);
}

const HAIR_WORDS: Record<string, string> = { '#1d1612': 'black-haired', '#3b2516': 'dark-haired', '#6b4224': 'brown-haired', '#9a6a35': 'chestnut-haired', '#c79a55': 'sandy-haired', '#e8cf8f': 'blond', '#f2ecdc': 'white-haired', '#8a8a8a': 'grey-haired', '#a33a22': 'red-haired', '#d4602b': 'copper-haired', '#5a2a6e': 'violet-haired', '#2d4f8f': 'blue-haired', '#2f6b3a': 'green-haired', '#c0c0c0': 'silver-haired', '#7a1f1f': 'auburn' };
/** The most striking feature of a humanoid figure (stable when the GM switches it to a man or a woman). */
export function lookAdjective(l: FigureLook): string | null {
  if (l.eyes === 'patch') return 'one-eyed';
  if (l.eyes === 'scarred' || l.face === 'cheekscar' || l.extra === 'scar') return 'scarred';
  if (l.extra === 'tattoos' || l.face === 'facetattoo') return 'tattooed';
  if (l.extra === 'warpaint') return 'war-painted';
  if (l.hat === 'mask') return 'masked';
  if (l.hat === 'hood' || l.hat === 'cowl') return 'hooded';
  if (l.eyes === 'glowing') return 'glowing-eyed';
  if (l.hair !== 'none' && l.hat !== 'helmet' && l.hat !== 'greathelm' && HAIR_WORDS[l.hairColor]) return HAIR_WORDS[l.hairColor];
  return null;
}

/** The name a newly placed creature gets: what it looks like plus what it is. */
export function individualName(block: { name: string; type: string; elite?: boolean }, seed: string, o: { tone?: string; colour?: string; sex?: FigureSex } = {}): string {
  const breed = `${block.name} ${block.type}`.slice(0, 60);
  const look = autoLook(breed, seed, o.colour, o.sex);
  if (look) { const a = lookAdjective(look); return a ? cap(`${a} ${block.name.toLowerCase()}`) : block.name; }
  // humanoids without a figure preset keep the old miniature: nothing to describe
  if (/humanoid/i.test(block.type)) return block.name;
  return describeCreature(individualOf(breed, seed, o.tone), block.name);
}

const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
/**
 * A name and appearance seed for a new creature that no other creature on the map has: the first look whose name
 * is free (up to ten tries), else the name with a numeral.
 */
export function uniqueIndividual(block: { name: string; type: string; elite?: boolean }, id: string, taken: (name: string) => boolean, o: { tone?: string; colour?: string; sex?: FigureSex } = {}): { name: string; seed: string } {
  for (let k = 0; k < 10; k++) {
    const seed = k ? `${id}~${k}` : id;
    const name = individualName(block, seed, o);
    if (!taken(name)) return { name, seed };
  }
  const name = individualName(block, id, o);
  let n = 2;
  while (taken(`${name}${ROMAN[n] ?? ` ${n}`}`) && n < 60) n++;
  return { name: `${name}${ROMAN[n] ?? ` ${n}`}`, seed: id };
}
