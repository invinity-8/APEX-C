/**
 * Equipment & derived combat statistics (APEX 0.5).
 *
 * Ownership: items always live in the character's inventory; equipment slots only REFERENCE item ids, and an item
 * can be referenced by at most one slot – switching weapon sets or resting never copies an item.
 * Rules: an item can only be equipped once its equipment properties are defined (kind, armour values, weapon
 * damage …). APEX never invents mechanics for unknown items; the SRD tables below are offered as one-click
 * SUGGESTIONS that the player or GM confirms. A GM can lock an item's properties.
 *
 * Derived stats are a pure function of (character sheet, token equipment) and come with a step-by-step
 * explanation. Imported sheet values stay untouched and remain visible as the "imported" baseline.
 */
import type { CharacterSheet } from './sheet.js';
import type { Item, Token } from './types.js';
import { containersOf } from './inventory.js';
import { modifier, type Element, ELEMENTS, type SaveAbility } from './items/modifiers.js';
import { DEFAULT_ITEM_RULES, type ItemRules } from './items/rules.js';
import { resistanceReduction } from './items/resistance.js';

export type EquipSlot = 'head' | 'chest' | 'gloves' | 'boots' | 'cloak' | 'amulet' | 'belt' | 'ring1' | 'ring2' | 'main1' | 'off1' | 'main2' | 'off2';
export const EQUIP_SLOTS: EquipSlot[] = ['head', 'amulet', 'cloak', 'chest', 'belt', 'gloves', 'ring1', 'ring2', 'boots', 'main1', 'off1', 'main2', 'off2'];
export type ItemKind = 'head' | 'armor' | 'gloves' | 'boots' | 'cloak' | 'amulet' | 'belt' | 'ring' | 'weapon' | 'shield' | 'focus';
export const ITEM_KINDS: ItemKind[] = ['weapon', 'shield', 'armor', 'head', 'gloves', 'boots', 'cloak', 'amulet', 'belt', 'ring', 'focus'];
export type ArmorType = 'light' | 'medium' | 'heavy';
export type WeaponProperty = 'finesse' | 'light' | 'heavy' | 'two-handed' | 'versatile' | 'reach' | 'thrown' | 'ranged' | 'loading' | 'ammunition';
export const WEAPON_PROPERTIES: WeaponProperty[] = ['finesse', 'light', 'heavy', 'two-handed', 'versatile', 'reach', 'thrown', 'ranged', 'loading', 'ammunition'];
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** Manually defined equipment properties of an item. */
export interface ItemEquip {
  kind: ItemKind;
  /** Body armour: base AC and type (light = full Dex, medium = Dex max +2, heavy = no Dex). */
  armorType?: ArmorType;
  armorBase?: number;
  /** Flat AC bonus while equipped (shield +2, ring of protection +1, magic armour +1 …). */
  acBonus?: number;
  /** Weapons: magic/other attack bonus, damage dice, damage type, properties, proficiency. */
  attackBonus?: number;
  damage?: string;
  /** Alternate damage dice for a versatile weapon gripped with both hands. */
  versatileDamage?: string;
  damageType?: string;
  properties?: WeaponProperty[];
  proficient?: boolean;
  /** Only the GM may change these properties. */
  gmLocked?: boolean;
}

export interface Equipment {
  slots: Partial<Record<EquipSlot, string>>;
  /** Equipped versatile weapon item ids currently gripped with two hands. */
  twoHandedGrips?: string[];
  activeSet: 1 | 2;
  /** Resting / Unarmored preset: everything except the kept slots counts as taken off. */
  resting: boolean;
  restingKeep: EquipSlot[];
  /** Unarmored defence ability added to 10 + Dex (e.g. a class feature) – set manually, never guessed. */
  unarmoredAbility?: Ability | null;
  /** Other manual AC modifier (spells, features …) with a label. */
  acOther?: number;
  acOtherLabel?: string;
}

