/**
 * APEX 2.12 – downtime between sessions. The GM ends the evening with “Activate downtime”:
 *  - On the road: the party makes camp. One shared camp scene is generated in the kind of land they stopped in (forest,
 *    desert, snow, swamp, shore, mountains, town …) – a sheltered spot with a campfire, tents and the cart. The players
 *    cannot reshape it: the night may bring an encounter, and the GM keeps every tool.
 *  - At home: an arc has ended. Every player travels to their own hideout – a place they pick from prefabs (beach,
 *    forest, desert, manor …) and shape themselves with the terrain editor; what they always want there (chest, cart,
 *    tent, bed …) stands next to where they arrive.
 * Each character has a chest at the hideout (the stash): long-term storage that is not carried, so an Obelisk death
 * cannot take it. The Obelisk opens during downtime (the GM may open it at any time).
 *
 * Pure: presets, the camp's land, stamping the keepsakes, stash moves.
 */
import type { Item, Token } from './types.js';
import type { HexPreset } from '../campaign/hexScene.js';
import { reconcileEquipment } from './equipment.js';
import { addToInventory } from './items/loot.js';

export type DowntimeMode = 'road' | 'home';
export interface Hideout { sceneId: string; preset: HexPreset; keep: Keepsake[]; name: string }
export interface DowntimeState {
  active: boolean;
  mode: DowntimeMode;
  since?: string;
  /** Where each player (user id) was before (back there afterwards; null = Sanctuary). */
  from: Record<string, string | null>;
  /** On the road: the shared camp. */
  campSceneId?: string;
  /** At home: every player's own hideout, kept between downtimes. */
  hideouts: Record<string, Hideout>;
}

export const HIDEOUT_PRESETS: Array<{ id: HexPreset; label: string }> = [
  { id: 'lakeshore', label: 'Lake shore' },
  { id: 'shipwreck', label: 'Beach' },
  { id: 'forest', label: 'Forest clearing' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'desert', label: 'Desert oasis' },
  { id: 'winter', label: 'Winter forest' },
  { id: 'highlands', label: 'Mountain pass' },
  { id: 'swamp', label: 'Swamp' },
  { id: 'farmstead', label: 'Farmstead' },
  { id: 'manor', label: 'Manor and garden' },
  { id: 'orchard', label: 'Walled orchard' },
  { id: 'temple', label: 'Temple ruin' },
  { id: 'cave', label: 'Cave' },
  { id: 'village', label: 'Village' },
];
/** What can always stand at the hideout (tile ids of the battle set). */
export const KEEPSAKES = ['crates', 'cart', 'tent', 'campfire', 'bed', 'woodpile', 'table', 'barrels'] as const;
export type Keepsake = (typeof KEEPSAKES)[number];
export const KEEPSAKE_LABEL: Record<Keepsake, string> = { crates: 'Chest (your storage)', cart: 'Cart', tent: 'Tent', campfire: 'Campfire', bed: 'Bed', woodpile: 'Woodpile', table: 'Table', barrels: 'Barrels' };
export const DEFAULT_KEEP: Keepsake[] = ['crates', 'campfire', 'tent'];
export const CAMP_KEEP: Keepsake[] = ['campfire', 'tent', 'tent', 'cart', 'crates', 'woodpile', 'bed'];

export const emptyDowntime = (): DowntimeState => ({ active: false, mode: 'road', from: {}, hideouts: {} });
export const downtimeOf = (s: { downtime?: DowntimeState }): DowntimeState => s.downtime ?? emptyDowntime();
export const isHideoutPreset = (v: unknown): v is HexPreset => typeof v === 'string' && HIDEOUT_PRESETS.some((p) => p.id === v);
export const parseKeep = (v: unknown): Keepsake[] | null => (Array.isArray(v) && v.length <= 8 && v.every((x) => (KEEPSAKES as readonly string[]).includes(x as string)) ? [...new Set(v as Keepsake[])] : null);

/**
 * The land a camp should look like: from the tiles of the scene the party stopped on (the most telling kind wins).
 * `tiles` are the tile ids of the scene (one per hex).
 */
export function campPresetFor(tiles: string[]): HexPreset {
  const count = (re: RegExp) => tiles.filter((t) => re.test(t)).length;
  const score: Array<[HexPreset, number]> = [
    ['desert', count(/sand|dune|palm|cactus|desert/)],
    ['winter', count(/snow|ice|frozen/)],
    ['swamp', count(/swamp|bog|reed|marsh|mud/)],
    ['lakeshore', count(/^water$|deep|shallow|lake|river|pier/)],
    ['highlands', count(/rock|cliff|crag|boulder|scree|cavewall|stone$/)],
    ['crossroads', count(/cobble|road|street|plaza|house|cottage|wall$/)],
    ['forest', count(/tree|pine|oak|birch|forest|undergrowth|bush|fern/)],
  ];
  const best = score.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] >= Math.max(3, tiles.length * 0.06) ? best[0] : 'forest';
}

// ---------------------------------------------------------------- the stash

export const MAX_STASH = 200;
/** Moves an item from the pack into the chest (equipment it was part of is taken off). Mutates the token. */
export function stashPut(t: Token, itemId: string): string | null {
  const item = t.inventory.find((i) => i.id === itemId);
  if (!item) return 'Item not found.';
  if ((t.stash?.length ?? 0) >= MAX_STASH) return 'The chest is full.';
  t.inventory = t.inventory.filter((i) => i.id !== itemId);
  reconcileEquipment(t);
  const { container: _c, ...rest } = item;
  t.stash = [...(t.stash ?? []), rest as Item];
  return null;
}
/** Takes an item from the chest back into the pack. Mutates the token. */
export function stashTake(t: Token, itemId: string): string | null {
  const item = t.stash?.find((i) => i.id === itemId);
  if (!item) return 'Item not in the chest.';
  const err = addToInventory(t, item);
  if (err) return err;
  t.stash = (t.stash ?? []).filter((i) => i.id !== itemId);
  return null;
}
/** Everything carried that is not worn goes into the chest (before the Obelisk). Returns how many. */
export function stashUnworn(t: Token, worn: Set<string>): number {
  let n = 0;
  for (const i of [...t.inventory]) if (!worn.has(i.id) && !stashPut(t, i.id)) n++;
  return n;
}
