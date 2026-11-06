/**
 * APEX base item catalogue (APEX 0.6) – the Game Master's item pool.
 *
 * Templates only: an owned item is a separate instance in a character's inventory that copies what it needs
 * (`baseId`, `equip`, name …) at creation time, so editing or extending a template never changes items already
 * in play.
 *
 * Sources:
 *  - SRD: "System Reference Document 5.1" by Wizards of the Coast LLC, available at
 *    https://dnd.wizards.com/resources/systems-reference-document, licensed under CC BY 4.0
 *    (https://creativecommons.org/licenses/by/4.0/). Weapons, armour, shield, selected adventuring gear and the
 *    potion of healing use SRD 5.1 statistics (damage, properties, AC, weight, cost). APEX uses SRD 5.1 because the
 *    imported Aurora character sheets follow the 2014 rules.
 *  - APEX: original generic bases for categories without an SRD base item (rings, amulets, cloaks, helmets,
 *    gloves, boots, belts, materials, quest items, crafting currency). They carry no built-in combat statistics;
 *    their value comes from rolled modifiers or GM decisions. They are NOT official D&D items.
 */
import type { ItemEquip, ItemKind, WeaponProperty } from '../equipment.js';

export type BaseCategory = 'weapon' | 'armor' | 'shield' | 'ring' | 'amulet' | 'cloak' | 'head' | 'gloves' | 'boots' | 'belt' | 'gear' | 'consumable' | 'material' | 'quest' | 'currency';
export type ModTag = 'weapon' | 'melee' | 'ranged' | 'armour' | 'shield' | 'jewellery' | 'clothing' | 'head' | 'hands' | 'feet' | 'belt' | 'cloak';

export interface ItemSource {
  name: 'SRD 5.1' | 'APEX';
  license: 'CC-BY-4.0' | 'APEX original';
  attribution?: string;
}

export interface BaseItem {
  id: string;
  name: string;
  category: BaseCategory;
  /** e.g. 'simple melee', 'martial ranged', 'light', 'heavy', 'tools' */
  subtype: string;
  /** Equipment properties copied onto instances (absent for non-equipment). */
  equip?: ItemEquip;
  weight: number;
  /** Price reference in gold pieces (SRD cost where available). */
  price?: number;
  requirements?: { str?: number };
  /** Armour notes from the SRD (stealth disadvantage). */
  stealthDisadvantage?: boolean;
  /** Which modifier tags this base accepts (empty = no random modifiers). */
  modTags: ModTag[];
  /** Stack in one inventory entry (consumables, materials, currency). */
  stackable?: boolean;
  description?: string;
  source: ItemSource;
}