export const DEFAULT_RESTING_KEEP: EquipSlot[] = ['amulet', 'ring1', 'ring2', 'cloak', 'belt'];
export const emptyEquipment = (): Equipment => ({ slots: {}, activeSet: 1, resting: false, restingKeep: [...DEFAULT_RESTING_KEEP] });
export const equipmentOf = (t: Pick<Token, 'equipment'>): Equipment => t.equipment ?? emptyEquipment();

export const SLOT_LABEL: Record<EquipSlot, string> = {
  head: 'Head',
  chest: 'Armor',
  gloves: 'Gloves',
  boots: 'Boots',
  cloak: 'Cloak',
  amulet: 'Amulet',
  belt: 'Belt',
  ring1: 'Ring',
  ring2: 'Ring',
  main1: 'Main hand',
  off1: 'Off hand',
  main2: 'Main hand',
  off2: 'Off hand',
};

const SLOT_KINDS: Record<EquipSlot, ItemKind[]> = {
  head: ['head'],
  chest: ['armor'],
  gloves: ['gloves'],
  boots: ['boots'],
  cloak: ['cloak'],
  amulet: ['amulet'],
  belt: ['belt'],
  ring1: ['ring'],
  ring2: ['ring'],
  main1: ['weapon', 'focus'],
  main2: ['weapon', 'focus'],
  off1: ['weapon', 'shield', 'focus'],
  off2: ['weapon', 'shield', 'focus'],
};
export const slotAccepts = (slot: EquipSlot, e: ItemEquip | undefined) => !!e && SLOT_KINDS[slot].includes(e.kind);
export const isTwoHanded = (e: ItemEquip | undefined) => !!e?.properties?.includes('two-handed');
const offOf = (main: EquipSlot): EquipSlot | null => (main === 'main1' ? 'off1' : main === 'main2' ? 'off2' : null);
const mainOf = (off: EquipSlot): EquipSlot | null => (off === 'off1' ? 'main1' : off === 'off2' ? 'main2' : null);
export const setOfSlot = (s: EquipSlot): 1 | 2 | null => (s === 'main1' || s === 'off1' ? 1 : s === 'main2' || s === 'off2' ? 2 : null);

/** Slots that count right now (active weapon set; resting removes everything but the kept slots). */
export function activeSlots(eq: Equipment): EquipSlot[] {
  const set = eq.activeSet;
  return EQUIP_SLOTS.filter((s) => {
    const ws = setOfSlot(s);
    if (ws !== null && ws !== set) return false;
    return !eq.resting || eq.restingKeep.includes(s);
  });
}

/** Where an item is equipped (at most one slot). */
export const slotOfItem = (eq: Equipment, itemId: string): EquipSlot | null => EQUIP_SLOTS.find((s) => eq.slots[s] === itemId) ?? null;

// ---------------------------------------------------------------- rules applied by commands (mutating)

export type EquipError = 'noSuchItem' | 'noEquipProps' | 'wrongSlot' | 'twoHandedOff' | 'gmLocked' | 'unidentified';

/** Equips an item into a slot; moves it if it was equipped elsewhere (never duplicates). */
export function equipItem(t: Token, itemId: string, slot: EquipSlot): EquipError | null {
  const item = t.inventory.find((i) => i.id === itemId);
  if (!item) return 'noSuchItem';
  if (!item.equip) return 'noEquipProps';
  if (item.identified === false) return 'unidentified';
  if (!slotAccepts(slot, item.equip)) return 'wrongSlot';
  const eq = structuredClone(equipmentOf(t));
  const main = mainOf(slot);
  if (main && isTwoHanded(item.equip)) return 'twoHandedOff';
  if (main) {
    const mainItem = t.inventory.find((i) => i.id === eq.slots[main]);
    if (isTwoHanded(mainItem?.equip) && eq.slots[main] !== itemId) return 'twoHandedOff';
  }
  const from = slotOfItem(eq, itemId);
  if (from) delete eq.slots[from];
  eq.slots[slot] = itemId;
  const off = offOf(slot);
  if (off && isTwoHanded(item.equip)) delete eq.slots[off]; // a two-handed weapon needs both hands
  t.equipment = eq;
  return null;
}

