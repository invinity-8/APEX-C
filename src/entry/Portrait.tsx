/** Original stylised portrait medallion: laurel wreath, character sigil and monogram. */
import type { ProfileConfig } from '../data/profiles';

export function Portrait({ profile, size = 88 }: { profile: ProfileConfig; size?: number }) {
  const id = `pg-${profile.key}`;
  const gm = profile.role === 'gm';
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="38%" r="65%">
          <stop offset="0" stopColor={profile.color} stopOpacity="0.55" />
          <stop offset="1" stopColor="#0f0d0c" />
        </radialGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6dd94" />
          <stop offset="1" stopColor="#9c6f22" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-bg)`} stroke={`url(#${id}-gold)`} strokeWidth="3" />
      {/* laurel wreath */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a = Math.PI * (0.62 + i * 0.09);
        const b = Math.PI * (0.38 - i * 0.09);
        return (
          <g key={i} fill="#c9973c" opacity={0.85}>
            <ellipse cx={50 + Math.cos(a) * 38} cy={50 + Math.sin(a) * 38} rx="5" ry="2.2" transform={`rotate(${(a * 180) / Math.PI + 70} ${50 + Math.cos(a) * 38} ${50 + Math.sin(a) * 38})`} />
            <ellipse cx={50 + Math.cos(b) * 38} cy={50 + Math.sin(b) * 38} rx="5" ry="2.2" transform={`rotate(${(b * 180) / Math.PI - 70} ${50 + Math.cos(b) * 38} ${50 + Math.sin(b) * 38})`} />
          </g>
        );
      })}
      <text x="50" y="47" textAnchor="middle" fontSize={gm ? 30 : 26} fill={`url(#${id}-gold)`} fontFamily="Cinzel, Georgia, serif">
        {profile.sigil}
      </text>
      <text x="50" y="72" textAnchor="middle" fontSize="13" fontWeight="700" letterSpacing="2" fill="#f6f1e7" fontFamily="Cinzel, Georgia, serif">
        {gm ? 'GM' : profile.character.slice(0, 2).toUpperCase()}
      </text>
    </svg>
  );
}
