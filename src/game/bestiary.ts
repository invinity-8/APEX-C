/**
 * Enemy library (APEX 1.2): stat blocks for scene combat.
 *
 * Built-in creatures use simplified SRD 5.1 statistics (CC BY 4.0, “System Reference Document 5.1” by Wizards of
 * the Coast LLC) – numbers only, no flavour text. The GM adds own creatures and named ELITES (e.g. “Grak the
 * White”, shown with a dragon frame) to the campaign's library; they are stored in the game state.
 *
 * What the rules use: AC, hit points, speed (movement per turn), ability scores (saving throws, initiative),
 * attacks (melee, ranged, spell attacks with reach / range), Multiattack (attacks per Attack action), area
 * abilities (saving throw, damage, area) and darkvision (GM vision modes).
 */
export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export interface NpcAttack {
  name: string;
  kind: 'melee' | 'ranged' | 'spell';
  bonus: number;
  damage: string;
  damageType: string;
  /** Melee reach in feet (5 or 10). */
  reachFt: number;
  /** Normal range (ranged / spell attacks). */
  rangeFt?: number;
  longRangeFt?: number;
}

export type AreaShape = 'sphere' | 'cone' | 'line' | 'cube';
/** An area ability: everyone in the area makes a saving throw (full damage on a failure, half on a success). */
export interface NpcArea {
  name: string;
  shape: AreaShape;
  sizeFt: number;
  rangeFt: number;
  save: AbilityKey;
  dc: number;
  damage: string;
  damageType: string;
  /** Uses per encounter (null = at will). */
  uses?: number | null;
  /** APEX 1.3: a condition on a failed save (e.g. 'restrained', 'prone', 'frightened'). */
  condition?: import('./combatEffects.js').ConditionId;
}

/** APEX 1.3: a supporting ability (bonus action): allies within the radius get a buff until the creature's next turn. */
export interface NpcBuff {
  name: string;
  radiusFt: number;
  /** +to hit, +AC, advantage on attacks. */
  toHit?: number;
  ac?: number;
  advantage?: boolean;
  /** Also affects the creature itself. */
  self?: boolean;
  uses?: number | null;
  cost: 'action' | 'bonus';
}

export interface StatBlock {
  id: string;
  name: string;
  /** Elite: named, title and a dragon frame on the map. */
  elite?: boolean;
  title?: string;
  size: string;
  type: string;
  ac: number;
  acNote?: string;
  hp: number;
  hitDice?: string;
  speedFt: number;
  abilities: Record<AbilityKey, number>;
  /** Proficient saving throw bonuses (others use the ability modifier). */
  saves?: Partial<Record<AbilityKey, number>>;
  senses: string;
  darkvisionFt: number;
  languages: string;
  cr: string;
  attacks: NpcAttack[];
  /** Attacks per Attack action (Multiattack). */
  multiattack: number;
  areas?: NpcArea[];
  buffs?: NpcBuff[];
  traits: Array<{ name: string; text: string }>;
  color: string;
  icon: string;
  source: 'SRD 5.1' | 'APEX' | 'custom';
}

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const saveBonus = (b: Pick<StatBlock, 'abilities' | 'saves'>, a: AbilityKey) => b.saves?.[a] ?? mod(b.abilities[a]);
export const initBonus = (b: Pick<StatBlock, 'abilities'>) => mod(b.abilities.dex);
export const displayName = (b: Pick<StatBlock, 'name' | 'title'>) => (b.title ? `${b.name} ${b.title}` : b.name);

const ab = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Record<AbilityKey, number> => ({ str, dex, con, int, wis, cha });
const melee = (name: string, bonus: number, damage: string, damageType: string, reachFt = 5): NpcAttack => ({ name, kind: 'melee', bonus, damage, damageType, reachFt });
const ranged = (name: string, bonus: number, damage: string, damageType: string, rangeFt: number, longRangeFt: number): NpcAttack => ({ name, kind: 'ranged', bonus, damage, damageType, reachFt: 5, rangeFt, longRangeFt });
const SRD = 'SRD 5.1' as const;