export function unequipSlot(t: Token, slot: EquipSlot): void {
  const eq = structuredClone(equipmentOf(t));
  delete eq.slots[slot];
  t.equipment = eq;
}

/** Removes references to items that no longer exist or no longer fit their slot. */
export function reconcileEquipment(t: Token): void {
  if (!t.equipment) return;
  const eq = t.equipment;
  for (const s of EQUIP_SLOTS) {
    const id = eq.slots[s];
    if (!id) continue;
    const item = t.inventory.find((i) => i.id === id);
    if (!item || !slotAccepts(s, item.equip)) delete eq.slots[s];
  }
  for (const off of ['off1', 'off2'] as EquipSlot[]) {
    const main = mainOf(off)!;
    const m = t.inventory.find((i) => i.id === eq.slots[main]);
    if (eq.slots[off] && isTwoHanded(m?.equip)) delete eq.slots[off];
  }
  if (eq.twoHandedGrips) {
    const valid = new Set((['main1', 'main2'] as const).flatMap((slot) => {
      const item = t.inventory.find((i) => i.id === eq.slots[slot]);
      return item?.equip?.kind === 'weapon' && item.equip.properties?.includes('versatile') && !item.equip.properties.includes('two-handed') && item.equip.versatileDamage ? [item.id] : [];
    }));
    eq.twoHandedGrips = eq.twoHandedGrips.filter((id) => valid.has(id));
  }
}

// ---------------------------------------------------------------- SRD suggestions (confirmed by a person)

/** D&D 5e SRD 5.1 (CC BY 4.0) armour – offered as suggestions only. */
export const ARMOR_PRESETS: Record<string, ItemEquip> = {
  'Padded armor': { kind: 'armor', armorType: 'light', armorBase: 11 },
  'Leather armor': { kind: 'armor', armorType: 'light', armorBase: 11 },
  'Studded leather armor': { kind: 'armor', armorType: 'light', armorBase: 12 },
  'Hide armor': { kind: 'armor', armorType: 'medium', armorBase: 12 },
  'Chain shirt': { kind: 'armor', armorType: 'medium', armorBase: 13 },
  'Scale mail': { kind: 'armor', armorType: 'medium', armorBase: 14 },
  Breastplate: { kind: 'armor', armorType: 'medium', armorBase: 14 },
  'Half plate': { kind: 'armor', armorType: 'medium', armorBase: 15 },
  'Ring mail': { kind: 'armor', armorType: 'heavy', armorBase: 14 },
  'Chain mail': { kind: 'armor', armorType: 'heavy', armorBase: 16 },
  'Splint armor': { kind: 'armor', armorType: 'heavy', armorBase: 17 },
  'Plate armor': { kind: 'armor', armorType: 'heavy', armorBase: 18 },
  Shield: { kind: 'shield', acBonus: 2 },
};

