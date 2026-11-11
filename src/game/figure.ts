/**
 * APEX 2.1 – low-poly figure kit (data only; the 3D builder lives in components/map/lowpoly.ts).
 *
 * A figure is assembled from parts – body, head, face, hair, beard, headwear, torso, legs, boots, cloak, weapons,
 * extras – and a handful of colours. Players build their own hero; the GM uses the same kit for NPCs. Purely
 * cosmetic: never read by any rule.
 *
 * Humanoid enemies without a chosen look get one automatically: a preset picked from their name or type (bandit,
 * cultist, guard, orc …) with seeded variation per figure, so a gang of five bandits shows five different faces.
 */

export const FIGURE_PARTS = {
  body: ['human', 'dwarf', 'elf', 'halfling', 'gnome', 'orc', 'goblin', 'tiefling', 'dragonborn', 'lizardfolk', 'skeleton', 'zombie', 'ogre'],
  build: ['average', 'slim', 'stocky', 'broad', 'heavy'],
  head: ['round', 'square', 'oval', 'long', 'wide', 'pointed'],
  eyes: ['dots', 'wide', 'narrow', 'angry', 'sleepy', 'happy', 'glowing', 'patch', 'scarred', 'closed', 'hollow'],
  brows: ['none', 'thin', 'thick', 'angry', 'worried', 'bushy'],
  mouth: ['none', 'smile', 'flat', 'frown', 'open', 'grin', 'tusks', 'fangs'],
  nose: ['button', 'pointy', 'broad', 'hooked', 'none'],
  ears: ['normal', 'pointed', 'long', 'big', 'none'],
  hair: ['none', 'buzz', 'short', 'messy', 'spiky', 'mohawk', 'bob', 'long', 'ponytail', 'bun', 'topknot', 'braids', 'curly', 'wild', 'sidecut', 'pigtails'],
  beard: ['none', 'stubble', 'moustache', 'handlebar', 'goatee', 'chin', 'full', 'long', 'forked', 'braided', 'mutton'],
  hat: ['none', 'hood', 'cowl', 'wizard', 'cap', 'bandana', 'headband', 'helmet', 'greathelm', 'horned', 'crown', 'circlet', 'tricorn', 'feathercap', 'strawhat', 'turban', 'skullcap', 'antlers', 'mask'],
  horns: ['none', 'small', 'curled', 'ram', 'long'],
  torso: ['tunic', 'shirt', 'vest', 'robe', 'cultrobe', 'leather', 'studded', 'chain', 'scale', 'plate', 'rags', 'apron', 'coat', 'dress', 'furs', 'bare'],
  shoulders: ['none', 'pads', 'spiked', 'fur', 'plate'],
  belt: ['none', 'belt', 'sash', 'pouches', 'rope'],
  legs: ['trousers', 'shorts', 'skirt', 'robe', 'greaves', 'kilt', 'rags'],
  boots: ['boots', 'tall', 'sandals', 'bare', 'armored', 'wraps'],
  cloak: ['none', 'short', 'long', 'tattered', 'fur', 'cape', 'mantle'],
  back: ['none', 'backpack', 'quiver', 'bedroll', 'banner', 'scabbard', 'wings'],
  main: ['none', 'sword', 'longsword', 'greatsword', 'axe', 'greataxe', 'mace', 'hammer', 'warhammer', 'spear', 'halberd', 'dagger', 'scimitar', 'club', 'staff', 'wand', 'bow', 'crossbow', 'torch', 'pick', 'scythe', 'flail', 'trident', 'lute', 'sickle', 'whip'],
  off: ['none', 'roundshield', 'kiteshield', 'towershield', 'buckler', 'dagger', 'book', 'lantern', 'orb', 'torch', 'holy', 'potion', 'handaxe', 'skull'],
  extra: ['none', 'necklace', 'scarf', 'amulet', 'earring', 'monocle', 'pipe', 'warpaint', 'tattoos', 'scar', 'freckles', 'blush'],
} as const;

