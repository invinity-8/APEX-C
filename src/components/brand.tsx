/** Brand elements shared by the game UI and the login screens. */

/**
 * APEX 2.13 – the emblem: a three-headed imperial eagle (aquila) – wings of layered blade feathers spread wide, a shield
 * for a body, a fanned tail, two heads in profile and a crowned head in the middle, a rune glowing on the breast.
 * Monumental and imperial; it takes the campaign's main colour (CSS variables).
 */
const WING: Array<[number, number]> = [[3, 9], [2, 17], [3, 25], [6, 32], [10, 38], [15, 43]];
export function ApexEmblem({ className = '' }: { className?: string }) {
  const feather = (tip: [number, number], i: number, side: 1 | -1) => {
    const sx = (x: number) => (side > 0 ? x : 64 - x);
    const root: [number, number] = [26.5 + i * 0.35, 26 + i * 2.3];
    const back: [number, number] = [root[0] - 2.2, root[1] + 3.6];
    return <polygon key={`${side}${i}`} points={`${sx(root[0])},${root[1]} ${sx(tip[0])},${tip[1]} ${sx(back[0] + (tip[0] - back[0]) * 0.18)},${back[1] + (tip[1] - back[1]) * 0.18 + 2.4} ${sx(back[0])},${back[1]}`}
      fill={i % 2 ? 'url(#aq-d)' : 'url(#aq-g)'} stroke="#0b0a0e" strokeWidth={0.7} strokeLinejoin="round" />;
  };
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aq-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-gold-200)' }} /><stop offset="1" style={{ stopColor: 'var(--color-gold-500)' }} />
        </linearGradient>
        <linearGradient id="aq-d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-gold-400)' }} /><stop offset="1" style={{ stopColor: 'var(--color-gold-700)' }} />
        </linearGradient>
        <radialGradient id="aq-r" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#d8f6ff" /><stop offset=".5" stopColor="#7fd6ff" stopOpacity=".85" /><stop offset="1" stopColor="#7fd6ff" stopOpacity="0" /></radialGradient>
      </defs>
      {/* wings: layered blade feathers */}
      {WING.map((t, i) => feather(t, i, -1))}
      {WING.map((t, i) => feather(t, i, 1))}
      {/* tail */}
      <polygon points="29,47 32,62 35,47" fill="url(#aq-g)" stroke="#0b0a0e" strokeWidth={0.7} strokeLinejoin="round" />
      <polygon points="28.5,46 24,59 30.5,49" fill="url(#aq-d)" stroke="#0b0a0e" strokeWidth={0.7} strokeLinejoin="round" />
      <polygon points="35.5,46 40,59 33.5,49" fill="url(#aq-d)" stroke="#0b0a0e" strokeWidth={0.7} strokeLinejoin="round" />
      {/* necks */}
      <path d="M29 28 L21 18.5 M35 28 L43 18.5 M32 26 L32 14" stroke="#0b0a0e" strokeWidth={4.6} strokeLinecap="round" />
      <path d="M29 28 L21 18.5 M35 28 L43 18.5 M32 26 L32 14" stroke="url(#aq-g)" strokeWidth={3} strokeLinecap="round" />
      {/* the shield body */}
      <polygon points="26,25 38,25 39.5,38 32,49 24.5,38" fill="url(#aq-g)" stroke="#0b0a0e" strokeWidth={1} strokeLinejoin="round" />
      <polygon points="28,28 36,28 36.8,37 32,44.5 27.2,37" fill="#14110d" />
      <circle cx="32" cy="35" r="5" fill="url(#aq-r)" className="obelisk-rune" />
      <path d="M32 31.5 L34 35 L32 38.5 L30 35 Z" fill="#eafcff" />
      {/* heads: left and right in profile, the crowned one in the middle */}
      {([-1, 1] as const).map((d) => {
        // an angular eagle head in profile: brow, hooked beak, a hard slit of an eye
        const P: Array<[number, number]> = [[23, 17.4], [22.8, 14.4], [19.8, 12.9], [16.6, 13.6], [14, 14.9], [12.2, 17.4], [13.4, 17.6], [15.4, 16.8], [16.8, 18.2], [20.4, 19.6]];
        const sx = (x: number) => (d < 0 ? x : 64 - x);
        return (
          <g key={d}>
            <polygon points={P.map(([x, y]) => `${sx(x)},${y}`).join(' ')} fill="url(#aq-g)" stroke="#0b0a0e" strokeWidth={0.8} strokeLinejoin="round" />
            <path d={`M${sx(14.2)} 15.1 L${sx(16.4)} 16.6`} stroke="#0b0a0e" strokeWidth={0.6} />
            <path d={`M${sx(16.9)} 15.1 L${sx(19.4)} 15.7`} stroke="#0b0a0e" strokeWidth={0.9} strokeLinecap="round" />
          </g>
        );
      })}
      <polygon points="28.8,9.6 32,7.6 35.2,9.6 35.2,12.6 33.5,14.2 32,17.4 30.5,14.2 28.8,12.6" fill="url(#aq-g)" stroke="#0b0a0e" strokeWidth={0.8} strokeLinejoin="round" />
      <path d="M29.6 10.7 L31.2 11.6 M34.4 10.7 L32.8 11.6" stroke="#0b0a0e" strokeWidth={0.9} strokeLinecap="round" />
      <path d="M31.2 13.6 L32 16.2 L32.8 13.6" fill="url(#aq-d)" stroke="#0b0a0e" strokeWidth={0.5} />
      <path d="M28.8 7.6 L29.8 3.9 L31 6.6 L32 3 L33 6.6 L34.2 3.9 L35.2 7.6 Z" fill="url(#aq-g)" stroke="#0b0a0e" strokeWidth={0.6} strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

