/**
 * World management (APEX 0.4): what belongs to a WORLD and what belongs to a CHARACTER.
 *
 *  Account level   (never touched here): profiles, passwords, roles, sessions – other tables.
 *  Character level (carried into every world): identity (name, title, colour, initials),
 *                  inventory and containers, Will maximum, vision and movement traits,
 *                  in-game control rights. Character sheets live in their own table.
 *  World level     (new per world): map, seed, radius, positions, movement points left,
 *                  temporary vision bonus, explored terrain (Fog of War), sightings, sites,
 *                  events, day/night, shrinking, log.
 *
 * Pure functions – used by the server; covered by tests.
 */
import type { GameState, Token, WorldMeta } from './types.js';

// APEX 0.7: equipment, currency, cosmetic choices and the portrait belong to the character as well – a new world
// must not silently drop them.
const CHARACTER_FIELDS = [
  'name',
  'title',
  'titleCustom',
  'color',
  'accent',
  'marker',
  'portrait',
  'initials',
  'inventory',
  'containers',
  'equipment',
  'currency',
  'currencyRev',
  'cubeProgression',
  'speedFt',
  'maxMovePoints',
  'visionRadius',
  'controllers',
  'sharesWithParty',
] as const;

/** Copies the character-level data of the old world's player characters into a freshly generated world. */
export function carryCharacters(prev: GameState, fresh: GameState): GameState {
  const next = structuredClone(fresh);
  const start = Object.values(next.tokens).find((t) => t.kind === 'player')?.pos ?? { q: 0, r: 0 };
  for (const old of Object.values(prev.tokens)) {
    if (old.kind !== 'player') continue;
    let t: Token | undefined = next.tokens[old.id];
    if (!t) {
      // Character that the generator does not know (added later): bring it along at the start.
      t = structuredClone(old);
      t.pos = { ...start };
      next.tokens[old.id] = t;
    }
    for (const f of CHARACTER_FIELDS) {
      if (old[f] !== undefined) (t as unknown as Record<string, unknown>)[f] = structuredClone(old[f]);
    }
    // World-level values start fresh according to the APEX rules.
    t.movePoints = t.maxMovePoints;
    t.visionBonus = 0;
    t.controllers = t.controllers.filter((c) => next.tokens[c]?.kind === 'player');
  }
  return next;
}

export type InventoryChoice = 'keep-current' | 'use-archived';

/**
 * Restoring an archived world: the archive brings its map, positions and knowledge back.
 * Character-level data is reconciled explicitly – by default the CURRENT inventory, containers
 * and Will maximum are kept (they belong to the character, not to the world).
 */
export function reconcileRestore(current: GameState, archived: GameState, choice: InventoryChoice): GameState {
  const next = structuredClone(archived);
  if (choice === 'use-archived') return next;
  for (const t of Object.values(next.tokens)) {
    const now = current.tokens[t.id];
    if (t.kind !== 'player' || now?.kind !== 'player') continue;
    t.inventory = structuredClone(now.inventory);
    if (now.containers) t.containers = structuredClone(now.containers);
    else delete t.containers;
    // Ownership belongs to the present: keep the current equipment references and currency, never the archived
    // ones (an item traded away since must not come back, currency must not be duplicated).
    for (const f of ['equipment', 'currency', 'currencyRev', 'cubeProgression', 'accent', 'marker', 'portrait', 'titleCustom'] as const) {
      if (now[f] !== undefined) (t as unknown as Record<string, unknown>)[f] = structuredClone(now[f]);
      else delete t[f];
    }
    for (const f of ['name', 'title', 'color', 'initials'] as const) t[f] = now[f];
  }
  return next;
}

export function newWorldMeta(name: string, now = new Date()): WorldMeta {
  const id = `w-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, name: name.trim().slice(0, 80) || 'Unnamed world', createdAt: now.toISOString() };
}

/** World id used for stale-command protection (older saves without metadata → null). */
export const worldIdOf = (s: Pick<GameState, 'world'> | null | undefined) => s?.world?.id ?? null;