export type FigurePartKey = keyof typeof FIGURE_PARTS;
type PartValue<K extends FigurePartKey> = (typeof FIGURE_PARTS)[K][number];

export const FIGURE_COLOURS = ['skin', 'hairColor', 'primary', 'secondary', 'leather', 'metal', 'eyeColor'] as const;
export type FigureColourKey = (typeof FIGURE_COLOURS)[number];

export type FigureLook = { [K in FigurePartKey]: PartValue<K> } & { [K in FigureColourKey]: string } & { tail?: boolean };

/** Colour palettes offered in the editor (any #rrggbb is valid). */
export const SKIN_TONES = ['#f6d7b8', '#eebf94', '#d9a06e', '#b97b4c', '#8d5a36', '#5e3b23', '#3e2716', '#9fb37a', '#6f8f4e', '#4f6b3a', '#b9585a', '#8e3b44', '#7d8fa3', '#c9c1b0', '#a0b8a8', '#d8c48a'];
export const HAIR_COLOURS = ['#1d1612', '#3b2516', '#6b4224', '#9a6a35', '#c79a55', '#e8cf8f', '#f2ecdc', '#8a8a8a', '#a33a22', '#d4602b', '#5a2a6e', '#2d4f8f', '#2f6b3a', '#c0c0c0', '#7a1f1f'];
export const CLOTH_COLOURS = ['#7a1f1f', '#b3261e', '#d4602b', '#d8b25a', '#e8d4a6', '#5c7a2a', '#2f6b3a', '#1f5a5a', '#2d4f8f', '#1f2f5a', '#5a2a6e', '#8e3b8e', '#3a2a1a', '#6b4a2b', '#8a8a8a', '#2a2a2a', '#f2ecdc', '#141210'];
export const METAL_COLOURS = ['#c8ccd2', '#9aa0a8', '#6b6f75', '#d8b25a', '#b87333', '#3a3d42', '#e8e8f0'];
export const EYE_COLOURS = ['#141210', '#3b5a8f', '#2f6b3a', '#6b4224', '#d8b25a', '#b3261e', '#7fd6ff', '#c97fff'];

export const DEFAULT_LOOK: FigureLook = {
  body: 'human', build: 'average', head: 'round', eyes: 'dots', brows: 'thin', mouth: 'smile', nose: 'button', ears: 'normal',
  hair: 'short', beard: 'none', hat: 'none', horns: 'none', torso: 'tunic', shoulders: 'none', belt: 'belt', legs: 'trousers', boots: 'boots',
  cloak: 'none', back: 'none', main: 'sword', off: 'none', extra: 'none',
  skin: '#eebf94', hairColor: '#6b4224', primary: '#2d4f8f', secondary: '#e8d4a6', leather: '#6b4a2b', metal: '#c8ccd2', eyeColor: '#141210',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Validates a look from the client: every part from the catalogue, every colour #rrggbb. Unknown keys are dropped. */
export function parseLook(v: unknown): FigureLook | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(FIGURE_PARTS) as FigurePartKey[]) {
    const val = o[k] ?? DEFAULT_LOOK[k];
    if (!(FIGURE_PARTS[k] as readonly string[]).includes(val as string)) return null;
    out[k] = val;
  }
  for (const k of FIGURE_COLOURS) {
    const val = o[k] ?? DEFAULT_LOOK[k];
    if (typeof val !== 'string' || !HEX.test(val)) return null;
    out[k] = val.toLowerCase();
  }
  if (o.tail !== undefined) { if (typeof o.tail !== 'boolean') return null; if (o.tail) out.tail = true; }
  return out as FigureLook;
}

export interface FigurePreset { id: string; label: string; group: 'hero' | 'npc' | 'monster'; look: Partial<FigureLook>; /** Parts the variation may swap (per figure). */ vary?: Partial<{ [K in FigurePartKey]: ReadonlyArray<PartValue<K>> }>; colours?: Partial<Record<FigureColourKey, readonly string[]>>; match?: RegExp }

