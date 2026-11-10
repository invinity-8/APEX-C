/**
 * APEX 2.1 – enemy groups and spawn points.
 *
 * A group is a named set of creatures from the enemy library (cultist cell, bandit gang, orc war band …). In the
 * scene editor the GM drags groups onto the battle map: each becomes a hidden spawn marker (a map node of kind
 * 'enemies'). During the game the GM spawns a marker's group with one click – the creatures stand on the free
 * hexes nearest to the marker, and each gets its own look (figure variation) and initiative.
 *
 * Layout × colour scheme / mood × groups: the composer in the editor places matching groups for a layout, so a
 * market square + golden hour + cultist cell is a ready scenario in three clicks.
 */
import type { SceneMap } from '../campaign/maps.js';
import { decodeTiles, hexAt, hexCentre } from '../campaign/hexScene.js';
import { ORIGIN, distance, hexKey, hexesInRange, type Axial, type HexKey } from './hex.js';
import { crXp } from './encounters.js';
import type { StatBlock } from './bestiary.js';

export interface EnemyGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Up to 12 creatures in total. */
  members: Array<{ templateId: string; count: number }>;
  /** Short note for the GM (tactics, loot …). */
  note?: string;
  source?: 'APEX' | 'custom';
}

const g = (id: string, name: string, icon: string, color: string, members: Array<[string, number]>, note: string): EnemyGroup => ({ id, name, icon, color, members: members.map(([templateId, count]) => ({ templateId, count })), note, source: 'APEX' });
export const BUILTIN_GROUPS: EnemyGroup[] = [
  g('g-cult-cell', 'Cultist cell', '🕯', '#5a1515', [['thug', 1], ['cultist', 3]], 'A thug guards three cultists. They fight to the last for their leader.'),
  g('g-cult-ritual', 'Cult ritual', '⛧', '#3a0d0d', [['cultist', 5], ['giant-bat', 2]], 'Cultists around a ritual site; summoned bats circle above.'),
  g('g-bandit-gang', 'Bandit gang', '🗡', '#6b4a2b', [['thug', 1], ['bandit', 3], ['archer', 1]], 'The boss and his crew; the archer keeps her distance.'),
  g('g-bandit-ambush', 'Bandit ambush', '🏹', '#5c7a2a', [['archer', 2], ['bandit', 2]], 'Archers in cover, two blades to hold the road.'),
  g('g-highwaymen', 'Highwaymen', '💰', '#8a6a3a', [['bandit', 3]], 'Three robbers who would rather take the purse than fight.'),
  g('g-thugs', 'Enforcers', '👊', '#3a2a1a', [['thug', 3]], 'Hired muscle from the city.'),
  g('g-orc-warband', 'Orc war band', '🪓', '#4f6b3a', [['orc-bloodcaller', 1], ['orc', 3], ['wolf', 1]], 'The Bloodcaller drives the orcs forward with war cries.'),
  g('g-orc-scouts', 'Orc scouts', '🐺', '#6f8f4e', [['orc', 2], ['wolf', 2]], 'Fast raiders with their wolves.'),
  g('g-goblin-raid', 'Goblin raiders', '👺', '#9fb37a', [['goblin', 4], ['wolf', 1]], 'They hit, hide and run.'),
  g('g-goblin-boss', 'Goblins and their ogre', '👹', '#b9a06a', [['ogre', 1], ['goblin', 3]], 'The goblins hide behind the ogre.'),
  g('g-restless-dead', 'Restless dead', '💀', '#c9c1b0', [['zombie', 2], ['skeleton', 3]], 'Slow, relentless, never afraid.'),
  g('g-skeleton-guard', 'Skeleton guard', '⚔', '#6a6458', [['skeleton', 4]], 'Crypt guardians in formation.'),
  g('g-wolf-pack', 'Wolf pack', '🐺', '#7d8fa3', [['wolf', 4]], 'Pack tactics: they surround one target.'),
  g('g-spider-nest', 'Spider nest', '🕷', '#2a2a2a', [['spider', 2], ['giant-bat', 2]], 'Webs and bats in the dark.'),
  g('g-wild-beasts', 'Bear and hawks', '🐻', '#6b4224', [['bear', 1], ['blood-hawk', 2]], 'A furious bear with hawks overhead.'),
];

export const groupSize = (gr: EnemyGroup) => gr.members.reduce((n, m) => n + m.count, 0);
export const groupTemplates = (gr: EnemyGroup) => gr.members.flatMap((m) => Array.from({ length: m.count }, () => m.templateId));
export const groupXp = (gr: EnemyGroup, blocks: StatBlock[]) => groupTemplates(gr).reduce((n, id) => n + crXp(blocks.find((b) => b.id === id)?.cr ?? '0'), 0);
export const allGroups = (custom: EnemyGroup[] | undefined) => [...BUILTIN_GROUPS.filter((b) => !(custom ?? []).some((c) => c.id === b.id)), ...(custom ?? [])];

