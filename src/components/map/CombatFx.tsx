/**
 * Combat feedback on the battle map (APEX 1.6): every new combat event from the server is animated once –
 * a streak from the attacker for ranged attacks and spells, a slash for melee hits, a burst at the target,
 * a floating number (damage red/element-coloured, healing green, "Miss" grey, critical hits gold and bigger),
 * a ring for buffs and debuffs, and a coloured flash over the hexes of an area spell. Pure SVG + CSS animations.
 */
import { useEffect, useRef, useState } from 'react';
import type { SceneFx, FxElement } from '../../game/sceneFx';
import { hexCorners, parseKey } from '../../game/hex';
import { HEX_SIZE, center } from './geometry';

export const FX_COLOR: Record<FxElement, string> = {
  fire: '#ff6a2a', cold: '#8fdcff', lightning: '#ffe14d', thunder: '#a9b8ff', radiant: '#fff1a8', necrotic: '#9a6bff',
  acid: '#a6e34a', poison: '#6ccf5a', psychic: '#ff7ad9', force: '#c9a7ff', physical: '#f1ece2', heal: '#6fe39b', arcane: '#b9a8e3',
};
const LIFE_MS = 2200;
const STAGGER_MS = 220;

type Live = SceneFx & { delay: number; born: number };

export function CombatFx({ fx, posOf }: { fx: SceneFx[]; posOf: (actor: string) => { x: number; y: number } | null }) {
  const seen = useRef<Set<string> | null>(null);
  const [live, setLive] = useState<Live[]>([]);
  useEffect(() => {
    // on first sight, only events of the last seconds play (a reload doesn't replay a whole fight)
    if (!seen.current) {
      const newest = Math.max(0, ...fx.map((f) => f.at));
      seen.current = new Set(fx.filter((f) => newest - f.at > 3000).map((f) => f.id));
    }
    const fresh = fx.filter((f) => !seen.current!.has(f.id)).sort((a, b) => a.at - b.at);
    if (!fresh.length) return;
    for (const f of fresh) seen.current.add(f.id);
    const now = Date.now();
    setLive((l) => [...l.filter((x) => now - x.born < LIFE_MS + x.delay), ...fresh.map((f, i) => ({ ...f, delay: i * STAGGER_MS, born: now }))]);
  }, [fx]);
  useEffect(() => {
    if (!live.length) return;
    const end = Math.max(...live.map((x) => x.born + x.delay + LIFE_MS));
    const t = window.setTimeout(() => setLive((l) => l.filter((x) => Date.now() < x.born + x.delay + LIFE_MS)), Math.max(50, end - Date.now()));
    return () => window.clearTimeout(t);
  }, [live]);
  if (!live.length) return null;
  return (
    <g pointerEvents="none" data-testid="combat-fx">
      {live.map((f) => <FxItem key={f.id} f={f} posOf={posOf} />)}
    </g>
  );
}

