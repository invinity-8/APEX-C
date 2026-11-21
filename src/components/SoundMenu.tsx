/** APEX 2.9 – sound settings in the header: effects and music on/off, volumes, the track list. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onSoundSettings, play, setSoundSettings, soundSettings, TRACKS, TRACK_LABEL, unlockSound, type Track } from '../audio/sound';

export function SoundMenu() {
  const [s, setS] = useState(soundSettings());
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const r = open ? btn.current?.getBoundingClientRect() : undefined;
  useEffect(() => onSoundSettings(setS), []);
  const on = s.sfx || s.music;
  return (
    <span className="relative">
      <button ref={btn} type="button" className="btn btn-ghost px-2" aria-expanded={open} title="Sound and music" aria-label="Sound and music" onClick={() => { unlockSound(); setOpen(!open); }} data-testid="sound-menu">{on ? '🔊' : '🔇'}</button>
      {open && r && createPortal(
        <div className="fixed z-[90] w-72 space-y-2 rounded-xl border border-gold-400/40 bg-ink-950/95 p-3 text-xs text-marble-100 shadow-2xl" style={{ top: r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 296, r.right - 288)) }} role="dialog" aria-label="Sound settings">
          <b className="font-display text-sm text-gold-200">🔊 Sound</b>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.sfx} onChange={(e) => { setSoundSettings({ sfx: e.target.checked }); if (e.target.checked) play('hit'); }} data-testid="sound-sfx" /> Effects (attacks, hits, spells, growls …)</label>
          <input type="range" min={0} max={1} step={0.05} value={s.sfxVolume} disabled={!s.sfx} onChange={(e) => setSoundSettings({ sfxVolume: Number(e.target.value) })} onPointerUp={() => play('swing')} aria-label="Effects volume" className="w-full accent-amber-400" />
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.music} onChange={(e) => setSoundSettings({ music: e.target.checked })} data-testid="sound-music" /> Music and ambience</label>
          <input type="range" min={0} max={1} step={0.05} value={s.musicVolume} disabled={!s.music} onChange={(e) => setSoundSettings({ musicVolume: Number(e.target.value) })} aria-label="Music volume" className="w-full accent-amber-400" />
          <div className="space-y-0.5" role="radiogroup" aria-label="Track">
            {TRACKS.map((t: Track) => (
              <button key={t} type="button" role="radio" aria-checked={s.track === t} disabled={!s.music} className={`block w-full rounded px-2 py-0.5 text-left ${s.track === t ? 'bg-gold-500/25 text-gold-100' : 'text-marble-300 hover:bg-ink-800'} disabled:opacity-40`} onClick={() => setSoundSettings({ track: t })} data-testid={`sound-track-${t}`}>{TRACK_LABEL[t]}</button>
            ))}
          </div>
          <p className="text-[10px] text-marble-500">All sounds are made in your browser while you play. Settings are kept on this device.</p>
          <button type="button" className="btn btn-ghost w-full py-0.5" onClick={() => setOpen(false)}>Close</button>
        </div>, document.body)}
    </span>
  );
}
