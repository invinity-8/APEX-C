import { useState } from 'react';
import { MarkerShape } from '../CharacterVisuals';
import type { ReactNode } from 'react';
import type { Site } from '../../game/types';
import type { SiteView, TeamView, TokenView, TrackerView } from '../../game/visibility';
import { HEX_SIZE, center, stackLayout } from './geometry';

const SITE_ICON: Record<Site['type'], ReactNode> = {
  start: (
    <g>
      <path d="M0,-9 L7,0 L0,9 L-7,0 Z" fill="#d6b878" stroke="#4a3510" strokeWidth={1} />
      <rect x={-1.5} y={-5} width={3} height={10} fill="#5a4214" />
    </g>
  ),
  camp: (
    <g>
      <path d="M-8,6 L0,-7 L8,6 Z" fill="#e8dcc2" stroke="#3c3226" strokeWidth={1} />
      <path d="M0,-7 L0,6 M-2,6 L0,1 L2,6" stroke="#3c3226" strokeWidth={1} fill="none" />
    </g>
  ),
  tower: (
    <g>
      <rect x={-4} y={-6} width={8} height={13} fill="#d8cbb0" stroke="#3c3226" strokeWidth={1} />
      <path d="M-6,-6 h12 l-2,-3 h-8 Z" fill="#b08532" stroke="#3c3226" strokeWidth={0.8} />
      <circle cx={0} cy={-1} r={1.6} fill="#3c3226" />
    </g>
  ),
  shrine: (
    <g>
      <path d="M0,-9 C5,-2 6,2 6,4 A6,6 0 0 1 -6,4 C-6,2 -5,-2 0,-9 Z" fill="#b48ee0" stroke="#2b1847" strokeWidth={1} />
      <circle cx={-2} cy={3} r={1.5} fill="#efe6ff" />
    </g>
  ),
  ruin: (
    <g fill="#d6c3a5" stroke="#3c3226" strokeWidth={0.8}>
      <rect x={-7} y={-5} width={3.5} height={11} />
      <rect x={-1.7} y={-1} width={3.5} height={7} />
      <rect x={3.6} y={-7} width={3.5} height={13} />
    </g>
  ),
  cache: (
    <g>
      <rect x={-7} y={-4} width={14} height={10} rx={1.5} fill="#c9973c" stroke="#3c2a0e" strokeWidth={1} />
      <path d="M-7,0 h14" stroke="#3c2a0e" strokeWidth={1} />
      <rect x={-1.5} y={-1.5} width={3} height={3} fill="#e8d4a6" />
    </g>
  ),
};

export function SiteMarker({ site, gm }: { site: SiteView; gm: boolean }) {
  const c = center(site.pos);
  const hidden = gm && site.visibility === 'hidden';
  return (
    <g transform={`translate(${c.x},${c.y - HEX_SIZE * 0.42})`} pointerEvents="none" opacity={hidden ? 0.75 : 1}>
      <circle r={11} fill="#15181b" stroke={hidden ? '#c4a6ff' : '#c09b58'} strokeWidth={1.4} strokeDasharray={hidden ? '3 2' : undefined} />
      <g transform="scale(0.85)">{SITE_ICON[site.type]}</g>
    </g>
  );
}

export function TrackerMarker({ t }: { t: TrackerView }) {
  const c = center(t.pos);
  const areaR = t.radius > 0 ? (t.radius + 0.6) * HEX_SIZE * 1.6 : 0;
  return (
    <g pointerEvents="none">
      {areaR > 0 && (
        <circle cx={c.x} cy={c.y} r={areaR} fill="rgba(229,72,77,0.08)" stroke="#e5484d" strokeWidth={1.8} strokeDasharray="7 5" />
      )}
      <circle cx={c.x} cy={c.y} r={HEX_SIZE * 0.55} fill="none" stroke="#e5484d" strokeWidth={2} className="tracker-pulse" />
      <g transform={`translate(${c.x},${c.y})`}>
        <path d="M0,-14 C7,-14 9,-7 9,-5 C9,2 0,10 0,10 C0,10 -9,2 -9,-5 C-9,-7 -7,-14 0,-14 Z" fill="#e5484d" stroke="#3b0a0c" strokeWidth={1.2} />
        <circle cy={-5} r={3.2} fill="#2a0607" />
      </g>
      <text x={c.x} y={c.y + 22} textAnchor="middle" fontSize={9} fill="#ffb3b5" stroke="#1a0405" strokeWidth={3} paintOrder="stroke" fontWeight={600}>
        {t.mode === 'exact' ? t.teamName : `${t.teamName} (≈)`}
      </text>
    </g>
  );
}