/** D&D 5e SRD 5.1 weapons (selection) – suggestions only. */
export const WEAPON_PRESETS: Record<string, ItemEquip> = {
  Club: { kind: 'weapon', damage: '1d4', damageType: 'bludgeoning', properties: ['light'] },
  Dagger: { kind: 'weapon', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'] },
  Greatclub: { kind: 'weapon', damage: '1d8', damageType: 'bludgeoning', properties: ['two-handed'] },
  Handaxe: { kind: 'weapon', damage: '1d6', damageType: 'slashing', properties: ['light', 'thrown'] },
  Javelin: { kind: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['thrown'] },
  Mace: { kind: 'weapon', damage: '1d6', damageType: 'bludgeoning', properties: [] },
  Quarterstaff: { kind: 'weapon', damage: '1d6', versatileDamage: '1d8', damageType: 'bludgeoning', properties: ['versatile'] },
  Sickle: { kind: 'weapon', damage: '1d4', damageType: 'slashing', properties: ['light'] },
  Spear: { kind: 'weapon', damage: '1d6', versatileDamage: '1d8', damageType: 'piercing', properties: ['thrown', 'versatile'] },
  Shortbow: { kind: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['ranged', 'two-handed', 'ammunition'] },
  'Light crossbow': { kind: 'weapon', damage: '1d8', damageType: 'piercing', properties: ['ranged', 'two-handed', 'loading', 'ammunition'] },
  Scimitar: { kind: 'weapon', damage: '1d6', damageType: 'slashing', properties: ['finesse', 'light'] },
  Shortsword: { kind: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['finesse', 'light'] },
  Longsword: { kind: 'weapon', damage: '1d8', versatileDamage: '1d10', damageType: 'slashing', properties: ['versatile'] },
  Rapier: { kind: 'weapon', damage: '1d8', damageType: 'piercing', properties: ['finesse'] },
  Warhammer: { kind: 'weapon', damage: '1d8', versatileDamage: '1d10', damageType: 'bludgeoning', properties: ['versatile'] },
  Battleaxe: { kind: 'weapon', damage: '1d8', versatileDamage: '1d10', damageType: 'slashing', properties: ['versatile'] },
  Greatsword: { kind: 'weapon', damage: '2d6', damageType: 'slashing', properties: ['heavy', 'two-handed'] },
  Greataxe: { kind: 'weapon', damage: '1d12', damageType: 'slashing', properties: ['heavy', 'two-handed'] },
  Longbow: { kind: 'weapon', damage: '1d8', damageType: 'piercing', properties: ['ranged', 'heavy', 'two-handed', 'ammunition'] },
};

/** Suggestion for an item by its name (exact or "[Breastplate]"-style), or null – never applied automatically. */
export function suggestEquip(name: string): { preset: string; equip: ItemEquip } | null {
  const n = name.replace(/[[\]]/g, '').trim().toLowerCase();
  for (const table of [ARMOR_PRESETS, WEAPON_PRESETS]) {
    for (const [k, v] of Object.entries(table)) if (n === k.toLowerCase() || n === k.toLowerCase().replace(/ armor$/, '')) return { preset: k, equip: structuredClone(v) };
  }
  return null;
}

// ---------------------------------------------------------------- derived statistics

export interface CalcStep {
  label: string;
  value: number;
  /** '=' base value, '+' added, 'cap' capped */
  op: '=' | '+' | 'cap';
}

export interface DerivedStats {
  ac: { value: number | null; steps: CalcStep[]; source: 'derived' | 'imported' | 'none'; imported: number | null; note?: string };
  attacks: Array<{ slot: EquipSlot; itemId: string; name: string; toHit: number | null; damage: string; twoHandedGrip: boolean; steps: CalcStep[]; properties: WeaponProperty[]; extra: string[] }>;
  /** APEX 0.6: character-wide bonuses from modifiers on equipped, identified items of the active set. */
  bonuses: ItemBonuses;
  abilityMods: Partial<Record<Ability, number>>;
  proficiency: number | null;
  resting: boolean;
  activeSet: 1 | 2;
}

export interface BonusLine {
  total: number;
  /** after the bounded-accuracy cap */
  value: number;
  cap: number;
  steps: CalcStep[];
}
export interface ItemBonuses {
  resistances: Record<Element, BonusLine & { reduction: number }>;
  ac: BonusLine;
  maxHp: BonusLine;
  initiative: BonusLine;
  speed: BonusLine;
  carry: BonusLine;
  saves: Partial<Record<SaveAbility, BonusLine>>;
  /** APEX 0.7 */
  spellAttack: BonusLine;
  spellDc: BonusLine;
  abilities: Partial<Record<SaveAbility, BonusLine>>;
  thorns: BonusLine;
  skills: Record<string, BonusLine>;
}

const line = (cap: number): BonusLine => ({ total: 0, value: 0, cap, steps: [] });
const addTo = (l: BonusLine, label: string, v: number) => {
  l.total += v;
  l.steps.push({ label, value: v, op: '+' });
};
const finish = (l: BonusLine) => {
  l.value = Math.min(l.total, l.cap);
  if (l.total > l.cap) l.steps.push({ label: `Capped at ${l.cap}`, value: l.cap, op: 'cap' });
  return l;
};

/** Modifiers of items that are worn in an ACTIVE slot and identified (unidentified items grant nothing yet). */
export function itemBonuses(worn: Array<{ slot: EquipSlot; item: Item }>, rules: ItemRules = DEFAULT_ITEM_RULES): ItemBonuses {
  const b: ItemBonuses = {
    resistances: Object.fromEntries(ELEMENTS.map((e) => [e, { ...line(rules.resistanceCap), reduction: 0 }])) as ItemBonuses['resistances'],
    ac: line(rules.acCap),
    maxHp: line(rules.maxHpCap),
    initiative: line(rules.initiativeCap),
    speed: line(rules.speedCap),
    carry: line(Infinity),
    saves: {},
    skills: {},
    spellAttack: line(rules.spellAttackCap),
    spellDc: line(rules.spellDcCap),
    abilities: {},
    thorns: line(rules.thornsCap),
  };
  for (const { item } of worn) {
    if (item.identified === false) continue;
    for (const m of item.mods ?? []) {
      const def = modifier(m.modId);
      if (!def || def.local) continue;
      const e = def.effect;
      if (e.type === 'resistance') addTo(b.resistances[e.element], item.name, m.value);
      else if (e.type === 'ac') addTo(b.ac, item.name, m.value);
      else if (e.type === 'maxHp') addTo(b.maxHp, item.name, m.value);
      else if (e.type === 'initiative') addTo(b.initiative, item.name, m.value);
      else if (e.type === 'speed') addTo(b.speed, item.name, m.value);
      else if (e.type === 'carry') addTo(b.carry, item.name, m.value);
      else if (e.type === 'save') addTo((b.saves[e.ability] ??= line(rules.saveCap)), item.name, m.value);
      else if (e.type === 'skill') addTo((b.skills[e.skill] ??= line(rules.skillCap)), item.name, m.value);
      else if (e.type === 'spellAttack') addTo(b.spellAttack, item.name, m.value);
      else if (e.type === 'spellDc') addTo(b.spellDc, item.name, m.value);
      else if (e.type === 'ability') addTo((b.abilities[e.ability] ??= line(rules.abilityCap)), item.name, m.value);
      else if (e.type === 'thorns') addTo(b.thorns, item.name, m.value);
    }
  }
  for (const el of ELEMENTS) {
    const r = b.resistances[el];
    finish(r);
    r.reduction = resistanceReduction(r.value, rules.resistanceCap);
  }
  [b.ac, b.maxHp, b.initiative, b.speed, b.carry, b.spellAttack, b.spellDc, b.thorns, ...Object.values(b.saves), ...Object.values(b.skills), ...Object.values(b.abilities)].forEach((l) => l && finish(l));
  return b;
}

/** Weapon-local modifiers of one weapon: to-hit (capped), flat damage (capped, all types together), banes. */
export function weaponMods(item: Item, rules: ItemRules = DEFAULT_ITEM_RULES): { toHit: number; toHitTotal: number; flat: Array<{ damage: string; value: number }>; flatCapped: boolean; banes: string[] } {
  const out = { toHit: 0, toHitTotal: 0, flat: [] as Array<{ damage: string; value: number }>, flatCapped: false, banes: [] as string[] };
  if (item.identified === false) return out;
  let flatLeft = rules.flatDamageCap;
  for (const m of item.mods ?? []) {
    const def = modifier(m.modId);
    if (!def?.local) continue;
    const e = def.effect;
    if (e.type === 'toHit') out.toHitTotal += m.value;
    else if (e.type === 'flatDamage') {
      const v = Math.min(m.value, flatLeft);
      if (v < m.value) out.flatCapped = true;
      flatLeft -= v;
      if (v > 0) out.flat.push({ damage: e.damage, value: v });
    } else if (e.type === 'bane') out.banes.push(`+${m.value} vs ${e.creature}`);
    else if (e.type === 'critDamage') out.banes.push(`+${m.value} on a critical hit`);
  }
  out.toHit = Math.min(out.toHitTotal, rules.toHitCap);
  return out;
}

const ABILITY_NAMES: Record<Ability, RegExp> = { str: /^str/i, dex: /^dex/i, con: /^con/i, int: /^int/i, wis: /^wis/i, cha: /^cha/i };
const num = (s: string | undefined): number | null => {
  const m = /([+-]?\d+)/.exec(s ?? '');
  return m ? Number(m[1]) : null;
};

export function abilityMods(sheet: CharacterSheet): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  for (const a of Object.keys(ABILITY_NAMES) as Ability[]) {
    const attr = sheet.attributes.find((x) => ABILITY_NAMES[a].test(x.name.trim()));
    if (!attr) continue;
    const score = num(attr.value);
    out[a] = score !== null ? Math.floor((score - 10) / 2) : (num(attr.modifier) ?? undefined)!;
    if (out[a] === undefined) delete out[a];
  }
  return out;
}

