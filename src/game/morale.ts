/**
 * APEX 2.9 – enemy morale and personality. Pure rules (no state, dice passed in).
 *
 * Every creature has a PERSONALITY: a morale style and seven traits (0–10), preset from its stat block and
 * adjustable in the Enemy Library:
 *  - style `troop`  – humanoid bands (goblins, bandits, orcs, cultists, soldiers): they lean on each other and on a
 *                     leader. Losing sight of the group, comrades falling and the leader falling shake them.
 *          `pack`   – hunting animals (wolves, hyenas): brave in numbers only; outnumbered or alone they waver.
 *          `horde`  – the relentless (zombies, skeletons, constructs, oozes): no morale at all, they always come on.
 *          `beast`  – lone predators and monsters: fight until badly hurt, then save themselves.
 *          `proud`  – clever, powerful beings (dragons, giants, aberrations): only real danger makes them think again.
 *  - traits: loyalty (stands by comrades and leader), opportunism (preys on the weak, goes when the odds turn),
 *    greed (fights for gain, not to the death), savagery (fury: shrugs off losses, goes for the bleeding), mercy (lets
 *    the retreating go, may surrender), honor (stands its ground, seeks the strongest foe) and inspire (leadership: a
 *    creature with inspire 6+ is a LEADER).
 *  - light-shy: animals that fire and torches keep at bay.
 *
 * In a fight each creature carries a hidden COMBAT FATIGUE. At the start of its turn the AI checks what shook it since
 * its last turn (comrades down, the leader down, first blood, being alone, outnumbered, a torch in its face); each
 * shock is a morale check: d20 + Wisdom save + leader nearby + traits against DC (10–13) + fatigue. A failed check
 * adds fatigue; at the break point (3, more for the loyal, honourable and savage) the creature BREAKS and flees.
 * A broken creature that is cornered may SURRENDER (clever enough, not savage, merciful or greedy).
 * A leader sees the fatigue of the troops it can see and RALLIES them as a bonus action: fatigue down, the broken
 * come back. Players never see the numbers – only fleeing, rallying and surrender.
 */

export const TRAITS = ['loyalty', 'opportunism', 'greed', 'savagery', 'mercy', 'honor', 'inspire'] as const;
export type Trait = (typeof TRAITS)[number];
export const MORALE_STYLES = ['troop', 'pack', 'horde', 'beast', 'proud'] as const;
export type MoraleStyle = (typeof MORALE_STYLES)[number];
export interface Personality { style: MoraleStyle; lightShy: boolean; traits: Record<Trait, number> }
/** What the GM changed in the library (the rest stays preset). */
export type PersonalityOverride = { style?: MoraleStyle; lightShy?: boolean; traits?: Partial<Record<Trait, number>> };

export const TRAIT_LABEL: Record<Trait, string> = { loyalty: 'Loyalty', opportunism: 'Opportunism', greed: 'Greed', savagery: 'Savagery', mercy: 'Mercy', honor: 'Honor', inspire: 'Inspire (leadership)' };
export const TRAIT_HELP: Record<Trait, string> = {
  loyalty: 'Stands by its comrades and leader: harder to break while a leader is in sight, breaks later.',
  opportunism: 'Preys on the wounded and the lone; wavers quickly when outnumbered or alone.',
  greed: 'Fights for gain, not to the death: wounds shake it more; cornered, it would rather surrender.',
  savagery: 'Fury: shrugs off losses, breaks later and goes for the bleeding.',
  mercy: 'Lets retreating foes go (no opportunity attacks); cornered, it may surrender.',
  honor: 'Stands its ground and seeks the strongest foe instead of the weakest; breaks later.',
  inspire: 'Leadership. 6+: a leader – its troops are steadier while they see it, and it can rally them (bonus action).',
};
export const STYLE_LABEL: Record<MoraleStyle, string> = { troop: '⚑ Troop – needs its group and a leader', pack: '🐺 Pack – brave in numbers', horde: '🧟 Relentless horde – no morale', beast: '🐻 Beast – flees when badly hurt', proud: '🐉 Proud – only real danger moves it' };

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n)));
const T = (loyalty: number, opportunism: number, greed: number, savagery: number, mercy: number, honor: number, inspire: number): Record<Trait, number> => ({ loyalty, opportunism, greed, savagery, mercy, honor, inspire });
const mod = (score: number | undefined) => Math.floor(((score ?? 10) - 10) / 2);

