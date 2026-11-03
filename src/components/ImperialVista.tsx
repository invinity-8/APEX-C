/**
 * Welcome-screen illustration (APEX 0.7) – original, static, inline SVG: dusk over the arena, the aqueduct ring,
 * the labyrinth plinth and the golden eagle standard. No runtime, no network request, no third-party branding.
 * Replaces the APEX 0.5 Spline scene (removed in 0.7 at the owner's request).
 */
export function ImperialVista({ className = '' }: { className?: string }) {
  const arches = Array.from({ length: 14 }, (_, i) => i);
  const columns = Array.from({ length: 9 }, (_, i) => i);
  return (
    <figure className={`apex-vista ${className}`} data-testid="welcome-vista" aria-label="The Arena of the Eternal Will at dusk">
      <svg viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" className="h-full w-full">
        <defs>
          <linearGradient id="vista-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#141a2b" />
            <stop offset=".55" stopColor="#3a2f3a" />
            <stop offset=".82" stopColor="#8a5a3a" />
            <stop offset="1" stopColor="#c08a4e" />
          </linearGradient>
          <radialGradient id="vista-sun" cx=".5" cy=".86" r=".35">
            <stop offset="0" stopColor="#f6dd94" stopOpacity=".85" />
            <stop offset=".4" stopColor="#e3a85b" stopOpacity=".35" />
            <stop offset="1" stopColor="#e3a85b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="vista-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6dd94" />
            <stop offset=".55" stopColor="#c09b58" />
            <stop offset="1" stopColor="#7a5a26" />
          </linearGradient>
          <linearGradient id="vista-stone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b3632" />
            <stop offset="1" stopColor="#1c1a19" />
          </linearGradient>
        </defs>
        <rect width="1200" height="420" fill="url(#vista-sky)" />
        {/* stars */}
        {[[80, 40], [190, 90], [310, 30], [440, 70], [760, 45], [880, 95], [990, 35], [1110, 80], [610, 25], [520, 110]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 1 : 1.6} fill="#efe7d6" opacity={0.35 + (i % 4) * 0.12} />
        ))}
        <ellipse cx="600" cy="380" rx="520" ry="160" fill="url(#vista-sun)" />
        {/* distant hills */}
        <path d="M0 330 C 160 290 300 310 430 300 C 560 290 640 320 780 300 C 930 280 1060 300 1200 290 V420 H0Z" fill="#2a2228" opacity=".9" />
        {/* aqueduct */}
        <g fill="#241e22" opacity=".95">
          <rect x="0" y="268" width="1200" height="12" />
          {arches.map((i) => (
            <path key={i} d={`M${i * 88} 280 h88 v70 h-10 a34 34 0 0 0 -68 0 h-10z`} />
          ))}
        </g>
        {/* column ring */}
        <g fill="url(#vista-stone)">
          {columns.map((i) => {
            const x = 330 + i * 67.5;
            const h = 110 - Math.abs(i - 4) * 9;
            return (
              <g key={i}>
                <rect x={x - 9} y={360 - h} width="18" height={h} />
                <rect x={x - 13} y={354 - h} width="26" height="7" />
              </g>
            );
          })}
        </g>
        {/* labyrinth plinth */}
        <g>
          <path d="M470 372 L730 372 L700 340 L500 340Z" fill="#2c2622" stroke="#c09b58" strokeOpacity=".5" />
          <path d="M520 360 h160 M540 352 h120 M560 346 h80" stroke="#e3c25b" strokeOpacity=".55" strokeWidth="2" fill="none" />
        </g>
        {/* eagle standard */}
        <g transform="translate(600 205)">
          <rect x="-3" y="20" width="6" height="118" fill="url(#vista-gold)" />
          <circle r="40" cy="38" fill="none" stroke="url(#vista-gold)" strokeWidth="3" opacity=".75" />
          <path
            d="M0 0 C 10 8 18 16 22 26 C 40 18 60 16 78 22 C 62 30 50 38 40 46 C 30 52 18 54 8 56 L 0 70 L -8 56 C -18 54 -30 52 -40 46 C -50 38 -62 30 -78 22 C -60 16 -40 18 -22 26 C -18 16 -10 8 0 0Z"
            fill="url(#vista-gold)"
            stroke="#5a4320"
            strokeWidth="1.2"
          />
          <circle cx="0" cy="14" r="5" fill="#f6dd94" />
        </g>
        {/* foreground */}
        <path d="M0 380 C 200 370 400 392 600 386 C 800 380 1000 394 1200 384 V420 H0Z" fill="#141213" />
        {/* banners */}
        {[260, 940].map((x) => (
          <g key={x}>
            <rect x={x - 2} y="250" width="4" height="135" fill="#3a3330" />
            <path d={`M${x + 2} 256 h34 v54 l-17 -10 l-17 10z`} fill="#8e2424" stroke="#c09b58" strokeOpacity=".6" />
          </g>
        ))}
      </svg>
    </figure>
  );
}
