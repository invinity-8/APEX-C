/**
 * APEX 2.9 – sound: effects and music, all synthesised in the browser with Web Audio (no recordings, no files).
 *
 *  - Effects: sword swing, hit, critical hit, miss, bow shot, bite, growl, spells by element (fire roar, frost
 *    tinkle, lightning crackle, thunder boom, radiant bells, necrotic drone, acid bubbles, psychic warble, arcane
 *    shimmer), healing chime, buff shimmer, a soft click for the interface.
 *  - Music: generative pieces that never repeat exactly – Tavern (lute and drum), Battle (war drums and a driving
 *    ostinato), Exploration (pads and a flute), Dungeon (drone and drips) – and a quiet Menu ambience (wind and far
 *    chimes). "Auto" picks Battle while initiative runs, Exploration on the map, the ambience in the menus.
 *  - Settings per browser: effects and music on/off and volume, the track. Browsers only allow sound after a click,
 *    so nothing plays before the first interaction.
 */

export const TRACKS = ['auto', 'tavern', 'battle', 'explore', 'dungeon', 'menu'] as const;
export type Track = (typeof TRACKS)[number];
export type Mood = 'battle' | 'explore' | 'menu';
export const TRACK_LABEL: Record<Track, string> = { auto: '✨ Auto (follows the game)', tavern: '🍺 Tavern', battle: '⚔ Battle', explore: '🌲 Exploration', dungeon: '🕯 Dungeon', menu: '🌬 Menu ambience' };
export interface SoundSettings { sfx: boolean; music: boolean; sfxVolume: number; musicVolume: number; track: Track }
const KEY = 'apex.sound';
const DEFAULTS: SoundSettings = { sfx: true, music: false, sfxVolume: 0.7, musicVolume: 0.35, track: 'auto' };

let settings: SoundSettings = (() => { try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundSettings>) }; } catch { return { ...DEFAULTS }; } })();
const listeners = new Set<(s: SoundSettings) => void>();
export const soundSettings = () => settings;
export function setSoundSettings(change: Partial<SoundSettings>) {
  settings = { ...settings, ...change };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  if (sfxBus) sfxBus.gain.value = settings.sfx ? settings.sfxVolume : 0;
  if (musicBus) musicBus.gain.setTargetAtTime(settings.music ? settings.musicVolume : 0, ctx!.currentTime, 0.3);
  syncMusic();
  for (const l of listeners) l(settings);
}
export const onSoundSettings = (f: (s: SoundSettings) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

let ctx: AudioContext | null = null;
let meter: AnalyserNode | null = null;
/** Loudness of what plays right now (0 … 1) – for the settings' level light and for checks. */
export function soundLevel(): number {
  if (!meter) return 0;
  const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d);
  return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
}
let sfxBus: GainNode | null = null, musicBus: GainNode | null = null, noiseBuf: AudioBuffer | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  const master = ctx.createDynamicsCompressor(); master.connect(ctx.destination);
  meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
  sfxBus = ctx.createGain(); sfxBus.gain.value = settings.sfx ? settings.sfxVolume : 0; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = settings.music ? settings.musicVolume : 0; musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
/** Call once from a user gesture (the app does it on the first click). */
export function unlockSound() { const c = audio(); if (c?.state === 'suspended') void c.resume(); syncMusic(); }

// ---------------------------------------------------------------- building blocks
type Env = { a?: number; d: number; peak?: number };
function env(g: GainNode, t: number, e: Env) { const p = e.peak ?? 1; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p, t + (e.a ?? 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + (e.a ?? 0.005) + e.d); }
function tone(out: AudioNode, t: number, freq: number, e: Env, type: OscillatorType = 'sine', glide?: number, detune = 0) {
  const c = ctx!; const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune; if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + (e.a ?? 0.005) + e.d);
  env(g, t, e); o.connect(g).connect(out); o.start(t); o.stop(t + (e.a ?? 0.005) + e.d + 0.05);
}
function noise(out: AudioNode, t: number, e: Env, filter: BiquadFilterType, f0: number, f1?: number, q = 1) {
  const c = ctx!; const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = c.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(f0, t); f.Q.value = q; if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + (e.a ?? 0.005) + e.d);
  const g = c.createGain(); env(g, t, e); s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + (e.a ?? 0.005) + e.d + 0.05);
}

