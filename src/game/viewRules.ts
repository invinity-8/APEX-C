/**
 * Movement preview based on a filtered view (ViewModel).
 * The UI uses it to show reachable hexes and explanations without knowing any
 * secret data. The authoritative check is always executeCommand() (on the server).
 */
import { equals, type HexKey } from './hex.js';
import { pathTo, reachable, type ReachInfo } from './movement.js';
import { TERRAIN } from './terrain.js';
import { T } from './text.js';
import type { TokenView, ViewModel } from './visibility.js';

export function viewReach(view: ViewModel, token: TokenView): Map<HexKey, ReachInfo> {
  const budget = token.details?.movePoints ?? 0;
  return reachable(
    token.pos,
    budget,
    (k) => view.hexByKey[k]?.terrain ?? undefined,
    (k) => (view.hexByKey[k]?.zone === 'closed' ? 'closed' : null),
  );
}

/** Full path search (no MP limit) for the cost preview. */
export function viewFullReach(view: ViewModel, token: TokenView): Map<HexKey, ReachInfo> {
  return reachable(
    token.pos,
    Infinity,
    (k) => view.hexByKey[k]?.terrain ?? undefined,
    (k) => (view.hexByKey[k]?.zone === 'closed' ? 'closed' : null),
  );
}

export type ReachExplanation =
  | { ok: true; cost: number; steps: number }
  | { ok: false; reason: string; cost?: number };

export function explainReach(
  view: ViewModel,
  token: TokenView,
  key: HexKey,
  full: Map<HexKey, ReachInfo>,
): ReachExplanation {
  const hex = view.hexByKey[key];
  if (!hex) return { ok: false, reason: T.reachOutside };
  if (equals(token.pos, hex)) return { ok: false, reason: T.reachCurrent };
  if (hex.terrain === null) return { ok: false, reason: T.reachUnexplored };
  const def = TERRAIN[hex.terrain];
  if (def.cost === null) return { ok: false, reason: T.reachImpassable(def.label) };
  if (hex.zone === 'closed') return { ok: false, reason: T.closedZoneShort };
  const info = full.get(key);
  if (!info) return { ok: false, reason: T.reachNoPath };
  const mp = token.details?.movePoints ?? 0;
  const steps = pathTo(full, key)?.length ?? 0;
  if (info.cost > mp + 1e-9) {
    return { ok: false, reason: T.reachTooExpensive(info.cost, mp), cost: info.cost };
  }
  return { ok: true, cost: info.cost, steps };
}
