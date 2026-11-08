/**
 * APEX 1.0 – small original item icons (inline SVG, no external art). The glyph follows the base item (weapon
 * family, armour slot and weight class, jewellery …), the metal tint follows the weight class and the frame
 * follows the rarity, so different bases look different at a glance.
 */
import { baseItem } from '../../game/items/bases';
import type { Item } from '../../game/types';

type Glyph =
  | 'sword' | 'dagger' | 'axe' | 'hammer' | 'spear' | 'bow' | 'crossbow' | 'staff'
  | 'robe' | 'mail' | 'plate' | 'cap' | 'helm' | 'greathelm' | 'glove' | 'gauntlet' | 'shoe' | 'boot' | 'sabaton'
  | 'buckler' | 'shield' | 'tower' | 'ring' | 'amulet' | 'cloak' | 'belt' | 'potion' | 'gem' | 'coin' | 'key' | 'bag' | 'cube' | 'torch' | 'box';

const P: Record<Glyph, string> = {
  sword: 'M19 3l2 2-9 9 1.5 1.5-1.4 1.4-1.6-1.5L8 18l1 1-1.5 1.5-1-1L4 22l-2-2 2.5-2.5-1-1L5 15l1 1 2.5-2.5L7 12l1.4-1.4L10 12z',
  dagger: 'M17 3l3 1-1 3-7 7 1 1-1.4 1.4-1-1L7 18l-.5 2.5L4 21l.5-2.5L8 15l-1-1 1.4-1.4 1 1z',
  axe: 'M14 2c4 0 8 3 8 8l-6-1-2 2-1-1-9 10-2-2 10-9-1-1 2-2z',
  hammer: 'M9 2h8v6h-3v14h-2V8H9z',
  spear: 'M20 2l-1 6-2-1-12 12 1 1-2 2-2-2 2-2 1 1L17 7l-1-2z',
  bow: 'M5 2c8 2 15 9 17 17l-2 1C18 13 11 6 4 4zM4 4l16 16-1 1L3 5z',
  crossbow: 'M11 2h2v7h8v2h-8v11h-2V11H3V9h8zM5 7c2-2 4-3 7-3s5 1 7 3l-1 1c-2-2-4-2-6-2s-4 0-6 2z',
  staff: 'M17 2a3 3 0 1 1 0 6l-1-.2L5 19l1 1-2 2-2-2 2-2 1 1L15.2 8A3 3 0 0 1 17 2z',
  robe: 'M8 2h8l4 5-3 2v13H7V9L4 7zm2 2v4h4V4z',
  mail: 'M7 2h10l4 4-3 3v13H6V9L3 6zm1 6v2h2V8zm3 0v2h2V8zm3 0v2h2V8zm-6 4v2h2v-2zm3 0v2h2v-2zm3 0v2h2v-2z',
  plate: 'M6 2h12l3 3-2 4v13H5V9L3 5zm3 4v5h6V6zm-1 8v2h8v-2zm0 4v2h8v-2z',
  cap: 'M4 15c0-6 3-10 8-10s8 4 8 10H4zm-1 1h18v2H3z',
  helm: 'M4 14c0-6 3-11 8-11s8 5 8 11v6h-4v-5H8v5H4z',
  greathelm: 'M4 9c0-4 3-7 8-7s8 3 8 7v13H4zm3 4v2h10v-2zm4 3v5h2v-5z',
  glove: 'M7 22v-8L5 9l2-1 2 3V3h2v7h1V2h2v8h1V3h2v9l1-3h2l-2 7v6z',
  gauntlet: 'M6 22v-9L4 8l3-1 2 3V3h9v10l2-3 2 1-4 7v4zm4-15h6V5h-6z',
  shoe: 'M5 8h5v6l9 2c2 .5 3 2 3 4H3V10z',
  boot: 'M6 2h7v12l7 2c1 .5 2 2 2 4v2H4V8z',
  sabaton: 'M6 2h8v4H6zm0 5h8v3H6zm0 4h8v3l7 2c1 .5 1 2 1 3v2H4z',
  buckler: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  shield: 'M12 2l9 3v6c0 6-4 10-9 12-5-2-9-6-9-12V5zm0 3v15c3-1.5 6-4.5 6-9V7z',
  tower: 'M5 2h14v16l-7 4-7-4zm6 3v13h2V5z',
  ring: 'M12 7a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM9 2h6l-1 4h-4z',
  amulet: 'M5 2l7 9 7-9h2l-7 10a5 5 0 1 1-4 0L3 2zm7 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  cloak: 'M8 2h8l2 3 3 17h-7l-2-6-2 6H3L6 5zm2 2l2 3 2-3z',
  belt: 'M2 9h20v6H2zm8-1h5v8h-5zm1.5 2v4h2v-4z',
  potion: 'M9 2h6v2h-1v4l5 6a6 6 0 0 1-5 8h-4a6 6 0 0 1-5-8l5-6V4H9z',
  gem: 'M7 3h10l5 6-10 12L2 9zm1.5 2L5.5 9h13l-3-4z',
  coin: 'M12 3c5 0 9 2 9 5v8c0 3-4 5-9 5s-9-2-9-5V8c0-3 4-5 9-5zm0 2c-4 0-7 1.3-7 3s3 3 7 3 7-1.3 7-3-3-3-7-3z',
  key: 'M7 3a5 5 0 0 1 4.6 7H22v3h-2v3h-3v-3h-5.4A5 5 0 1 1 7 3zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  bag: 'M9 2h6l-1 3c4 2 7 6 7 10a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7c0-4 3-8 7-10z',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zm0 2.3L5.5 8 12 11.7 18.5 8z',
  torch: 'M12 2c2 2 4 4 4 6a4 4 0 0 1-8 0c0-2 2-4 4-6zm-2 11h4l-1 9h-2z',
  box: 'M3 6l9-4 9 4v12l-9 4-9-4zm9 0L6 8.5l6 2.5 6-2.5z',
};