export function deriveStats(sheet: CharacterSheet, token: Pick<Token, 'inventory' | 'equipment' | 'armorWornAt'>, rules: ItemRules = DEFAULT_ITEM_RULES, nowMs = Date.now()): DerivedStats {
  const eq = equipmentOf(token);
  const mods = abilityMods(sheet);
  const pb = num(sheet.combat.find((c) => /^proficiency bonus$/i.test(c.label))?.value);
  const importedAc = num(sheet.combat.find((c) => c.label === 'Armor Class')?.value);
  const items = new Map(token.inventory.map((i) => [i.id, i]));
  const worn = activeSlots(eq)
    .map((s) => ({ slot: s, item: eq.slots[s] ? items.get(eq.slots[s]!) : undefined }))
    .filter((x): x is { slot: EquipSlot; item: Item } => !!x.item?.equip);
  const allEquipped = EQUIP_SLOTS.map((s) => (eq.slots[s] ? items.get(eq.slots[s]!) : undefined)).filter((i): i is Item => !!i?.equip);
  const armor = worn.find((w) => w.slot === 'chest' && w.item.equip!.kind === 'armor')?.item;
  const mageArmor = sheet.spellEffects.find((effect) => effect.kind === 'mageArmor');
  const mageArmorActive = !!mageArmor && Date.parse(mageArmor.expiresAt) > nowMs && !armor && !(token.armorWornAt && Date.parse(token.armorWornAt) > Date.parse(mageArmor.castAt));
  const bonuses = itemBonuses(worn, rules);
  const acRelevant = allEquipped.some((i) => i.equip!.kind === 'armor' || i.equip!.acBonus) || !!eq.unarmoredAbility || !!eq.acOther || mageArmorActive;

  // ---- Armor Class
  let ac: DerivedStats['ac'];
  if (!acRelevant) {
    ac = {
      value: importedAc,
      steps: importedAc !== null ? [{ label: 'Imported from the character sheet', value: importedAc, op: '=' }] : [],
      source: importedAc !== null ? 'imported' : 'none',
      imported: importedAc,
      note: eq.resting ? 'Define the properties of worn armour/shields to calculate the resting Armor Class.' : undefined,
    };
  } else if (mods.dex === undefined) {
    ac = { value: importedAc, steps: [], source: importedAc !== null ? 'imported' : 'none', imported: importedAc, note: 'Dexterity is missing on the character sheet – AC cannot be calculated.' };
  } else {
    const steps: CalcStep[] = [];
    const dex = mods.dex;
    let value: number;
    if (armor && armor.equip!.armorBase) {
      const e = armor.equip!;
      value = e.armorBase!;
      steps.push({ label: `${armor.name} (${e.armorType ?? 'light'} armour)`, value, op: '=' });
      const cap = e.armorType === 'heavy' ? 0 : e.armorType === 'medium' ? 2 : Infinity;
      const add = Math.min(dex, cap);
      if (cap !== Infinity && dex > cap) steps.push({ label: `Dexterity modifier ${fmt(dex)}, capped by ${e.armorType} armour`, value: add, op: 'cap' });
      else if (cap !== 0) steps.push({ label: 'Dexterity modifier', value: dex, op: '+' });
      else steps.push({ label: 'Dexterity does not apply (heavy armour)', value: 0, op: 'cap' });
      value += add;
    } else if (mageArmorActive) {
      value = 13 + dex;
      steps.push({ label: 'Mage Armor (active): base AC 13', value: 13, op: '=' });
      steps.push({ label: 'Dexterity modifier', value: dex, op: '+' });
    } else {
      value = 10 + dex;
      steps.push({ label: eq.resting ? 'Unarmored (resting): 10' : 'Unarmored: 10', value: 10, op: '=' });
      steps.push({ label: 'Dexterity modifier', value: dex, op: '+' });
      if (eq.unarmoredAbility && mods[eq.unarmoredAbility] !== undefined) {
        value += mods[eq.unarmoredAbility]!;
        steps.push({ label: `Unarmored defence (${eq.unarmoredAbility.toUpperCase()} modifier, set manually)`, value: mods[eq.unarmoredAbility]!, op: '+' });
      }
    }
    for (const w of worn) {
      const b = w.item.equip!.acBonus;
      if (!b) continue;
      if (w.item.equip!.kind === 'shield' && w.slot !== 'off1' && w.slot !== 'off2') continue;
      value += b;
      steps.push({ label: `${w.item.name}${w.item.equip!.kind === 'shield' ? ' (shield)' : ''}`, value: b, op: '+' });
    }
    if (eq.acOther) {
      value += eq.acOther;
      steps.push({ label: eq.acOtherLabel || 'Other modifiers', value: eq.acOther, op: '+' });
    }
    if (bonuses.ac.value) {
      value += bonuses.ac.value;
      steps.push({ label: `Item modifiers${bonuses.ac.total > bonuses.ac.value ? ` (capped at +${bonuses.ac.cap})` : ''}`, value: bonuses.ac.value, op: '+' });
    }
    ac = { value, steps, source: 'derived', imported: importedAc };
  }
  if (ac.source === 'imported' && bonuses.ac.value && ac.value !== null) {
    // the imported sheet does not know APEX items – add the modifier bonus once, visibly
    ac = { ...ac, value: ac.value + bonuses.ac.value, steps: [...ac.steps, { label: 'Item modifiers (not part of the imported sheet)', value: bonuses.ac.value, op: '+' }] };
  }

  // ---- attacks of the active weapon set
  const attacks: DerivedStats['attacks'] = [];
  for (const w of worn) {
    if (w.slot !== 'main1' && w.slot !== 'main2' && w.slot !== 'off1' && w.slot !== 'off2') continue;
    const e = w.item.equip!;
    if (e.kind !== 'weapon') continue;
    const props = e.properties ?? [];
    const str = mods.str;
    const dexM = mods.dex;
    let ability: 'str' | 'dex' = props.includes('ranged') ? 'dex' : 'str';
    if (props.includes('finesse') && dexM !== undefined && (str === undefined || dexM > str)) ability = 'dex';
    const m = mods[ability];
    const steps: CalcStep[] = [];
    let toHit: number | null = null;
    if (m !== undefined) {
      toHit = m;
      steps.push({ label: `${ability.toUpperCase()} modifier${props.includes('finesse') ? ' (finesse: higher of STR/DEX)' : ''}`, value: m, op: '=' });
      if (e.proficient !== false && pb !== null) {
        toHit += pb;
        steps.push({ label: 'Proficiency bonus', value: pb, op: '+' });
      }
      if (e.attackBonus) {
        toHit += e.attackBonus;
        steps.push({ label: 'Item bonus', value: e.attackBonus, op: '+' });
      }
    }
    const wm = weaponMods(w.item, rules);
    if (toHit !== null && wm.toHit) {
      toHit += wm.toHit;
      steps.push({ label: `Weapon modifiers${wm.toHitTotal > wm.toHit ? ` (capped at +${rules.toHitCap})` : ''}`, value: wm.toHit, op: '+' });
    }
    const isOff = w.slot === 'off1' || w.slot === 'off2';
    const dmgMod = m !== undefined && !(isOff && m > 0) ? m + (e.attackBonus ?? 0) : (e.attackBonus ?? 0);
    const twoHandedGrip = !!((w.slot === 'main1' || w.slot === 'main2') && eq.twoHandedGrips?.includes(w.item.id) && props.includes('versatile') && !props.includes('two-handed') && e.versatileDamage);
    const damageDice = twoHandedGrip ? e.versatileDamage : e.damage;
    const dmg = damageDice ? `${damageDice}${dmgMod ? (dmgMod > 0 ? `+${dmgMod}` : `${dmgMod}`) : ''}${e.damageType ? ` ${e.damageType}` : ''}` : '—';
    const flat = wm.flat.map((f) => ` + ${f.value} ${f.damage}`).join('');
    const extra = [...wm.banes, ...(wm.flatCapped ? [`Flat damage capped at ${rules.flatDamageCap}`] : [])];
    attacks.push({ slot: w.slot, itemId: w.item.id, name: w.item.name, toHit, damage: dmg + flat + (isOff ? ' (off hand)' : ''), twoHandedGrip, steps, properties: props, extra });
  }
  return { ac, attacks, bonuses, abilityMods: mods, proficiency: pb, resting: eq.resting, activeSet: eq.activeSet };
}