/** The preset personality of a stat block: style from its type and name, traits from its kind and its scores. */
export function defaultPersonality(b: { id?: string; name: string; type: string; title?: string; elite?: boolean; abilities?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>; traits?: Array<{ name: string }> }): Personality {
  const t = `${b.id ?? ''} ${b.name} ${b.title ?? ''} ${b.type}`.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const int = b.abilities?.int ?? 10, cha = b.abilities?.cha ?? 10;
  const packTrait = !!b.traits?.some((x) => /pack tactics/i.test(x.name));
  const mindless = has(/zombie|skeleton|ooze|pudding|jelly|gelatinous|golem|animated|construct|shambling|myconid|elemental|purple worm|swarm|ghoul|ghast|mummy/) || (int <= 2 && has(/undead|construct|ooze|plant/));
  let style: MoraleStyle;
  let traits: Record<Trait, number>;
  let lightShy = false;
  const type = b.type.toLowerCase();
  const leads = !!b.traits?.some((x) => /leadership|commander|war ?cry|rally/i.test(x.name));
  if (mindless) { style = 'horde'; traits = T(0, 0, 0, 10, 0, 0, 0); }
  else if ((/dragon|giant|aberration|fiend|celestial|fey|undead/.test(type) || has(/beholder|aboleth|lich|vampire|mind flayer|naga|sphinx|treant|hag|rakshasa|kraken|titan/)) && int >= 6) { style = 'proud'; traits = T(3, 5, 4, 5, 3, 5, 3); }
  else if (/humanoid/.test(b.type.toLowerCase()) || has(/goblin|hobgoblin|bugbear|kobold|orc\b|gnoll|bandit|thug|cultist|guard|soldier|knight|veteran|pirate|scout|acolyte|priest|mage|noble|commoner|lizardfolk|sahuagin|merrow/)) {
    style = 'troop';
    traits = T(5, 5, 5, 4, 3, 3, 2);
    if (has(/goblin\b|kobold/)) traits = T(3, 8, 7, 5, 2, 1, 1);
    if (has(/hobgoblin/)) traits = T(8, 4, 3, 5, 2, 7, 3);
    if (has(/bugbear/)) traits = T(3, 8, 5, 7, 1, 1, 2);
    if (has(/orc\b|gnoll/)) traits = T(6, 4, 5, 8, 1, 4, 2);
    if (has(/bandit|thug|pirate|brigand|outlaw/)) traits = T(3, 7, 8, 4, 4, 2, 2);
    if (has(/cult|fanatic|zealot/)) traits = T(9, 2, 1, 6, 1, 3, 2);
    if (has(/guard|soldier|knight|veteran|watch|militia|legion/)) traits = T(8, 2, 2, 2, 6, 7, 2);
    if (has(/berserker/)) traits = T(4, 3, 3, 9, 0, 3, 2);
    if (has(/gladiator/)) traits = T(4, 3, 5, 5, 3, 7, 3);
    if (has(/assassin|spy/)) traits = T(2, 9, 7, 4, 0, 1, 1);
    if (has(/acolyte|priest\b|cleric|druid/)) traits = T(7, 2, 2, 2, 6, 6, 3);
    if (has(/scout|hunter/)) traits = T(5, 6, 3, 3, 3, 3, 2);
    if (has(/commoner|noble|merchant|villager|peasant/)) traits = T(4, 4, 5, 1, 7, 4, 1);
    if (has(/lizardfolk/)) traits = T(6, 5, 2, 6, 1, 3, 2);
    if (leads || has(/captain|chief|boss|leader|warlord|sergeant|lieutenant|commander|warchief|king|queen|lord|shaman|priest of|high priest|fanatic|bloodcaller|matriarch|alpha/) || b.elite) traits.inspire = Math.max(traits.inspire, b.elite ? 7 : 8);
  } else if ((packTrait || has(/wolf|worg|hyena|jackal|dog|mastiff|rat\b|giant rat|raptor|hell hound/)) && !has(/spider/)) {
    style = 'pack'; traits = T(7, 7, 0, 6, 1, 1, 1); lightShy = !has(/hell hound|winter wolf|undead|fiend|mastiff/);
    if (has(/dire|alpha|worg|winter wolf/)) traits.inspire = 6;
  } else {
    style = 'beast'; traits = T(2, 6, 0, 6, 0, 0, 0);
    // wild animals shy away from fire; tame and trained ones (and the cold-blooded) do not
    lightShy = /beast/.test(type) && int <= 3 && !has(/sheep|cow|bull|horse|pony|mule|camel|goat|\bcat\b|elephant|mammoth|snake|constrictor|crocodile|lizard|frog|toad|crab|centipede|scorpion|raven|eagle/);
  }
  // the scores colour the preset: charisma lends leadership, cunning lends opportunism
  if (style !== 'horde') {
    if (cha >= 14 && style !== 'beast') traits.inspire = clamp(traits.inspire + mod(cha) - 1);
    if (int >= 12) traits.opportunism = clamp(traits.opportunism + 1);
  }
  return { style, lightShy, traits };
}

