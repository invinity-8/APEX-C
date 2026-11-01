import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { PROFILES } from '../src/data/profiles';
import { applyRoster, needsRosterUpdate } from '../src/game/roster';
import { buildPlayerView } from '../src/game/visibility';

/** Builds a v0.2-style state with the old placeholder ids. */
function legacyState() {
  const s = createDemoState({ radius: 8, seed: 3 });
  const back: Record<string, [string, string]> = { sinna: ['livia', 'Livia Aurelia'], aster: ['marcus', 'Marcus Varro'], elwin: ['nyx', 'Nyx Silvana'], javi: ['cassius', 'Cassius Thorne'] };
  const tokens: typeof s.tokens = {};
  for (const [id, t] of Object.entries(s.tokens)) {
    const b = back[id];
    tokens[b ? b[0] : id] = b ? { ...t, id: b[0], name: b[1], controllers: id === 'aster' ? ['livia'] : [] } : t;
  }
  s.tokens = tokens;
  s.knowledge = Object.fromEntries(Object.entries(s.knowledge).map(([k, v]) => [back[k]?.[0] ?? k, v]));
  return s;
}

describe('Campaign roster', () => {
  it('new campaigns contain exactly the profile characters', () => {
    const s = createDemoState({ radius: 8 });
    for (const p of PROFILES.filter((x) => x.role === 'player')) {
      for (const id of p.tokenIds) expect(s.tokens[id]?.name).toBe(p.character);
    }
    expect(needsRosterUpdate(s)).toBe(false);
  });

  it('converts an existing campaign without losing position, movement or knowledge', () => {
    const old = legacyState();
    old.tokens.livia.pos = { q: 2, r: 0 };
    old.tokens.livia.movePoints = 3;
    expect(needsRosterUpdate(old)).toBe(true);
    const s = applyRoster(old);
    expect(s.tokens.livia).toBeUndefined();
    expect(s.tokens.sinna).toMatchObject({ id: 'sinna', name: 'Sinna', initials: 'SI', pos: { q: 2, r: 0 }, movePoints: 3 });
    expect(s.tokens.aster.controllers).toEqual(['sinna']);
    expect(s.knowledge.sinna).toEqual(old.knowledge.livia);
    expect(buildPlayerView(s, 'sinna').tokens.some((t) => t.id === 'sinna')).toBe(true);
    expect(old.tokens.livia).toBeDefined(); // input untouched
  });
});
