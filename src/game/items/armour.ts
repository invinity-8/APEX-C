/**
 * APEX 1.0 armour pieces: Armour and Evasion, translated into D&D Armor Class.
 *
 * Inspired by action-RPG armour/evasion bases, but expressed in 5e terms so bounded accuracy holds:
 *  - every armour slot (body, head, hands, feet) carries an ARMOUR rating and an EVASION rating (half-AC units);
 *  - Armor Class = 10 + ⌊Σ armour / 2⌋ + Dexterity modifier, where Dexterity counts at most ⌊Σ evasion / 2⌋
 *    (and at most the body piece's 5e limit: light no limit, medium +2, heavy +0);
 *  - an empty slot (or a piece without ratings, e.g. a plain cap from an old save) counts as light: no armour,
 *    full evasion – so unarmoured stays 10 + Dex.
 * Light pieces trade armour for evasion, heavy pieces the reverse. Whatever the mix, the best result for a given
 * Dexterity lands at 17–18 – the same ceiling as SRD plate – so collecting and mixing pieces is a choice of style,
 * weight and stealth rather than raw power (see docs/game/ITEMIZATION_BALANCE.md §16).
 *
 * SRD body armours (Plate Armor, Leather Armor …) are complete suits: their SRD Armor Class already includes helmet,
 * gauntlets and greaves, so while one is worn the other pieces add only their modifiers, not their ratings.
 */
import type { ArmorType } from '../equipment.js';

export type PieceSlot = 'body' | 'head' | 'hands' | 'feet';
export const PIECE_SLOTS: PieceSlot[] = ['body', 'head', 'hands', 'feet'];

/** Armour / evasion ratings (half-AC units) per slot and weight class. */
export const PIECE_RATINGS: Record<PieceSlot, Record<ArmorType, { armour: number; evasion: number }>> = {
  body: { light: { armour: 2, evasion: 6 }, medium: { armour: 5, evasion: 2 }, heavy: { armour: 8, evasion: 0 } },
  head: { light: { armour: 1, evasion: 2 }, medium: { armour: 2, evasion: 1 }, heavy: { armour: 3, evasion: 0 } },
  hands: { light: { armour: 1, evasion: 2 }, medium: { armour: 2, evasion: 1 }, heavy: { armour: 3, evasion: 0 } },
  feet: { light: { armour: 1, evasion: 2 }, medium: { armour: 2, evasion: 1 }, heavy: { armour: 3, evasion: 0 } },
};

/** What an empty slot (or an unrated piece) counts as: no armour, light evasion. */
export const EMPTY_RATING = (slot: PieceSlot) => ({ armour: 0, evasion: PIECE_RATINGS[slot].light.evasion });

/** 5e Dexterity limit of the body piece's weight class. */
export const BODY_DEX_LIMIT: Record<ArmorType, number> = { light: Infinity, medium: 2, heavy: 0 };

export interface PieceInput {
  slot: PieceSlot;
  /** null = empty slot / unrated piece */
  rating: { armour: number; evasion: number; type?: ArmorType } | null;
  name?: string;
}

export interface PieceResult {
  armour: number;
  evasion: number;
  /** Armor Class from armour (⌊Σ armour / 2⌋). */
  acFromArmour: number;
  /** Highest Dexterity modifier that still counts. */
  dexLimit: number;
  /** Overall feel of the worn mix (for display): light / medium / heavy. */
  weightClass: ArmorType;
}

export function combinePieces(pieces: PieceInput[]): PieceResult {
  let armour = 0;
  let evasion = 0;
  let body: ArmorType = 'light';
  let heaviness = 0;
  for (const slot of PIECE_SLOTS) {
    const p = pieces.find((x) => x.slot === slot)?.rating ?? null;
    const r = p ?? EMPTY_RATING(slot);
    armour += r.armour;
    evasion += r.evasion;
    if (slot === 'body' && p?.type) body = p.type;
    heaviness += (p?.type === 'heavy' ? 2 : p?.type === 'medium' ? 1 : 0) * (slot === 'body' ? 2 : 1);
  }
  const dexLimit = Math.min(BODY_DEX_LIMIT[body], Math.floor(evasion / 2));
  return { armour, evasion, acFromArmour: Math.floor(armour / 2), dexLimit, weightClass: heaviness >= 7 ? 'heavy' : heaviness >= 3 ? 'medium' : 'light' };
}

/** Best Armor Class a piece mix gives at a Dexterity modifier (used in tests and the balance table). */
export const pieceAc = (pieces: PieceInput[], dex: number) => {
  const r = combinePieces(pieces);
  return 10 + r.acFromArmour + Math.min(dex, r.dexLimit);
};
