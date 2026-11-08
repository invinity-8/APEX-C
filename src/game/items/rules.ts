/**
 * Rarity and balance rules (APEX 0.6). Defaults live here; the GM can override them per campaign through
 * `GameState.itemRules` (validated, bounded) – see docs/game/ITEMIZATION_BALANCE.md.
 */
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';
/** Unique is reserved for a later release: it cannot be generated or created yet. */
export const GENERATABLE_RARITIES: Rarity[] = ['normal', 'magic', 'rare'];

/** 2: weapon suffixes (of Ruin, of Alacrity on weapons) so rare weapons can reach 3–4 modifiers. */
/** 3 (APEX 0.7): low-impact situational and cosmetic flavour modifiers. */
/** 4 (APEX 1.0): attribute bonuses on all worn slots (+1 at ilvl 10, +2 at ilvl 24), Hale tier 4, March tier 2. */
export const MODIFIER_VERSION = 4;
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
  /** APEX 0.7 – additional families: spell attack, spell save DC, per-ability score, thorns (sum of all items). */
  spellAttackCap: number;
  spellDcCap: number;
  abilityCap: number;
  thornsCap: number;
  /** Economy: Arcane Fragments needed for one Orb of Renewal. */
  fragmentsPerOrb: number;
  /** APEX 0.7 – Arcane Transmutation: fragments per random Orb and the relative weights of the outcomes. */
  fragmentsPerRandomOrb: number;
  transmuteWeightRenewal: number;
  transmuteWeightAugment: number;
  transmuteWeightAscension: number;
  /** APEX 0.9 – separate Cube Fragments required to advance from levels 0–4. */
  cubeLevel1Fragments: number;
  cubeLevel2Fragments: number;
  cubeLevel3Fragments: number;
  cubeLevel4Fragments: number;
  cubeLevel5Fragments: number;
  /** Carrying: 0 = SRD standard (capacity STR × 15 lb, no slowdown), 1 = SRD variant (×5 / ×10 lb: −10 / −20 ft),
   *  2 = APEX (default since 1.0): above 50 % / 75 % of capacity speed −25 % / −50 %. */
  encumbranceVariant: number;
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
  spellAttackCap: 1,
  spellDcCap: 1,
  abilityCap: 2,
  thornsCap: 4,
  fragmentsPerOrb: 10,
  fragmentsPerRandomOrb: 10,
  transmuteWeightRenewal: 65,
  transmuteWeightAugment: 30,
  transmuteWeightAscension: 5,
  cubeLevel1Fragments: 3,
  cubeLevel2Fragments: 6,
  cubeLevel3Fragments: 9,
  cubeLevel4Fragments: 12,
  cubeLevel5Fragments: 15,
  encumbranceVariant: 2,
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
  spellAttackCap: [0, 2],
  spellDcCap: [0, 1],
  abilityCap: [0, 4],
  thornsCap: [0, 8],
  fragmentsPerOrb: [2, 100],
  fragmentsPerRandomOrb: [2, 100],
  transmuteWeightRenewal: [0, 1000],
  transmuteWeightAugment: [0, 1000],
  transmuteWeightAscension: [0, 1000],
  cubeLevel1Fragments: [1, 999],
  cubeLevel2Fragments: [1, 999],
  cubeLevel3Fragments: [1, 999],
  cubeLevel4Fragments: [1, 999],
  cubeLevel5Fragments: [1, 999],
  encumbranceVariant: [0, 2],
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