export function personalityOf(base: Personality, over?: PersonalityOverride): Personality {
  if (!over) return base;
  return { style: over.style ?? base.style, lightShy: over.lightShy ?? base.lightShy, traits: { ...base.traits, ...(over.traits ?? {}) } };
}
/** A placed creature's personality: its stat block's preset (elites lead) plus the GM's changes. */
export function creaturePersonality(block: (Parameters<typeof defaultPersonality>[0] & { personality?: PersonalityOverride }) | undefined, fallback: { name: string; elite?: boolean; abilities?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>> }): Personality {
  const base = defaultPersonality(block ?? { ...fallback, type: '' });
  const led = fallback.elite && base.style === 'troop' ? { ...base, traits: { ...base.traits, inspire: Math.max(base.traits.inspire, 7) } } : base;
  return personalityOf(led, block?.personality);
}
export function parsePersonality(v: unknown): PersonalityOverride | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: PersonalityOverride = {};
  if (o.style !== undefined) { if (!MORALE_STYLES.includes(o.style as MoraleStyle)) return null; out.style = o.style as MoraleStyle; }
  if (o.lightShy !== undefined) { if (typeof o.lightShy !== 'boolean') return null; out.lightShy = o.lightShy; }
  if (o.traits !== undefined) {
    if (!o.traits || typeof o.traits !== 'object' || Array.isArray(o.traits)) return null;
    const tr: Partial<Record<Trait, number>> = {};
    for (const [k, n] of Object.entries(o.traits as Record<string, unknown>)) {
      if (!TRAITS.includes(k as Trait) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) return null;
      tr[k as Trait] = n;
    }
    if (Object.keys(tr).length) out.traits = tr;
  }
  return out;
}

export const isLeader = (p: Personality) => p.style !== 'horde' && p.traits.inspire >= 6;
/** Fatigue at which the creature breaks. */
export const breakAt = (p: Personality) => 3 + (p.traits.loyalty >= 7 ? 1 : 0) + (p.traits.honor >= 7 ? 1 : 0) + (p.traits.savagery >= 9 ? 1 : 0);
/** Bonus on morale checks for creatures that see this leader. */
export const leaderBonus = (p: Personality) => (isLeader(p) ? Math.floor(p.traits.inspire / 3) : 0);
/** Fatigue a rally takes away. */
export const rallyAmount = (p: Personality) => 1 + Math.floor(p.traits.inspire / 4);

export interface MoraleState {
  fatigue: number;
  broken?: boolean;
  surrendered?: boolean;
  /** What it had already taken in at its last check. */
  seenDown?: number;
  seenLeaderDown?: boolean;
  bloodied?: boolean;
  badlyHurt?: boolean;
}
export interface MoraleSituation {
  /** Comrades (its side) that are down or dead. */
  alliesDown: number;
  /** A leader of its side is down. */
  leaderDown: boolean;
  /** Hit points as a share of the maximum. */
  hp: number;
  /** No standing comrade within 30 ft and none in sight. */
  isolated: boolean;
  /** More foes than comrades (itself included) within 30 ft. */
  outnumbered: boolean;
  /** A foe carrying a light within 15 ft. */
  lightNear: boolean;
  /** The best leader bonus among leaders of its side it sees (not itself). */
  leaderBonus: number;
  /** Its Wisdom saving throw bonus. */
  wisSave: number;
}
export interface MoraleCheck { why: string; dc: number; weight: number; dis?: boolean }