const SRD: ItemSource = {
  name: 'SRD 5.1',
  license: 'CC-BY-4.0',
  attribution: 'This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC, licensed under CC BY 4.0.',
};
const APEX: ItemSource = { name: 'APEX', license: 'APEX original' };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ---------------------------------------------------------------- SRD 5.1 weapons
type W = [name: string, subtype: string, price: number, damage: string, type: string, weight: number, props: WeaponProperty[], versatile?: string];
const WEAPONS: W[] = [
  ['Club', 'simple melee', 0.1, '1d4', 'bludgeoning', 2, ['light']],
  ['Dagger', 'simple melee', 2, '1d4', 'piercing', 1, ['finesse', 'light', 'thrown']],
  ['Greatclub', 'simple melee', 0.2, '1d8', 'bludgeoning', 10, ['two-handed']],
  ['Handaxe', 'simple melee', 5, '1d6', 'slashing', 2, ['light', 'thrown']],
  ['Javelin', 'simple melee', 0.5, '1d6', 'piercing', 2, ['thrown']],
  ['Light Hammer', 'simple melee', 2, '1d4', 'bludgeoning', 2, ['light', 'thrown']],
  ['Mace', 'simple melee', 5, '1d6', 'bludgeoning', 4, []],
  ['Quarterstaff', 'simple melee', 0.2, '1d6', 'bludgeoning', 4, ['versatile'], '1d8'],
  ['Sickle', 'simple melee', 1, '1d4', 'slashing', 2, ['light']],
  ['Spear', 'simple melee', 1, '1d6', 'piercing', 3, ['thrown', 'versatile'], '1d8'],
  ['Light Crossbow', 'simple ranged', 25, '1d8', 'piercing', 5, ['ranged', 'ammunition', 'loading', 'two-handed']],
  ['Dart', 'simple ranged', 0.05, '1d4', 'piercing', 0.25, ['ranged', 'finesse', 'thrown']],
  ['Shortbow', 'simple ranged', 25, '1d6', 'piercing', 2, ['ranged', 'ammunition', 'two-handed']],
  ['Sling', 'simple ranged', 0.1, '1d4', 'bludgeoning', 0, ['ranged', 'ammunition']],
  ['Battleaxe', 'martial melee', 10, '1d8', 'slashing', 4, ['versatile'], '1d10'],
  ['Flail', 'martial melee', 10, '1d8', 'bludgeoning', 2, []],
  ['Glaive', 'martial melee', 20, '1d10', 'slashing', 6, ['heavy', 'reach', 'two-handed']],
  ['Greataxe', 'martial melee', 30, '1d12', 'slashing', 7, ['heavy', 'two-handed']],
  ['Greatsword', 'martial melee', 50, '2d6', 'slashing', 6, ['heavy', 'two-handed']],
  ['Halberd', 'martial melee', 20, '1d10', 'slashing', 6, ['heavy', 'reach', 'two-handed']],
  ['Lance', 'martial melee', 10, '1d12', 'piercing', 6, ['reach']],
  ['Longsword', 'martial melee', 15, '1d8', 'slashing', 3, ['versatile'], '1d10'],
  ['Maul', 'martial melee', 10, '2d6', 'bludgeoning', 10, ['heavy', 'two-handed']],
  ['Morningstar', 'martial melee', 15, '1d8', 'piercing', 4, []],
  ['Pike', 'martial melee', 5, '1d10', 'piercing', 18, ['heavy', 'reach', 'two-handed']],
  ['Rapier', 'martial melee', 25, '1d8', 'piercing', 2, ['finesse']],
  ['Scimitar', 'martial melee', 25, '1d6', 'slashing', 3, ['finesse', 'light']],
  ['Shortsword', 'martial melee', 10, '1d6', 'piercing', 2, ['finesse', 'light']],
  ['Trident', 'martial melee', 5, '1d6', 'piercing', 4, ['thrown', 'versatile'], '1d8'],
  ['War Pick', 'martial melee', 5, '1d8', 'piercing', 2, []],
  ['Warhammer', 'martial melee', 15, '1d8', 'bludgeoning', 2, ['versatile'], '1d10'],
  ['Whip', 'martial melee', 2, '1d4', 'slashing', 3, ['finesse', 'reach']],
  ['Blowgun', 'martial ranged', 10, '1', 'piercing', 1, ['ranged', 'ammunition', 'loading']],
  ['Hand Crossbow', 'martial ranged', 75, '1d6', 'piercing', 3, ['ranged', 'ammunition', 'light', 'loading']],
  ['Heavy Crossbow', 'martial ranged', 50, '1d10', 'piercing', 18, ['ranged', 'ammunition', 'heavy', 'loading', 'two-handed']],
  ['Longbow', 'martial ranged', 50, '1d8', 'piercing', 2, ['ranged', 'ammunition', 'heavy', 'two-handed']],
];

