/** Small icons for conditions, buffs and concentration on battle-map figures (APEX 1.6). */
const ICONS: Record<string, string> = {
  blinded: '🙈', charmed: '💖', deafened: '🔇', frightened: '😱', grappled: '✊', incapacitated: '✖', invisible: '👻',
  paralyzed: '⚡', petrified: '🗿', poisoned: '☠', prone: '⤓', restrained: '⛓', stunned: '💫', unconscious: '💤',
  hidden: '🥷', dodge: '🌀', bless: '✨', bane: '🌑', shield: '🛡', 'shield-of-faith': '🔰', 'mage-armor': '🔷', barkskin: '🌳',
  longstrider: '👣', haste: '⏩', stoneskin: '🪨', 'divine-favor': '☀', 'armor-of-agathys': '❄', heroism: '🦁', aid: '➕',
  rage: '😤', inspired: '🎵', 'hunters-mark': '🎯', hex: '🔮', 'faerie-fire': '🧚', blur: '〰', 'wild-shape': '🐾', shillelagh: '🪵',
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
