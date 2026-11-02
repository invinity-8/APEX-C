/**
 * Character Appearance / Identity: portrait (upload, crop, reposition), character tag, primary and
 * accent colour, marker style – with a live preview. Purely cosmetic: saved through the server like
 * any other change of the own character, never affects rules or permissions.
 */
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Command } from '../game/commands';
import { MARKER_STYLES, type MarkerStyle } from '../game/types';
import type { TokenView } from '../game/visibility';
import type { DispatchResult, GameApi } from '../state/gameApi';
import { CharacterPortrait, MARKER_LABEL, MarkerPreview } from './CharacterVisuals';
import { Spinner } from './brand';

const PALETTE = ['#d6b878', '#c09b58', '#c0392b', '#a3262b', '#6fb1e0', '#3d6fa6', '#7cc98a', '#3a7d44', '#a78bfa', '#6b4fa0', '#ece4d2', '#8a7a66'];
const OUT = 512; // exported portrait size (px)
const VIEW = 220; // crop preview size (px)

interface Props {
  game: GameApi;
  token: TokenView;
  run: (cmd: Command) => Promise<DispatchResult>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

export function AppearanceEditor({ game, token, run, notify }: Props) {
  const [title, setTitle] = useState(token.title);
  const [color, setColor] = useState(token.color);
  const [accent, setAccent] = useState(token.accent ?? '#c09b58');
  const [marker, setMarker] = useState<MarkerStyle>(token.marker ?? 'medallion');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(token.title);
    setColor(token.color);
    setAccent(token.accent ?? '#c09b58');
    setMarker(token.marker ?? 'medallion');
  }, [token.id, token.title, token.color, token.accent, token.marker]);
  const dirty = title !== token.title || color !== token.color || accent !== (token.accent ?? '#c09b58') || marker !== (token.marker ?? 'medallion');

  const save = async () => {
    setSaving(true);
    const r = await run({ type: 'setAppearance', tokenId: token.id, title: title.trim() || token.title, color, accent, marker });
    setSaving(false);
    if (r.ok) notify('Appearance saved – visible on the map and on character cards.', 'info');
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="panel space-y-3 p-3">
        <h3 className="panel-title">Portrait</h3>
        <PortraitCropper game={game} token={token} notify={notify} />
      </section>
      <section className="panel space-y-3 p-3">
        <h3 className="panel-title">Identity &amp; style</h3>
        <label className="block text-xs text-marble-300">
          Character tag
          <input
            className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-marble-50 focus:border-gold-400 focus:outline-none"
            value={title}
            maxLength={40}
            placeholder="e.g. Druid of the Wilds"
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="text-[10px] text-marble-500">Shown below the name. Cosmetic only – it never grants any rights.</span>
        </label>
        <ColorField label="Primary colour" value={color} onChange={setColor} />
        <ColorField label="Accent colour" value={accent} onChange={setAccent} />
        <fieldset>
          <legend className="mb-1 text-xs text-marble-300">Marker style</legend>
          <div className="flex flex-wrap gap-2">
            {MARKER_STYLES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={marker === m}
                onClick={() => setMarker(m)}
                className={`flex flex-col items-center rounded-lg border px-2 py-1 text-[10px] ${marker === m ? 'border-gold-400 bg-gold-400/10 text-gold-200' : 'border-ink-600 text-marble-300'}`}
              >
                <MarkerPreview style={m} color={color} accent={accent} initials={token.initials} size={40} />
                {MARKER_LABEL[m]}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="rounded-lg border border-gold-700/40 bg-ink-900/60 p-3">
          <div className="label mb-2">Preview</div>
          <div className="flex items-center gap-3">
            <CharacterPortrait tokenId={token.id} portraitV={token.portraitV} online={game.mode === 'online'} color={color} accent={accent} initials={token.initials} name={token.name} size={56} />
            <div className="leading-tight">
              <div className="font-display text-lg font-bold text-marble-50">{token.name}</div>
              <div className="text-xs" style={{ color: accent }}>
                {title || token.title}
              </div>
            </div>
            <div className="ml-auto rounded-lg bg-[#2b3524] p-1" title="On the map">
              <MarkerPreview style={marker} color={color} accent={accent} initials={token.initials} size={44} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="btn btn-ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setTitle(token.title);
              setColor(token.color);
              setAccent(token.accent ?? '#c09b58');
              setMarker(token.marker ?? 'medallion');
            }}
          >
            Reset
          </button>
          <button className="btn btn-gold" disabled={!dirty || saving} onClick={() => void save()}>
            {saving && <Spinner />} Save appearance
          </button>
        </div>
      </section>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs text-marble-300">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            aria-pressed={value.toLowerCase() === c}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-full border-2 ${value.toLowerCase() === c ? 'border-gold-200' : 'border-ink-700'}`}
            style={{ background: c }}
          />
        ))}
        <input type="color" aria-label={`${label} (custom)`} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-ink-600 bg-ink-900" />
      </div>
    </div>
  );
}