// ---------------------------------------------------------------- effects
export type Sfx = 'swing' | 'hit' | 'crit' | 'miss' | 'bow' | 'bite' | 'growl' | 'heal' | 'buff' | 'click' | 'fire' | 'cold' | 'lightning' | 'thunder' | 'radiant' | 'necrotic' | 'acid' | 'poison' | 'psychic' | 'force' | 'arcane';
export function play(s: Sfx, delay = 0) {
  if (!settings.sfx) return;
  const c = audio(); if (!c || c.state !== 'running' || !sfxBus) return;
  const t = c.currentTime + delay, o = sfxBus;
  switch (s) {
    case 'swing': noise(o, t, { a: 0.04, d: 0.22, peak: 1 }, 'bandpass', 600, 2600, 1.1); break;
    case 'miss': noise(o, t, { a: 0.05, d: 0.28, peak: 0.8 }, 'bandpass', 900, 3200, 1.2); break;
    case 'hit': play('swing', delay); tone(o, t + 0.12, 140, { d: 0.22, peak: 0.9 }, 'sine', 45); noise(o, t + 0.12, { d: 0.09, peak: 0.6 }, 'lowpass', 1800); break;
    case 'crit': play('hit', delay); tone(o, t + 0.13, 1320, { d: 0.6, peak: 0.25 }, 'triangle'); tone(o, t + 0.13, 1980, { d: 0.5, peak: 0.12 }, 'sine'); break;
    case 'bow': tone(o, t, 220, { d: 0.18, peak: 0.4 }, 'sawtooth', 90); noise(o, t + 0.03, { a: 0.03, d: 0.35, peak: 0.25 }, 'highpass', 2500, 900); break;
    case 'bite': for (const k of [0, 0.09]) { noise(o, t + k, { d: 0.07, peak: 0.8 }, 'bandpass', 1400, 600, 2); tone(o, t + k, 120, { d: 0.08, peak: 0.5 }, 'square', 60); } break;
    case 'growl': {
      const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; g.connect(lp).connect(o);
      const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 23; lg.gain.value = 18;
      const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(78, t); osc.frequency.linearRampToValueAtTime(62, t + 0.9);
      lfo.connect(lg).connect(osc.frequency); osc.connect(g); env(g, t, { a: 0.12, d: 0.85, peak: 0.55 });
      osc.start(t); lfo.start(t); osc.stop(t + 1.1); lfo.stop(t + 1.1); noise(o, t, { a: 0.1, d: 0.8, peak: 0.15 }, 'bandpass', 300, 200, 3); break;
    }
    case 'heal': [523, 659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.08, f, { a: 0.01, d: 0.7, peak: 0.25 }, 'sine')); break;
    case 'buff': [784, 988, 1175].forEach((f, i) => tone(o, t + i * 0.05, f, { a: 0.02, d: 0.5, peak: 0.15 }, 'triangle')); noise(o, t, { a: 0.1, d: 0.4, peak: 0.08 }, 'highpass', 5000); break;
    case 'click': tone(o, t, 1800, { d: 0.03, peak: 0.12 }, 'square'); break;
    case 'fire': noise(o, t, { a: 0.08, d: 0.9, peak: 0.6 }, 'lowpass', 900, 300); tone(o, t, 70, { a: 0.05, d: 0.8, peak: 0.5 }, 'sine', 40); break;
    case 'cold': [1568, 2093, 2637, 2093].forEach((f, i) => tone(o, t + i * 0.05, f, { d: 0.35, peak: 0.12 }, 'sine')); noise(o, t, { a: 0.05, d: 0.5, peak: 0.12 }, 'highpass', 6000); break;
    case 'lightning': for (let i = 0; i < 6; i++) noise(o, t + i * 0.035 + Math.random() * 0.02, { d: 0.04, peak: 0.6 }, 'highpass', 2500); tone(o, t + 0.2, 60, { d: 0.6, peak: 0.5 }, 'sine', 35); break;
    case 'thunder': noise(o, t, { a: 0.02, d: 1.3, peak: 0.9 }, 'lowpass', 400, 80); tone(o, t, 55, { d: 1.2, peak: 0.6 }, 'sine', 30); break;
    case 'radiant': [880, 1109, 1319, 1760].forEach((f) => tone(o, t, f, { a: 0.02, d: 1.0, peak: 0.12 }, 'sine')); break;
    case 'necrotic': [110, 116.5].forEach((f) => tone(o, t, f, { a: 0.15, d: 0.9, peak: 0.3 }, 'sawtooth', f * 0.7)); break;
    case 'acid': case 'poison': for (let i = 0; i < 5; i++) tone(o, t + i * 0.07, 300 + Math.random() * 500, { d: 0.08, peak: 0.25 }, 'sine', 900); break;
    case 'psychic': tone(o, t, 440, { a: 0.1, d: 0.8, peak: 0.25 }, 'sine', 220, 0); tone(o, t, 447, { a: 0.1, d: 0.8, peak: 0.25 }, 'sine', 230); break;
    case 'force': case 'arcane': [659, 880, 1175, 1568].forEach((f, i) => tone(o, t + i * 0.04, f, { d: 0.4, peak: 0.14 }, 'triangle')); break;
  }
}