export const BUILTIN_BESTIARY: StatBlock[] = [
  { id: 'goblin', name: 'Goblin', size: 'Small', type: 'humanoid (goblinoid)', ac: 15, acNote: 'leather armor, shield', hp: 7, hitDice: '2d6', speedFt: 30, abilities: ab(8, 14, 10, 10, 8, 8), senses: 'darkvision 60 ft., passive Perception 9', darkvisionFt: 60, languages: 'Common, Goblin', cr: '1/4', attacks: [melee('Scimitar', 4, '1d6+2', 'slashing'), ranged('Shortbow', 4, '1d6+2', 'piercing', 80, 320)], multiattack: 1, traits: [{ name: 'Nimble Escape', text: 'Disengage or Hide as a bonus action on each of its turns.' }], color: '#6f8a3a', icon: 'Gb', source: SRD },
  { id: 'bandit', name: 'Bandit', size: 'Medium', type: 'humanoid', ac: 12, acNote: 'leather armor', hp: 11, hitDice: '2d8+2', speedFt: 30, abilities: ab(11, 12, 12, 10, 10, 10), senses: 'passive Perception 10', darkvisionFt: 0, languages: 'Common', cr: '1/8', attacks: [melee('Scimitar', 3, '1d6+1', 'slashing'), ranged('Light crossbow', 3, '1d8+1', 'piercing', 80, 320)], multiattack: 1, traits: [], color: '#8a5a3a', icon: 'Bd', source: SRD },
  { id: 'archer', name: 'Bandit archer', size: 'Medium', type: 'humanoid', ac: 12, acNote: 'leather armor', hp: 11, hitDice: '2d8+2', speedFt: 30, abilities: ab(11, 12, 12, 10, 10, 10), senses: 'passive Perception 10', darkvisionFt: 0, languages: 'Common', cr: '1/8', attacks: [ranged('Light crossbow', 3, '1d8+1', 'piercing', 80, 320), melee('Dagger', 3, '1d4+1', 'piercing')], multiattack: 1, traits: [], color: '#7a6a3a', icon: 'Ar', source: SRD },
  { id: 'wolf', name: 'Wolf', size: 'Medium', type: 'beast', ac: 13, acNote: 'natural armor', hp: 11, hitDice: '2d8+2', speedFt: 40, abilities: ab(12, 15, 12, 3, 12, 6), senses: 'passive Perception 13', darkvisionFt: 0, languages: '—', cr: '1/4', attacks: [melee('Bite', 4, '2d4+2', 'piercing')], multiattack: 1, traits: [{ name: 'Pack Tactics', text: 'Advantage on attacks against a creature if an ally of the wolf is within 5 ft of it and not incapacitated.' }, { name: 'Bite', text: 'On a hit, DC 11 Strength save or knocked prone.' }], color: '#7a7a80', icon: 'Wf', source: SRD },
  { id: 'skeleton', name: 'Skeleton', size: 'Medium', type: 'undead', ac: 13, acNote: 'armor scraps', hp: 13, hitDice: '2d8+4', speedFt: 30, abilities: ab(10, 14, 15, 6, 8, 5), senses: 'darkvision 60 ft., passive Perception 9', darkvisionFt: 60, languages: 'understands languages it knew in life', cr: '1/4', attacks: [melee('Shortsword', 4, '1d6+2', 'piercing'), ranged('Shortbow', 4, '1d6+2', 'piercing', 80, 320)], multiattack: 1, traits: [{ name: 'Vulnerable', text: 'Bludgeoning damage. Immune to poison.' }], color: '#d8d0b8', icon: 'Sk', source: SRD },
  { id: 'zombie', name: 'Zombie', size: 'Medium', type: 'undead', ac: 8, hp: 22, hitDice: '3d8+9', speedFt: 20, abilities: ab(13, 6, 16, 3, 6, 5), saves: { wis: 0 }, senses: 'darkvision 60 ft., passive Perception 8', darkvisionFt: 60, languages: '—', cr: '1/4', attacks: [melee('Slam', 3, '1d6+1', 'bludgeoning')], multiattack: 1, traits: [{ name: 'Undead Fortitude', text: 'If damage reduces it to 0 HP, Constitution save (DC 5 + damage taken) to drop to 1 HP instead, unless radiant damage or a critical hit.' }], color: '#5a7a5a', icon: 'Zb', source: SRD },
  { id: 'orc', name: 'Orc', size: 'Medium', type: 'humanoid (orc)', ac: 13, acNote: 'hide armor', hp: 15, hitDice: '2d8+6', speedFt: 30, abilities: ab(16, 12, 16, 7, 11, 10), senses: 'darkvision 60 ft., passive Perception 10', darkvisionFt: 60, languages: 'Common, Orc', cr: '1/2', attacks: [melee('Greataxe', 5, '1d12+3', 'slashing'), ranged('Javelin', 5, '1d6+3', 'piercing', 30, 120)], multiattack: 1, traits: [{ name: 'Aggressive', text: 'As a bonus action, move up to its speed toward a hostile creature it can see.' }], color: '#4a6a3a', icon: 'Or', source: SRD },
  { id: 'cultist', name: 'Cultist', size: 'Medium', type: 'humanoid', ac: 12, acNote: 'leather armor', hp: 9, hitDice: '2d8', speedFt: 30, abilities: ab(11, 12, 10, 10, 11, 10), senses: 'passive Perception 10', darkvisionFt: 0, languages: 'Common', cr: '1/8', attacks: [melee('Scimitar', 3, '1d6+1', 'slashing')], multiattack: 1, traits: [{ name: 'Dark Devotion', text: 'Advantage on saves against being charmed or frightened.' }], color: '#6a2a3a', icon: 'Cu', source: SRD },
  { id: 'spider', name: 'Giant spider', size: 'Large', type: 'beast', ac: 14, acNote: 'natural armor', hp: 26, hitDice: '4d10+4', speedFt: 30, abilities: ab(14, 16, 12, 2, 11, 4), senses: 'blindsight 10 ft., darkvision 60 ft., passive Perception 10', darkvisionFt: 60, languages: '—', cr: '1', attacks: [melee('Bite', 5, '1d8+3', 'piercing'), ranged('Web', 5, '0', 'restrained', 30, 60)], multiattack: 1, traits: [{ name: 'Bite', text: 'Also DC 11 Constitution save: 2d8 poison damage, half on a success.' }, { name: 'Spider Climb, Web Walker', text: 'Climbs difficult surfaces; ignores webs.' }], color: '#3a3040', icon: 'Sp', source: SRD },
  { id: 'bear', name: 'Brown bear', size: 'Large', type: 'beast', ac: 11, acNote: 'natural armor', hp: 34, hitDice: '4d10+12', speedFt: 40, abilities: ab(19, 10, 16, 2, 13, 7), senses: 'passive Perception 13', darkvisionFt: 0, languages: '—', cr: '1', attacks: [melee('Claws', 6, '2d6+4', 'slashing'), melee('Bite', 6, '1d8+4', 'piercing')], multiattack: 2, traits: [{ name: 'Multiattack', text: 'One bite and one claws attack.' }], color: '#6a4a2a', icon: 'Br', source: SRD },
  { id: 'thug', name: 'Thug', size: 'Medium', type: 'humanoid', ac: 11, acNote: 'leather armor', hp: 32, hitDice: '5d8+10', speedFt: 30, abilities: ab(15, 11, 14, 10, 10, 11), senses: 'passive Perception 10', darkvisionFt: 0, languages: 'Common', cr: '1/2', attacks: [melee('Mace', 4, '1d6+2', 'bludgeoning'), ranged('Heavy crossbow', 2, '1d10', 'piercing', 100, 400)], multiattack: 2, traits: [{ name: 'Pack Tactics', text: 'Advantage when an ally is within 5 ft of the target.' }], color: '#5a5a6a', icon: 'Th', source: SRD },
  { id: 'ogre', name: 'Ogre', size: 'Large', type: 'giant', ac: 11, acNote: 'hide armor', hp: 59, hitDice: '7d10+21', speedFt: 40, abilities: ab(19, 8, 16, 5, 7, 7), senses: 'darkvision 60 ft., passive Perception 8', darkvisionFt: 60, languages: 'Common, Giant', cr: '2', attacks: [melee('Greatclub', 6, '2d8+4', 'bludgeoning'), ranged('Javelin', 6, '2d6+4', 'piercing', 30, 120)], multiattack: 1, traits: [], color: '#8a6a4a', icon: 'Og', source: SRD },
  {
    id: 'orc-bloodcaller', name: 'Orc Bloodcaller', elite: true, size: 'Medium', type: 'humanoid (orc)', ac: 14, acNote: 'bone mail', hp: 52, hitDice: '8d8+16', speedFt: 30, abilities: ab(14, 12, 14, 10, 16, 14), saves: { wis: 5 }, senses: 'darkvision 60 ft., passive Perception 13', darkvisionFt: 60, languages: 'Common, Orc', cr: '3',
    attacks: [melee('Bone staff', 4, '1d8+2', 'bludgeoning'), { name: 'Blood flame', kind: 'spell', bonus: 5, damage: '2d10', damageType: 'fire', reachFt: 5, rangeFt: 120 }],
    multiattack: 1,
    areas: [{ name: 'Burning howl', shape: 'cone', sizeFt: 15, rangeFt: 0, save: 'dex', dc: 13, damage: '3d6', damageType: 'fire', uses: 2 }, { name: 'Grasping roots', shape: 'sphere', sizeFt: 10, rangeFt: 60, save: 'str', dc: 13, damage: '0', damageType: 'none', uses: 1, condition: 'restrained' }],
    buffs: [{ name: 'Blood war cry', radiusFt: 30, toHit: 2, self: false, uses: 2, cost: 'bonus' }],
    traits: [{ name: 'Elite', text: 'An APEX elite shaman: war cry (+2 to hit for allies within 30 ft until its next turn), roots that restrain, fire.' }], color: '#8a2a2a', icon: 'Bc', source: 'APEX',
  },
];

