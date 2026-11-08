/**
 * Enemy token art (APEX 1.2): a coloured disc with the creature's letters; ELITES get an original golden dragon
 * frame (wings and a horned head around the disc) so they stand out on the map and in the library.
 */

/** Gold dragon frame drawn around a token of radius r (SVG group, centred on 0,0). */
export function EliteFrame({ r }: { r: number }) {
  const k = r / 20;
  return (
    <g pointerEvents="none" data-testid="elite-frame">
      {/* wings */}
      <path d={`M${-18 * k},${-4 * k} C${-34 * k},${-24 * k} ${-40 * k},${-6 * k} ${-36 * k},${10 * k} C${-32 * k},${4 * k} ${-28 * k},${6 * k} ${-24 * k},${14 * k} C${-24 * k},${6 * k} ${-21 * k},${4 * k} ${-18 * k},${6 * k} Z`} fill="#d9a63a" stroke="#5a3a0a" strokeWidth={1.2 * k} />
      <path d={`M${18 * k},${-4 * k} C${34 * k},${-24 * k} ${40 * k},${-6 * k} ${36 * k},${10 * k} C${32 * k},${4 * k} ${28 * k},${6 * k} ${24 * k},${14 * k} C${24 * k},${6 * k} ${21 * k},${4 * k} ${18 * k},${6 * k} Z`} fill="#d9a63a" stroke="#5a3a0a" strokeWidth={1.2 * k} />
      {/* ring */}
      <circle r={r + 2.5 * k} fill="none" stroke="#f3cf6b" strokeWidth={3 * k} />
      <circle r={r + 4.5 * k} fill="none" stroke="#5a3a0a" strokeWidth={1 * k} />
      {/* head with horns on top */}
      <path d={`M${-7 * k},${-r - 2 * k} L${-11 * k},${-r - 12 * k} L${-4 * k},${-r - 6 * k} L0,${-r - 10 * k} L${4 * k},${-r - 6 * k} L${11 * k},${-r - 12 * k} L${7 * k},${-r - 2 * k} Z`} fill="#f3cf6b" stroke="#5a3a0a" strokeWidth={1 * k} />
      {/* tail at the bottom */}
      <path d={`M${-4 * k},${r + 3 * k} Q0,${r + 12 * k} ${6 * k},${r + 9 * k} Q${2 * k},${r + 8 * k} ${4 * k},${r + 3 * k} Z`} fill="#d9a63a" stroke="#5a3a0a" strokeWidth={1 * k} />
    </g>
  );
}

export function EnemyBadge({ icon, color, elite, size = 32 }: { icon: string; color: string; elite?: boolean; size?: number }) {
  const r = 20;
  const box = elite ? 46 : 24;
  return (
    <svg width={size} height={size} viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`} aria-hidden className="shrink-0">
      {elite && <EliteFrame r={r} />}
      <circle r={r} fill={color} stroke="#b3261e" strokeWidth={3} />
      <text y={6} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={2.5} paintOrder="stroke">{icon}</text>
    </svg>
  );
}
