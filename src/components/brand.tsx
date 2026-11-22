/** Brand elements shared by the game UI and the login screens. */

/**
 * APEX 2.12 – the emblem: an “A” whose two strokes lean on an obelisk, a crossbar of laurel and a glowing rune at
 * the obelisk's heart. It takes the theme's main colour (CSS variables), so it follows the chosen palette.
 */
export function ApexEmblem({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="apex-em-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-gold-200)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-gold-500)' }} />
        </linearGradient>
        <linearGradient id="apex-em-o" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0b0a0e" /><stop offset=".55" stopColor="#2a2631" /><stop offset="1" stopColor="#0b0a0e" />
        </linearGradient>
        <radialGradient id="apex-em-g" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#bdf0ff" /><stop offset=".45" stopColor="#7fd6ff" stopOpacity=".8" /><stop offset="1" stopColor="#7fd6ff" stopOpacity="0" /></radialGradient>
      </defs>
      {/* the obelisk */}
      <polygon points="27.5,57 36.5,57 35,19 29,19" fill="url(#apex-em-o)" stroke="url(#apex-em-a)" strokeWidth={1} />
      <polygon points="29,19 35,19 32,12.5" fill="#34303c" stroke="url(#apex-em-a)" strokeWidth={1} />
      {/* the A */}
      <path d="M32 5 L9 58 M32 5 L55 58" stroke="url(#apex-em-a)" strokeWidth={4.2} strokeLinecap="round" fill="none" />
      <path d="M17.5 41 Q32 35.5 46.5 41" stroke="url(#apex-em-a)" strokeWidth={2.4} strokeLinecap="round" fill="none" />
      {[20.5, 24.5, 28.5, 35.5, 39.5, 43.5].map((x, i) => <ellipse key={i} cx={x} cy={39.6 - Math.abs(x - 32) * -0.06 - (i < 3 ? (28.5 - x) * 0.18 : (x - 35.5) * 0.18)} rx={1.7} ry={0.8} transform={`rotate(${i < 3 ? -28 : 28} ${x} 39)`} style={{ fill: 'var(--color-gold-300)' }} />)}
      {/* the rune */}
      <circle cx="32" cy="29" r="5.5" fill="url(#apex-em-g)" className="obelisk-rune" />
      <path d="M32 25.5 L34 29 L32 32.5 L30 29 Z" fill="#e8fbff" />
    </svg>
  );
}

export function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