function FxItem({ f, posOf }: { f: Live; posOf: (actor: string) => { x: number; y: number } | null }) {
  const to = f.to ? posOf(f.to) : f.point && f.hexes?.length ? center(parseKey(f.hexes[Math.floor(f.hexes.length / 2)])) : null;
  const from = f.from ? posOf(f.from) : null;
  const color = FX_COLOR[f.element] ?? '#fff';
  const d = (ms: number) => ({ animationDelay: `${f.delay + ms}ms` });
  const melee = !!from && !!to && !f.ranged;
  const streak = !!from && !!to && !melee && (f.kind !== 'resist' || !!f.ranged) && Math.hypot(to.x - from.x, to.y - from.y) > HEX_SIZE;
  const len = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  const impact = streak ? 260 : 0;
  const text = f.kind === 'miss' ? 'Miss' : f.kind === 'resist' ? (f.amount ? `${f.amount}` : 'Resisted') : f.kind === 'heal' ? `+${f.amount ?? ''}` : f.kind === 'buff' ? `✦ ${f.amount ? `+${f.amount} ` : ''}${f.label ?? ''}` : f.kind === 'debuff' ? `✧ ${f.label ?? ''}` : f.kind === 'area' ? '' : `${f.kind === 'crit' ? 'CRIT ' : ''}−${f.amount ?? 0}`;
  const textColor = f.kind === 'miss' || f.kind === 'resist' ? '#cfc8bb' : f.kind === 'heal' ? '#7cf0a7' : f.kind === 'crit' ? '#ffd76a' : f.kind === 'buff' ? '#ffe6a3' : f.kind === 'debuff' ? '#d6b8ff' : f.element === 'physical' ? '#ff6b5a' : color;
  return (
    <g>
      {f.kind === 'area' && f.hexes && (
        <g className="fx-area" style={{ ...d(impact), ['--fx-color' as string]: color }}>
          {f.hexes.map((k) => { const c = center(parseKey(k)); return <polygon key={k} points={hexCorners(c.x, c.y, HEX_SIZE * 0.95)} fill={color} fillOpacity={0.5} stroke={color} strokeWidth={1.5} />; })}
        </g>
      )}
      {streak && from && to && (
        <g className="fx-streak" style={{ ...d(0), ['--fx-len' as string]: `${len}` }}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeOpacity={0.35} strokeWidth={9} strokeLinecap="round" strokeDasharray={len} />
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={len} />
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#fff" strokeOpacity={0.8} strokeWidth={1} strokeLinecap="round" strokeDasharray={len} />
        </g>
      )}
      {to && melee && (f.kind === 'hit' || f.kind === 'crit') && (
        <g transform={`translate(${to.x},${to.y})`}>
          <path className="fx-slash" style={d(0)} d={`M${-HEX_SIZE * 0.6},${-HEX_SIZE * 0.5} Q0,${-HEX_SIZE * 0.1} ${HEX_SIZE * 0.6},${HEX_SIZE * 0.5}`} fill="none" stroke={f.kind === 'crit' ? '#ffd76a' : '#fff'} strokeWidth={f.kind === 'crit' ? 4 : 3} strokeLinecap="round" />
        </g>
      )}
      {to && f.kind !== 'area' && (
        <g transform={`translate(${to.x},${to.y})`}>
          {(f.kind === 'hit' || f.kind === 'crit') && <circle className="fx-burst" style={d(impact)} r={HEX_SIZE * (f.kind === 'crit' ? 0.9 : 0.65)} fill={color} fillOpacity={0.45} stroke={color} strokeWidth={2} />}
          {(f.kind === 'heal' || f.kind === 'buff' || f.kind === 'debuff') && <circle className="fx-ring" style={d(impact)} r={HEX_SIZE * 0.7} fill="none" stroke={f.kind === 'heal' ? '#7cf0a7' : f.kind === 'buff' ? '#ffe6a3' : '#b48cff'} strokeWidth={3} />}
          {f.kind === 'heal' && [-0.35, 0, 0.35].map((dx, i) => <circle key={i} className="fx-sparkle" style={d(impact + i * 120)} cx={dx * HEX_SIZE} cy={0} r={2.5} fill="#bfffd6" />)}
          {f.kind === 'miss' && <path className="fx-whoosh" style={d(impact)} d={`M${-HEX_SIZE * 0.7},${HEX_SIZE * 0.2} q${HEX_SIZE * 0.7},${-HEX_SIZE * 0.6} ${HEX_SIZE * 1.4},0`} fill="none" stroke="#e8e2d6" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="4 4" />}
          {text && (
            <text className={f.kind === 'crit' ? 'fx-float fx-float-crit' : 'fx-float'} style={d(impact)} y={-HEX_SIZE * 0.55} textAnchor="middle" fontSize={f.kind === 'crit' ? 20 : f.kind === 'buff' || f.kind === 'debuff' ? 11 : 16} fontWeight={800} fill={textColor} stroke="#000" strokeWidth={3.5} paintOrder="stroke" fontFamily="Cinzel, Georgia, serif" data-testid="fx-text">
              {text}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
