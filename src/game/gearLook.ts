/**
 * APEX 2.9 – the 3D figure in the gear the character really wears. The Appearance tab stays the baseline (body,
 * face, hair, colours, clothes); with "show equipped gear" on, armour, helmet, boots, cloak, weapons and shield come
 * from the equipped items of the active weapon set instead. Pure: used by the server (the figure others see on the
 * map) and the inventory's 3D view.
 */
import { DEFAULT_LOOK, type FigureLook } from './figure.js';
import type { EquipSlot, ItemEquip } from './equipment.js';

type Worn = { slot: EquipSlot; item: { name: string; baseId?: string; equip?: ItemEquip }; active?: boolean };
const CLOTHES: ReadonlyArray<FigureLook['torso']> = ['tunic', 'shirt', 'vest', 'robe', 'cultrobe', 'coat', 'dress', 'rags', 'apron', 'bare'];
const text = (w: Worn) => `${w.item.name} ${w.item.baseId ?? ''}`.toLowerCase().replace(/[-_]/g, ' ');

const WEAPONS: Array<[RegExp, FigureLook['main']]> = [
  [/greatsword|zweihänder|claymore/, 'greatsword'], [/longsword|bastard/, 'longsword'], [/scimitar|sabre|saber|falchion|cutlass/, 'scimitar'], [/rapier|shortsword|short sword|\bsword/, 'sword'],
  [/greataxe/, 'greataxe'], [/battleaxe|battle axe|handaxe|hand axe|\baxe/, 'axe'], [/maul|warhammer|war hammer/, 'warhammer'], [/light hammer|\bhammer/, 'hammer'],
  [/morningstar|\bmace/, 'mace'], [/flail/, 'flail'], [/halberd|glaive|poleaxe/, 'halberd'], [/spear|pike|lance|javelin/, 'spear'], [/trident/, 'trident'],
  [/dagger|knife|dirk|stiletto/, 'dagger'], [/greatclub|\bclub|cudgel/, 'club'], [/quarterstaff|\bstaff/, 'staff'], [/wand|rod\b/, 'wand'],
  [/crossbow/, 'crossbow'], [/longbow|shortbow|\bbow/, 'bow'], [/whip/, 'whip'], [/sickle/, 'sickle'], [/scythe/, 'scythe'], [/war pick|\bpick/, 'pick'], [/torch/, 'torch'], [/lute|lyre|flute|drum/, 'lute'],
];
const OFF: Array<[RegExp, FigureLook['off']]> = [
  [/tower shield|pavise/, 'towershield'], [/kite shield|heater/, 'kiteshield'], [/buckler/, 'buckler'], [/shield/, 'roundshield'],
  [/orb|crystal|sphere/, 'orb'], [/holy symbol|reliquary|amulet of faith|emblem/, 'holy'], [/book|tome|grimoire|spellbook/, 'book'], [/lantern/, 'lantern'], [/torch/, 'torch'], [/handaxe|hand axe/, 'handaxe'], [/dagger|knife/, 'dagger'], [/potion/, 'potion'], [/skull/, 'skull'],
];

/** The look with the worn gear (active slots only). `worn`: wornItems(token). */
export function gearLook(base: FigureLook | undefined, worn: Worn[]): FigureLook {
  const look: FigureLook = { ...DEFAULT_LOOK, ...(base ?? {}) };
  const active = worn.filter((w) => w.active !== false);
  const at = (s: EquipSlot | EquipSlot[]) => active.find((w) => (Array.isArray(s) ? s : [s]).includes(w.slot));
  // clothes stay, armour and weapons come from the equipment
  if (!CLOTHES.includes(look.torso)) look.torso = 'tunic';
  if (look.legs === 'greaves') look.legs = 'trousers';
  if (look.boots === 'armored') look.boots = 'boots';
  if (['helmet', 'greathelm', 'horned'].includes(look.hat)) look.hat = 'none';
  if (look.shoulders === 'plate' || look.shoulders === 'pads' || look.shoulders === 'spiked') look.shoulders = 'none';
  look.main = 'none'; look.off = 'none';
  if (look.back === 'quiver' || look.back === 'scabbard') look.back = 'none';

  const chest = at('chest');
  if (chest) {
    const t = text(chest), type = chest.item.equip?.armorType;
    const set = (torso: FigureLook['torso'], shoulders: FigureLook['shoulders'] = look.shoulders, heavy = false) => { look.torso = torso; look.shoulders = shoulders; if (heavy) { look.legs = 'greaves'; look.boots = 'armored'; } };
    if (/full plate|half plate|\bplate/.test(t)) set('plate', 'plate', true);
    else if (/splint|banded/.test(t)) set('plate', 'pads', true);
    else if (/breastplate|cuirass/.test(t)) set('plate');
    else if (/chain mail|ring mail|hauberk|ringed/.test(t)) set('chain', 'pads', true);
    else if (/chain shirt|mail shirt/.test(t)) set('chain');
    else if (/scale|lamellar|brigandine/.test(t)) set('scale', 'pads');
    else if (/studded/.test(t)) set('studded');
    else if (/hide|fur|pelt/.test(t)) set('furs', 'fur');
    else if (/robe|vestment/.test(t)) { look.torso = 'robe'; look.legs = 'robe'; }
    else if (/leather|jerkin/.test(t)) set('leather');
    else if (/padded|quilted|gambeson/.test(t)) set('vest');
    else if (type === 'heavy') set('plate', 'plate', true);
    else if (type === 'medium') set('scale', 'pads');
    else if (type === 'light') set('leather');
  }
  const head = at('head');
  if (head) {
    const t = text(head);
    look.hat = /great ?helm|full helm|closed helm/.test(t) ? 'greathelm' : /horn/.test(t) ? 'horned' : /hood|cowl/.test(t) ? 'hood' : /crown/.test(t) ? 'crown' : /circlet|tiara|diadem/.test(t) ? 'circlet' : /mask/.test(t) ? 'mask' : /bandana|headband/.test(t) ? 'headband' : /hat/.test(t) ? 'feathercap' : /cap/.test(t) ? 'cap' : 'helmet';
  }
  const boots = at('boots');
  if (boots) look.boots = /sabaton|greave|plate|iron|steel/.test(text(boots)) || boots.item.equip?.armorType === 'heavy' ? 'armored' : /sandal/.test(text(boots)) ? 'sandals' : 'tall';
  const cloak = at('cloak');
  if (cloak) { const t = text(cloak); look.cloak = /cape/.test(t) ? 'cape' : /fur/.test(t) ? 'fur' : /mantle/.test(t) ? 'mantle' : /tatter|rag/.test(t) ? 'tattered' : /short/.test(t) ? 'short' : 'long'; }
  const main = at(['main1', 'main2']);
  if (main) { const t = text(main); look.main = WEAPONS.find(([re]) => re.test(t))?.[1] ?? (main.item.equip?.properties?.includes('ranged') ? 'bow' : 'sword'); }
  const off = at(['off1', 'off2']);
  if (off) { const t = text(off); look.off = OFF.find(([re]) => re.test(t))?.[1] ?? (off.item.equip?.kind === 'shield' ? 'roundshield' : 'dagger'); }
  if (main && main.item.equip?.properties?.includes('two-handed')) look.off = 'none';
  if ((look.main === 'bow' || look.main === 'crossbow') && look.back === 'none') look.back = 'quiver';
  return look;
}