/** The library of a campaign: built-in creatures plus the GM's own (same id replaces a built-in). */
export function bestiary(state: { enemyLibrary?: StatBlock[] }): StatBlock[] {
  const own = state.enemyLibrary ?? [];
  return [...BUILTIN_BESTIARY.filter((b) => !own.some((o) => o.id === b.id)), ...own];
}
export const statBlock = (state: { enemyLibrary?: StatBlock[] }, id: string) => bestiary(state).find((b) => b.id === id);

const DICE = /^\d{1,2}d\d{1,3}([+-]\d{1,3})?$|^\d{1,3}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);

/** Validates a GM-made stat block (server side). */
export function parseStatBlock(raw: unknown): { ok: true; block: StatBlock } | { ok: false; error: string } {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return { ok: false, error: 'Invalid stat block.' };
  const id = str(o.id, 40);
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return { ok: false, error: 'Id: 2–40 lowercase letters, digits or dashes.' };
  const name = str(o.name, 40);
  if (!name) return { ok: false, error: 'A name is required.' };
  const ac = int(o.ac, 1, 30), hp = int(o.hp, 1, 999), speedFt = int(o.speedFt, 0, 120), multiattack = int(o.multiattack ?? 1, 1, 6), darkvisionFt = int(o.darkvisionFt ?? 0, 0, 300);
  if (ac === null || hp === null || speedFt === null || multiattack === null || darkvisionFt === null) return { ok: false, error: 'AC 1–30, HP 1–999, speed 0–120 ft, multiattack 1–6, darkvision 0–300 ft.' };
  const a = o.abilities as Record<string, unknown> | undefined;
  const abilities = {} as Record<AbilityKey, number>;
  for (const k of ABILITY_KEYS) {
    const v = int(a?.[k], 1, 30);
    if (v === null) return { ok: false, error: `Ability ${k.toUpperCase()} must be 1–30.` };
    abilities[k] = v;
  }
  const saves: Partial<Record<AbilityKey, number>> = {};
  for (const k of ABILITY_KEYS) { const v = (o.saves as Record<string, unknown> | undefined)?.[k]; if (v !== undefined) { const n = int(v, -5, 20); if (n === null) return { ok: false, error: 'Saving throw bonuses −5…+20.' }; saves[k] = n; } }
  if (!Array.isArray(o.attacks) || o.attacks.length > 6) return { ok: false, error: 'Up to 6 attacks.' };
  const attacks: NpcAttack[] = [];
  for (const r of o.attacks as Array<Record<string, unknown>>) {
    const kind = r.kind === 'ranged' || r.kind === 'spell' ? r.kind : 'melee';
    const at: NpcAttack = { name: str(r.name, 40), kind, bonus: int(r.bonus, -5, 20) ?? NaN, damage: str(r.damage, 20).replace(/\s/g, ''), damageType: str(r.damageType, 20) || 'bludgeoning', reachFt: int(r.reachFt ?? 5, 5, 30) ?? NaN };
    if (kind !== 'melee') { at.rangeFt = int(r.rangeFt, 5, 600) ?? NaN; if (r.longRangeFt !== undefined) at.longRangeFt = int(r.longRangeFt, 5, 1200) ?? undefined; }
    if (!at.name || !Number.isFinite(at.bonus) || !DICE.test(at.damage) || !Number.isFinite(at.reachFt) || (kind !== 'melee' && !Number.isFinite(at.rangeFt))) return { ok: false, error: `Attack “${at.name || '?'}”: name, bonus −5…+20, damage like 1d8+3, reach, range.` };
    attacks.push(at);
  }
  const areas: NpcArea[] = [];
  for (const r of (Array.isArray(o.areas) ? o.areas : []).slice(0, 4) as Array<Record<string, unknown>>) {
    const shape = (['sphere', 'cone', 'line', 'cube'] as const).find((s) => s === r.shape);
    const save = ABILITY_KEYS.find((k) => k === r.save);
    const area: NpcArea = { name: str(r.name, 40), shape: shape ?? 'sphere', sizeFt: int(r.sizeFt, 5, 120) ?? NaN, rangeFt: int(r.rangeFt ?? 0, 0, 600) ?? NaN, save: save ?? 'dex', dc: int(r.dc, 5, 30) ?? NaN, damage: str(r.damage, 20).replace(/\s/g, ''), damageType: str(r.damageType, 20) || 'fire', uses: r.uses === null || r.uses === undefined ? null : int(r.uses, 1, 9) };
    if (!area.name || !shape || !save || !Number.isFinite(area.sizeFt) || !Number.isFinite(area.rangeFt) || !Number.isFinite(area.dc) || !DICE.test(area.damage)) return { ok: false, error: `Area ability “${area.name || '?'}”: shape, size, save, DC, damage.` };
    areas.push(area);
  }
  const COND = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];
  (Array.isArray(o.areas) ? o.areas : []).slice(0, 4).forEach((r, i) => { const c = (r as Record<string, unknown>).condition; if (typeof c === 'string' && COND.includes(c) && areas[i]) areas[i].condition = c as NpcArea['condition']; });
  const buffs: NpcBuff[] = [];
  for (const r of (Array.isArray(o.buffs) ? o.buffs : []).slice(0, 3) as Array<Record<string, unknown>>) {
    const b: NpcBuff = { name: str(r.name, 40), radiusFt: int(r.radiusFt, 0, 120) ?? NaN, cost: r.cost === 'action' ? 'action' : 'bonus', ...(int(r.toHit, 1, 5) !== null ? { toHit: r.toHit as number } : {}), ...(int(r.ac, 1, 5) !== null ? { ac: r.ac as number } : {}), ...(r.advantage === true ? { advantage: true } : {}), ...(r.self === true ? { self: true } : {}), uses: r.uses === null || r.uses === undefined ? null : int(r.uses, 1, 9) };
    if (!b.name || !Number.isFinite(b.radiusFt) || (!b.toHit && !b.ac && !b.advantage)) return { ok: false, error: `Support ability “${b.name || '?'}”: name, radius and an effect (to hit, AC or advantage).` };
    buffs.push(b);
  }
  const traits = (Array.isArray(o.traits) ? o.traits : []).slice(0, 8).map((t) => ({ name: str((t as Record<string, unknown>).name, 40), text: str((t as Record<string, unknown>).text, 400) })).filter((t) => t.name);
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : '#7a3a3a';
  const icon = str(o.icon, 3) || name.slice(0, 2);
  return {
    ok: true,
    block: {
      id, name, ...(o.elite === true ? { elite: true } : {}), ...(str(o.title, 40) ? { title: str(o.title, 40) } : {}),
      size: str(o.size, 20) || 'Medium', type: str(o.type, 40) || 'humanoid', ac, ...(str(o.acNote, 40) ? { acNote: str(o.acNote, 40) } : {}), hp, ...(str(o.hitDice, 20) ? { hitDice: str(o.hitDice, 20) } : {}),
      speedFt, abilities, ...(Object.keys(saves).length ? { saves } : {}), senses: str(o.senses, 80), darkvisionFt, languages: str(o.languages, 80), cr: str(o.cr, 6) || '?',
      attacks, multiattack, ...(areas.length ? { areas } : {}), ...(buffs.length ? { buffs } : {}), traits, color, icon, source: 'custom',
    },
  };
}
