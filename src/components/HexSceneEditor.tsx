/**
 * Scenes → editor for battle and region maps. Same hex engine as the Arena (HexSceneMap): paint
 * terrain with a brush, generate terrain with the Arena generator, or import a picture/PDF that is
 * sampled into hex terrain. Markers (spawn, locations, labels) sit on hex centres.
 */
import { useState } from 'react';
import type { MapNode, SceneMap } from '../campaign/maps';
import {
  PRESETS,
  TILESETS,
  convertToBattleTiles,
  generateBattleScene,
  tileSetOf,
  type TileId,
  MAX_HEX_RADIUS,
  MIN_HEX_RADIUS,
  generateHexScene,
  hexAt,
  hexCentre,
  neighbourKeys,
  paintHexes,
  setHeights,
  MAX_LEVEL,
  passable,
  replaceTerrain,
  resizeHexScene,
  sampleImageToHex,
  type HexPreset,
} from '../campaign/hexScene';
import { loadPictureForSampling } from '../campaign/pictureSampling';
import { ORIGIN, hexKey, hexesInRange, parseKey, type HexKey } from '../game/hex';
import type { SceneDefinition } from '../server/scenes';
import { HexSceneMap } from './map/HexSceneMap';
import { PALETTE_PRESETS, paletteKey } from '../campaign/palette';

type Tool = 'brush' | 'height' | 'select' | 'spawn' | 'location' | 'label' | 'light';
const TOOL_LABEL: Record<Tool, string> = { brush: '🖌 Paint terrain', height: '⛰ Height', select: '◎ Select', spawn: '⇣ Spawn', location: '◆ Location', label: '✎ Label', light: '🔥 Light' };