export const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** One-click equip from the inventory: a fitting slot of the ACTIVE weapon set, free slots first. */
export function suggestSlot(eq: Equipment, item: Pick<Item, 'id' | 'equip'>): EquipSlot | null {
  if (!item.equip) return null;
  const cands = EQUIP_SLOTS.filter((s) => {
    if (!slotAccepts(s, item.equip)) return false;
    const set = setOfSlot(s);
    if (set !== null && set !== eq.activeSet) return false;
    return !(mainOf(s) && isTwoHanded(item.equip));
  });
  return cands.find((s) => !eq.slots[s]) ?? cands[0] ?? null;
}


// ---------------------------------------------------------------- APEX 0.7: one authoritative item location

export const EQUIPPED_CONTAINER = 'equipped';

/**
 * Equipment slots are the single source of truth for "worn"; the inventory location follows them:
 *  - an item referenced by a slot (any weapon set, resting or not) lives in the "Equipped / Worn" container and
 *    remembers the container it came from (`prevContainer`);
 *  - an item with equipment properties that is no longer referenced by a slot goes back to that container (or the
 *    first other container) – it is never shown as worn and stored at the same time.
 * Narrative items without equipment properties may stay in "Equipped / Worn" (a player's choice). Mutates `t` –
 * call it on a copy inside commands.
 */
