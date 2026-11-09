/**
 * Encounter generator (APEX 2.0) – D&D 5e 2014 encounter building (DMG ch. 3): an XP budget from the party's size
 * and level and the wanted difficulty, monsters from a theme (cultists, orcs, bandits …) until the adjusted XP
 * (encounter multiplier for the number of monsters) fills the budget, and a placement on the battle map for the
 * situation (camp, ambush, siege, patrol, lair). Same seed → same encounter. The GM can edit the list before placing.
 */
import type { SceneMap } from '../campaign/maps.js';
import { decodeTiles, heightLookup, hexAt, hexCentre } from '../campaign/hexScene.js';
import { ORIGIN, distance, hexKey, hexesInRange, neighbors, parseKey, type Axial, type HexKey } from './hex.js';
import type { StatBlock } from './bestiary.js';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'deadly';
/** XP thresholds per character (DMG): [easy, medium, hard, deadly] by level 1–20. */
const THRESHOLDS: Array<[number, number, number, number]> = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];
const XP: Record<string, number> = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000 };
export const crXp = (cr: string) => XP[cr.trim()] ?? 0;
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'deadly'];
export const partyThreshold = (size: number, level: number, d: Difficulty) => THRESHOLDS[Math.max(1, Math.min(20, Math.round(level))) - 1][DIFFS.indexOf(d)] * Math.max(1, size);

/** DMG encounter multiplier for the number of monsters (one step up for parties under 3, one down for 6+). */
export function multiplier(count: number, partySize: number): number {
  const steps = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  let i = count <= 1 ? 1 : count === 2 ? 2 : count <= 6 ? 3 : count <= 10 ? 4 : count <= 14 ? 5 : 6;
  if (partySize < 3) i++;
  else if (partySize >= 6) i--;
  return steps[Math.max(0, Math.min(steps.length - 1, i))];
}
export function rate(xps: number[], partySize: number, level: number): { raw: number; adjusted: number; difficulty: Difficulty | 'trivial' } {
  const raw = xps.reduce((a, b) => a + b, 0);
  const adjusted = Math.round(raw * multiplier(xps.length, partySize));
  let difficulty: Difficulty | 'trivial' = 'trivial';
  for (const d of DIFFS) if (adjusted >= partyThreshold(partySize, level, d)) difficulty = d;
  return { raw, adjusted, difficulty };
}

export interface Theme { id: string; label: string; leaders: string[]; troops: string[]; support?: string[]; match?: RegExp }
export const THEMES: Theme[] = [
  { id: 'cultists', label: 'Cultist cell', leaders: ['thug'], troops: ['cultist'], support: ['giant-bat'], match: /cult|fanatic|acolyte/i },
  { id: 'orcs', label: 'Orc war band', leaders: ['orc-bloodcaller'], troops: ['orc'], support: ['wolf'], match: /orc/i },
  { id: 'bandits', label: 'Bandit gang', leaders: ['thug'], troops: ['bandit', 'archer'], support: ['blood-hawk'], match: /bandit|thug|brigand/i },
  { id: 'goblins', label: 'Goblin raiders', leaders: ['ogre'], troops: ['goblin'], support: ['wolf'], match: /goblin|hobgoblin|bugbear/i },
  { id: 'undead', label: 'Restless dead', leaders: ['zombie'], troops: ['skeleton'], support: ['giant-bat'], match: /skeleton|zombie|ghoul|undead/i },
  { id: 'beasts', label: 'Wild beasts', leaders: ['bear'], troops: ['wolf', 'spider'], support: ['blood-hawk', 'giant-bat'], match: /wolf|bear|spider|boar|beast/i },
];
export type Situation = 'camp' | 'ambush' | 'siege' | 'patrol' | 'lair';
export const SITUATIONS: Array<{ id: Situation; label: string; text: string }> = [
  { id: 'camp', label: 'Camp', text: 'Gathered around the middle of the map (a campfire if there is one) – unaware, spread loosely.' },
  { id: 'ambush', label: 'Ambush', text: 'Hidden in cover around the party, 20–35 ft away (Stealth rolled for each).' },
  { id: 'siege', label: 'Siege', text: 'Coming from the map edge opposite the party; archers on high ground.' },
  { id: 'patrol', label: 'Patrol', text: 'A tight group on the move about 40 ft from the party.' },
  { id: 'lair', label: 'Lair', text: 'Deep in the far side of the map, clustered around the leader.' },
];

export interface EncounterEntry { templateId: string; name: string; cr: string; xp: number; role: 'leader' | 'troop' | 'support' }
export interface EncounterPlan { theme: string; situation: Situation; seed: number; entries: EncounterEntry[]; budget: number; rating: ReturnType<typeof rate> }

