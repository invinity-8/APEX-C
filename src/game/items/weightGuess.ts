/**
 * Rough weight estimate for free-text items (APEX 0.7) – imported Aurora equipment, hand-written items.
 *
 * APEX only needs a guide value ("am I hauling too much?"), not exact bookkeeping. Order:
 *  1. the APEX base catalogue (SRD 5.1 weights) by name,
 *  2. a table of common SRD 5.1 adventuring gear, packs, ammunition, foci and tools (pounds per unit),
 *  3. keyword rules (swords, axes, armour, books, clothes …),
 *  4. otherwise 0.5 lb – a small, generic object.
 * Results are converted to kilograms (1 lb = 0.45359237 kg) and rounded to 0.05 kg. The player or GM can always
 * correct the value in the item's edit form; an explicit weight is never overwritten.
 */
import { BASE_ITEMS } from './bases.js';

const LB_TO_KG = 0.45359237;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** SRD 5.1 gear (lb per unit). Keys are normalised names; a key matches when the item name contains it. */
const GEAR_LB: Array<[string, number]> = [
  // packs (whole pack as one item)
  ['explorers pack', 59],
  ['dungeoneers pack', 61.5],
  ['burglars pack', 44.5],
  ['diplomats pack', 36],
  ['entertainers pack', 38],
  ['priests pack', 24],
  ['scholars pack', 10],
  // ammunition (per piece)
  ['crossbow bolt', 0.075],
  ['bolts', 0.075],
  ['arrows', 0.05],
  ['arrow', 0.05],
  ['sling bullet', 0.075],
  ['blowgun needle', 0.02],
  ['dart', 0.25],
  // containers and camp
  ['backpack', 5],
  ['bedroll', 7],
  ['blanket', 3],
  ['tent', 20],
  ['mess kit', 1],
  ['cooking', 10],
  ['iron pot', 10],
  ['pouch', 1],
  ['sack', 0.5],
  ['chest', 25],
  ['barrel', 70],
  ['basket', 2],
  ['bucket', 2],
  ['quiver', 1],
  ['case', 1],
  ['waterskin', 5],
  ['flask', 1],
  ['jug', 4],
  ['bottle', 2],
  ['vial', 0],
  ['potion', 0.5],
  ['oil', 1],
  ['rations', 2],
  ['ration', 2],
  // tools and gear
  ['rope', 10],
  ['chain', 10],
  ['grappling hook', 4],
  ['crowbar', 5],
  ['hammer', 3],
  ['sledgehammer', 10],
  ['pick', 10],
  ['shovel', 5],
  ['piton', 0.25],
  ['manacles', 6],
  ['lantern', 2],
  ['lamp', 1],
  ['torch', 1],
  ['candle', 0],
  ['tinderbox', 1],
  ['mirror', 0.5],
  ['spyglass', 1],
  ['magnifying glass', 0],
  ['hourglass', 1],
  ['scale', 3],
  ['lock', 1],
  ['ladder', 25],
  ['pole', 7],
  ['ram', 35],
  ['healers kit', 3],
  ['herbalism kit', 3],
  ['poisoners kit', 2],
  ['disguise kit', 3],
  ['forgery kit', 5],
  ['thieves tools', 1],
  ['navigators tools', 2],
  ['tools', 5],
  ['kit', 3],
  ['climbers kit', 12],
  ['caltrops', 2],
  ['ball bearings', 2],
  ['hunting trap', 25],
  ['bell', 0],
  ['whistle', 0],
  ['signet ring', 0],
  ['ring', 0],
  ['amulet', 1],
  ['ink', 0],
  ['quill', 0],
  ['paper', 0],
  ['parchment', 0],
  ['letter', 0],
  ['map', 0],
  ['scroll', 0],
  ['spellbook', 3],
  ['book', 5],
  ['journal', 1],
  ['component pouch', 2],
  ['holy symbol', 1],
  ['emblem', 0],
  ['reliquary', 2],
  ['arcane focus', 1],
  ['crystal', 1],
  ['orb', 3],
  ['rod', 2],
  ['wand', 1],
  ['staff', 4],
  ['druidic focus', 1],
  ['totem', 1],
  ['sprig of mistletoe', 0],
  ['yew wand', 1],
  ['wooden staff', 4],
  // instruments
  ['bagpipes', 6],
  ['drum', 3],
  ['dulcimer', 10],
  ['flute', 1],
  ['horn', 2],
  ['lute', 2],
  ['lyre', 2],
  ['pan flute', 2],
  ['shawm', 1],
  ['viol', 1],
  ['dice set', 0],
  ['playing card', 0],
  // clothes
  ['fine clothes', 6],
  ['travelers clothes', 4],
  ['common clothes', 3],
  ['costume', 4],
  ['robes', 4],
  ['robe', 4],
  ['cloak', 1],
  ['clothes', 3],
  ['boots', 2],
  ['gloves', 0.5],
  ['belt', 1],
  // coins (per coin: 50 coins = 1 lb)
  ['gold piece', 0.02],
  ['silver piece', 0.02],
  ['copper piece', 0.02],
  ['gp', 0.02],
  ['coin', 0.02],
  ['gem', 0],
  ['trinket', 0],
];

/** Keyword rules for names the tables do not know (lb). First match wins. */
const KEYWORDS: Array<[RegExp, number]> = [
  [/\bplate\b/, 65],
  [/\bsplint\b/, 60],
  [/\bchain mail\b/, 55],
  [/\b(ring mail)\b/, 40],
  [/\b(scale|half plate)\b/, 45],
  [/\b(breastplate|chain shirt)\b/, 20],
  [/\b(hide|studded)\b/, 12],
  [/\b(armor|armour)\b/, 15],
  [/\b(shield|scutum|parma|clipeus)\b/, 6],
  [/\b(gladius|spatha|falx|sica)\b/, 3],
  [/\b(pilum|hasta)\b/, 3],
  [/\b(lorica|cuirass)\b/, 20],
  [/\bgalea\b/, 4],
  [/\b(greatsword|greataxe|maul|halberd|glaive|pike)\b/, 6],
  [/\b(sword|scimitar|rapier|axe|mace|flail|morningstar|warhammer|trident|spear)\b/, 3],
  [/\b(dagger|knife|sickle|club)\b/, 1],
  [/\b(longbow|crossbow)\b/, 4],
  [/\b(bow|sling)\b/, 2],
  [/\bjavelin\b/, 2],
  [/\bhelm(et)?\b/, 4],
];

const CATALOGUE = new Map(BASE_ITEMS.map((b) => [norm(b.name), b.weight]));

/** Estimated weight of ONE unit in pounds. */
export function estimateWeightLb(name: string): number {
  const n = norm(name);
  if (!n) return 0.5;
  const exact = CATALOGUE.get(n);
  if (exact !== undefined) return exact;
  // longest catalogue/gear name contained in the item name wins ("Leather Armor +1" → leather armor)
  let best: [string, number] | null = null;
  for (const [k, w] of [...CATALOGUE.entries(), ...GEAR_LB]) {
    if (k.length < 3) continue;
    if ((` ${n} `.includes(` ${k} `) || n.includes(` ${k}`) || n.startsWith(k)) && (!best || k.length > best[0].length)) best = [k, w];
  }
  if (best) return best[1];
  for (const [re, w] of KEYWORDS) if (re.test(n)) return w;
  return 0.5;
}

/** Estimated weight of ONE unit in kilograms, rounded to 0.05 kg (rough guide value). */
export function estimateWeightKg(name: string): number {
  const kg = estimateWeightLb(name) * LB_TO_KG;
  return Math.round(kg * 20) / 20;
}