// ---------------------------------------------------------------- SRD 5.1 armour
type A = [name: string, type: 'light' | 'medium' | 'heavy', price: number, base: number, weight: number, stealth: boolean, str?: number];
const ARMOUR: A[] = [
  ['Padded Armor', 'light', 5, 11, 8, true],
  ['Leather Armor', 'light', 10, 11, 10, false],
  ['Studded Leather Armor', 'light', 45, 12, 13, false],
  ['Hide Armor', 'medium', 10, 12, 12, false],
  ['Chain Shirt', 'medium', 50, 13, 20, false],
  ['Scale Mail', 'medium', 50, 14, 45, true],
  ['Breastplate', 'medium', 400, 14, 20, false],
  ['Half Plate', 'medium', 750, 15, 40, true],
  ['Ring Mail', 'heavy', 30, 14, 40, true],
  ['Chain Mail', 'heavy', 75, 16, 55, true, 13],
  ['Splint Armor', 'heavy', 200, 17, 60, true, 15],
  ['Plate Armor', 'heavy', 1500, 18, 65, true, 15],
];

// ---------------------------------------------------------------- APEX generic equipment bases (no built-in stats)
type G = [name: string, category: BaseCategory, kind: ItemKind, subtype: string, weight: number, price: number, tags: ModTag[], description: string];
const GENERIC: G[] = [
  ['Iron Band', 'ring', 'ring', 'ring', 0, 5, ['jewellery'], 'A plain band of dark iron.'],
  ['Bronze Signet', 'ring', 'ring', 'ring', 0, 15, ['jewellery'], 'A legion signet with a worn eagle seal.'],
  ['Silver Ring', 'ring', 'ring', 'ring', 0, 25, ['jewellery'], 'A slim silver ring.'],
  ['Bone Charm', 'amulet', 'amulet', 'amulet', 0, 5, ['jewellery'], 'Carved bone on a leather cord.'],
  ['Bronze Torc', 'amulet', 'amulet', 'amulet', 1, 20, ['jewellery'], 'A heavy neck ring of twisted bronze.'],
  ['Imperial Medallion', 'amulet', 'amulet', 'amulet', 0, 40, ['jewellery'], 'Gold-washed medallion of the Empire.'],
  ['Travelling Cloak', 'cloak', 'cloak', 'cloak', 2, 1, ['cloak', 'clothing'], 'Weatherproof wool, hooded.'],
  ['Legion Sagum', 'cloak', 'cloak', 'cloak', 3, 5, ['cloak', 'clothing'], 'The red military cloak of the legions.'],
  ['Leather Cap', 'head', 'head', 'helmet', 1, 2, ['head', 'clothing'], 'Padded leather cap.'],
  ['Iron Helm', 'head', 'head', 'helmet', 4, 10, ['head'], 'Plain iron helmet with cheek guards.'],
  ['Crested Galea', 'head', 'head', 'helmet', 5, 25, ['head'], 'An officer’s helmet with a red crest.'],
  ['Leather Gloves', 'gloves', 'gloves', 'gloves', 0.5, 1, ['hands', 'clothing'], 'Supple riding gloves.'],
  ['Iron Gauntlets', 'gloves', 'gloves', 'gauntlets', 3, 10, ['hands'], 'Articulated iron gauntlets.'],
  ['Soft Boots', 'boots', 'boots', 'boots', 1, 1, ['feet', 'clothing'], 'Quiet soft-soled boots.'],
  ['Marching Caligae', 'boots', 'boots', 'boots', 2, 2, ['feet'], 'Hobnailed legion sandals.'],
  ['Rope Belt', 'belt', 'belt', 'belt', 0.5, 0.1, ['belt', 'clothing'], 'A knotted rope belt.'],
  ['Leather Belt', 'belt', 'belt', 'belt', 1, 1, ['belt', 'clothing'], 'A broad belt with pouches.'],
  ['Legion Cingulum', 'belt', 'belt', 'belt', 2, 10, ['belt'], 'Military belt with bronze plates.'],
];

