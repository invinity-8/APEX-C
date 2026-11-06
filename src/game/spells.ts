/** Focused, server-validated spell actions supported by APEX. */
import { activeSlots, equipmentOf } from './equipment.js';
import { SLOT_RE } from './resources.js';
import type { CharacterSheet } from './sheet.js';
import type { Token } from './types.js';

export const MAGE_ARMOR_DURATION_MS = 8 * 60 * 60 * 1000;

export function isWearingArmor(token: Pick<Token, 'inventory' | 'equipment'>): boolean {
  const eq = equipmentOf(token);
  const chestId = activeSlots(eq).includes('chest') ? eq.slots.chest : undefined;
  const item = token.inventory.find((candidate) => candidate.id === chestId);
  return item?.equip?.kind === 'armor';
}

export function activeMageArmor(sheet: CharacterSheet, armorWornAt?: string, nowMs = Date.now()) {
  const effect = sheet.spellEffects.find((candidate) => candidate.kind === 'mageArmor');
  if (!effect || Date.parse(effect.expiresAt) <= nowMs) return null;
  if (armorWornAt && Date.parse(armorWornAt) > Date.parse(effect.castAt)) return null;
  return effect;
}

export type CastSpellResult = { ok: true; sheet: CharacterSheet; expiresAt: string } | { ok: false; error: string };

/** Applies the self-cast Mage Armor rules without trusting client-supplied spell data or time. */
export function castMageArmor(sheet: CharacterSheet, token: Pick<Token, 'inventory' | 'equipment'>, spellId: unknown, nowMs: number): CastSpellResult {
  if (typeof spellId !== 'string') return { ok: false, error: 'Choose a known Mage Armor spell first.' };
  const spell = sheet.spells.find((candidate) => candidate.id === spellId);
  if (!spell || spell.name.trim().toLowerCase() !== 'mage armor' || spell.level !== 1 || !spell.prepared) {
    return { ok: false, error: 'A prepared 1st-level Mage Armor entry is required before casting.' };
  }
  if (isWearingArmor(token)) return { ok: false, error: 'Mage Armor cannot be cast while wearing armor.' };
  const levelOneSlots = sheet.resources.filter((resource) => {
    const match = SLOT_RE.exec(resource.name);
    return match?.[1] === '1';
  });
  if (levelOneSlots.length !== 1) return { ok: false, error: 'Add exactly one “Spell slots (level 1)” resource before casting Mage Armor.' };
  const slot = levelOneSlots[0];
  if (slot.current < 1) return { ok: false, error: 'No 1st-level spell slot is available.' };
  if (!Number.isFinite(nowMs)) return { ok: false, error: 'The server time is unavailable. Please retry.' };

  const castAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + MAGE_ARMOR_DURATION_MS).toISOString();
  const next = structuredClone(sheet);
  const resource = next.resources.find((candidate) => candidate.id === slot.id)!;
  resource.current -= 1;
  // This one-effect rule prevents multiple Mage Armor castings from stacking; recasting refreshes its duration.
  next.spellEffects = [...next.spellEffects.filter((effect) => effect.kind !== 'mageArmor'), { id: 'mage-armor', kind: 'mageArmor', spellId, castAt, expiresAt }];
  return { ok: true, sheet: next, expiresAt };
}