export function syncEquipmentLocations(t: Token): void {
  const eq = t.equipment;
  const worn = new Set(eq ? EQUIP_SLOTS.map((s) => eq.slots[s]).filter((x): x is string => !!x) : []);
  const needs = t.inventory.some((i) => worn.has(i.id) || (i.equip && i.container === EQUIPPED_CONTAINER));
  if (!needs) return;
  const containers = containersOf(t);
  if (!containers.some((c) => c.id === EQUIPPED_CONTAINER)) containers.push({ id: EQUIPPED_CONTAINER, name: 'Equipped / Worn' });
  t.containers = containers;
  const fallback = containers.find((c) => c.id !== EQUIPPED_CONTAINER)?.id ?? EQUIPPED_CONTAINER;
  for (const i of t.inventory) {
    if (worn.has(i.id)) {
      if (i.container !== EQUIPPED_CONTAINER) {
        if (i.container) i.prevContainer = i.container;
        i.container = EQUIPPED_CONTAINER;
      }
    } else if (i.equip && i.container === EQUIPPED_CONTAINER) {
      const back = i.prevContainer && i.prevContainer !== EQUIPPED_CONTAINER && containers.some((c) => c.id === i.prevContainer) ? i.prevContainer : fallback;
      i.container = back;
      delete i.prevContainer;
    } else if (i.prevContainer) delete i.prevContainer;
  }
}
