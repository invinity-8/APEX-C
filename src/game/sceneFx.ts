/**
 * Combat feedback for the battle map (APEX 1.6): short-lived visual events – a hit with its damage number, a miss,
 * a critical hit, healing, a buff, an area spell – that clients animate (floating numbers, a streak from the attacker,
 * a burst over the area). Creatures are referred to by participant id (`pc-<token>` / `npc-<id>`); a client only
 * animates what it can see. The scene keeps the last few events for a short while.
 */
import type { GameState } from './types.js';

export type FxElement = 'fire' | 'cold' | 'lightning' | 'thunder' | 'radiant' | 'necrotic' | 'acid' | 'poison' | 'psychic' | 'force' | 'physical' | 'heal' | 'arcane';
export interface SceneFx {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  kind: 'hit' | 'crit' | 'miss' | 'heal' | 'buff' | 'debuff' | 'resist' | 'area';
  from?: string;
  to?: string;
  /** Area: centre and size. */
  point?: { x: number; y: number };
  sizeFt?: number;
  /** Area: the hexes it covers (hex keys), drawn as a coloured flash. */
  hexes?: string[];
  amount?: number;
  /** Short label (spell or effect name). */
  label?: string;
  element: FxElement;
  /** Melee or ranged (spells and bows draw a streak from the attacker). */
  ranged?: boolean;
}

const KEEP = 24;
const MAX_AGE_MS = 20_000;

const ELEMENTS: FxElement[] = ['fire', 'cold', 'lightning', 'thunder', 'radiant', 'necrotic', 'acid', 'poison', 'psychic', 'force'];
/** Element from a damage text ("2d6 fire", "Fire Bolt"); weapons are physical, other spells arcane. */
export function elementOf(text: string | undefined, spell = false): FxElement {
  const t = (text ?? '').toLowerCase();
  const hit = ELEMENTS.find((e) => t.includes(e));
  if (hit) return hit;
  if (/flame|fire|burn|scorch/.test(t)) return 'fire';
  if (/frost|ice|cold/.test(t)) return 'cold';
  if (/shock|lightning|thunder/.test(t)) return 'lightning';
  return spell ? 'arcane' : 'physical';
}

export function pushFx(state: GameState, sceneId: string, events: Array<Omit<SceneFx, 'id' | 'at'>>, now = Date.now()) {
  if (!events.length) return;
  const old = (state.sceneFx?.[sceneId] ?? []).filter((f) => now - f.at < MAX_AGE_MS);
  const add = events.map((e, i) => ({ ...e, id: `vfx-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}-${i}`, at: now + i * 120 }));
  state.sceneFx = { ...(state.sceneFx ?? {}), [sceneId]: [...old, ...add].slice(-KEEP) };
}

/** Events still worth animating for a snapshot. */
export const recentFx = (state: Pick<GameState, 'sceneFx'>, sceneId: string, now = Date.now()) => (state.sceneFx?.[sceneId] ?? []).filter((f) => now - f.at < MAX_AGE_MS);