export function HexSceneEditor({
  scene,
  map,
  change,
  busy,
  setMessage,
}: {
  scene: SceneDefinition;
  map: SceneMap;
  change: (patch: Partial<SceneMap> | SceneMap, replace?: boolean) => void;
  busy: boolean;
  setMessage: (m: string) => void;
}) {
  const [tool, setTool] = useState<Tool>('brush');
  const set = tileSetOf(map.hex);
  const battleScene = scene.category === 'battle';
  const [terrain, setTerrain] = useState<TileId>(set === 'battle' ? 'wall' : 'forest');
  const palette = TILESETS[set];
  const [brush, setBrush] = useState<0 | 1>(0);
  const [level, setLevel] = useState(2);
  const [selected, setSelected] = useState<string | null>(null);
  const [preset, setPreset] = useState<HexPreset>('forest');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [importRadius, setImportRadius] = useState(map.hex?.radius ?? 10);
  const [crop, setCrop] = useState(true);
  const [undo, setUndo] = useState<SceneMap | null>(null);
  const [importing, setImporting] = useState(false);
  const current = map.nodes.find((n) => n.id === selected);
  const radius = map.hex?.radius ?? 8;

  function paint(key: HexKey) {
    if (!map.hex) return;
    const keys = brush ? [key, ...neighbourKeys(key)] : [key];
    if (tool === 'height') {
      // APEX 1.8: ground height in 5-ft levels (one level = a step, two or more = a cliff)
      const next = setHeights(map.hex, keys, () => level);
      if (next.heights !== map.hex.heights) change({ hex: next });
      return;
    }
    const next = paintHexes(map.hex, keys, terrain);
    if (next.terrain !== map.hex.terrain) change({ hex: next });
  }
  function nodeChange(patch: Partial<MapNode>) {
    change({ nodes: map.nodes.map((n) => (n.id === selected ? { ...n, ...patch } : n)) });
  }
  function clickHex(key: HexKey) {
    const at = map.nodes.find((n) => hexKey(hexAt(map, n)) === key);
    if (tool === 'select') return setSelected(at?.id ?? null);
    if (tool === 'brush' || tool === 'height') return;
    if (!passable(map, parseKey(key)) && tool !== 'label' && tool !== 'light') return setMessage(`Impassable hexes cannot hold a ${tool}. Paint passable terrain first.`);
    const p = hexCentre(map, parseKey(key));
    if (tool === 'spawn') {
      const spawn = map.nodes.find((n) => n.kind === 'spawn');
      if (spawn) {
        change({ nodes: map.nodes.map((n) => (n.id === spawn.id ? { ...n, ...p } : n)) });
        setSelected(spawn.id);
        return setMessage('Spawn moved. Players arrive here when they are sent to this scene.');
      }
    }
    const n: MapNode = { id: crypto.randomUUID(), ...p, label: tool === 'spawn' ? 'Arrival' : tool === 'location' ? 'New location' : tool === 'light' ? 'Torch' : 'Label', kind: tool, visible: tool !== 'spawn', width: 50, height: 50, description: '', targetScene: null, ...(tool === 'light' ? { lightFt: 30 } : {}) };
    change({ nodes: [...map.nodes, n] });
    setSelected(n.id);
    setTool('select');
  }
  function generate() {
    setUndo(map);
    change(replaceTerrain(map, set === 'battle' ? generateBattleScene(preset, radius, seed) : generateHexScene(preset, radius, seed)), true);
    setMessage(`Generated “${PRESETS[set].find((p) => p.id === preset)?.label}” with seed ${seed}. Markers were kept. Save the draft to keep it.`);
  }
  async function importPicture(file?: File) {
    if (!file) return;
    setImporting(true);
    setMessage('Reading the picture…');
    try {
      const picture = await loadPictureForSampling(file);
      const data = sampleImageToHex(picture.pixels, picture.width, picture.height, importRadius, crop, set);
      setUndo(map);
      change(replaceTerrain(map, data), true);
      setMessage(`${file.name} was sampled into ${data.terrain.replace(/\./g, '').length} hexes (radius ${data.radius}). Colours are matched to the nearest ${set === 'battle' ? '5-ft tile' : 'Arena terrain'} – paint corrections with the brush, then save.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const visibleTools = (Object.keys(TOOL_LABEL) as Tool[]).filter((t) => (t !== 'light' && t !== 'height') || set === 'battle');
  return (
    <>
    {battleScene && set !== 'battle' && (
      <div role="note" className="scene-legacy-banner">
        <strong>Overview-scale terrain.</strong> This battle map still uses the Arena's overview tiles (mountains, forests). Battle maps now use 5-ft tiles – walls, single trees, boulders, floors – where line of sight matters.
        <div className="journal-toolbar">
          <button type="button" className="btn btn-gold" disabled={busy} onClick={() => (change(convertToBattleTiles(map, seed), true), setTerrain('wall'), setMessage('Converted to 5-ft battle tiles: mountains became walls, forests single trees and undergrowth. Check, then save.'))}>
            Convert to 5-ft battle tiles
          </button>
        </div>
      </div>
    )}
    <div className="scene-editor-columns">
      <div className="scene-editor-canvas-panel">
        <p>
          {scene.category} · Arena hex engine · {map.unitsPerCell} {map.unit} per hex
        </p>
        <div className="journal-toolbar" role="toolbar" aria-label="Hex map tools">
          {visibleTools.map((t) => (
            <button key={t} type="button" className="btn btn-ghost" aria-pressed={tool === t} disabled={busy} onClick={() => setTool(t)}>
              {TOOL_LABEL[t]}
            </button>
          ))}
        </div>
        {tool === 'brush' && (
          <div className="hex-palette" role="radiogroup" aria-label="Tile library">
            {[...new Set(palette.map((t) => t.group))].map((group) => (
              <div key={group} className="hex-palette-group">
                <span className="hex-palette-title">{group}</span>
                {palette.filter((t) => t.group === group).map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={terrain === t.id} title={`${t.label} – ${t.cost === null ? 'blocks movement' : t.cost > 1 ? `difficult (×${t.cost})` : 'open'}${t.blocksSight ? ', blocks sight' : ''}${t.light ? `, light ${t.light} ft` : ''}`} onClick={() => setTerrain(t.id)}>
                    <span style={{ background: t.fill, boxShadow: t.accent ? `inset -4px -4px 0 ${t.accent}` : undefined }} />
                    {t.label}
                  </button>
                ))}
              </div>
            ))}
            <label className="hex-brush-size">
              <input type="checkbox" checked={brush === 1} onChange={(e) => setBrush(e.target.checked ? 1 : 0)} /> Large brush
            </label>
          </div>
        )}
        {tool === 'height' && (
          <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Height brush" data-testid="height-brush">
            <span className="text-marble-300">Ground height</span>
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setLevel((l) => Math.max(0, l - 1))} aria-label="Lower">−</button>
            <input type="range" min={0} max={MAX_LEVEL} value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Level" />
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setLevel((l) => Math.min(MAX_LEVEL, l + 1))} aria-label="Higher">+</button>
            <b className="tabular-nums text-gold-200">{level * 5} ft</b>
            {[0, 1, 2, 4, 6].map((l) => <button key={l} type="button" className="btn btn-ghost px-2 py-0.5" aria-pressed={level === l} onClick={() => setLevel(l)}>{l * 5} ft</button>)}
            <label className="hex-brush-size"><input type="checkbox" checked={brush === 1} onChange={(e) => setBrush(e.target.checked ? 1 : 0)} /> Large brush</label>
            {map.hex?.heights && <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => { if (map.hex) change({ hex: setHeights(map.hex, [...hexesInRange(ORIGIN, map.hex.radius)].map(hexKey), () => 0) }); }}>Flatten all</button>}
            <span className="text-marble-500">One level (5 ft) is a step – climbing up costs 5 ft extra. Two or more levels are a cliff walkers can't take.</span>
          </div>
        )}
        <p className="text-xs text-marble-400">{tool === 'height' ? 'Click or drag over hexes to set their ground height.' : tool === 'brush' ? 'Click or drag over hexes to paint. Mouse wheel zooms.' : tool === 'select' ? 'Click a marker to edit it. Drag to pan, mouse wheel zooms.' : `Click a hex to place the ${tool}.`}</p>
        <div className="scene-editor-hex">
          <HexSceneMap map={map} label={`${scene.name} editor`} gm selectedHex={current ? hexKey(hexAt(map, current)) : null} onPaint={(tool === 'brush' || tool === 'height') && !busy ? paint : undefined} onHexClick={tool !== 'brush' && tool !== 'height' && !busy ? (k) => clickHex(k) : undefined} />
        </div>
      </div>
      <aside className="scene-editor-inspector" aria-label="Hex map settings">
        <fieldset disabled={busy} className="scene-generator-panel" data-testid="colour-scheme">
          <legend>Colour scheme</legend>
          <p>Recolours all tiles of this map (remembered fog stays grey).</p>
          <label>
            Preset{' '}
            <select value={PALETTE_PRESETS.find((p) => paletteKey(p.palette) === paletteKey(map.palette))?.id ?? (map.palette ? 'custom' : '')} onChange={(e) => change({ palette: e.target.value ? PALETTE_PRESETS.find((p) => p.id === e.target.value)?.palette ?? map.palette : undefined })}>
              <option value="">Original colours</option>
              {PALETTE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {map.palette && !PALETTE_PRESETS.some((p) => paletteKey(p.palette) === paletteKey(map.palette)) && <option value="custom">Custom</option>}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {(map.palette?.colors ?? []).map((c, i) => (
              <span key={i} className="inline-flex items-center gap-0.5">
                <input type="color" aria-label={`Scheme colour ${i + 1}`} value={c} onChange={(e) => change({ palette: { ...map.palette!, colors: map.palette!.colors.map((x, j) => (j === i ? e.target.value : x)) } })} />
                {map.palette!.colors.length > 2 && (
                  <button type="button" className="ws-icon" aria-label={`Remove colour ${i + 1}`} onClick={() => change({ palette: { ...map.palette!, colors: map.palette!.colors.filter((_, j) => j !== i) } })}>
                    ×
                  </button>
                )}
              </span>
            ))}
            <button type="button" className="btn btn-ghost" disabled={(map.palette?.colors.length ?? 0) >= 6} onClick={() => change({ palette: { colors: [...(map.palette?.colors ?? ['#3a2a1a']), '#d8b060'], strength: map.palette?.strength ?? 0.6 } })}>
              + Colour
            </button>
          </div>
          {map.palette && (
            <label>
              Strength · {Math.round(map.palette.strength * 100)}% <input type="range" min="0" max="100" value={Math.round(map.palette.strength * 100)} onChange={(e) => change({ palette: { ...map.palette!, strength: Number(e.target.value) / 100 } })} />
            </label>
          )}
        </fieldset>
        <fieldset disabled={busy || importing} className="scene-generator-panel">
          <legend>Generate terrain</legend>
          <label>
            Style{' '}
            <select value={preset} onChange={(e) => setPreset(e.target.value as HexPreset)}>
              {PRESETS[set].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seed <input type="number" min="0" max="4294967295" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <div className="scene-editor-actions">
            <button type="button" className="btn btn-gold" onClick={generate}>
              Generate
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSeed((s) => (s + 1) >>> 0)}>
              Next seed
            </button>
            <button type="button" className="btn btn-ghost" disabled={!undo} onClick={() => (undo && change(undo, true), setUndo(null), setMessage('Previous terrain restored.'))}>
              Undo
            </button>
          </div>
        </fieldset>
        <fieldset disabled={busy || importing} className="scene-generator-panel">
          <legend>Import picture or PDF</legend>
          <p>A map picture (PNG, JPG, WebP) or the first page of a PDF is sampled into hex terrain by colour. Nothing is uploaded.</p>
          <label>
            Hex radius · {importRadius} <input type="range" min={MIN_HEX_RADIUS} max={MAX_HEX_RADIUS} value={importRadius} onChange={(e) => setImportRadius(Number(e.target.value))} />
          </label>
          <label>
            <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} /> Leave hexes outside the picture empty
          </label>
          <label>
            Choose file <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" aria-label="Import map picture or PDF" onChange={(e) => (void importPicture(e.target.files?.[0]), (e.target.value = ''))} />
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Map settings</legend>
          <label>
            Hex radius · {radius} ({3 * radius * (radius + 1) + 1} hexes){' '}
            <input type="range" min={MIN_HEX_RADIUS} max={MAX_HEX_RADIUS} value={radius} onChange={(e) => change(resizeHexScene(map, Number(e.target.value)), true)} />
          </label>
          <p className="text-xs text-marble-400">
            Scale: {set === 'battle' ? '1 hex = 5 ft (one square in 5e).' : '1 hex = 3 miles · 8 hexes per day at speed 30 (Arena scale).'}
          </p>
          <label>
            GM notes <textarea maxLength={20000} value={map.gmNotes} onChange={(e) => change({ gmNotes: e.target.value })} />
          </label>
        </fieldset>
        <section className="scene-layer-panel" aria-label="Markers">
          <h3 className="panel-title">Markers · {map.nodes.length}</h3>
          {map.nodes.length ? (
            <ul>
              {map.nodes.map((n) => (
                <li key={n.id} className={selected === n.id ? 'is-selected' : ''}>
                  <button type="button" className="scene-layer-select" aria-pressed={selected === n.id} onClick={() => setSelected(n.id)}>
                    {n.kind === 'spawn' ? '⇣ ' : n.kind === 'label' ? '✎ ' : n.kind === 'light' ? '🔥 ' : '◆ '}
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No markers yet. Use Spawn, Location or Label and click a hex.</p>
          )}
        </section>
        {current && (
          <fieldset disabled={busy}>
            <legend>Selected {current.kind}</legend>
            <label>
              Label <input maxLength={120} value={current.label} onChange={(e) => nodeChange({ label: e.target.value })} />
            </label>
            <label>
              Description <textarea maxLength={2000} value={current.description} onChange={(e) => nodeChange({ description: e.target.value })} />
            </label>
            {current.kind === 'light' && (
              <label>
                Light radius · {current.lightFt ?? 30} ft <input type="range" min="10" max="60" step="5" value={current.lightFt ?? 30} onChange={(e) => nodeChange({ lightFt: Number(e.target.value) })} />
              </label>
            )}
            {current.kind !== 'spawn' && (
              <>
                <label>
                  <input type="checkbox" checked={current.visible} onChange={(e) => nodeChange({ visible: e.target.checked })} /> Revealed to players
                </label>
                <label>
                  <input type="checkbox" checked={current.discoverable ?? false} onChange={(e) => nodeChange({ discoverable: e.target.checked })} /> Discoverable during exploration
                </label>
              </>
            )}
            <label>
              Linked scene ID <input value={current.targetScene ?? ''} onChange={(e) => nodeChange({ targetScene: e.target.value || null })} />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                change({ nodes: map.nodes.filter((n) => n.id !== selected) });
                setSelected(null);
              }}
            >
              Remove marker
            </button>
          </fieldset>
        )}
      </aside>
    </div>
    </>
  );
}
