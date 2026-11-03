/**
 * Rarity and balance rules (APEX 0.6). Defaults live here; the GM can override them per campaign through
 * `GameState.itemRules` (validated, bounded) – see docs/game/ITEMIZATION_BALANCE.md.
 */
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';
/** Unique is reserved for a later release: it cannot be generated or created yet. */
export const GENERATABLE_RARITIES: Rarity[] = ['normal', 'magic', 'rare'];

/** 2: weapon suffixes (of Ruin, of Alacrity on weapons) so rare weapons can reach 3–4 modifiers. */
export const MODIFIER_VERSION = 2;
export const MAX_ITEM_LEVEL = 30;

export interface AffixRule {
  min: number;
  max: number;
  maxPrefixes: number;
  maxSuffixes: number;
}
export const AFFIX_RULES: Record<Exclude<Rarity, 'unique'>, AffixRule> = {
  normal: { min: 0, max: 0, maxPrefixes: 0, maxSuffixes: 0 },
  magic: { min: 1, max: 2, maxPrefixes: 1, maxSuffixes: 1 },
  rare: { min: 3, max: 4, maxPrefixes: 2, maxSuffixes: 2 },
};

/** Bounded-accuracy caps for everything equipment modifiers can add (totals across all equipped items). */
export interface ItemRules {
  /** Effective resistance points (100 = 50 % reduction). The GM may lower it, never raise it above 100. */
  resistanceCap: number;
  /** Attack-roll bonus from modifiers on ONE weapon. */
  toHitCap: number;
  /** Armour Class from all equipped modifiers. */
  acCap: number;
  /** Saving-throw bonus from modifiers, per ability. */
  saveCap: number;
  /** Skill bonus from modifiers, per skill. */
  skillCap: number;
  initiativeCap: number;
  maxHpCap: number;
  /** Walking speed bonus in feet (character sheet speed only – never map movement points). */
  speedCap: number;
  /** Flat bonus damage per weapon hit from modifiers (all elements together). */
  flatDamageCap: number;
  /** Economy: Arcane Fragments needed for one Orb of Renewal. */
  fragmentsPerOrb: number;
}

export const DEFAULT_ITEM_RULES: ItemRules = {
  resistanceCap: 100,
  toHitCap: 2,
  acCap: 2,
  saveCap: 2,
  skillCap: 2,
  initiativeCap: 2,
  maxHpCap: 20,
  speedCap: 10,
  flatDamageCap: 6,
  fragmentsPerOrb: 10,
};

/** Hard limits the GM's overrides must stay within (validation). */
export const ITEM_RULE_LIMITS: Record<keyof ItemRules, [number, number]> = {
  resistanceCap: [0, 100],
  toHitCap: [0, 3],
  acCap: [0, 3],
  saveCap: [0, 3],
  skillCap: [0, 5],
  initiativeCap: [0, 5],
  maxHpCap: [0, 60],
  speedCap: [0, 30],
  flatDamageCap: [0, 12],
  fragmentsPerOrb: [2, 100],
};

export function itemRulesOf(state: { itemRules?: Partial<ItemRules> }): ItemRules {
  const out = { ...DEFAULT_ITEM_RULES };
  for (const k of Object.keys(out) as Array<keyof ItemRules>) {
    const v = state.itemRules?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(ITEM_RULE_LIMITS[k][0], Math.min(ITEM_RULE_LIMITS[k][1], Math.round(v)));
  }
  return out;
}

export const RARITY_LABEL: Record<Rarity, string> = { normal: 'Normal', magic: 'Magic', rare: 'Rare', unique: 'Unique' };