const humanVary = { hair: ['short', 'messy', 'buzz', 'long', 'ponytail', 'bun', 'curly', 'none', 'sidecut', 'braids'], beard: ['none', 'none', 'stubble', 'moustache', 'goatee', 'full', 'chin'], eyes: ['dots', 'narrow', 'angry', 'wide', 'scarred'], brows: ['thin', 'thick', 'angry', 'bushy'], head: ['round', 'square', 'oval', 'long'], nose: ['button', 'pointy', 'broad', 'hooked'] } as const;
const anyHuman = { skin: SKIN_TONES.slice(0, 7), hairColor: HAIR_COLOURS.slice(0, 9) };

export const FIGURE_PRESETS: FigurePreset[] = [
  // heroes (starting points for players)
  { id: 'fighter', label: 'Fighter', group: 'hero', look: { torso: 'chain', shoulders: 'pads', main: 'longsword', off: 'kiteshield', legs: 'greaves', boots: 'armored', primary: '#2d4f8f', secondary: '#d8b25a', beard: 'stubble' } },
  { id: 'barbarian', label: 'Barbarian', group: 'hero', look: { build: 'broad', torso: 'furs', shoulders: 'fur', hair: 'wild', beard: 'braided', main: 'greataxe', legs: 'kilt', boots: 'wraps', extra: 'warpaint', primary: '#6b4a2b', secondary: '#7a1f1f', cloak: 'fur' } },
  { id: 'wizard', label: 'Wizard', group: 'hero', look: { torso: 'robe', legs: 'robe', hat: 'wizard', beard: 'long', main: 'staff', off: 'book', primary: '#2d4f8f', secondary: '#d8b25a', hairColor: '#f2ecdc', build: 'slim', belt: 'sash' } },
  { id: 'sorcerer', label: 'Sorcerer', group: 'hero', look: { torso: 'coat', hair: 'spiky', main: 'wand', off: 'orb', primary: '#5a2a6e', secondary: '#d8b25a', eyes: 'glowing', eyeColor: '#c97fff', cloak: 'mantle' } },
  { id: 'warlock', label: 'Warlock', group: 'hero', look: { body: 'tiefling', horns: 'curled', tail: true, skin: '#b9585a', torso: 'coat', main: 'wand', off: 'skull', primary: '#141210', secondary: '#7a1f1f', cloak: 'long', eyes: 'glowing', eyeColor: '#d8b25a' } },
  { id: 'rogue', label: 'Rogue', group: 'hero', look: { torso: 'leather', hat: 'hood', cloak: 'short', main: 'dagger', off: 'dagger', primary: '#2a2a2a', secondary: '#5c7a2a', belt: 'pouches', build: 'slim', extra: 'scarf' } },
  { id: 'ranger', label: 'Ranger', group: 'hero', look: { body: 'elf', ears: 'pointed', torso: 'leather', cloak: 'long', hat: 'hood', main: 'bow', back: 'quiver', primary: '#2f6b3a', secondary: '#6b4a2b', hair: 'long', hairColor: '#e8cf8f' } },
  { id: 'cleric', label: 'Cleric', group: 'hero', look: { torso: 'scale', main: 'mace', off: 'holy', primary: '#f2ecdc', secondary: '#d8b25a', extra: 'amulet', hair: 'short', beard: 'full' } },
  { id: 'paladin', label: 'Paladin', group: 'hero', look: { torso: 'plate', shoulders: 'plate', legs: 'greaves', boots: 'armored', hat: 'helmet', main: 'longsword', off: 'towershield', cloak: 'cape', primary: '#f2ecdc', secondary: '#d8b25a', metal: '#e8e8f0' } },
  { id: 'druid', label: 'Druid', group: 'hero', look: { torso: 'robe', legs: 'robe', hat: 'antlers', main: 'staff', off: 'none', primary: '#5c7a2a', secondary: '#6b4a2b', hair: 'braids', extra: 'necklace', boots: 'wraps', cloak: 'tattered' } },
  { id: 'bard', label: 'Bard', group: 'hero', look: { body: 'halfling', torso: 'vest', hat: 'feathercap', main: 'lute', off: 'none', primary: '#b3261e', secondary: '#d8b25a', hair: 'curly', extra: 'blush', cloak: 'cape' } },
  { id: 'monk', label: 'Monk', group: 'hero', look: { torso: 'robe', legs: 'trousers', boots: 'sandals', hair: 'none', belt: 'sash', main: 'staff', primary: '#d4602b', secondary: '#d8b25a', extra: 'none' } },
  { id: 'dwarf-hero', label: 'Dwarf warrior', group: 'hero', look: { body: 'dwarf', build: 'stocky', beard: 'braided', hat: 'horned', torso: 'chain', main: 'warhammer', off: 'roundshield', primary: '#7a1f1f', hairColor: '#a33a22' } },
  { id: 'gnome-tinker', label: 'Gnome tinker', group: 'hero', look: { body: 'gnome', ears: 'big', hair: 'wild', hairColor: '#d4602b', torso: 'apron', main: 'hammer', off: 'lantern', extra: 'monocle', back: 'backpack', primary: '#6b4a2b', secondary: '#1f5a5a' } },
  { id: 'dragonborn-hero', label: 'Dragonborn knight', group: 'hero', look: { body: 'dragonborn', skin: '#b9585a', tail: true, torso: 'scale', main: 'greatsword', shoulders: 'spiked', primary: '#1f2f5a', secondary: '#d8b25a', hair: 'none', horns: 'long' } },
  // NPCs (humanoid enemies and townsfolk) – `match` maps an enemy's name/type to its preset
  { id: 'bandit', label: 'Bandit', group: 'npc', match: /bandit|brigand|outlaw|highway/i, look: { torso: 'leather', hat: 'bandana', main: 'scimitar', off: 'none', primary: '#6b4a2b', secondary: '#7a1f1f', belt: 'pouches', extra: 'scar', mouth: 'grin' }, vary: { ...humanVary, hat: ['bandana', 'hood', 'none', 'cap', 'mask'], main: ['scimitar', 'dagger', 'club', 'axe', 'sword', 'crossbow'], off: ['none', 'none', 'dagger', 'buckler'], torso: ['leather', 'vest', 'rags', 'studded'], cloak: ['none', 'tattered', 'short'] }, colours: { ...anyHuman, primary: ['#6b4a2b', '#3a2a1a', '#5c7a2a', '#2a2a2a', '#8a8a8a'], secondary: ['#7a1f1f', '#d4602b', '#1f5a5a', '#e8d4a6'] } },
  { id: 'bandit-captain', label: 'Bandit captain', group: 'npc', match: /captain|chief|boss/i, look: { torso: 'studded', hat: 'tricorn', main: 'scimitar', off: 'dagger', cloak: 'long', primary: '#3a2a1a', secondary: '#b3261e', beard: 'handlebar', extra: 'earring', belt: 'sash', shoulders: 'pads' } },
  { id: 'thug', label: 'Thug', group: 'npc', match: /thug|bruiser|enforcer/i, look: { build: 'broad', torso: 'vest', hair: 'buzz', main: 'club', off: 'none', primary: '#3a2a1a', secondary: '#8a8a8a', extra: 'tattoos', brows: 'angry', mouth: 'frown' }, vary: { ...humanVary, main: ['club', 'mace', 'flail', 'hammer'], hair: ['buzz', 'none', 'mohawk', 'short'] }, colours: anyHuman },
  { id: 'cultist', label: 'Cultist', group: 'npc', match: /cult|acolyte|zealot/i, look: { torso: 'cultrobe', legs: 'robe', hat: 'cowl', main: 'sickle', off: 'none', primary: '#5a1515', secondary: '#141210', extra: 'amulet', eyes: 'hollow', mouth: 'flat' }, vary: { main: ['sickle', 'dagger', 'dagger', 'scythe', 'staff'], off: ['none', 'none', 'skull', 'book'], eyes: ['hollow', 'narrow', 'glowing', 'angry'] }, colours: { ...anyHuman, primary: ['#5a1515', '#3a0d0d', '#141210', '#2b1b3a'] } },
  { id: 'cult-fanatic', label: 'Cult fanatic', group: 'npc', match: /fanatic|priest of|high priest/i, look: { torso: 'cultrobe', legs: 'robe', hat: 'horned', main: 'staff', off: 'skull', primary: '#141210', secondary: '#7a1f1f', eyes: 'glowing', eyeColor: '#b3261e', cloak: 'long', extra: 'warpaint' } },
  { id: 'guard', label: 'Guard', group: 'npc', match: /guard|watch|soldier|militia|sentry/i, look: { torso: 'chain', hat: 'helmet', main: 'spear', off: 'roundshield', primary: '#1f2f5a', secondary: '#d8b25a', legs: 'trousers', boots: 'tall', shoulders: 'pads' }, vary: { ...humanVary, main: ['spear', 'spear', 'halberd', 'sword'], beard: ['none', 'moustache', 'stubble', 'full'] }, colours: anyHuman },
  { id: 'knight', label: 'Knight', group: 'npc', match: /knight|veteran|champion/i, look: { torso: 'plate', shoulders: 'plate', legs: 'greaves', boots: 'armored', hat: 'greathelm', main: 'longsword', off: 'kiteshield', cloak: 'cape', primary: '#7a1f1f', secondary: '#d8b25a' } },
  { id: 'archer', label: 'Archer', group: 'npc', match: /archer|scout|hunter|sharpshoot/i, look: { torso: 'leather', hat: 'hood', main: 'bow', back: 'quiver', cloak: 'short', primary: '#2f6b3a', secondary: '#6b4a2b' }, vary: { ...humanVary, hat: ['hood', 'none', 'feathercap', 'cap'], main: ['bow', 'bow', 'crossbow'] }, colours: anyHuman },
  { id: 'mage', label: 'Mage', group: 'npc', match: /mage|wizard|sorcer|warlock|apprentice|necromancer/i, look: { torso: 'robe', legs: 'robe', hat: 'wizard', main: 'staff', off: 'orb', primary: '#1f2f5a', secondary: '#c0c0c0', beard: 'long', eyes: 'glowing', eyeColor: '#7fd6ff' } },
  { id: 'priest', label: 'Priest', group: 'npc', match: /priest|cleric|monk|abbot/i, look: { torso: 'robe', legs: 'robe', hair: 'none', main: 'mace', off: 'holy', primary: '#f2ecdc', secondary: '#d8b25a', extra: 'amulet' } },
  { id: 'pirate', label: 'Pirate', group: 'npc', match: /pirate|sailor|corsair|buccaneer/i, look: { torso: 'shirt', hat: 'tricorn', main: 'scimitar', off: 'none', eyes: 'patch', beard: 'full', primary: '#f2ecdc', secondary: '#b3261e', belt: 'sash', boots: 'tall', extra: 'earring' }, vary: { ...humanVary, hat: ['tricorn', 'bandana', 'headband'], eyes: ['patch', 'dots', 'narrow', 'scarred'] }, colours: anyHuman },
  { id: 'villager', label: 'Villager', group: 'npc', match: /villager|commoner|peasant|farmer|townsfolk/i, look: { torso: 'shirt', hat: 'strawhat', main: 'pick', off: 'none', primary: '#e8d4a6', secondary: '#6b4a2b', belt: 'rope', legs: 'trousers' }, vary: { ...humanVary, hat: ['strawhat', 'none', 'cap', 'none'], main: ['pick', 'none', 'sickle', 'club', 'torch'], torso: ['shirt', 'apron', 'tunic', 'dress'] }, colours: { ...anyHuman, primary: ['#e8d4a6', '#6b4a2b', '#5c7a2a', '#8a8a8a', '#d4602b'] } },
  { id: 'merchant', label: 'Merchant', group: 'npc', match: /merchant|trader|shopkeep/i, look: { build: 'heavy', torso: 'coat', hat: 'turban', main: 'none', off: 'potion', primary: '#5a2a6e', secondary: '#d8b25a', beard: 'goatee', extra: 'necklace', belt: 'pouches' } },
  { id: 'noble', label: 'Noble', group: 'npc', match: /noble|lord|lady|duke|baron/i, look: { torso: 'coat', hat: 'circlet', main: 'sword', off: 'none', cloak: 'mantle', primary: '#7a1f1f', secondary: '#d8b25a', extra: 'monocle', beard: 'moustache' } },
  { id: 'smith', label: 'Blacksmith', group: 'npc', match: /smith|forge/i, look: { build: 'broad', torso: 'apron', main: 'hammer', off: 'none', primary: '#3a2a1a', secondary: '#6b4a2b', hair: 'buzz', beard: 'full', shoulders: 'none' } },
  // monsters (humanoid ones the kit can show)
  { id: 'orc', label: 'Orc warrior', group: 'monster', match: /orc/i, look: { body: 'orc', build: 'broad', skin: '#6f8f4e', torso: 'furs', shoulders: 'spiked', main: 'greataxe', off: 'none', mouth: 'tusks', hair: 'mohawk', hairColor: '#1d1612', primary: '#3a2a1a', secondary: '#7a1f1f', extra: 'warpaint', ears: 'pointed', eyes: 'angry' }, vary: { main: ['greataxe', 'axe', 'spear', 'club', 'warhammer'], off: ['none', 'roundshield', 'none'], hair: ['mohawk', 'topknot', 'none', 'wild'], torso: ['furs', 'leather', 'bare', 'studded'] }, colours: { skin: ['#6f8f4e', '#4f6b3a', '#7d8f6a', '#5a7a4a', '#8a9a6a'] } },
  { id: 'goblin', label: 'Goblin', group: 'monster', match: /goblin|kobold|hobgoblin/i, look: { body: 'goblin', skin: '#9fb37a', ears: 'big', torso: 'rags', legs: 'shorts', boots: 'bare', main: 'scimitar', off: 'buckler', mouth: 'fangs', hair: 'none', primary: '#6b4a2b', secondary: '#5c7a2a', eyes: 'wide', eyeColor: '#d8b25a' }, vary: { main: ['scimitar', 'dagger', 'spear', 'bow', 'club'], off: ['buckler', 'none', 'none', 'torch'], hat: ['none', 'skullcap', 'helmet', 'none'] }, colours: { skin: ['#9fb37a', '#6f8f4e', '#a0b8a8', '#b9a06a'] } },
  { id: 'skeleton', label: 'Skeleton', group: 'monster', match: /skeleton/i, look: { body: 'skeleton', skin: '#e8e2cc', torso: 'bare', legs: 'rags', boots: 'bare', hair: 'none', main: 'sword', off: 'roundshield', eyes: 'glowing', eyeColor: '#7fd6ff', mouth: 'fangs', nose: 'none', ears: 'none', brows: 'none' }, vary: { main: ['sword', 'spear', 'axe', 'bow', 'mace'], off: ['roundshield', 'none', 'buckler'], hat: ['none', 'helmet', 'none'] } },
  { id: 'zombie', label: 'Zombie', group: 'monster', match: /zombie|ghoul|ghast|wight/i, look: { body: 'zombie', skin: '#a0b8a8', torso: 'rags', legs: 'rags', boots: 'bare', hair: 'messy', main: 'none', off: 'none', eyes: 'hollow', mouth: 'open', primary: '#5a5a4a', secondary: '#3a2a1a', extra: 'scar' }, vary: { hair: ['messy', 'none', 'long', 'wild'], torso: ['rags', 'shirt', 'tunic'] } },
  { id: 'ogre', label: 'Ogre', group: 'monster', match: /ogre|troll|giant/i, look: { body: 'ogre', build: 'heavy', skin: '#b9a06a', torso: 'furs', legs: 'kilt', boots: 'bare', main: 'club', off: 'none', mouth: 'tusks', hair: 'none', eyes: 'narrow' } },
  { id: 'lizardfolk', label: 'Lizardfolk', group: 'monster', match: /lizard|troglodyte|yuan/i, look: { body: 'lizardfolk', skin: '#4f6b3a', tail: true, torso: 'bare', main: 'trident', off: 'roundshield', hair: 'none', ears: 'none', primary: '#6b4a2b', extra: 'necklace' } },
];

