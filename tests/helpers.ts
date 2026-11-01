import { createDemoState } from '../src/data/demo';
import type { Axial } from '../src/game/hex';
import { hexKey } from '../src/game/hex';
import type { TerrainType } from '../src/game/terrain';
import type { GameState } from '../src/game/types';
import { emptyKnowledge, refreshAllKnowledge } from '../src/game/visibility';

/** Small, controlled game state: grassland only, all characters at the centre. */
export function flatState(radius = 6): GameState {
  const s = createDemoState({ radius, seed: 1 });
  for (const t of Object.values(s.hexes)) {
    t.terrain = 'plains';
    delete t.siteId;
  }
  s.sites = {};
  s.config.shrink.enabled = false;
  for (const id of Object.keys(s.knowledge)) s.knowledge[id] = emptyKnowledge();
  for (const t of Object.values(s.tokens)) t.pos = { q: 0, r: 0 };
  return s;
}

export function setTerrain(s: GameState, h: Axial, t: TerrainType) {
  s.hexes[hexKey(h)].terrain = t;
}

export function place(s: GameState, id: string, h: Axial) {
  s.tokens[id].pos = { ...h };
  refreshAllKnowledge(s);
}
