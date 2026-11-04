/**
 * Beast forms for Wild Shape (APEX 0.7).
 *
 * Stat blocks from the "System Reference Document 5.1" by Wizards of the Coast LLC, licensed under CC BY 4.0
 * (https://creativecommons.org/licenses/by/4.0/). Statistics only – no artwork. Players may upload their own
 * picture per form (stored privately like portraits). The GM can add custom forms (`GameState.customBeasts`).
 */
export type BeastSpeed = { walk: number; climb?: number; swim?: number; fly?: number; burrow?: number };
export interface BeastAttack {
  name: string;
  toHit: number;
  damage: string;
  /** reach / range, extra effects */
  notes?: string;
}
export interface BeastForm {
  id: string;
  name: string;
  /** challenge rating as a number (1/8 = 0.125 …) */
  cr: number;
  ac: number;
  hp: number;
  hitDice: string;
  speed: BeastSpeed;
  str: number;
  dex: number;
  con: number;
  /** the beast's own mental scores – shown for reference, the druid keeps theirs */
  int: number;
  wis: number;
  cha: number;
  skills?: string;
  senses: string;
  traits: string[];
  attacks: BeastAttack[];
  source: 'SRD 5.1' | 'GM';
}

export const SRD_BEAST_ATTRIBUTION = 'Beast statistics: System Reference Document 5.1 by Wizards of the Coast LLC, CC BY 4.0.';