/** The sound of a combat event (from the scene's visual effects). */
export function playFx(f: { kind: string; element: string; ranged?: boolean; label?: string; from?: string }) {
  const beastly = /bite|claw|gore|tusk|maul|talon|sting|tail|horn/i.test(f.label ?? '');
  if (f.kind === 'heal') return play('heal');
  if (f.kind === 'buff') return play('buff');
  if (f.kind === 'debuff') return play(f.element === 'physical' ? 'necrotic' : (f.element as Sfx));
  if (f.kind === 'area') return play(f.element === 'physical' ? 'thunder' : f.element === 'heal' ? 'heal' : (f.element as Sfx));
  if (f.element !== 'physical' && f.element !== 'heal') return play(f.element as Sfx);
  if (beastly && f.kind !== 'miss') { play('bite'); if (Math.random() < 0.5) play('growl', 0.15); return; }
  if (f.ranged) { play('bow'); if (f.kind !== 'miss') play('hit', 0.25); return; }
  play(f.kind === 'crit' ? 'crit' : f.kind === 'miss' ? 'miss' : f.kind === 'resist' ? 'swing' : 'hit');
}

// ---------------------------------------------------------------- music
let mood: Mood = 'menu';
let playing: Exclude<Track, 'auto'> | null = null;
let timer: number | null = null;
let nextBeat = 0, beat = 0;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export function setMusicMood(m: Mood) { if (m !== mood) { mood = m; syncMusic(); } }
const wanted = (): Exclude<Track, 'auto'> | null => (!settings.music ? null : settings.track !== 'auto' ? settings.track : mood === 'battle' ? 'battle' : mood === 'explore' ? 'explore' : 'menu');
function syncMusic() {
  const w = wanted();
  if (w === playing) return;
  playing = w;
  if (timer !== null) { clearInterval(timer); timer = null; }
  const c = audio();
  if (!w || !c || !musicBus) return;
  nextBeat = c.currentTime + 0.1; beat = 0;
  timer = window.setInterval(schedule, 60);
}
const PIECES: Record<Exclude<Track, 'auto'>, { bpm: number; step: (t: number, b: number, o: AudioNode, len: number) => void }> = {
  // D dorian folk: plucked arpeggios over a drone, a frame drum on 1 and 3
  tavern: { bpm: 116, step: (t, b, o, len) => {
    const chords = [[62, 65, 69], [60, 64, 67], [62, 65, 69], [57, 60, 64]];
    const ch = chords[Math.floor(b / 8) % 4];
    const n = ch[[0, 1, 2, 1, 0, 2, 1, 2][b % 8]] + (b % 16 > 11 ? 12 : 0);
    tone(o, t, midi(n), { d: len * 1.6, peak: 0.16 }, 'triangle');
    if (b % 8 === 0) tone(o, t, midi(ch[0] - 24), { a: 0.02, d: len * 7, peak: 0.1 }, 'triangle');
    if (b % 4 === 0) tone(o, t, 95, { d: 0.18, peak: 0.35 }, 'sine', 50);
    if (b % 4 === 2) noise(o, t, { d: 0.06, peak: 0.12 }, 'bandpass', 2500);
    if (b % 16 === 14 && Math.random() < 0.6) tone(o, t, midi(ch[2] + 12), { a: 0.03, d: len * 3, peak: 0.08 }, 'sine');
  } },
  // D minor: taiko on the beat, a driving low ostinato, brass stabs now and then
  battle: { bpm: 140, step: (t, b, o, len) => {
    if (b % 4 === 0 || b % 8 === 7) tone(o, t, 80, { d: 0.35, peak: 0.6 }, 'sine', 40);
    if (b % 2 === 1) noise(o, t, { d: 0.05, peak: 0.1 }, 'highpass', 4000);
    const bass = [38, 38, 41, 38, 36, 36, 34, 36][Math.floor(b / 4) % 8];
    tone(o, t, midi(bass + (b % 2 ? 12 : 0)), { d: len * 0.9, peak: 0.14 }, 'sawtooth', undefined, -6);
    if (b % 32 === 0 || (b % 32 === 24 && Math.random() < 0.7)) [50, 53, 57].forEach((n) => { tone(o, t, midi(n), { a: 0.04, d: len * 5, peak: 0.07 }, 'sawtooth', undefined, 7); tone(o, t, midi(n), { a: 0.04, d: len * 5, peak: 0.07 }, 'sawtooth', undefined, -7); });
  } },
  // slow pads, a pentatonic flute
  explore: { bpm: 72, step: (t, b, o, len) => {
    const pads = [[50, 57, 62, 66], [48, 55, 60, 64], [45, 52, 57, 60], [47, 54, 59, 62]];
    if (b % 8 === 0) pads[Math.floor(b / 8) % 4].forEach((n) => tone(o, t, midi(n), { a: len * 2, d: len * 8, peak: 0.05 }, 'sine'));
    if (Math.random() < 0.45) { const scale = [74, 76, 78, 81, 83, 86]; tone(o, t, midi(scale[Math.floor(Math.random() * scale.length)]), { a: 0.06, d: len * 1.8, peak: 0.07 }, 'sine'); }
  } },
  // a low drone, drips and a far bell
  dungeon: { bpm: 60, step: (t, b, o, len) => {
    if (b % 16 === 0) [36, 36.2, 43].forEach((n) => tone(o, t, midi(n), { a: len * 4, d: len * 14, peak: 0.07 }, 'sawtooth'));
    if (Math.random() < 0.18) tone(o, t, 1200 + Math.random() * 900, { d: 0.12, peak: 0.08 }, 'sine', 600);
    if (b % 32 === 20) tone(o, t, midi(69), { a: 0.01, d: 3, peak: 0.06 }, 'triangle');
  } },
  // menu ambience: wind and a far chime
  menu: { bpm: 50, step: (t, b, o, len) => {
    if (b % 8 === 0) noise(o, t, { a: len * 3, d: len * 6, peak: 0.08 }, 'bandpass', 500 + Math.random() * 400, 300, 0.6);
    if (Math.random() < 0.12) [76, 83].forEach((n, i) => tone(o, t + i * 0.12, midi(n), { a: 0.01, d: 2.5, peak: 0.035 }, 'sine'));
  } },
};
function schedule() {
  const c = ctx; if (!c || !musicBus || !playing || c.state !== 'running') return;
  const piece = PIECES[playing];
  const len = 60 / piece.bpm / 2;
  while (nextBeat < c.currentTime + 0.25) { piece.step(nextBeat, beat, musicBus, len); nextBeat += len; beat++; }
}
