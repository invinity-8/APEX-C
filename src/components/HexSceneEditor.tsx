/**
 * Scenes → editor for battle and region maps. Same hex engine as the Arena (HexSceneMap): paint
 * terrain with a brush, generate terrain with the Arena generator, or import a picture/PDF that is
 * sampled into hex terrain. Markers (spawn, locations, labels) sit on hex centres.
 */
import { useState } from 'react';
import type { MapNode, SceneMap } from '../campaign/maps';
import {
  HEX_PRESETS,
  MAX_HEX_RADIUS,
  MIN_HEX_RADIUS,
  generateHexScene,
  hexAt,
  hexCentre,
  neighbourKeys,
  paintHexes,
  passable,
  replaceTerrain,
  resizeHexScene,
  sampleImageToHex,
  type HexPreset,
} from '../campaign/hexScene';
import { loadPictureForSampling } from '../campaign/pictureSampling';
import { hexKey, parseKey, type HexKey } from '../game/hex';
import { TERRAIN, TERRAIN_ORDER, type TerrainType } from '../game/terrain';
import type { SceneDefinition } from '../server/scenes';
import { HexSceneMap } from './map/HexSceneMap';

type Tool = 'brush' | 'select' | 'spawn' | 'location' | 'label';
const TOOL_LABEL: Record<Tool, string> = { brush: '🖌 Paint terrain', select: '◎ Select', spawn: '⇣ Spawn', location: '◆ Location', label: '✎ Label' };

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
  const [terrain, setTerrain] = useState<TerrainType>('forest');
  const [brush, setBrush] = useState<0 | 1>(0);
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
    const next = paintHexes(map.hex, keys, terrain);
    if (next.terrain !== map.hex.terrain) change({ hex: next });
  }
  function nodeChange(patch: Partial<MapNode>) {
    change({ nodes: map.nodes.map((n) => (n.id === selected ? { ...n, ...patch } : n)) });
  }
  function clickHex(key: HexKey) {
    const at = map.nodes.find((n) => hexKey(hexAt(map, n)) === key);
    if (tool === 'select') return setSelected(at?.id ?? null);
    if (tool === 'brush') return;
    if (!passable(map, parseKey(key)) && tool !== 'label') return setMessage(`Impassable hexes cannot hold a ${tool}. Paint passable terrain first.`);
    const p = hexCentre(map, parseKey(key));
    if (tool === 'spawn') {
      const spawn = map.nodes.find((n) => n.kind === 'spawn');
      if (spawn) {
        change({ nodes: map.nodes.map((n) => (n.id === spawn.id ? { ...n, ...p } : n)) });
        setSelected(spawn.id);
        return setMessage('Spawn moved. Players arrive here when they are sent to this scene.');
      }
    }
    const n: MapNode = { id: crypto.randomUUID(), ...p, label: tool === 'spawn' ? 'Arrival' : tool === 'location' ? 'New location' : 'Label', kind: tool, visible: tool !== 'spawn', width: 50, height: 50, description: '', targetScene: null };
    change({ nodes: [...map.nodes, n] });
    setSelected(n.id);
    setTool('select');
  }
  function generate() {
    setUndo(map);
    change(replaceTerrain(map, generateHexScene(preset, radius, seed)), true);
    setMessage(`Generated “${HEX_PRESETS.find((p) => p.id === preset)?.label}” with seed ${seed}. Markers were kept. Save the draft to keep it.`);
  }
  async function importPicture(file?: File) {
    if (!file) return;
    setImporting(true);
    setMessage('Reading the picture…');
    try {
      const picture = await loadPictureForSampling(file);
      const data = sampleImageToHex(picture.pixels, picture.width, picture.height, importRadius, crop);
      setUndo(map);
      change(replaceTerrain(map, data), true);
      setMessage(`${file.name} was sampled into ${data.terrain.replace(/\./g, '').length} hexes (radius ${data.radius}). Colours are matched to the nearest Arena terrain – paint corrections with the brush, then save.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="scene-editor-columns">
      <div className="scene-editor-canvas-panel">
        <p>
          {scene.category} · Arena hex engine · {map.unitsPerCell} {map.unit} per hex
        </p>
        <div className="journal-toolbar" role="toolbar" aria-label="Hex map tools">
          {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
            <button key={t} type="button" className="btn btn-ghost" aria-pressed={tool === t} disabled={busy} onClick={() => setTool(t)}>
              {TOOL_LABEL[t]}
            </button>
          ))}
        </div>
        {tool === 'brush' && (
          <div className="hex-palette" role="radiogroup" aria-label="Terrain">
            {TERRAIN_ORDER.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={terrain === t} title={`${TERRAIN[t].label} – ${TERRAIN[t].cost === null ? 'impassable' : `cost ${TERRAIN[t].cost}`}`} onClick={() => setTerrain(t)}>
                <span style={{ background: TERRAIN[t].fill }} />
                {TERRAIN[t].label}
              </button>
            ))}
            <label className="hex-brush-size">
              <input type="checkbox" checked={brush === 1} onChange={(e) => setBrush(e.target.checked ? 1 : 0)} /> Large brush
            </label>
          </div>
        )}
        <p className="text-xs text-marble-400">{tool === 'brush' ? 'Click or drag over hexes to paint. Mouse wheel zooms.' : tool === 'select' ? 'Click a marker to edit it. Drag to pan, mouse wheel zooms.' : `Click a hex to place the ${tool}.`}</p>
        <div className="scene-editor-hex">
          <HexSceneMap map={map} label={`${scene.name} editor`} gm selectedHex={current ? hexKey(hexAt(map, current)) : null} onPaint={tool === 'brush' && !busy ? paint : undefined} onHexClick={tool !== 'brush' && !busy ? (k) => clickHex(k) : undefined} />
        </div>
      </div>
      <aside className="scene-editor-inspector" aria-label="Hex map settings">
        <fieldset disabled={busy || importing} className="scene-generator-panel">
          <legend>Generate terrain</legend>
          <label>
            Style{' '}
            <select value={preset} onChange={(e) => setPreset(e.target.value as HexPreset)}>
              {HEX_PRESETS.map((p) => (
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
          <label>
            {map.unit} per hex <input type="number" min="0.01" max="10000" step="0.01" value={map.unitsPerCell} onChange={(e) => change({ unitsPerCell: Number(e.target.value) })} />
          </label>
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
                    {n.kind === 'spawn' ? '⇣ ' : n.kind === 'label' ? '✎ ' : '◆ '}
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
  );
}