type I = [name: string, category: BaseCategory, subtype: string, weight: number, price: number | undefined, stackable: boolean, source: ItemSource, description: string];
const OTHER: I[] = [
  ['Rope, Hempen (50 feet)', 'gear', 'adventuring gear', 10, 1, false, SRD, ''],
  ['Torch', 'gear', 'adventuring gear', 1, 0.01, true, SRD, ''],
  ['Rations (1 day)', 'gear', 'adventuring gear', 2, 0.5, true, SRD, ''],
  ['Bedroll', 'gear', 'adventuring gear', 7, 1, false, SRD, ''],
  ['Waterskin', 'gear', 'adventuring gear', 5, 0.2, false, SRD, ''],
  ['Crowbar', 'gear', 'adventuring gear', 5, 2, false, SRD, ''],
  ['Lantern, Hooded', 'gear', 'adventuring gear', 2, 5, false, SRD, ''],
  ["Healer's Kit", 'gear', 'kit', 3, 5, false, SRD, 'Ten uses: stabilise a creature at 0 hit points without a Medicine check.'],
  ["Thieves' Tools", 'gear', 'tools', 1, 25, false, SRD, ''],
  ['Potion of Healing', 'consumable', 'potion', 0.5, 50, true, SRD, 'Regain 2d4 + 2 hit points when you drink it.'],
  [
    'Bag of Holding',
    'gear',
    'wondrous item',
    15,
    500,
    false,
    SRD,
    'Holds up to 500 pounds, not exceeding a volume of 64 cubic feet; the bag always weighs 15 pounds. Retrieving an item is an action. Placing it inside another extradimensional space is not allowed in APEX (it would destroy both).',
  ],
  ['Iron Ingot', 'material', 'metal', 1, 1, true, APEX, 'Raw material.'],
  [
    'Imperial Transmutation Cube',
    'gear',
    'artifact',
    3,
    undefined,
    false,
    APEX,
    'A palm-sized cube of black basalt banded in gold, its faces etched with the eagle and the labyrinth. Whoever carries it can perform Arcane Transmutation (fragments into random Orbs).',
  ],
  ['Arcane Dust', 'material', 'reagent', 0, 5, true, APEX, 'Glittering residue of controlled magic.'],
  ['Quest Token', 'quest', 'quest', 0, undefined, false, APEX, 'A story object – rename it and describe it for your campaign.'],
];

export const BASE_ITEMS: BaseItem[] = [
  ...WEAPONS.map(([name, subtype, price, damage, type, weight, props, versatile]): BaseItem => ({
    id: `srd-${slug(name)}`,
    name,
    category: 'weapon',
    subtype,
    equip: { kind: 'weapon', damage, ...(versatile ? { versatileDamage: versatile } : {}), damageType: type, properties: props },
    weight,
    price,
    modTags: ['weapon', subtype.includes('ranged') ? 'ranged' : 'melee'],
    description: versatile ? `Versatile (${versatile}).` : undefined,
    source: SRD,
  })),
  ...ARMOUR.map(([name, type, price, base, weight, stealth, str]): BaseItem => ({
    id: `srd-${slug(name)}`,
    name,
    category: 'armor',
    subtype: `${type} armor`,
    equip: { kind: 'armor', armorType: type, armorBase: base },
    weight,
    price,
    requirements: str ? { str } : undefined,
    stealthDisadvantage: stealth,
    modTags: ['armour'],
    source: SRD,
  })),
  { id: 'srd-shield', name: 'Shield', category: 'shield', subtype: 'shield', equip: { kind: 'shield', acBonus: 2 }, weight: 6, price: 10, modTags: ['shield', 'armour'], source: SRD },
  ...GENERIC.map(([name, category, kind, subtype, weight, price, tags, description]): BaseItem => ({
    id: `apex-${slug(name)}`,
    name,
    category,
    subtype,
    equip: { kind },
    weight,
    price,
    modTags: tags,
    description,
    source: APEX,
  })),
  ...OTHER.map(([name, category, subtype, weight, price, stackable, source, description]): BaseItem => ({
    id: `${source.name === 'APEX' ? 'apex' : 'srd'}-${slug(name)}`,
    name,
    category,
    subtype,
    weight,
    price,
    stackable,
    modTags: [],
    description: description || undefined,
    source,
  })),
];

const BY_ID = new Map(BASE_ITEMS.map((b) => [b.id, b]));
export const baseItem = (id: string | undefined): BaseItem | undefined => (id ? BY_ID.get(id) : undefined);
