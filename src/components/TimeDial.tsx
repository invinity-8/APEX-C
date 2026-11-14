/**
 * APEX 2.5 – the campaign clock: a drawn day/night dial. The GM drags the sun/moon to set the time, lets it run
 * in real time (or faster), skips to dawn or to 4 am, picks season, snow and the scene's weather. Players see
 * the dial read-only.
 */
import { useEffect, useRef, useState } from 'react';
import { DAY_MIN, SEASONS, SEASON_LABEL, SKIES, WEATHER_FX, WEATHER_LABEL, clockText, dayOf, hourOf, nowMinute, weatherMix, weatherText, type Season, type Weather, type WeatherFx, type WorldTime } from '../game/worldTime';

/** The world minute now, ticking locally while the time runs. */
export function useWorldMinute(world: WorldTime | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!world?.runningSince) return;
    const id = window.setInterval(() => setNow(Date.now()), Math.max(1000, 60000 / Math.max(1, world.rate ?? 1) / 4));
    return () => window.clearInterval(id);
  }, [world?.runningSince, world?.rate]);
  return world ? nowMinute(world, now) : null;
}

const RATES: Array<[number, string]> = [[1, '×1 real time'], [6, '×6'], [60, '×60 (1 h/min)'], [360, '×360']];

export function TimeDial({ world, weather, weatherFx, followTime = true, gm = false, busy = false, size = 132, onTime, onScene }: {
  world: WorldTime | undefined; weather?: Weather; weatherFx?: readonly WeatherFx[]; followTime?: boolean; gm?: boolean; busy?: boolean; size?: number;
  onTime?: (change: Record<string, unknown>) => void; onScene?: (change: { weather?: Weather; weatherFx?: WeatherFx[]; followTime?: boolean }) => void;
}) {
  const minute = useWorldMinute(world) ?? 8 * 60;
  const mix = weatherMix(weather, weatherFx);
  const [drag, setDrag] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const hour = drag ?? hourOf(minute);
  const r = size / 2 - 8, c = size / 2;
  // midnight at the bottom, noon at the top, the day runs clockwise
  const ang = ((hour / 24) * Math.PI * 2) + Math.PI / 2;
  const hx = c + Math.cos(ang) * r * 0.78, hy = c + Math.sin(ang) * r * 0.78;
  const isDay = hour >= 6 && hour < 19;
  const hourAt = (e: React.PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    const a = Math.atan2(e.clientY - b.top - b.height / 2, e.clientX - b.left - b.width / 2) - Math.PI / 2;
    const h = (((a / (Math.PI * 2)) * 24) % 24 + 24) % 24;
    return Math.round(h * 4) / 4; // quarter hours
  };
  const commit = (h: number) => onTime?.({ minute: Math.floor(minute / DAY_MIN) * DAY_MIN + h * 60 });
  return (
    <div className="time-dial" data-testid="time-dial">
      <svg ref={svg} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={gm ? 'slider' : 'img'} aria-label={`Time of day ${clockText(minute)}, day ${dayOf(minute)}`} aria-valuemin={0} aria-valuemax={24} aria-valuenow={Math.round(hour * 10) / 10}
        style={{ cursor: gm ? 'grab' : undefined, touchAction: 'none' }}
        onPointerDown={gm && !busy ? (e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(hourAt(e)); } : undefined}
        onPointerMove={drag !== null ? (e) => setDrag(hourAt(e)) : undefined}
        onPointerUp={drag !== null ? () => { commit(drag); setDrag(null); } : undefined}>
        <defs>
          <linearGradient id="dial-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fc4ff" /><stop offset=".38" stopColor="#f3d79a" /><stop offset=".5" stopColor="#e07a4a" /><stop offset=".62" stopColor="#3a2a5a" /><stop offset="1" stopColor="#0b1024" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r + 5} fill="#2a1d12" stroke="#c09b58" strokeWidth={2} />
        <circle cx={c} cy={c} r={r} fill="url(#dial-sky)" stroke="#6b4a24" strokeWidth={1} />
        {/* stars on the night half */}
        {[[0.3, 0.75], [0.62, 0.82], [0.45, 0.9], [0.75, 0.7], [0.2, 0.62]].map(([x, y], i) => <circle key={i} cx={c - r + x * r * 2} cy={c - r + y * r * 2} r={1.1} fill="#fff8d8" opacity={0.8} />)}
        {/* the horizon and hour ticks */}
        <line x1={c - r} y1={c} x2={c + r} y2={c} stroke="#2a1d12" strokeWidth={1} opacity={0.5} />
        {Array.from({ length: 24 }, (_, h) => { const a = (h / 24) * Math.PI * 2 + Math.PI / 2; const big = h % 6 === 0; return <line key={h} x1={c + Math.cos(a) * r * (big ? 0.84 : 0.9)} y1={c + Math.sin(a) * r * (big ? 0.84 : 0.9)} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r} stroke="#2a1d12" strokeWidth={big ? 1.6 : 0.8} />; })}
        {[[0, 'XII'], [6, 'VI'], [12, 'XII'], [18, 'XVIII']].map(([h, l]) => { const a = ((h as number) / 24) * Math.PI * 2 + Math.PI / 2; return <text key={h as number} x={c + Math.cos(a) * r * 0.66} y={c + Math.sin(a) * r * 0.66 + 3} textAnchor="middle" fontSize={8} fontFamily="Cinzel, Georgia, serif" fill={(h as number) === 0 ? '#e8e0c8' : '#2a1d12'}>{l}</text>; })}
        <line x1={c} y1={c} x2={hx} y2={hy} stroke="#2a1d12" strokeWidth={2} />
        <circle cx={hx} cy={hy} r={9} fill={isDay ? '#ffd76a' : '#e8ecff'} stroke="#6b4a24" strokeWidth={1.5} />
        <text x={hx} y={hy + 4} textAnchor="middle" fontSize={11}>{isDay ? '☀' : '☾'}</text>
        <circle cx={c} cy={c} r={3} fill="#c09b58" />
      </svg>
      <div className="time-dial-info">
        <b>{drag !== null ? clockText(Math.floor(minute / DAY_MIN) * DAY_MIN + drag * 60) : clockText(minute)}</b>
        <span>Day {dayOf(minute)}{world?.season ? ` · ${SEASON_LABEL[world.season]}` : ''}{world?.runningSince ? ` · ▶ ×${world.rate ?? 1}` : ''}</span>
        {(weather || weatherFx?.length) && <span>{weatherText(mix)}</span>}
      </div>
      {gm && (
        <div className="time-dial-controls">
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={busy} onClick={() => onTime?.({ run: !world?.runningSince })} data-testid="time-run">{world?.runningSince ? '⏸ Stop' : '▶ Run'}</button>
            <select aria-label="Time speed" disabled={busy} value={world?.rate ?? 1} onChange={(e) => onTime?.({ rate: Number(e.target.value) })}>{RATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button type="button" disabled={busy} onClick={() => onTime?.({ advance: 60 })}>+1 h</button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" disabled={busy} onClick={() => onTime?.({ skipTo: 6 })} data-testid="skip-dawn" title="Long rest / camp: jump to the next dawn">🌅 Skip to dawn</button>
            <button type="button" disabled={busy} onClick={() => onTime?.({ skipTo: 4 })}>Skip to 4 am</button>
            <button type="button" disabled={busy} onClick={() => onTime?.({ skipTo: 12 })}>Noon</button>
            <button type="button" disabled={busy} onClick={() => onTime?.({ skipTo: 19 })}>Dusk</button>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Season">
            {SEASONS.map((s) => <button key={s} type="button" disabled={busy} aria-pressed={(world?.season ?? 'summer') === s} onClick={() => onTime?.({ season: s as Season })}>{SEASON_LABEL[s]}</button>)}
          </div>
          <label className="flex items-center gap-2">❄ Snow
            <input type="range" min={0} max={1} step={0.05} disabled={busy} defaultValue={world?.snow ?? 0} key={world?.snow ?? 0} onPointerUp={(e) => onTime?.({ snow: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => onTime?.({ snow: Number((e.target as HTMLInputElement).value) })} aria-label="Snow on the map" data-testid="snow-slider" />
            <span>{Math.round((world?.snow ?? 0) * 100)} %</span>
          </label>
          {onScene && <div className="flex flex-wrap gap-1" role="group" aria-label="Weather of this scene" data-testid="weather">
            {SKIES.map((w) => <button key={w} type="button" disabled={busy} aria-pressed={mix.sky === w} onClick={() => onScene({ weather: w })}>{WEATHER_LABEL[w]}</button>)}
            <span className="w-full" />
            {WEATHER_FX.map((w) => <button key={w} type="button" disabled={busy} aria-pressed={mix[w]} title="Combine freely with the sky and the other effects" onClick={() => onScene({ weatherFx: WEATHER_FX.filter((k) => (k === w ? !mix[w] : mix[k])) })} data-testid={`weather-${w}`}>{WEATHER_LABEL[w]}</button>)}
          </div>}
          {onScene && <label className="flex items-center gap-1"><input type="checkbox" checked={followTime} disabled={busy} onChange={(e) => onScene({ followTime: e.target.checked })} /> Scene lighting follows the time of day</label>}
        </div>
      )}
    </div>
  );
}
