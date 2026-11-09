/**
 * Target strip in the action bar (APEX 2.0): the creatures the acting figure can see, nearest first, with the
 * distance (3D: the larger of horizontal and vertical, flying altitude and ground heights included) and whether the
 * attack or spell in hand reaches them. A click acts like a right-click on the figure on the map – handy in 3D,
 * where figures in the air are hard to click.
 */
import type { SceneSnapshot } from '../server/sceneRuntime';
import { hexAt, heightLookup } from '../campaign/hexScene';
import { distance, hexKey } from '../game/hex';

type Fig = NonNullable<SceneSnapshot['figures']>[number];

export function TargetStrip({ snapshot, from, fromAlt = 0, side, rangeFt, onPick, label = 'Targets' }: { snapshot: SceneSnapshot; from: { x: number; y: number } | null; fromAlt?: number; side: 'hostile' | 'party'; rangeFt?: number | null; onPick: (id: string) => void; label?: string }) {
  const map = snapshot.scene?.map;
  if (!map?.hex || !from) return null;
  const h = heightLookup(map);
  const z = (p: { x: number; y: number }, alt = 0) => h(hexKey(hexAt(map, p))) * 5 + alt;
  const z0 = z(from, fromAlt);
  const figs = (snapshot.figures ?? []).filter((f) => f.condition !== 'down' && (side === 'hostile' ? f.kind === 'enemy' && f.side !== 'ally' : f.kind === 'pc' || f.side === 'ally'));
  const list = figs.map((f) => ({ f, ft: Math.max(distance(hexAt(map, from), hexAt(map, f)) * (map.unitsPerCell || 5), Math.abs(z(f, f.alt ?? 0) - z0)) })).filter((x) => x.ft > 0).sort((a, b) => a.ft - b.ft).slice(0, 8);
  if (!list.length) return null;
  return (
    <div className="target-strip" role="toolbar" aria-label={label} data-testid="target-strip">
      <span className="target-strip-label">{label}</span>
      {list.map(({ f, ft }) => {
        const ok = !rangeFt || ft <= rangeFt;
        const id = f.kind === 'pc' ? f.tokenId! : f.id;
        return (
          <button key={id} type="button" className={`target-chip${ok ? '' : ' is-far'}`} onClick={() => onPick(id)} title={`${f.name} · ${ft} ft${f.alt ? ` · ${f.alt} ft up` : ''}${rangeFt ? (ok ? ' · in range' : ' · out of range') : ''} – click: act on it (like a right-click)`} data-testid="target-chip">
            <span className="target-chip-icon" style={{ background: f.color }} aria-hidden>{f.kind === 'pc' ? f.name.slice(0, 2) : f.icon ?? '?'}</span>
            <span className="target-chip-name">{f.name}</span>
            <span className="target-chip-ft">{ft} ft{f.alt ? ' ↑' : ''}</span>
            {rangeFt ? <span aria-hidden className={`target-chip-dot ${ok ? 'ok' : 'far'}`} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export type { Fig };