const rng = (seed: number) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/** Picks monsters of a theme to fill the XP budget. `blocks` are the stat blocks available (built-in + custom). */
export function planEncounter(o: { theme: string; situation: Situation; difficulty: Difficulty; partySize: number; partyLevel: number; seed: number; blocks: StatBlock[] }): EncounterPlan {
  const theme = THEMES.find((t) => t.id === o.theme) ?? THEMES[0];
  const byId = new Map(o.blocks.map((b) => [b.id, b]));
  // custom library creatures that fit the theme join the pools
  const custom = o.blocks.filter((b) => !['goblin', 'bandit', 'archer', 'wolf', 'skeleton', 'zombie', 'orc', 'cultist', 'spider', 'bear', 'thug', 'ogre', 'giant-bat', 'blood-hawk', 'orc-bloodcaller'].includes(b.id) && theme.match?.test(`${b.name} ${b.type}`));
  const pool = (ids: string[]) => [...ids.map((id) => byId.get(id)).filter((b): b is StatBlock => !!b)];
  const leaders = [...pool(theme.leaders), ...custom.filter((b) => b.elite)];
  const troops = [...pool(theme.troops), ...custom.filter((b) => !b.elite)];
  const support = pool(theme.support ?? []);
  const budget = partyThreshold(o.partySize, o.partyLevel, o.difficulty);
  const r = rng(o.seed * 7919 + o.theme.length * 31 + o.difficulty.length);
  const entries: EncounterEntry[] = [];
  const fits = (b: StatBlock) => rate([...entries.map((e) => e.xp), crXp(b.cr)], o.partySize, o.partyLevel).adjusted <= budget * 1.1;
  const add = (b: StatBlock, role: EncounterEntry['role']) => entries.push({ templateId: b.id, name: b.name, cr: b.cr, xp: crXp(b.cr), role });
  // a leader for medium and harder fights (if it fits)
  if (o.difficulty !== 'easy' && leaders.length) { const l = leaders[Math.floor(r() * leaders.length)]; if (fits(l)) add(l, 'leader'); }
  for (let guard = 0; guard < 40 && entries.length < 12; guard++) {
    const fromSupport = support.length && r() < 0.22;
    const list = fromSupport ? support : troops.length ? troops : support;
    if (!list.length) break;
    const cands = list.filter(fits);
    if (!cands.length) break;
    add(cands[Math.floor(r() * cands.length)], fromSupport ? 'support' : 'troop');
  }
  if (!entries.length && troops.length) add(troops.reduce((a, b) => (crXp(a.cr) <= crXp(b.cr) ? a : b)), 'troop');
  return { theme: theme.id, situation: o.situation, seed: o.seed, entries, budget, rating: rate(entries.map((e) => e.xp), o.partySize, o.partyLevel) };
}

/**
 * Where the creatures stand: hex centres on passable, free hexes for the situation. `party` is where the party is
 * (its spawn or centre); `ranged` marks entries that shoot (they prefer high ground in a siege).
 */
export function placeEncounter(map: SceneMap, situation: Situation, count: number, party: { x: number; y: number }, seed: number, occupied: Set<HexKey>, ranged: boolean[] = []): Array<{ x: number; y: number; hidden?: boolean }> {
  if (!map.hex) return [];
  const tiles = decodeTiles(map.hex);
  const height = heightLookup(map);
  const r = rng(seed * 104729 + count);
  const p = hexAt(map, party);
  const free = (h: Axial) => { const t = tiles.get(hexKey(h)); return !!t && t.cost !== null && !occupied.has(hexKey(h)); };
  const all = hexesInRange(ORIGIN, map.hex.radius).filter(free);
  const cover = (h: Axial) => neighbors(h).filter((n) => { const t = tiles.get(hexKey(n)); return !!t && (t.blocksSight || t.cost === null); }).length;
  const take: Axial[] = [];
  const pick = (score: (h: Axial) => number, n: number) => {
    const ranked = all.filter((h) => !take.some((t) => t.q === h.q && t.r === h.r)).map((h) => ({ h, s: score(h) + r() * 0.5 })).sort((a, b) => b.s - a.s);
    for (const x of ranked) { if (take.length >= n) break; take.push(x.h); }
  };
  // the far side of the map from the party
  const far = all.reduce((best, h) => (distance(h, p) > distance(best, p) ? h : best), all[0] ?? ORIGIN);
  const fire = [...tiles].find(([, t]) => t.id === 'campfire')?.[0];
  const campAt = fire ? parseKey(fire) : distance(ORIGIN, p) > 3 ? ORIGIN : hexesInRange(ORIGIN, Math.max(2, Math.floor(map.hex.radius / 2))).reduce((best, h) => (distance(h, p) > distance(best, p) ? h : best), ORIGIN);
  switch (situation) {
    case 'camp': pick((h) => -Math.abs(distance(h, campAt) - 1.6) * 2, count); break;
    case 'ambush': pick((h) => { const d = distance(h, p); return d >= 4 && d <= 7 ? 3 + cover(h) * 2 - Math.abs(d - 5) : -10 - Math.abs(d - 5); }, count); break;
    case 'patrol': { const c = all.filter((h) => distance(h, p) === Math.min(8, Math.max(4, map.hex!.radius - 2))).sort(() => r() - 0.5)[0] ?? far; pick((h) => -distance(h, c), count); break; }
    case 'lair': pick((h) => -distance(h, far) * 1.5, count); break;
    case 'siege': {
      // archers on the highest free ground facing the party, the rest along the far edge
      const nRanged = ranged.filter(Boolean).length;
      pick((h) => height(hexKey(h)) * 3 - distance(h, far) * 0.6, nRanged);
      pick((h) => -distance(h, far) + (distance(h, p) > map.hex!.radius ? 2 : 0), count);
      // keep the order: ranged entries get the high spots
      const high = take.slice(0, nRanged), rest = take.slice(nRanged);
      take.length = 0;
      ranged.forEach((isR) => take.push((isR ? high.shift() : rest.shift()) ?? rest.shift() ?? high.shift() ?? far));
      break;
    }
  }
  return take.slice(0, count).map((h) => ({ ...hexCentre(map, h), ...(situation === 'ambush' ? { hidden: true } : {}) }));
}
