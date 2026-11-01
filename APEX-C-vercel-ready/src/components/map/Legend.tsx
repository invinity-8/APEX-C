import { useState } from 'react';
import { TERRAIN, TERRAIN_ORDER } from '../../game/terrain';
import { fmt } from '../../game/commands';

export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute top-3 left-3 z-10">
      <button className={`btn ${open ? 'btn-active' : 'btn-ghost'}`} onClick={() => setOpen(!open)} title="Legende ein-/ausblenden">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
          <rect x="2" y="3" width="4" height="4" rx="1" />
          <rect x="2" y="9" width="4" height="4" rx="1" />
          <rect x="8" y="4" width="10" height="2" rx="1" />
          <rect x="8" y="10" width="10" height="2" rx="1" />
          <rect x="2" y="15" width="4" height="2" rx="1" />
          <rect x="8" y="15" width="10" height="2" rx="1" />
        </svg>
        Legende
      </button>
      {open && (
        <div className="panel mt-2 w-60 p-3 text-xs">
          <div className="panel-title mb-2">Gelände · Kosten</div>
          <ul className="space-y-1">
            {TERRAIN_ORDER.map((t) => (
              <li key={t} className="flex items-center gap-2" title={TERRAIN[t].description}>
                <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/40" style={{ background: TERRAIN[t].fill }} />
                <span className="flex-1">{TERRAIN[t].label}</span>
                <span className={TERRAIN[t].cost === null ? 'text-blood-400' : TERRAIN[t].difficult ? 'text-amber-300' : 'text-marble-300'}>
                  {TERRAIN[t].cost === null ? 'unpassierbar' : `${fmt(TERRAIN[t].cost!)} BP${TERRAIN[t].difficult ? ' · schwierig' : ''}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="panel-title mt-3 mb-2">Markierungen</div>
          <ul className="space-y-1 text-marble-300">
            <li><span className="inline-block h-3 w-3 rounded-sm align-middle" style={{ backgroundColor: '#16130f', border: '1px solid #2a2520' }} /> Unerforscht</li>
            <li><span className="inline-block h-3 w-3 rounded-sm bg-ink-600/80 align-middle" /> Erforscht, nicht sichtbar</li>
            <li><span className="inline-block h-3 w-3 rounded-sm border border-gold-200/70 bg-gold-200/20 align-middle" /> In Reichweite</li>
            <li><span className="text-blood-400">●</span> Tracking-Marker · <span className="text-blood-400">- -</span> Zonengrenze</li>
            <li><span className="text-marble-300">◌</span> Letzte Sichtung eines Teams</li>
            <li>Runde Marker = Spieler · Schilde = Rivalen</li>
          </ul>
          <div className="mt-3 text-[11px] text-marble-500">Mausrad/Pinch: Zoom · Ziehen: Karte verschieben · Esc: Auswahl aufheben</div>
        </div>
      )}
    </div>
  );
}
