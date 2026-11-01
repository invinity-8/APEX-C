/**
 * Bewegungsvorschau auf Basis einer gefilterten Ansicht (ViewModel).
 * Die Oberfläche zeigt damit erreichbare Felder und Erklärungen an, ohne
 * geheime Daten zu kennen. Die verbindliche Prüfung macht immer executeCommand().
 */
import { equals, type HexKey } from './hex';
import { pathTo, reachable, type ReachInfo } from './movement';
import { TERRAIN } from './terrain';
import { fmt } from './commands';
import type { TokenView, ViewModel } from './visibility';

export function viewReach(view: ViewModel, token: TokenView): Map<HexKey, ReachInfo> {
  const budget = token.details?.movePoints ?? 0;
  return reachable(
    token.pos,
    budget,
    (k) => view.hexByKey[k]?.terrain ?? undefined,
    (k) => (view.hexByKey[k]?.zone === 'closed' ? 'closed' : null),
  );
}

/** Vollständige Wegsuche (ohne BP-Limit) für die Kostenanzeige. */
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
  if (!hex) return { ok: false, reason: 'Außerhalb der Arena' };
  if (equals(token.pos, hex)) return { ok: false, reason: 'Aktueller Standort' };
  if (hex.terrain === null) return { ok: false, reason: 'Unerforscht – zuerst erkunden' };
  const def = TERRAIN[hex.terrain];
  if (def.cost === null) return { ok: false, reason: `${def.label}: nicht passierbar` };
  if (hex.zone === 'closed') return { ok: false, reason: 'Gesperrte Zone' };
  const info = full.get(key);
  if (!info) return { ok: false, reason: 'Kein bekannter Weg dorthin' };
  const mp = token.details?.movePoints ?? 0;
  const steps = pathTo(full, key)?.length ?? 0;
  if (info.cost > mp + 1e-9) {
    return { ok: false, reason: `Kostet ${fmt(info.cost)} BP – nur ${fmt(mp)} BP übrig`, cost: info.cost };
  }
  return { ok: true, cost: info.cost, steps };
}
