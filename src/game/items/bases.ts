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
import type { ArmorType, ItemEquip, ItemKind, WeaponProperty } from '../equipment.js';
import { PIECE_RATINGS, type PieceSlot } from './armour.js';

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
  /** APEX 1.0: lowest item level this base drops at in random loot (default 1). */
  dropLevel?: number;
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
  ['Rope Belt', 'belt', 'belt', 'belt', 0.5, 0.1, ['belt', 'clothing'], 'A knotted rope belt.'],
  ['Leather Belt', 'belt', 'belt', 'belt', 1, 1, ['belt', 'clothing'], 'A broad belt with pouches.'],
  ['Legion Cingulum', 'belt', 'belt', 'belt', 2, 10, ['belt'], 'Military belt with bronze plates.'],
];

// ---------------------------------------------------------------- APEX 1.0 armour pieces (armour / evasion, see armour.ts)
// Tiers of the same slot and weight class share their ratings (bounded accuracy); a higher tier drops from a higher
// item level and is lighter, quieter or needs less Strength. Modifiers depend on the ITEM level, never on the base
// tier – a great roll can land on a humble base.
type P = [name: string, slot: 'armor' | 'head' | 'gloves' | 'boots', type: ArmorType, dropLevel: number, weight: number, price: number, stealth: boolean, str: number | undefined, description: string];
const PIECES: P[] = [
  // body
  ['Quilted Jerkin', 'armor', 'light', 1, 6, 5, false, undefined, 'Layers of quilted linen – light and quiet.'],
  ['Scout Leathers', 'armor', 'light', 8, 7, 40, false, undefined, 'Oiled leather with a hood and many straps.'],
  ['Shadowweave Coat', 'armor', 'light', 16, 4, 300, false, undefined, 'Dark, close-woven cloth that drinks the light.'],
  ['Ringed Hauberk', 'armor', 'medium', 1, 22, 30, true, undefined, 'Iron rings sewn onto a leather coat.'],
  ['Lorica Squamata', 'armor', 'medium', 8, 18, 200, true, undefined, 'Overlapping bronze scales on linen.'],
  ['Lamellar Cuirass', 'armor', 'medium', 16, 15, 600, false, undefined, 'Laced lamellae that move without a sound.'],
  ['Iron Cuirass', 'armor', 'heavy', 1, 35, 60, true, 13, 'A thick breast- and backplate of hammered iron.'],
  ['Lorica Segmentata', 'armor', 'heavy', 8, 30, 400, true, 13, 'Banded legion plate, the pride of the Empire.'],
  ['Praetorian Plate', 'armor', 'heavy', 16, 26, 1200, true, 11, 'Gilded steel of the guard – lighter than it looks.'],
  // head
  ['Leather Cap', 'head', 'light', 1, 1, 2, false, undefined, 'Padded leather cap.'],
  ['Scout Hood', 'head', 'light', 8, 1, 15, false, undefined, 'A deep hood with a leather brow guard.'],
  ['Silk Circlet', 'head', 'light', 16, 0, 80, false, undefined, 'A silver circlet with a padded silk coif.'],
  ['Iron Helm', 'head', 'medium', 1, 4, 10, false, undefined, 'Plain iron helmet with cheek guards.'],
  ['Montefortino Helm', 'head', 'medium', 8, 3, 40, false, undefined, 'A bronze bowl helm with a neck guard.'],
  ['Lamellar Helm', 'head', 'medium', 16, 3, 150, false, undefined, 'Laced lamellae around a steel cap.'],
  ['Crested Galea', 'head', 'heavy', 1, 5, 25, true, undefined, 'An officer’s helmet with a red crest.'],
  ['Visored Galea', 'head', 'heavy', 8, 5, 90, true, undefined, 'A closed helm with a hinged face plate.'],
  ['Praetorian Helm', 'head', 'heavy', 16, 4, 300, true, undefined, 'Gilded helm of the guard.'],
  // hands
  ['Leather Gloves', 'gloves', 'light', 1, 0.5, 1, false, undefined, 'Supple riding gloves.'],
  ['Archer’s Bracers', 'gloves', 'light', 8, 0.5, 15, false, undefined, 'Laced leather bracers that guard the bow arm.'],
  ['Silk Wraps', 'gloves', 'light', 16, 0, 80, false, undefined, 'Fighting wraps of layered silk.'],
  ['Studded Gloves', 'gloves', 'medium', 1, 1.5, 5, false, undefined, 'Leather gloves set with iron studs.'],
  ['Manica Vambraces', 'gloves', 'medium', 8, 2, 40, false, undefined, 'The segmented arm guard of the arena.'],
  ['Lamellar Gloves', 'gloves', 'medium', 16, 1.5, 150, false, undefined, 'Laced lamellae over the back of the hand.'],
  ['Iron Gauntlets', 'gloves', 'heavy', 1, 3, 10, true, undefined, 'Articulated iron gauntlets.'],
  ['Plated Gauntlets', 'gloves', 'heavy', 8, 3, 90, true, undefined, 'Steel plates over mail gloves.'],
  ['Praetorian Gauntlets', 'gloves', 'heavy', 16, 2.5, 300, true, undefined, 'Gilded gauntlets of the guard.'],
  // feet
  ['Soft Boots', 'boots', 'light', 1, 1, 1, false, undefined, 'Quiet soft-soled boots.'],
  ['Runner’s Sandals', 'boots', 'light', 8, 1, 15, false, undefined, 'Light laced sandals of the courier guild.'],
  ['Shadowstep Boots', 'boots', 'light', 16, 0.5, 80, false, undefined, 'Felt-soled boots that barely touch the ground.'],
  ['Marching Caligae', 'boots', 'medium', 1, 2, 2, false, undefined, 'Hobnailed legion sandals.'],
  ['Legion Greaves', 'boots', 'medium', 8, 3, 40, false, undefined, 'Bronze shin guards over caligae.'],
  ['Lamellar Boots', 'boots', 'medium', 16, 2.5, 150, false, undefined, 'Laced lamellae over soft boots.'],
  ['Iron Sabatons', 'boots', 'heavy', 1, 5, 10, true, undefined, 'Plated iron foot armour.'],
  ['Plated Greaves', 'boots', 'heavy', 8, 5, 90, true, undefined, 'Full steel greaves and sabatons.'],
  ['Praetorian Sabatons', 'boots', 'heavy', 16, 4, 300, true, undefined, 'Gilded sabatons of the guard.'],
];
const PIECE_SLOT: Record<P[1], PieceSlot> = { armor: 'body', head: 'head', gloves: 'hands', boots: 'feet' };
const PIECE_TAGS: Record<P[1], ModTag[]> = { armor: ['armour'], head: ['head'], gloves: ['hands'], boots: ['feet'] };

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
  ...PIECES.map(([name, slot, type, dropLevel, weight, price, stealth, str, description]): BaseItem => ({
    id: `apex-${slug(name.replace(/’/g, ''))}`,
    name,
    category: slot,
    subtype: `${type} ${slot === 'armor' ? 'armour' : slot === 'head' ? 'helmet' : slot}`,
    equip: { kind: slot, armorType: type, ...PIECE_RATINGS[PIECE_SLOT[slot]][type] },
    weight,
    price,
    dropLevel,
    requirements: str ? { str } : undefined,
    stealthDisadvantage: stealth,
    // light pieces are clothing (skills, travel flavour); heavy body pieces also roll armour mods (thorns, AC)
    modTags: [...PIECE_TAGS[slot], ...(type === 'light' ? (['clothing'] as ModTag[]) : []), ...(type === 'heavy' && slot !== 'armor' ? (['armour'] as ModTag[]) : [])],
    description,
    source: APEX,
  })),
  { id: 'srd-shield', name: 'Shield', category: 'shield', subtype: 'shield', equip: { kind: 'shield', acBonus: 2 }, weight: 6, price: 10, modTags: ['shield', 'armour'], source: SRD },
  { id: 'apex-buckler', name: 'Buckler', category: 'shield', subtype: 'light shield', equip: { kind: 'shield', acBonus: 1 }, weight: 2, price: 5, modTags: ['shield'], description: 'A small fist shield – +1 AC, light enough to keep a hand half free.', source: APEX },
  { id: 'apex-scutum', name: 'Scutum', category: 'shield', subtype: 'tower shield', equip: { kind: 'shield', acBonus: 3 }, weight: 20, price: 30, dropLevel: 12, requirements: { str: 15 }, stealthDisadvantage: true, modTags: ['shield', 'armour'], description: 'The curved legion tower shield: +3 AC, but heavy, loud and only for the strong (STR 15).', source: APEX },
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
