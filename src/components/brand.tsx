/** Brand elements shared by the game UI and the login screens. */

export function ApexEmblem({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="emblem-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6dd94" />
          <stop offset="1" stopColor="#b08532" />
        </linearGradient>
      </defs>
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#14110d" stroke="url(#emblem-gold)" strokeWidth={3.5} />
      <path
        d="M32 15 l3 6 l8 -4 l-3 7 l9 -1 l-6 6 l7 3 l-9 2 l2 6 l-7 -3 l-2 9 h-4 l-2 -9 l-7 3 l2 -6 l-9 -2 l7 -3 l-6 -6 l9 1 l-3 -7 l8 4 z"
        fill="url(#emblem-gold)"
      />
      <circle cx="32" cy="27" r="2.2" fill="#14110d" />
    </svg>
  );
}

export function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