/** Upload → zoom & drag to position → export a square WebP/JPEG (the original never leaves the device). */
function PortraitCropper({ game, token, notify }: { game: GameApi; token: TokenView; notify: (msg: string, kind?: 'error' | 'info') => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const supported = !!game.uploadPortrait;

  // Draw the crop preview.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    const base = Math.max(VIEW / img.width, VIEW / img.height) * zoom;
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.drawImage(img, VIEW / 2 - (img.width * base) / 2 + off.x, VIEW / 2 - (img.height * base) / 2 + off.y, img.width * base, img.height * base);
  }, [img, zoom, off]);

  const pick = (f: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return notify('Please choose a JPG, PNG or WebP picture.');
    if (f.size > 15 * 1024 * 1024) return notify('This picture is too large (max. 15 MB).');
    const url = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setZoom(1);
      setOff({ x: 0, y: 0 });
    };
    i.onerror = () => notify('This picture could not be read.');
    i.src = url;
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y });
  };

  const upload = async () => {
    if (!img || !game.uploadPortrait) return;
    setBusy(true);
    const out = document.createElement('canvas');
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext('2d')!;
    const k = OUT / VIEW;
    const base = Math.max(VIEW / img.width, VIEW / img.height) * zoom * k;
    ctx.drawImage(img, OUT / 2 - (img.width * base) / 2 + off.x * k, OUT / 2 - (img.height * base) / 2 + off.y * k, img.width * base, img.height * base);
    let data = out.toDataURL('image/webp', 0.85);
    if (!data.startsWith('data:image/webp')) data = out.toDataURL('image/jpeg', 0.85); // Safari fallback
    const r = await game.uploadPortrait(token.id, data);
    setBusy(false);
    if (r.ok) {
      notify('Portrait saved.', 'info');
      setImg(null);
    } else notify(r.error ?? 'The portrait could not be saved.');
  };

  if (!supported) return <p className="text-xs text-marble-500">Portraits are stored online and are not available in the local demo.</p>;
  return (
    <div className="space-y-2">
      {!img ? (
        <div className="flex items-center gap-3">
          <CharacterPortrait tokenId={token.id} portraitV={token.portraitV} online color={token.color} accent={token.accent} initials={token.initials} name={token.name} size={96} />
          <div className="space-y-1 text-xs text-marble-300">
            <p>JPG, PNG or WebP. You can zoom and move the picture before saving. Only signed-in members of this campaign can see it.</p>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              {token.portraitV ? 'Change portrait…' : 'Upload portrait…'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <canvas
            ref={canvas}
            width={VIEW}
            height={VIEW}
            className="cursor-move touch-none rounded-full border-2 border-gold-400"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            aria-label="Drag to position the portrait"
          />
          <div className="min-w-[10rem] flex-1 space-y-2 text-xs text-marble-300">
            <label className="block">
              Zoom
              <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" aria-label="Zoom" />
            </label>
            <p className="text-marble-500">Drag the picture to reposition it.</p>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => setImg(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={() => void upload()} disabled={busy}>
                {busy && <Spinner />} Save portrait
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="Choose a portrait picture"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) pick(f);
        }}
      />
    </div>
  );
}