/** Validates a group from the client (ids against the given stat blocks). */
export function parseGroup(v: unknown, blocks: StatBlock[]): EnemyGroup | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(o.id)) return null;
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 40) return null;
  if (!Array.isArray(o.members) || !o.members.length || o.members.length > 8) return null;
  const members: EnemyGroup['members'] = [];
  for (const m of o.members as Array<Record<string, unknown>>) {
    if (!m || typeof m.templateId !== 'string' || !blocks.some((b) => b.id === m.templateId) || !Number.isSafeInteger(m.count) || (m.count as number) < 1 || (m.count as number) > 12) return null;
    members.push({ templateId: m.templateId, count: m.count as number });
  }
  if (members.reduce((n, m) => n + m.count, 0) > 12) return null;
  const icon = typeof o.icon === 'string' && o.icon.length <= 4 && o.icon.trim() ? o.icon : '⚔';
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : '#7a3a3a';
  const note = typeof o.note === 'string' ? o.note.slice(0, 300) : undefined;
  return { id: o.id, name: o.name.trim(), icon, color, members, ...(note ? { note } : {}), source: 'custom' };
}

/**
 * Free passable hexes nearest to a spawn marker for `count` creatures (ring by ring, the marker's hex first).
 * Returns hex centres in scene pixels.
 */
export function spotsAround(map: SceneMap, at: { x: number; y: number }, count: number, occupied: Set<HexKey>): Array<{ x: number; y: number }> {
  if (!map.hex) return [];
  const tiles = decodeTiles(map.hex);
  const c = hexAt(map, at);
  const out: Axial[] = [];
  for (let ring = 0; ring <= map.hex.radius * 2 && out.length < count; ring++) {
    for (const h of hexesInRange(c, ring)) {
      if (distance(h, c) !== ring || out.length >= count) continue;
      const k = hexKey(h), t = tiles.get(k);
      if (!t || t.cost === null || occupied.has(k)) continue;
      out.push(h);
    }
  }
  return out.map((h) => hexCentre(map, h));
}

/** Layout → fitting groups (used by the composer and as a default suggestion). */
export const LAYOUT_GROUPS: Record<string, string[]> = {
  farmstead: ['g-bandit-gang', 'g-goblin-raid', 'g-wolf-pack', 'g-highwaymen'],
  hamlet: ['g-bandit-gang', 'g-orc-scouts', 'g-cult-cell', 'g-goblin-raid'],
  orchard: ['g-goblin-raid', 'g-wild-beasts', 'g-bandit-ambush'],
  graveyard: ['g-restless-dead', 'g-skeleton-guard', 'g-cult-ritual'],
  manor: ['g-cult-cell', 'g-thugs', 'g-bandit-gang'],
  market: ['g-cult-cell', 'g-thugs', 'g-bandit-gang'],
  streets: ['g-thugs', 'g-cult-cell', 'g-bandit-ambush'],
  docks: ['g-thugs', 'g-bandit-gang', 'g-cult-cell'],
  citygate: ['g-orc-warband', 'g-goblin-boss', 'g-bandit-ambush'],
  tavern: ['g-thugs', 'g-bandit-gang', 'g-cult-cell'],
  crypt: ['g-restless-dead', 'g-skeleton-guard', 'g-cult-ritual', 'g-spider-nest'],
  camp: ['g-bandit-gang', 'g-orc-warband', 'g-cult-cell'],
  cave: ['g-spider-nest', 'g-goblin-boss', 'g-wolf-pack'],
  forest: ['g-wolf-pack', 'g-wild-beasts', 'g-bandit-ambush'],
  swamp: ['g-restless-dead', 'g-spider-nest', 'g-cult-ritual'],
  temple: ['g-cult-ritual', 'g-cult-cell', 'g-skeleton-guard'],
  dungeon: ['g-skeleton-guard', 'g-goblin-boss', 'g-spider-nest'],
};

/**
 * Spawn markers for `groups` on a map: spread over the far side from the party spawn, on passable hexes, at least
 * three hexes apart. Deterministic for a seed.
 */
export function composeSpawns(map: SceneMap, groups: EnemyGroup[], seed: number): Array<{ x: number; y: number; group: EnemyGroup }> {
  if (!map.hex) return [];
  const tiles = decodeTiles(map.hex);
  const spawn = map.nodes.find((n) => n.kind === 'spawn');
  const party = spawn ? hexAt(map, spawn) : ORIGIN;
  const open = hexesInRange(ORIGIN, map.hex.radius).filter((h) => { const t = tiles.get(hexKey(h)); return !!t && t.cost !== null; });
  const roomy = (h: Axial) => hexesInRange(h, 1).filter((n) => { const t = tiles.get(hexKey(n)); return !!t && t.cost !== null; }).length;
  const taken: Axial[] = [];
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return groups.map((group) => {
    const best = open
      .filter((h) => taken.every((t) => distance(t, h) >= 3))
      .map((h) => ({ h, score: Math.min(distance(h, party), map.hex!.radius + 2) * 1.5 + roomy(h) + rnd() * 2 }))
      .sort((a, b) => b.score - a.score)[0]?.h ?? ORIGIN;
    taken.push(best);
    return { ...hexCentre(map, best), group };
  });
}