function glyphFor(item: Pick<Item, 'baseId' | 'kind' | 'equip' | 'name'>): Glyph {
  const base = baseItem(item.baseId);
  const n = `${base?.name ?? item.name}`.toLowerCase();
  const sub = base?.subtype ?? '';
  const kind = item.equip?.kind;
  const w = item.equip?.armorType;
  if (kind === 'weapon' || base?.category === 'weapon') {
    if (/crossbow/.test(n)) return 'crossbow';
    if (/bow|sling/.test(n)) return 'bow';
    if (/dagger|dart|sickle/.test(n)) return 'dagger';
    if (/axe|halberd|glaive/.test(n)) return 'axe';
    if (/hammer|mace|maul|club|flail|morningstar|pick/.test(n)) return 'hammer';
    if (/spear|javelin|pike|trident|lance/.test(n)) return 'spear';
    if (/staff/.test(n)) return 'staff';
    return 'sword';
  }
  if (kind === 'shield' || base?.category === 'shield') return /buckler/.test(n) ? 'buckler' : /scutum|tower/.test(n) || sub.includes('tower') ? 'tower' : 'shield';
  if (kind === 'armor' || base?.category === 'armor') return w === 'heavy' ? 'plate' : w === 'medium' ? 'mail' : 'robe';
  if (kind === 'head' || base?.category === 'head') return w === 'heavy' ? 'greathelm' : w === 'medium' ? 'helm' : 'cap';
  if (kind === 'gloves' || base?.category === 'gloves') return w === 'heavy' || /gauntlet/.test(n) ? 'gauntlet' : 'glove';
  if (kind === 'boots' || base?.category === 'boots') return w === 'heavy' ? 'sabaton' : w === 'medium' ? 'boot' : 'shoe';
  if (kind === 'ring') return 'ring';
  if (kind === 'amulet') return 'amulet';
  if (kind === 'cloak') return 'cloak';
  if (kind === 'belt') return 'belt';
  if (kind === 'focus') return 'staff';
  if (base?.category === 'consumable' || /potion|elixir|flask/.test(n)) return 'potion';
  if (base?.category === 'material') return 'gem';
  if (base?.category === 'currency' || /coin|gold/.test(n)) return 'coin';
  if (base?.category === 'quest' || /key/.test(n)) return 'key';
  if (/cube/.test(n)) return 'cube';
  if (/bag|pouch|sack|pack/.test(n)) return 'bag';
  if (/torch|lantern|candle/.test(n)) return 'torch';
  return 'box';
}

const METAL: Record<string, string> = { light: '#c49a6c', medium: '#d4a95a', heavy: '#c9d1dc', none: '#d9cfb8' };
const FRAME: Record<string, string> = { normal: '#6b6f78', magic: '#5b8cff', rare: '#e8c547', unique: '#e0803a', none: '#3c4049' };

export function ItemIcon({ item, size = 28 }: { item: Pick<Item, 'baseId' | 'kind' | 'equip' | 'name' | 'rarity' | 'identified'>; size?: number }) {
  const g = glyphFor(item);
  const tint = item.equip?.armorType ? METAL[item.equip.armorType] : METAL.none;
  const frame = FRAME[item.rarity ?? 'none'];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md"
      style={{ width: size, height: size, background: 'radial-gradient(circle at 35% 30%, #2a2e36, #121418)', boxShadow: `inset 0 0 0 1.5px ${frame}` }}
      aria-hidden
      data-icon={g}
    >
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24">
        <path d={P[g]} fill={item.identified === false ? '#7a7f8a' : tint} fillRule="evenodd" />
      </svg>
    </span>
  );
}
