/** Small icons for conditions, buffs and concentration on battle-map figures (APEX 1.6). */
const ICONS: Record<string, string> = {
  blinded: '🙈', charmed: '💖', deafened: '🔇', frightened: '😱', grappled: '✊', incapacitated: '✖', invisible: '👻',
  paralyzed: '⚡', petrified: '🗿', poisoned: '☠', prone: '⤓', restrained: '⛓', stunned: '💫', unconscious: '💤',
  hidden: '🥷', dodge: '🌀', bless: '✨', bane: '🌑', shield: '🛡', 'shield-of-faith': '🔰', 'mage-armor': '🔷', barkskin: '🌳',
  longstrider: '👣', haste: '⏩', stoneskin: '🪨', 'divine-favor': '☀', 'armor-of-agathys': '❄', heroism: '🦁', aid: '➕',
  rage: '😤', inspired: '🎵', 'hunters-mark': '🎯', hex: '🔮', 'faerie-fire': '🧚', blur: '〰', 'wild-shape': '🐾', shillelagh: '🪵', fly: '🪽',
};
export const CONCENTRATION_ICON = '◎';
export const effectIcon = (key: string) => ICONS[key] ?? (key.startsWith('buff-') ? '⬆' : '•');
export function figureIcons(effects: Array<{ key: string; name: string }> | undefined, concentration?: string): Array<{ icon: string; name: string; tone: 'conc' | 'bad' | 'good' }> {
  const bad = new Set(['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'bane', 'hunters-mark', 'hex', 'faerie-fire']);
  return [
    ...(concentration ? [{ icon: CONCENTRATION_ICON, name: `Concentrating: ${concentration}`, tone: 'conc' as const }] : []),
    ...(effects ?? []).map((e) => ({ icon: effectIcon(e.key), name: e.name, tone: bad.has(e.key) ? ('bad' as const) : ('good' as const) })),
  ];
}

/** Beast form → an icon for the druid's figure in Wild Shape. */
export function beastIcon(name: string): string {
  const n = name.toLowerCase();
  const table: Array<[RegExp, string]> = [[/wolf|dog|mastiff|jackal/, '🐺'], [/bear/, '🐻'], [/cat|panther|lion|tiger|leopard/, '🐈'], [/spider/, '🕷'], [/owl/, '🦉'], [/eagle|hawk|raven|vulture|bird|falcon/, '🦅'], [/boar|pig/, '🐗'], [/rat/, '🐀'], [/snake|serpent|constrictor/, '🐍'], [/horse|pony/, '🐎'], [/frog|toad/, '🐸'], [/deer|elk/, '🦌'], [/ape|baboon/, '🦍'], [/crocodile|lizard/, '🐊'], [/shark/, '🦈'], [/bat/, '🦇'], [/fish|piranha|quipper/, '🐟'], [/crab/, '🦀'], [/goat/, '🐐'], [/badger|weasel/, '🦡'], [/octopus/, '🐙'], [/scorpion/, '🦂'], [/mule|camel/, '🐪']];
  return table.find(([re]) => re.test(n))?.[1] ?? '🐾';
}
/** APEX 2.9 – morale marks on enemies: fleeing and surrendered for everyone, shaken for the GM. */
export function moraleIcons(m: 'shaken' | 'broken' | 'surrendered' | undefined): Array<{ icon: string; name: string; tone: 'conc' | 'bad' | 'good' }> {
  if (m === 'surrendered') return [{ icon: '🏳', name: 'Surrendered', tone: 'good' }];
  if (m === 'broken') return [{ icon: '🏃', name: 'Broken – flees in panic', tone: 'bad' }];
  if (m === 'shaken') return [{ icon: '😟', name: 'Shaken (combat fatigue)', tone: 'bad' }];
  return [];
}
/**
 * APEX 2.9 – a picture symbol for any creature (map tokens, target chips): like the druid's wild-shape icon, for
 * goblins, cultists, spiders, dragons … instead of two letters. `fallback`: the stat block's own icon.
 */
export function creatureEmoji(text: string, fallback?: string): string {
  const n = ` ${text.toLowerCase()} `;
  const table: Array<[RegExp, string]> = [
    [/skeleton|bone/, '💀'], [/zombie|ghoul|ghast|mummy|wight/, '🧟'], [/ghost|specter|wraith|banshee|shadow|will-o/, '👻'], [/vampire/, '🧛'], [/lich|necromancer/, '☠'],
    [/dragon|drake|wyrm/, '🐉'], [/wyvern|pseudodragon/, '🐲'], [/demon|devil|fiend|vrock|imp\b|quasit|hell hound|nightmare/, '😈'],
    [/goblin|hobgoblin|bugbear|kobold/, '👺'], [/orc\b|ogre|troll|ettin|gnoll|giant\b|hill giant|frost giant|fire giant|minotaur|yeti/, '👹'],
    [/cult|fanatic|acolyte|priest|cleric|shaman/, '🕯'], [/mage|wizard|sorcer|warlock|witch|druid/, '🧙'], [/bandit|thug|pirate|brigand|assassin|spy|outlaw/, '🗡'],
    [/guard|soldier|knight|veteran|gladiator|captain|militia/, '🛡'], [/archer|scout|hunter/, '🏹'], [/noble|merchant|commoner|villager|peasant/, '🧑'], [/berserker/, '🪓'], [/lizardfolk/, '🦎'],
    [/beholder|gazer|spectator/, '👁'], [/kraken|octopus|squid|aboleth/, '🦑'], [/mimic/, '📦'], [/golem|gargoyle|animated|construct/, '🗿'], [/treant|tree|shambling/, '🌳'], [/myconid|mushroom/, '🍄'],
    [/fire elemental|magma|salamander/, '🔥'], [/water elemental/, '💧'], [/air elemental|wind/, '🌪'], [/earth elemental/, '🪨'], [/ooze|pudding|jelly|cube/, '🟢'],
    [/unicorn|pegasus/, '🦄'], [/owlbear/, '🦉'], [/griffon|hippogriff|roc\b/, '🦅'], [/hydra/, '🐉'], [/worm|centipede|carrion/, '🐛'], [/scorpion|ankheg/, '🦂'], [/elf/, '🧝'], [/dwarf/, '🧔'], [/fairy|sprite|pixie|fey/, '🧚'],
  ];
  const hit = table.find(([re]) => re.test(n))?.[1];
  if (hit) return hit;
  const beast = beastIcon(n);
  return beast !== '🐾' ? beast : /beast|monstrosity/.test(n) ? '🐾' : fallback ?? '⚔';
}
