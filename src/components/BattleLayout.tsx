/**
 * Battle screen layout (APEX 1.9) for players and the GM: the map takes the centre and the full height, the turn
 * order lies over its top edge, the action bar (hotbar) over its bottom edge, and the detail panel (combat details,
 * spellbook, target menu, GM tools, log) docks to the right, the left or below – the viewer's choice, remembered
 * per device. Phones always dock below.
 */
import { useState, type ReactNode } from 'react';

export type DockSide = 'right' | 'left' | 'below';
const KEY = 'apex.battle.dock';
const read = (): DockSide => { try { const v = localStorage.getItem(KEY); return v === 'left' || v === 'below' ? v : 'right'; } catch { return 'right'; } };

export function BattleLayout({ top, map, dock, label = 'Battle' }: { top?: ReactNode; map: ReactNode; dock: (bar: HTMLElement | null) => ReactNode; label?: string }) {
  const [side, setSideState] = useState<DockSide>(read);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const setSide = (s: DockSide) => { setSideState(s); setCollapsed(false); try { localStorage.setItem(KEY, s); } catch { /* private mode */ } };
  return (
    <div className={`battle-layout dock-${side}${collapsed ? ' dock-collapsed' : ''}`} aria-label={label} data-testid="battle-layout">
      <div className="battle-stage">
        {map}
        <div className="battle-overlay-top">{top}</div>
        <div className="battle-dock-switch" role="group" aria-label="Panel position">
          {(['left', 'below', 'right'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={side === s && !collapsed} title={`Panel ${s === 'below' ? 'below the map' : `on the ${s}`}`} onClick={() => setSide(s)} data-testid={`dock-${s}`}>{s === 'left' ? '◧' : s === 'right' ? '◨' : '⬓'}</button>
          ))}
          <button type="button" aria-pressed={collapsed} title={collapsed ? 'Show the panel' : 'Hide the panel (map only)'} onClick={() => setCollapsed((c) => !c)} data-testid="dock-hide">{collapsed ? '▣' : '□'}</button>
        </div>
        <div className="battle-overlay-bottom" ref={setBar} data-testid="battle-hotbar-slot" />
      </div>
      <aside className="battle-dock" aria-label="Details" hidden={collapsed}>{dock(bar)}</aside>
    </div>
  );
}
