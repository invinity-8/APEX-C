/**
 * APEX 2.9 – reaction settings per character (like Baldur's Gate 3): for every reaction the player chooses whether
 * it is used automatically, asked for, or never offered – for reactions that cost a spell slot also "ask only while
 * I have a slot" and "ask only while I have more than one slot". The server leaves out the offers a character does
 * not want; the player's client answers "automatic" offers on its own.
 */
export const REACTION_KINDS = ['opportunity', 'shield'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];
export const REACTION_MODES = ['ask', 'auto', 'never', 'askIfSlot', 'askIf2Slots'] as const;
export type ReactionMode = (typeof REACTION_MODES)[number];
export type ReactionPrefs = Partial<Record<ReactionKind, ReactionMode>>;

export const REACTION_LABEL: Record<ReactionKind, string> = { opportunity: '⚡ Opportunity attack', shield: '🛡 Shield (spell)' };
export const MODE_LABEL: Record<ReactionMode, string> = { ask: 'Ask me', auto: 'Always – automatically', never: 'Never ask', askIfSlot: 'Ask only while I have a spell slot', askIf2Slots: 'Ask only while I have 2+ spell slots' };
/** Which modes make sense for a reaction (slot conditions only for spells). */
export const modesFor = (k: ReactionKind): ReactionMode[] => (k === 'shield' ? [...REACTION_MODES] : ['ask', 'auto', 'never']);

export const reactionMode = (prefs: ReactionPrefs | undefined, k: ReactionKind): ReactionMode => prefs?.[k] ?? 'ask';
/**
 * What happens with an offer: 'skip' (not offered at all), 'ask' or 'auto'. `slots`: spell slots of 1st level or
 * higher the character has left (for slot-based reactions).
 */
export function offerFor(prefs: ReactionPrefs | undefined, k: ReactionKind, slots = 0): 'skip' | 'ask' | 'auto' {
  const m = reactionMode(prefs, k);
  if (m === 'never') return 'skip';
  if (m === 'auto') return 'auto';
  if (m === 'askIfSlot') return slots >= 1 ? 'ask' : 'skip';
  if (m === 'askIf2Slots') return slots >= 2 ? 'ask' : 'skip';
  return 'ask';
}
export function parseReactionPref(kind: unknown, mode: unknown): { kind: ReactionKind; mode: ReactionMode } | null {
  if (!(REACTION_KINDS as readonly unknown[]).includes(kind) || !(REACTION_MODES as readonly unknown[]).includes(mode)) return null;
  if (!modesFor(kind as ReactionKind).includes(mode as ReactionMode)) return null;
  return { kind: kind as ReactionKind, mode: mode as ReactionMode };
}
