import { TERRAIN, TERRAIN_ORDER } from '../../game/terrain';
import { fmt } from '../../game/text';

/** Map legend – APEX 0.7: a regular workspace widget (terrain costs, markers, controls). */
export function LegendContent() {
  return (
    <div className="text-xs" aria-label="Map legend">
      <div className="panel-title mb-2">Terrain · Movement Cost</div>
      <ul className="space-y-1">
        {TERRAIN_ORDER.map((t) => (
          <li key={t} className="flex items-center gap-2" title={TERRAIN[t].description}>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/40"
              style={{ background: `linear-gradient(135deg, ${TERRAIN[t].light}, ${TERRAIN[t].fill} 55%, ${TERRAIN[t].stroke})` }}
            />
            <span className="flex-1">{TERRAIN[t].label}</span>
            <span className={TERRAIN[t].cost === null ? 'text-blood-400' : TERRAIN[t].difficult ? 'text-amber-300' : 'text-marble-300'}>
              {TERRAIN[t].cost === null ? 'impassable' : `${fmt(TERRAIN[t].cost!)} MP${TERRAIN[t].difficult ? ' · difficult' : ''}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="panel-title mt-3 mb-2">Markers</div>
      <ul className="space-y-1 text-marble-300">
        <li><span className="inline-block h-3 w-3 rounded-sm align-middle" style={{ backgroundColor: '#0b0a0e', border: '1px solid #2a2520' }} /> Unexplored – the unknown has no edges</li>
        <li><span className="inline-block h-3 w-3 rounded-sm bg-ink-600/80 align-middle" /> Explored, not currently visible</li>
        <li><span className="inline-block h-1 w-4 rounded-sm bg-gold-400 align-middle" /> Arena wall (once discovered)</li>
        <li><span className="inline-block h-3 w-3 rounded-sm border border-gold-200/70 bg-gold-200/20 align-middle" /> Within movement range</li>
        <li><span className="text-blood-400">●</span> Tracking marker · <span className="text-blood-400">▨</span> Death zone</li>
        <li><span className="text-marble-300">◌</span> Last team sighting</li>
        <li>Round markers = players · Shields = rivals</li>
      </ul>
      <div className="mt-3 text-[11px] text-marble-500">Mouse wheel/pinch or +/−: zoom · Drag or arrow keys: pan · 0: recentre · Esc: clear selection</div>
    </div>
  );
}

/** Personal map display toggle (formerly inside the legend overlay). */
export function AtmosphereToggle({ atmosphere, setAtmosphere }: { atmosphere: boolean; setAtmosphere: (on: boolean) => void }) {
  return (
    <label className="btn btn-ghost absolute top-3 left-3 z-10 gap-1.5 px-2 py-1 text-[11px]" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} title="Fog, light and vignette over the map (only on this device)">
      <input type="checkbox" checked={atmosphere} onChange={(e) => setAtmosphere(e.target.checked)} aria-label="Map atmosphere" />
      Atmosphere
    </label>
  );
}