export const SRD_BEASTS: BeastForm[] = [
  { id: 'cat', name: 'Cat', cr: 0, ac: 12, hp: 2, hitDice: '1d4', speed: { walk: 40, climb: 30 }, str: 3, dex: 15, con: 10, int: 3, wis: 12, cha: 7, skills: 'Perception +3, Stealth +4', senses: 'passive Perception 13', traits: ['Keen Smell: advantage on Wisdom (Perception) checks that rely on smell.'], attacks: [{ name: 'Claws', toHit: 0, damage: '1 slashing' }], source: 'SRD 5.1' },
  { id: 'rat', name: 'Rat', cr: 0, ac: 10, hp: 1, hitDice: '1d4−1', speed: { walk: 20 }, str: 2, dex: 11, con: 9, int: 2, wis: 10, cha: 4, senses: 'darkvision 30 ft., passive Perception 10', traits: ['Keen Smell.'], attacks: [{ name: 'Bite', toHit: 0, damage: '1 piercing' }], source: 'SRD 5.1' },
  { id: 'hawk', name: 'Hawk', cr: 0, ac: 13, hp: 1, hitDice: '1d4−1', speed: { walk: 10, fly: 60 }, str: 5, dex: 16, con: 8, int: 2, wis: 14, cha: 6, skills: 'Perception +4', senses: 'passive Perception 14', traits: ['Keen Sight: advantage on Wisdom (Perception) checks that rely on sight.'], attacks: [{ name: 'Talons', toHit: 5, damage: '1 slashing' }], source: 'SRD 5.1' },
  { id: 'mastiff', name: 'Mastiff', cr: 0.125, ac: 12, hp: 5, hitDice: '1d8+1', speed: { walk: 40 }, str: 13, dex: 14, con: 12, int: 3, wis: 12, cha: 7, skills: 'Perception +3', senses: 'passive Perception 13', traits: ['Keen Hearing and Smell.'], attacks: [{ name: 'Bite', toHit: 3, damage: '1d6+1 piercing', notes: 'Target: DC 11 Strength save or knocked prone.' }], source: 'SRD 5.1' },
  { id: 'wolf', name: 'Wolf', cr: 0.25, ac: 13, hp: 11, hitDice: '2d8+2', speed: { walk: 40 }, str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6, skills: 'Perception +3, Stealth +4', senses: 'passive Perception 13', traits: ['Keen Hearing and Smell.', 'Pack Tactics: advantage on attacks if an ally is within 5 ft. of the target.'], attacks: [{ name: 'Bite', toHit: 4, damage: '2d4+2 piercing', notes: 'Target: DC 11 Strength save or knocked prone.' }], source: 'SRD 5.1' },
  { id: 'panther', name: 'Panther', cr: 0.25, ac: 12, hp: 13, hitDice: '3d8', speed: { walk: 50, climb: 40 }, str: 14, dex: 15, con: 10, int: 3, wis: 14, cha: 7, skills: 'Perception +4, Stealth +6', senses: 'passive Perception 14', traits: ['Keen Smell.', 'Pounce: move 20 ft. straight then claw → DC 12 Strength save or prone; then a bonus-action bite.'], attacks: [{ name: 'Bite', toHit: 4, damage: '1d6+2 piercing' }, { name: 'Claw', toHit: 4, damage: '1d4+2 slashing' }], source: 'SRD 5.1' },
  { id: 'boar', name: 'Boar', cr: 0.25, ac: 11, hp: 11, hitDice: '2d8+2', speed: { walk: 40 }, str: 13, dex: 11, con: 12, int: 2, wis: 9, cha: 5, senses: 'passive Perception 9', traits: ['Charge: 20 ft. straight then tusk → +1d6 slashing, DC 11 Strength save or prone.', 'Relentless (recharges after a rest): damage of 7 or less that would drop it to 0 HP leaves it at 1 HP.'], attacks: [{ name: 'Tusk', toHit: 3, damage: '1d6+1 slashing' }], source: 'SRD 5.1' },
  { id: 'giant-badger', name: 'Giant Badger', cr: 0.25, ac: 10, hp: 13, hitDice: '2d8+4', speed: { walk: 30, burrow: 10 }, str: 13, dex: 10, con: 15, int: 2, wis: 12, cha: 5, senses: 'darkvision 30 ft., passive Perception 11', traits: ['Keen Smell.', 'Multiattack: bite and claws.'], attacks: [{ name: 'Bite', toHit: 3, damage: '1d6+1 piercing' }, { name: 'Claws', toHit: 3, damage: '2d4+1 slashing' }], source: 'SRD 5.1' },
  { id: 'black-bear', name: 'Black Bear', cr: 0.5, ac: 11, hp: 19, hitDice: '3d8+6', speed: { walk: 40, climb: 30 }, str: 15, dex: 10, con: 14, int: 2, wis: 12, cha: 7, skills: 'Perception +3', senses: 'passive Perception 13', traits: ['Keen Smell.', 'Multiattack: bite and claws.'], attacks: [{ name: 'Bite', toHit: 3, damage: '1d6+2 piercing' }, { name: 'Claws', toHit: 3, damage: '2d4+2 slashing' }], source: 'SRD 5.1' },
  { id: 'ape', name: 'Ape', cr: 0.5, ac: 12, hp: 19, hitDice: '3d8+6', speed: { walk: 30, climb: 30 }, str: 16, dex: 14, con: 14, int: 6, wis: 12, cha: 7, skills: 'Athletics +5, Perception +3', senses: 'passive Perception 13', traits: ['Multiattack: two fist attacks.'], attacks: [{ name: 'Fist', toHit: 5, damage: '1d6+3 bludgeoning' }, { name: 'Rock', toHit: 5, damage: '1d6+3 bludgeoning', notes: 'Ranged 25/50 ft.' }], source: 'SRD 5.1' },
  { id: 'crocodile', name: 'Crocodile', cr: 0.5, ac: 12, hp: 19, hitDice: '3d10+3', speed: { walk: 20, swim: 30 }, str: 15, dex: 10, con: 13, int: 2, wis: 10, cha: 5, skills: 'Stealth +2', senses: 'passive Perception 10', traits: ['Hold Breath: 15 minutes.'], attacks: [{ name: 'Bite', toHit: 4, damage: '1d10+2 piercing', notes: 'Target grappled (escape DC 12).' }], source: 'SRD 5.1' },
  { id: 'brown-bear', name: 'Brown Bear', cr: 1, ac: 11, hp: 34, hitDice: '4d10+12', speed: { walk: 40, climb: 30 }, str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7, skills: 'Perception +3', senses: 'passive Perception 13', traits: ['Keen Smell.', 'Multiattack: bite and claws.'], attacks: [{ name: 'Bite', toHit: 6, damage: '1d8+4 piercing' }, { name: 'Claws', toHit: 6, damage: '2d6+4 slashing' }], source: 'SRD 5.1' },
  { id: 'dire-wolf', name: 'Dire Wolf', cr: 1, ac: 14, hp: 37, hitDice: '5d10+10', speed: { walk: 50 }, str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7, skills: 'Perception +3, Stealth +4', senses: 'passive Perception 13', traits: ['Keen Hearing and Smell.', 'Pack Tactics.'], attacks: [{ name: 'Bite', toHit: 5, damage: '2d6+3 piercing', notes: 'Target: DC 13 Strength save or knocked prone.' }], source: 'SRD 5.1' },
  { id: 'giant-spider', name: 'Giant Spider', cr: 1, ac: 14, hp: 26, hitDice: '4d10+4', speed: { walk: 30, climb: 30 }, str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4, skills: 'Stealth +7', senses: 'blindsight 10 ft., darkvision 60 ft., passive Perception 10', traits: ['Spider Climb.', 'Web Sense.', 'Web Walker.'], attacks: [{ name: 'Bite', toHit: 5, damage: '1d8+3 piercing', notes: '+2d8 poison, DC 11 Constitution save for half.' }, { name: 'Web (recharge 5–6)', toHit: 5, damage: 'restrained', notes: 'Ranged 30/60 ft.; escape DC 12.' }], source: 'SRD 5.1' },
  { id: 'giant-eagle', name: 'Giant Eagle', cr: 1, ac: 13, hp: 26, hitDice: '4d10+4', speed: { walk: 10, fly: 80 }, str: 16, dex: 17, con: 13, int: 8, wis: 14, cha: 10, skills: 'Perception +4', senses: 'passive Perception 14', traits: ['Keen Sight.', 'Multiattack: beak and talons.'], attacks: [{ name: 'Beak', toHit: 5, damage: '1d6+3 piercing' }, { name: 'Talons', toHit: 5, damage: '2d6+3 slashing' }], source: 'SRD 5.1' },
];

