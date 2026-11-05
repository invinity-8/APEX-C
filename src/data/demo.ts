/**
 * Demo campaign "APEX – Arena of the Eternal Will".
 * All names and backgrounds are placeholders you can change freely.
 * The online mode uses the same factory to create a new shared campaign.
 */
import { ORIGIN, distance, hexKey, hexesInRange, type Axial, type HexKey } from '../game/hex.js';
import { generateArena } from '../game/mapgen.js';
import { T } from '../game/text.js';
import { isPassable, type TerrainType } from '../game/terrain.js';
import { refreshAllKnowledge, emptyKnowledge } from '../game/visibility.js';
import { addLog } from '../game/log.js';
import {
  DEFAULT_PHASE_RULES,
  STATE_VERSION,
  type ArenaEvent,
  type GameConfig,
  type GameState,
  type HexTile,
  type Site,
  type Team,
  type Token,
} from '../game/types.js';

export interface DemoOptions {
  radius?: number;
  seed?: number;
}

/** v0.2: ten times the area of v0.1 (radius 12 → 39, 469 → 4,681 hexes). */
export const DEFAULT_RADIUS = 39;
export const MIN_RADIUS = 4;
export const MAX_RADIUS = 78;
export const DEFAULT_SEED = 1337;
/** Site positions below were designed for radius 12 and are scaled to the chosen size. */
const DESIGN_RADIUS = 12;