export function LastSeenMarker({ team }: { team: TeamView }) {
  if (!team.lastSeen) return null;
  const c = center(team.lastSeen.pos);
  return (
    <g transform={`translate(${c.x},${c.y})`} pointerEvents="none" opacity={0.75}>
      <circle r={HEX_SIZE * 0.42} fill="none" stroke={team.color} strokeWidth={1.5} strokeDasharray="3 3" />
      <text y={4} textAnchor="middle" fontSize={12} fill={team.color}>{team.emblem}</text>
      <text y={HEX_SIZE * 0.75} textAnchor="middle" fontSize={8} fill="#bdb29e" stroke="#000" strokeWidth={2.5} paintOrder="stroke">
        Day {team.lastSeen.day}
      </text>
    </g>
  );
}

interface TokenStackProps {
  tokens: TokenView[];
  selectedId: string | null;
  viewerId: string | null;
  hiddenTeamIds: Set<string>;
  onSelect: (id: string) => void;
  /** APEX 1.6 – show uploaded character portraits inside the markers (online scenes). */
  portraits?: boolean;
}

/** Mehrere Figuren auf einem Feld werden gruppiert, damit nichts übereinander liegt. */
export function TokenStack({ tokens, selectedId, viewerId, hiddenTeamIds, onSelect, portraits = false }: TokenStackProps) {
  const c = center(tokens[0].pos);
  const shown = tokens.length > 4 ? tokens.slice(0, 3) : tokens;
  const extra = tokens.length - shown.length;
  const { offsets, r } = stackLayout(tokens.length > 4 ? 4 : tokens.length);
  return (
    <g>
      {shown.map((t, i) => {
        const o = offsets[i];
        const selected = t.id === selectedId;
        const isViewer = t.id === viewerId;
        const ghost = hiddenTeamIds.has(t.teamId);
        return (
          <g
            key={t.id}
            transform={`translate(${c.x + o.x},${c.y + o.y})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(t.id);
            }}
            style={{ cursor: 'pointer' }}
            role="button"
            aria-label={`Select ${t.name}`}
            opacity={ghost ? 0.55 : 1}
          >
            <title>{`${t.name} – ${t.title}${ghost ? ' (hidden from players)' : ''}`}</title>
            {selected && <circle r={r + 4} fill="none" stroke="#e8d4a6" strokeWidth={2.2} />}
            {t.kind === 'player' ? (
              <>
                <MarkerShape style={t.marker} r={r} color={t.color} accent={t.accent} highlight={isViewer} filter="url(#token-shadow)" />
                <text y={r * 0.36} textAnchor="middle" fontSize={r * 0.95} fontWeight={700} fill="#14110d" fontFamily="Inter, sans-serif">
                  {t.initials}
                </text>
                {portraits && !!t.portraitV && <PortraitDisc tokenId={t.id} v={t.portraitV} r={r * 0.86} ring={t.accent ?? t.color} />}
              </>
            ) : (
              <>
                <path
                  d={shieldPath(r * 1.08)}
                  fill="#14110d"
                  stroke={t.color}
                  strokeWidth={2}
                  strokeDasharray={ghost ? '3 2' : undefined}
                  filter="url(#token-shadow)"
                />
                <text y={r * 0.42} textAnchor="middle" fontSize={r * 1.15} fill={t.color}>
                  {t.initials}
                </text>
              </>
            )}
          </g>
        );
      })}
      {extra > 0 && (
        <g transform={`translate(${c.x + offsets[3].x},${c.y + offsets[3].y})`} pointerEvents="none">
          <circle r={r} fill="#26221d" stroke="#c09b58" strokeWidth={1.4} />
          <text y={r * 0.36} textAnchor="middle" fontSize={r * 0.9} fontWeight={700} fill="#e8d4a6">+{extra}</text>
        </g>
      )}
    </g>
  );
}

function shieldPath(r: number) {
  return `M0,${-r} L${r * 0.9},${-r * 0.55} L${r * 0.8},${r * 0.35} L0,${r} L${-r * 0.8},${r * 0.35} L${-r * 0.9},${-r * 0.55} Z`;
}

/** Uploaded portrait clipped into the marker; a broken image simply hides (initials stay underneath). */
function PortraitDisc({ tokenId, v, r, ring }: { tokenId: string; v: number; r: number; ring: string }) {
  const [broken, setBroken] = useState(false);
  const clip = `portrait-clip-${tokenId.replace(/[^a-z0-9_-]/gi, '')}-${Math.round(r)}`;
  if (broken) return null;
  return (
    <g data-testid="token-portrait">
      <defs><clipPath id={clip}><circle r={r} /></clipPath></defs>
      <image href={`/api/apex?op=portrait&token=${encodeURIComponent(tokenId)}&v=${v}`} x={-r} y={-r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} onError={() => setBroken(true)} />
      <circle r={r} fill="none" stroke={ring} strokeWidth={1.6} />
    </g>
  );
}