export const crLabel = (cr: number) => (cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr));
export const speedLabel = (s: BeastSpeed) =>
  [`${s.walk} ft.`, s.climb ? `climb ${s.climb} ft.` : '', s.swim ? `swim ${s.swim} ft.` : '', s.fly ? `fly ${s.fly} ft.` : '', s.burrow ? `burrow ${s.burrow} ft.` : ''].filter(Boolean).join(', ');

/** Validates a GM custom beast (bounded numbers, short texts). Returns the clean form or an error. */
export function parseBeast(raw: unknown): BeastForm | string {
  if (!raw || typeof raw !== 'object') return 'Invalid beast.';
  const o = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const id = txt(o.id, 40);
  const name = txt(o.name, 60);
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !name) return 'Beast id (a-z, 0-9, -) and name are required.';
  const cr = typeof o.cr === 'number' && [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6].includes(o.cr) ? o.cr : null;
  const sp = (o.speed ?? {}) as Record<string, unknown>;
  const n = { ac: int(o.ac, 1, 30), hp: int(o.hp, 1, 500), str: int(o.str, 1, 30), dex: int(o.dex, 1, 30), con: int(o.con, 1, 30), int: int(o.int, 1, 30), wis: int(o.wis, 1, 30), cha: int(o.cha, 1, 30), walk: int(sp.walk, 0, 200) };
  if (cr === null || Object.values(n).some((v) => v === null)) return 'Check CR, AC, HP, speed and ability scores.';
  const opt = (v: unknown) => (v === undefined || v === 0 ? undefined : (int(v, 1, 200) ?? undefined));
  const attacks = (Array.isArray(o.attacks) ? o.attacks : []).slice(0, 6).map((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    return { name: txt(x.name, 40) || 'Attack', toHit: int(x.toHit, -5, 20) ?? 0, damage: txt(x.damage, 60), ...(txt(x.notes, 160) ? { notes: txt(x.notes, 160) } : {}) };
  });
  return {
    id: `gm-${id.replace(/^gm-/, '')}`,
    name,
    cr,
    ac: n.ac!,
    hp: n.hp!,
    hitDice: txt(o.hitDice, 20) || '—',
    speed: { walk: n.walk!, ...(opt(sp.climb) ? { climb: opt(sp.climb) } : {}), ...(opt(sp.swim) ? { swim: opt(sp.swim) } : {}), ...(opt(sp.fly) ? { fly: opt(sp.fly) } : {}), ...(opt(sp.burrow) ? { burrow: opt(sp.burrow) } : {}) },
    str: n.str!,
    dex: n.dex!,
    con: n.con!,
    int: n.int!,
    wis: n.wis!,
    cha: n.cha!,
    ...(txt(o.skills, 120) ? { skills: txt(o.skills, 120) } : {}),
    senses: txt(o.senses, 120) || '—',
    traits: (Array.isArray(o.traits) ? o.traits : []).slice(0, 8).map((t) => txt(t, 200)).filter(Boolean),
    attacks,
    source: 'GM',
  };
}