export function createDemoState(opts: DemoOptions = {}): GameState {
  const radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(opts.radius ?? DEFAULT_RADIUS)));
  const seed = Math.round(opts.seed ?? DEFAULT_SEED) || 1;
  const f = radius / DESIGN_RADIUS;
  const at = (q: number, r: number): Axial => ({ q: Math.round(q * f), r: Math.round(r * f) });

  const config: GameConfig = {
    mapRadius: radius,
    seed,
    defaultMovePoints: 8,
    defaultVisionRadius: 2,
    shrink: {
      enabled: true,
      startDay: 5,
      intervalDays: 2,
      // Scales with the map so that the large arena actually contracts noticeably.
      ringsPerStep: Math.max(1, Math.round(radius / DESIGN_RADIUS)),
      mode: 'danger',
      warningDays: 1,
      consequence: 'Constitution saving throw (DC 12) – on a failure, 2d6 necrotic damage.',
    },
    phases: structuredClone(DEFAULT_PHASE_RULES),
  };

  // ---------------- Sites ----------------
  const siteList: Array<Site & { terrain: TerrainType }> = [
    {
      id: 'meta-aurea',
      name: 'Aquila Aurea',
      type: 'start',
      pos: { ...ORIGIN },
      terrain: 'plains',
      description:
        'A colossal golden eagle with outstretched wings crowns a marble dais at the heart of the arena – the symbol of the Empire\'s power. Around it winds the Labyrinthus Imperii, an ancient maze of walls, mosaics and glowing inscriptions. Crates of basic equipment lie at the eagle\'s feet.',
      gmNotes: 'On the evening of Day 1 a second supply crate drops – whoever stays risks an ambush. The inscriptions of the labyrinth can later unlock campaign events.',
      visibility: 'public',
      status: 'intact',
      rewards: ['Rations for 2 days', 'Rope (50 ft)', 'Gladius'],
      interactions: ['Loot the equipment', 'Study the inscriptions (Arcana DC 13)', 'Walk the labyrinth'],
    },
    {
      id: 'castra-neutra',
      name: 'Castra Neutra',
      type: 'camp',
      pos: at(5, -3),
      terrain: 'plains',
      description:
        'A palisaded camp under the seal of the Gamemakers. The trader Sabina Velox exchanges supplies for gold. Fighting is forbidden here.',
      gmNotes: 'Sabina is an informant of the Legio Ferrata. With high reputation she admits it.',
      visibility: 'onSight',
      status: 'occupied',
      rewards: ['Healing potions (for gold)', 'Map of one sector'],
      interactions: ['Trade', 'Rest (safe)', 'Ask for rumours'],
    },
    {
      id: 'speculum',
      name: 'Speculum',
      type: 'tower',
      pos: at(-3, 1),
      terrain: 'ruins',
      description: 'A half-ruined signal tower with a giant bronze mirror. From the top you can survey the surroundings.',
      gmNotes: 'Climbing: Athletics DC 10 → GM grants +2 vision until dawn.',
      visibility: 'onSight',
      status: 'intact',
      rewards: ['Wide view (+2)'],
      interactions: ['Climb the tower', 'Align the mirror (signals other teams!)'],
    },
    {
      id: 'fons-voluntatis',
      name: 'Fons Voluntatis',
      type: 'shrine',
      pos: at(-8, 2),
      terrain: 'magic',
      description: 'A spring of shimmering, faintly glowing water. It restores body and mind – at a price.',
      gmNotes: 'Per drink: regain 2d4 + 2 HP; Wisdom saving throw DC 14, otherwise 1 level of exhaustion.',
      visibility: 'onSight',
      status: 'intact',
      rewards: ['Regain 2d4 + 2 hit points'],
      interactions: ['Drink', 'Fill a flask'],
    },
    {
      id: 'templum-oblitum',
      name: 'Templum Oblitum',
      type: 'ruin',
      pos: at(-6, 8),
      terrain: 'ruins',
      description: 'A forgotten temple that appears on no map of the arena.',
      gmNotes: 'Hidden site. Contains the anchor stone that powers the arena borders. Destroying it halts the shrinking for 2 days.',
      visibility: 'hidden',
      status: 'intact',
      rewards: ['Anchor stone of the arena'],
      interactions: ['Take the anchor stone', 'Destroy the anchor stone'],
    },
    {
      id: 'donum-imperatoris',
      name: 'Donum Imperatoris',
      type: 'cache',
      pos: at(6, 2),
      terrain: 'plains',
      description: 'A supply shrine lowered from the sky, bearing the eagle of the Emperor.',
      gmNotes: 'Becomes public on Day 3 through the "Proclamation" event. All rivals head for it.',
      visibility: 'hidden',
      status: 'intact',
      rewards: ['Pilum of the Stars', 'Will vial (full)', 'Rations for 4 days'],
      interactions: ['Open the shrine'],
    },
  ];

  const overrides: Record<HexKey, TerrainType> = {};
  for (const s of siteList) overrides[hexKey(s.pos)] = s.terrain;

  const hexes = generateArena({ radius, seed, overrides });
  for (const s of siteList) if (hexes[hexKey(s.pos)]) hexes[hexKey(s.pos)].siteId = s.id;

  const sites: Record<string, Site> = {};
  for (const { terrain: _t, ...s } of siteList) if (hexes[hexKey(s.pos)]) sites[s.id] = s;

  // ---------------- Teams ----------------
  const teams: Record<string, Team> = {
    party: {
      id: 'party',
      name: 'Cohors Ignota',
      kind: 'party',
      color: '#e9c46a',
      emblem: '✦',
      motto: 'No one knows our names – not yet.',
      personality: 'The player party.',
      aggression: 0,
      goals: ['Survive', 'Uncover the truth behind the arena'],
      resources: [],
      strategy: 'manual',
      visibility: 'revealed',
      tracking: null,
    },
    ferrata: {
      id: 'ferrata',
      name: 'Legio Ferrata',
      kind: 'rival',
      color: '#8fa3bf',
      emblem: '⚔',
      motto: 'Iron obeys. Iron prevails.',
      personality: 'Disciplined veterans from the barracks of Ostia. They fight in formation and never negotiate twice.',
      aggression: 8,
      goals: ['Secure the Donum Imperatoris', 'Eliminate the strongest team'],
      resources: ['Shields', 'Signal horn', '2 will vials'],
      strategy: 'patrol',
      visibility: 'auto',
      tracking: null,
    },
    vesperia: {
      id: 'vesperia',
      name: 'House Vesperia',
      kind: 'rival',
      color: '#b48ee0',
      emblem: '✶',
      motto: 'The will of many in the hands of few.',
      personality: 'Noble will-binders. Polite, calculating, fond of luring other teams into traps.',
      aggression: 5,
      goals: ['Control the Fons Voluntatis', 'Forge and break alliances'],
      resources: ['Bound servants', 'Forged map'],
      strategy: 'forage',
      visibility: 'auto',
      tracking: null,
    },
    aquaeductus: {
      id: 'aquaeductus',
      name: 'Children of the Aqueduct',
      kind: 'rival',
      color: '#4fc1b0',
      emblem: '≈',
      motto: 'We know the paths beneath the arena.',
      personality: 'Street children from the lower districts. Quick, suspicious, avoid open fights.',
      aggression: 3,
      goals: ['Stay undetected', 'Reach the Templum Oblitum'],
      resources: ['Climbing hooks', 'Smoke pots'],
      strategy: 'flee',
      visibility: 'auto',
      tracking: null,
    },
  };

  // ---------------- Characters ----------------
  const base = (p: Partial<Token> & Pick<Token, 'id' | 'name' | 'kind' | 'teamId' | 'color' | 'initials' | 'pos' | 'title'>): Token => ({
    movePoints: config.defaultMovePoints,
    maxMovePoints: config.defaultMovePoints,
    visionRadius: config.defaultVisionRadius,
    visionBonus: 0,
    controllers: [],
    sharesWithParty: true,
    inventory: [],
    ...p,
  });

  const tokenList: Token[] = [
    base({
      id: 'sinna', name: 'Sinna', kind: 'player', teamId: 'party', title: 'Will-Weaver',
      color: '#e9c46a', initials: 'SI', pos: { q: 0, r: 1 },
      inventory: [
        { id: 'i1', name: 'Voluntas Vial', kind: 'misc', description: 'A sealed glass vial from the Tributum Voluntatis.', quantity: 1 },
        { id: 'i2', name: 'Aqueduct-Stone Staff', kind: 'weapon', description: 'Channels willpower like water.', quantity: 1 },
      ],
    }),
    base({
      id: 'aster', name: 'Aster', kind: 'player', teamId: 'party', title: 'Retired Legionary',
      color: '#6fb1e0', initials: 'AS', pos: { q: 0, r: 1 }, maxMovePoints: 8,
      inventory: [
        { id: 'i3', name: 'Scutum', kind: 'armor', description: 'Large legionary shield.', quantity: 1 },
        { id: 'i4', name: 'Gladius', kind: 'weapon', description: 'Short sword.', quantity: 1 },
      ],
    }),
    base({
      id: 'elwin', name: 'Elwin', kind: 'player', teamId: 'party', title: 'Scout',
      color: '#7cc98a', initials: 'EL', pos: { q: -1, r: 2 }, visionRadius: 3,
      inventory: [
        { id: 'i5', name: 'Shortbow', kind: 'weapon', description: '20 arrows.', quantity: 1 },
        { id: 'i6', name: 'Climbing Rope', kind: 'tool', description: '50 ft, with grappling hook.', quantity: 1 },
      ],
    }),
    base({
      id: 'javi', name: 'Javi', kind: 'player', teamId: 'party', title: 'Gladiator-Priest',
      color: '#ece4d2', initials: 'JA', pos: { q: 0, r: 1 },
      inventory: [
        { id: 'i7', name: 'Net & Trident', kind: 'weapon', description: 'Classic retiarius gear.', quantity: 1 },
        { id: 'i8', name: 'Healing Potion', kind: 'consumable', description: '2d4+2 HP.', quantity: 2 },
      ],
    }),
    base({
      id: 'r-ferrata', name: 'Legio Ferrata', kind: 'rival', teamId: 'ferrata', title: '4 legionaries · Centurion Gaius Dentatus',
      color: teams.ferrata.color, initials: '⚔', pos: nearestPassable(hexes, at(8, -8)),
    }),
    base({
      id: 'r-vesperia', name: 'House Vesperia', kind: 'rival', teamId: 'vesperia', title: '3 will-binders · Domina Aelia Vesper',
      color: teams.vesperia.color, initials: '✶', pos: nearestPassable(hexes, at(-9, 4)),
    }),
    base({
      id: 'r-aquaeductus', name: 'Children of the Aqueduct', kind: 'rival', teamId: 'aquaeductus', title: '5 strays · "Rat" Felix',
      color: teams.aquaeductus.color, initials: '≈', pos: nearestPassable(hexes, at(2, 7)),
    }),
  ];
  const tokens: Record<string, Token> = Object.fromEntries(tokenList.map((t) => [t.id, t]));

  // ---------------- Events ----------------
  const floodHexes = hexesInRange(at(-1, -6), 1)
    .concat(hexesInRange(at(1, -7), 1))
    .map(hexKey)
    .filter((k) => hexes[k] && !hexes[k].siteId);

  const events: Record<string, ArenaEvent> = {
    flood: {
      id: 'flood',
      name: 'Breach of the Aqueduct',
      description: 'A floating aqueduct collapses in the north. The floods turn the land into a lake.',
      trigger: { type: 'day', day: 2 },
      hexes: [...new Set(floodHexes)],
      effects: [{ type: 'setTerrain', terrain: 'water' }],
      status: 'pending',
      announce: true,
    },
    proclamation: {
      id: 'proclamation',
      name: 'Proclamation of the Editor',
      description: 'The voice of the arena\'s Editor echoes across the field: in the east awaits the Donum Imperatoris.',
      trigger: { type: 'day', day: 3 },
      hexes: sites['donum-imperatoris'] ? [hexKey(sites['donum-imperatoris'].pos)] : [],
      effects: [{ type: 'revealSite', siteId: 'donum-imperatoris' }],
      status: 'pending',
      announce: true,
    },
    willstorm: {
      id: 'willstorm',
      name: 'Willstorm',
      description: 'A storm of unleashed willpower sweeps across the arena. Every step becomes torment (−2 MP).',
      trigger: { type: 'manual' },
      hexes: [],
      effects: [{ type: 'modifyMovePoints', amount: -2 }],
      status: 'pending',
      announce: true,
    },
  };

  const state: GameState = {
    version: STATE_VERSION,
    config,
    day: 1,
    phase: 'day',
    hexes,
    tokens,
    teams,
    sites,
    events,
    knowledge: Object.fromEntries(tokenList.filter((t) => t.kind === 'player').map((t) => [t.id, emptyKnowledge()])),
    log: [],
    nextLogId: 1,
  };

  addLog(state, 'system', T.logArenaOpen);
  addLog(state, 'system', T.logArenaCreated(radius, Object.keys(hexes).length, seed), 'gm');
  refreshAllKnowledge(state);
  return state;
}

/** Nearest passable hex (for starting positions). */
export function nearestPassable(hexes: Record<HexKey, HexTile>, target: Axial): Axial {
  const tiles = Object.values(hexes)
    .filter((t) => isPassable(t.terrain))
    .sort((a, b) => distance(a, target) - distance(b, target));
  return tiles.length ? { q: tiles[0].q, r: tiles[0].r } : { ...ORIGIN };
}