const rng = (seed: number) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
export const hashText = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Preset + seeded variation: a different face, hair and gear per figure, same every time for the same seed. */
export function lookFromPreset(preset: FigurePreset, seed: number): FigureLook {
  const r = rng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const look: FigureLook = { ...DEFAULT_LOOK, ...preset.look };
  for (const [k, list] of Object.entries(preset.vary ?? {})) if (list?.length) (look as Record<string, unknown>)[k] = pick(list as readonly string[]);
  for (const [k, list] of Object.entries(preset.colours ?? {})) if (list?.length) (look as Record<string, unknown>)[k] = pick(list);
  return look;
}

/** Auto look for a humanoid enemy without a chosen one (null: no preset fits – the old miniature is used). */
export function autoLook(nameAndType: string, seed: string, colour?: string): FigureLook | null {
  const preset = FIGURE_PRESETS.find((p) => p.match?.test(nameAndType));
  if (!preset) return null;
  const look = lookFromPreset(preset, hashText(seed));
  return colour && HEX.test(colour) && preset.group === 'npc' && !preset.colours?.primary ? { ...look, secondary: colour.toLowerCase() } : look;
}

/** A completely random look (the editor's dice button). */
export function randomLook(seed: number, heroOnly = true): FigureLook {
  const r = rng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const base = pick(FIGURE_PRESETS.filter((p) => !heroOnly || p.group !== 'monster'));
  const look = base.group === 'monster' ? lookFromPreset(base, seed) : lookFromPreset({ ...base, vary: { ...humanVary, ...base.vary }, colours: { ...anyHuman, ...base.colours } }, seed);
  look.primary = pick(CLOTH_COLOURS); look.secondary = pick(CLOTH_COLOURS);
  if (r() < 0.25) look.cloak = pick(FIGURE_PARTS.cloak);
  if (r() < 0.3) look.hat = pick(FIGURE_PARTS.hat);
  return look;
}

/** Labels for the editor. */
export const PART_LABELS: Record<FigurePartKey, string> = {
  body: 'Ancestry', build: 'Build', head: 'Head shape', eyes: 'Eyes', brows: 'Brows', mouth: 'Mouth', nose: 'Nose', ears: 'Ears', hair: 'Hair', beard: 'Beard', hat: 'Headwear', horns: 'Horns',
  torso: 'Torso', shoulders: 'Shoulders', belt: 'Belt', legs: 'Legs', boots: 'Feet', cloak: 'Cloak', back: 'On the back', main: 'Main hand', off: 'Off hand', extra: 'Detail',
};
export const COLOUR_LABELS: Record<FigureColourKey, string> = { skin: 'Skin', hairColor: 'Hair', primary: 'Main colour', secondary: 'Trim', leather: 'Leather', metal: 'Metal', eyeColor: 'Eyes' };
export const partLabel = (v: string) => v.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