/** The shocks since the creature's last check. */
export function moraleTriggers(p: Personality, m: MoraleState, s: MoraleSituation): MoraleCheck[] {
  if (p.style === 'horde' || m.surrendered) return [];
  const out: MoraleCheck[] = [];
  const fresh = s.alliesDown - (m.seenDown ?? 0);
  if (fresh > 0 && (p.style === 'troop' || p.style === 'pack')) out.push({ why: fresh > 1 ? `${fresh} comrades fell` : 'a comrade fell', dc: 10 + (fresh > 1 ? 2 : 0), weight: 1 });
  if (s.leaderDown && !m.seenLeaderDown && (p.style === 'troop' || p.style === 'pack')) out.push({ why: 'its leader fell', dc: 13, weight: 2 });
  if (s.hp <= 0.5 && !m.bloodied && p.style !== 'proud') out.push({ why: 'it is bloodied', dc: 10 + (p.traits.greed >= 7 ? 2 : 0), weight: 1 });
  if (s.hp <= 0.25 && !m.badlyHurt && (p.style === 'beast' || p.style === 'proud' || p.traits.greed >= 7)) out.push({ why: 'it is badly hurt', dc: 12, weight: 2 });
  if (s.isolated && (p.style === 'troop' || p.style === 'pack')) out.push({ why: 'it lost sight of its group', dc: 10, weight: 1 });
  if (s.outnumbered && p.style === 'pack') out.push({ why: 'the pack is outnumbered', dc: 10, weight: 1 });
  if (s.lightNear && p.lightShy) out.push({ why: 'fire in its face', dc: 10, weight: 1, dis: true });
  return out;
}

/** Rolls the checks; returns the new morale state and log lines (for the GM). */
export function rollMorale(p: Personality, m: MoraleState, s: MoraleSituation, d20: () => number): { state: MoraleState; lines: string[]; broke: boolean } {
  const checks = moraleTriggers(p, m, s);
  const next: MoraleState = { ...m, seenDown: s.alliesDown, ...(s.leaderDown ? { seenLeaderDown: true } : {}), ...(s.hp <= 0.5 ? { bloodied: true } : {}), ...(s.hp <= 0.25 ? { badlyHurt: true } : {}) };
  const lines: string[] = [];
  let broke = false;
  const bonus = s.wisSave + s.leaderBonus + (p.traits.savagery >= 8 ? 2 : 0) + (p.traits.loyalty >= 7 && s.leaderBonus > 0 ? 2 : 0) + (p.traits.honor >= 7 ? 1 : 0) - (p.traits.opportunism >= 7 && (s.outnumbered || s.isolated) ? 2 : 0);
  for (const c of checks) {
    if (next.broken) break;
    const r = c.dis ? Math.min(d20(), d20()) : d20();
    const dc = c.dc + next.fatigue;
    const ok = r + bonus >= dc;
    if (!ok) next.fatigue += c.weight;
    lines.push(`morale (${c.why}): ${r}${bonus >= 0 ? '+' : ''}${bonus} vs DC ${dc} – ${ok ? 'holds' : `fails, fatigue ${next.fatigue}/${breakAt(p)}`}`);
    if (!ok && next.fatigue >= breakAt(p)) { next.broken = true; broke = true; }
  }
  return { state: next, lines, broke };
}

/** A leader's rally on one creature. */
export function rally(p: Personality, m: MoraleState, leader: Personality): MoraleState {
  const fatigue = Math.max(0, m.fatigue - rallyAmount(leader));
  const next: MoraleState = { ...m, fatigue };
  if (next.broken && fatigue < breakAt(p)) delete next.broken;
  return next;
}
/** Whether a cornered, broken creature lays down its arms. */
export const surrenders = (p: Personality, int: number) => p.style === 'troop' && int >= 6 && p.traits.savagery < 7 && (p.traits.mercy >= 5 || p.traits.greed >= 6 || p.traits.opportunism >= 6);
/** Morale as the GM reads it. */
export function moraleText(p: Personality, m: MoraleState | undefined): string {
  if (p.style === 'horde') return 'relentless';
  if (!m) return 'steady';
  if (m.surrendered) return 'surrendered';
  if (m.broken) return 'broken – fleeing';
  if (m.fatigue <= 0) return 'steady';
  return `shaken ${m.fatigue}/${breakAt(p)}`;
}
