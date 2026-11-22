/**
 * Welcome-screen illustration – original, static, inline SVG (no network request, no third-party branding).
 * APEX 2.11: "Rome meets magic" – a broken colonnade and an aqueduct under a dusk sky, and at the centre an obelisk
 * whose runes glow above a magic circle; embers drift up (CSS, still when the user prefers reduced motion).
 */
export function ImperialVista({ className = '' }: { className?: string }) {
  const leftCols = [60, 150, 240, 330];
  const rightCols = [1270, 1360, 1450, 1540];
  const arches = Array.from({ length: 11 }, (_, i) => 330 + i * 86);
  const runes = Array.from({ length: 9 }, (_, i) => i);
  return (
    <figure className={`welcome-vista overflow-hidden ${className}`} data-testid="welcome-vista" aria-label="A glowing obelisk among Roman ruins at dusk">
      <svg viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" className="h-full w-full">
        <defs>
          <linearGradient id="v-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#06070c" /><stop offset=".45" stopColor="#141a2a" /><stop offset=".72" stopColor="#3a2434" /><stop offset=".9" stopColor="#7a3e26" /><stop offset="1" stopColor="#a8582c" />
          </linearGradient>
          <radialGradient id="v-glow" cx=".5" cy=".62" r=".42"><stop offset="0" stopColor="#7fd6ff" stopOpacity=".38" /><stop offset=".45" stopColor="#4a7ab8" stopOpacity=".12" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
          <radialGradient id="v-ember" cx=".5" cy="1" r=".6"><stop offset="0" stopColor="#ff9a4a" stopOpacity=".5" /><stop offset="1" stopColor="#ff9a4a" stopOpacity="0" /></radialGradient>
          <linearGradient id="v-obelisk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0c0b10" /><stop offset=".55" stopColor="#25222c" /><stop offset="1" stopColor="#0a090d" /></linearGradient>
          <linearGradient id="v-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#9be4ff" stopOpacity=".55" /><stop offset="1" stopColor="#9be4ff" stopOpacity="0" /></linearGradient>
          <linearGradient id="v-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0a0b10" stopOpacity="0" /><stop offset="1" stopColor="#08080b" stopOpacity=".95" /></linearGradient>
          <filter id="v-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <rect width="1600" height="700" fill="url(#v-sky)" />
        {[[120, 60], [260, 120], [420, 40], [560, 90], [980, 55], [1120, 110], [1260, 45], [1420, 95], [700, 30], [860, 130]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? 1 : 1.6} fill="#efe7d6" opacity={0.25 + (i % 4) * 0.12} />)}
        <ellipse cx="800" cy="700" rx="900" ry="260" fill="url(#v-ember)" />
        {/* mountains */}
        <path d="M0 470 L140 390 L260 430 L420 350 L560 420 L700 380 L820 430 L980 360 L1120 420 L1260 370 L1420 430 L1600 380 L1600 700 L0 700 Z" fill="#101219" />
        {/* the aqueduct, broken in the middle */}
        <rect x="300" y="420" width="1000" height="22" fill="#17161d" />
        {arches.map((x, i) => (i === 5 || i === 6 ? null : <path key={x} d={`M${x} 442 L${x} 560 L${x + 12} 560 L${x + 12} 500 A31 31 0 0 1 ${x + 74} 500 L${x + 74} 560 L${x + 86} 560 L${x + 86} 442 Z`} fill="#17161d" />))}
        <path d="M730 420 L760 420 L752 446 L740 432 Z M840 420 L870 420 L862 440 L848 432 Z" fill="#17161d" />
        {/* the glow of the obelisk */}
        <ellipse cx="800" cy="440" rx="560" ry="320" fill="url(#v-glow)" />
        <polygon points="784,560 816,560 870,0 730,0" fill="url(#v-beam)" opacity=".35" />
        {/* the obelisk */}
        <polygon points="760,600 840,600 826,210 774,210" fill="url(#v-obelisk)" />
        <polygon points="774,210 826,210 800,160" fill="#2e2a34" />
        <polygon points="800,160 826,210 800,210" fill="#17151b" />
        {runes.map((i) => <rect key={i} x={792 + ((i % 3) - 1) * 2} y={250 + i * 36} width="16" height={i % 2 ? 18 : 12} rx="2" fill="#9be4ff" opacity={0.55 + (i % 3) * 0.15} filter="url(#v-blur)" />)}
        {runes.map((i) => <path key={`r${i}`} d={`M${794} ${252 + i * 36} l12 0 l-6 ${i % 2 ? 14 : 8} z`} fill="#d8f6ff" opacity=".85" />)}
        {/* the magic circle */}
        <ellipse cx="800" cy="608" rx="230" ry="34" fill="none" stroke="#7fd6ff" strokeOpacity=".55" strokeWidth="2" />
        <ellipse cx="800" cy="608" rx="180" ry="26" fill="none" stroke="#7fd6ff" strokeOpacity=".35" strokeWidth="1.5" strokeDasharray="10 8" />
        <ellipse cx="800" cy="608" rx="120" ry="17" fill="#7fd6ff" opacity=".12" filter="url(#v-blur)" />
        {/* colonnades */}
        {[...leftCols, ...rightCols].map((x, i) => {
          const broken = i === 1 || i === 6, h = broken ? 230 : 380 - (i % 4) * 18;
          return (
            <g key={x} fill="#0c0b10">
              <rect x={x - 26} y={700 - h} width="52" height={h} />
              {!broken && <rect x={x - 38} y={700 - h - 18} width="76" height="20" />}
              {!broken && <rect x={x - 32} y={700 - h - 26} width="64" height="10" />}
              {broken && <path d={`M${x - 26} ${700 - h} L${x - 6} ${700 - h - 22} L${x + 8} ${700 - h - 6} L${x + 26} ${700 - h - 18} L${x + 26} ${700 - h} Z`} />}
              <rect x={x - 34} y={680} width="68" height="20" />
            </g>
          );
        })}
        <rect x="20" y="300" width="360" height="22" fill="#0c0b10" />
        <rect x="1230" y="318" width="350" height="22" fill="#0c0b10" />
        <rect width="1600" height="700" fill="url(#v-mist)" />
      </svg>
      <div className="welcome-embers" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <span key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${(i * 0.7) % 6}s`, animationDuration: `${6 + (i % 5)}s` }} />)}</div>
    </figure>
  );
}
