import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { emptyMap, parseMap, type MapNode, type SceneMap } from '../campaign/maps';
import { convertLegacyMap, newHexScene } from '../campaign/hexScene';
import { HexSceneEditor } from './HexSceneEditor';
import type { SceneDefinition } from '../server/scenes';
import { api } from '../online/api';
import { playerSafeBackground, prepareMapUpload } from '../campaign/imageUpload';
import { SceneGrid } from './SceneSurface';

const legacyFeatureColors = { tree: '#41664b', rock: '#877c6e', obstacle: '#78553d', water: '#3d7485' } as const;

/**
 * Scene map editor. Battle and region maps use the Arena hex engine (HexSceneEditor); celestial and
 * world maps keep the route/overview editor. Saved drafts and published definitions are separate.
 */
export function SceneMapEditor({ scene, onSaved }: { scene: SceneDefinition; onSaved: (scene: SceneDefinition) => void }) {
  const picture = scene.category === 'world' || scene.category === 'celestial';
  const [map, setMap] = useState<SceneMap>(() => parseMap(scene.metadata) ?? emptyMap(scene.category));
  const [revision, setRevision] = useState(scene.revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<MapNode['kind'] | 'select'>('select');
  const [zoom, setZoom] = useState(1);
  const [playerPreview, setPlayerPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [hours, setHours] = useState(1); const [distance, setDistance] = useState(0);
  const svg = useRef<SVGSVGElement>(null); const dragging = useRef<string | null>(null);
  const current = map.nodes.find(n => n.id === selected);
  useEffect(() => {
    let live = true; setBackgroundUrl(null);
    const id = playerPreview ? map.playerBackgroundAsset : map.backgroundAsset;
    if (id) api.mapImage(id).then(r => { if (live) setBackgroundUrl(r.url); }).catch(e => { if (live) setMessage(String(e)); });
    return () => { live = false; };
  }, [map.backgroundAsset, map.playerBackgroundAsset, playerPreview]);
  function change(patch: Partial<SceneMap> | SceneMap, replace = false) { setMap(old => (replace ? (patch as SceneMap) : { ...old, ...patch })); setDirty(true); if (!replace) setMessage(''); }
  function nodeChange(patch: Partial<MapNode>) { change({ nodes: map.nodes.map(n => n.id === selected ? { ...n, ...patch } : n) }); }
  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = svg.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(map.width, (event.clientX - rect.left) / rect.width * map.width)), y: Math.max(0, Math.min(map.height, (event.clientY - rect.top) / rect.height * map.height)) };
  }
  function add(event: PointerEvent<SVGSVGElement>) {
    if (playerPreview || tool === 'select' || busy) return;
    const n: MapNode = { id: crypto.randomUUID(), ...point(event), label: tool === 'spawn' ? 'Entry' : 'New ' + tool, kind: tool, visible: tool === 'spawn', width: 60, height: 60, description: '', targetScene: null };
    change({ nodes: [...map.nodes, n] }); setSelected(n.id); setTool('select');
  }
  async function save(publish = false) {
    setBusy(true); setMessage('');
    try {
      let candidate = map;
      if (publish && map.backgroundAsset && !map.hex) {
        const source = await api.mapImage(map.backgroundAsset);
        const safe = await playerSafeBackground(map, source.url);
        const asset = await api.mapUpload(scene.id, 'players', safe.image, safe.thumbnail);
        candidate = { ...map, playerBackgroundAsset: asset.id };
      }
      const result = await api.sceneAction(scene.id, revision, publish ? 'publish' : 'save', { map: candidate });
      setMap(candidate);
      setRevision(result.scene.revision); setDirty(false); setMessage(publish ? 'Scene published. Players have not been moved.' : 'Draft saved.'); onSaved(result.scene);
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setMessage('Processing map image…');
    try {
      const image = await prepareMapUpload(file); const asset = await api.mapUpload(scene.id, 'gm', image.image, image.thumbnail);
      if (picture) {
        // World / celestial maps are pictures: the map takes the picture's proportions (longest side 2000) and
        // players see the whole picture; markers keep their relative position.
        const k = 2000 / Math.max(image.width, image.height), width = Math.max(100, Math.round(image.width * k)), height = Math.max(100, Math.round(image.height * k));
        const sx = width / map.width, sy = height / map.height;
        change({ backgroundAsset: asset.id, playerBackgroundAsset: null, revealBackground: true, grid: 'none', width, height, nodes: map.nodes.map(n => ({ ...n, x: Math.min(width, n.x * sx), y: Math.min(height, n.y * sy) })) });
        setMessage('Map picture uploaded. Add locations, then publish – players see the whole picture with the revealed locations.');
      } else { change({ backgroundAsset: asset.id, playerBackgroundAsset: null }); setMessage('Private map uploaded. Publish to generate a separate player-safe image.'); }
    }
    catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }
  const displayedNodes = map.nodes;
  const visibleNodes = displayedNodes.filter(n => !playerPreview || (n.visible && n.kind !== 'spawn'));
  const hexCategory = scene.category === 'battle' || scene.category === 'region';
  const saveBar = <div className="journal-toolbar"><button className="btn btn-ghost" disabled={!dirty || busy} onClick={() => void save()}>Save draft</button><button className="btn btn-gold" disabled={busy} onClick={() => void save(true)}>Publish definition</button></div>;
  if (map.hex) return <section className="scene-editor scene-editor-full" aria-label="Map editor">
    <HexSceneEditor scene={scene} map={map} change={change} busy={busy} setMessage={setMessage} />
    {message && <p role="status">{message}</p>}
    <p className="text-xs text-marble-400">{dirty ? 'Unsaved changes.' : 'Saved definition.'} Players only see the published version.</p>
    {saveBar}
  </section>;
  return <section className="scene-editor scene-editor-full" aria-label="Map editor">
    {hexCategory && <div role="note" className="scene-legacy-banner">
      <strong>Old map format.</strong> Battle and region maps now use the Arena hex engine (hex tiles, terrain, mouse-wheel zoom). Convert this map – drawn trees, rocks, water and walls become hex terrain, spawn and locations are kept – or start over with an empty hex map. Nothing is stored until you save.
      <div className="journal-toolbar"><button className="btn btn-gold" disabled={busy} onClick={() => { change(convertLegacyMap(map), true); setMessage('Converted to a hex map. Check it, then save or publish.'); }}>Convert to hex map</button><button className="btn btn-ghost" disabled={busy} onClick={() => { change(newHexScene(map, 'blank', 8, Math.floor(Math.random() * 100000)), true); setMessage('Started an empty hex map. The old drawing is discarded when you save.'); }}>Replace with empty hex map</button></div>
    </div>}
    <div className="scene-editor-columns">
    <div className="scene-editor-canvas-panel">
    <p>{scene.category} · {map.interval} movement · {dirty ? 'Unsaved changes' : 'Saved definition'}</p>
    {picture && <p className="text-xs text-marble-400">World and celestial maps are pictures with clickable locations: upload a PNG/JPG, place locations (name + description) and routes, then publish.</p>}
    <div className="journal-toolbar" role="toolbar" aria-label="Map editor tools">{(picture ? ['select', 'location', 'label'] as const : ['select', 'location', 'label', 'spawn', 'wall', 'area'] as const).map(t => <button className="btn btn-ghost" key={t} disabled={playerPreview || busy} aria-pressed={tool === t} onClick={() => setTool(t)}>{t}</button>)}</div>
    <p>Choose a tool and click the map. Drag markers to move them. Scroll the map area to pan.</p>
    <label>Zoom <input type="range" min="0.4" max="2" step="0.1" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
    <label><input type="checkbox" checked={playerPreview} onChange={e => setPlayerPreview(e.target.checked)} /> Preview revealed map elements</label>
    <div className="scene-canvas-scroll scene-canvas-full"><svg ref={svg} role="img" aria-label="Editable scene map" width={map.width * zoom} height={map.height * zoom} viewBox={`0 0 ${map.width} ${map.height}`} onPointerDown={add} onPointerMove={e => { if (dragging.current && !busy) { const p = point(e); change({ nodes: map.nodes.map(n => n.id === dragging.current ? { ...n, ...p } : n) }); } }} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
      <rect width={map.width} height={map.height} fill={scene.category === 'celestial' ? '#101626' : '#302a20'} />
      {backgroundUrl && <image href={backgroundUrl} width={map.width} height={map.height} preserveAspectRatio="none" />}
      <SceneGrid map={map} id={`grid-${scene.id}`} />
      {map.routes.filter(r => !playerPreview || r.visible).map(r => { const a = visibleNodes.find(n => n.id === r.from), b = visibleNodes.find(n => n.id === r.to); return a && b ? <g key={r.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c9ac70" strokeDasharray="8 6" /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fill="#f3e4bd" fontSize="14">{r.hours}h</text></g> : null; })}
      {visibleNodes.map(n => <g key={n.id} opacity={n.generatedBy ? .78 : 1} onPointerDown={e => { e.stopPropagation(); if (!playerPreview && !busy) { setSelected(n.id); dragging.current = n.id; svg.current?.setPointerCapture(e.pointerId); } }}>
        {n.kind === 'wall' || n.kind === 'area' ? <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={n.proceduralFeature === 'water' ? 12 : 3} fill={n.proceduralFeature ? legacyFeatureColors[n.proceduralFeature] : n.kind === 'wall' ? '#877566' : '#52664d'} opacity={n.proceduralFeature === 'water' ? .72 : .82} stroke={selected === n.id ? '#fff' : n.generatedBy ? '#a8d8ad' : '#beab80'} strokeDasharray={n.generatedBy ? '4 3' : undefined} /> : <circle cx={n.x} cy={n.y} r={n.kind === 'spawn' ? 11 : 8} fill={n.visible ? '#d9bd76' : '#7a7589'} stroke={selected === n.id ? '#fff' : '#302a20'} strokeWidth="2" />}
        <text x={n.x + 15} y={n.y + 4} fill="#f5e6c6" fontSize="14">{n.label}{!n.visible && !playerPreview ? ' (hidden)' : ''}</text>
      </g>)}
    </svg></div>
    {message && <p role={message.startsWith('This layout') ? 'alert' : 'status'}>{message}</p>}
    </div>
    <aside className="scene-editor-inspector" aria-label="Scene settings and layers">
    {!playerPreview && <section className="scene-layer-panel" aria-label="Layers and objects"><h3 className="panel-title">Layers & objects · {map.nodes.length}</h3>
      {map.nodes.length ? <ul>{map.nodes.map(n => <li key={n.id} className={selected === n.id ? 'is-selected' : ''}><button className="scene-layer-select" aria-pressed={selected === n.id} onClick={() => setSelected(n.id)}>{n.generatedBy ? '✦ ' : ''}{n.label}</button><button className="btn btn-ghost" aria-label={`${n.visible ? 'Hide' : 'Reveal'} ${n.label}`} disabled={busy} onClick={() => change({ nodes: map.nodes.map(item => item.id === n.id ? { ...item, visible: !item.visible } : item) })}>◉</button></li>)}</ul> : <p>No objects yet. Choose a tool and click the map.</p>}
    </section>}
    {!playerPreview && <fieldset disabled={busy}>
      <legend>Map settings</legend>
      {!picture && <><label>Map width <input type="number" min="100" max="5000" value={map.width} onChange={e => change({ width: Number(e.target.value) })} /></label>
      <label>Map height <input type="number" min="100" max="5000" value={map.height} onChange={e => change({ height: Number(e.target.value) })} /></label>
      <label>Upload private map image <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <label><input type="checkbox" checked={map.revealBackground} onChange={e => change({ revealBackground: e.target.checked })} /> Reveal the entire background image</label>
      <p>Otherwise only revealed area rectangles are copied into the player image when publishing. The private source image remains GM-only.</p>
      <label>Grid <select value={map.grid} onChange={e => change({ grid: e.target.value as SceneMap['grid'] })}>{['none', 'square', 'hex'].map(g => <option key={g}>{g}</option>)}</select></label>
      <label>Cell size <input type="number" min="10" max="500" value={map.cell} onChange={e => change({ cell: Number(e.target.value) })} /></label>
      <label>{map.unit} per cell <input type="number" min="0.01" max="10000" step="0.01" value={map.unitsPerCell} onChange={e => change({ unitsPerCell: Number(e.target.value) })} /></label></>}
      {picture && <label>Upload map picture (PNG / JPG / WebP) <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>}
      <label>GM notes <textarea maxLength={20000} value={map.gmNotes} onChange={e => change({ gmNotes: e.target.value })} /></label>
      {current && <fieldset><legend>Selected {current.kind}</legend>
        <label>Label <input maxLength={120} value={current.label} onChange={e => nodeChange({ label: e.target.value })} /></label>
        <label>Description <textarea maxLength={2000} value={current.description} onChange={e => nodeChange({ description: e.target.value })} /></label>
        <label><input type="checkbox" checked={current.visible} onChange={e => nodeChange({ visible: e.target.checked })} /> Revealed to players</label>
        <label><input type="checkbox" checked={current.discoverable ?? false} onChange={e => nodeChange({ discoverable: e.target.checked })} /> Discoverable during exploration</label>
        {current.kind === 'area' && <label>Terrain movement cost <input type="number" min="1" max="10" step="0.5" value={current.terrainCost ?? 1} onChange={e => nodeChange({ terrainCost: Number(e.target.value) })} /></label>}
        <label>Linked scene ID <input value={current.targetScene ?? ''} onChange={e => nodeChange({ targetScene: e.target.value || null })} /></label>
        {(current.kind === 'wall' || current.kind === 'area') && <><label>Width <input type="number" min="1" max={map.width} value={current.width} onChange={e => nodeChange({ width: Number(e.target.value) })} /></label><label>Height <input type="number" min="1" max={map.height} value={current.height} onChange={e => nodeChange({ height: Number(e.target.value) })} /></label></>}
        <button className="btn btn-ghost" onClick={() => { change({ nodes: map.nodes.filter(n => n.id !== selected), routes: map.routes.filter(r => r.from !== selected && r.to !== selected) }); setSelected(null); }}>Remove selected element</button>
      </fieldset>}
      {(scene.category === 'world' || scene.category === 'celestial') && <fieldset><legend>Routes</legend>
        <label>From <select value={from} onChange={e => setFrom(e.target.value)}><option value="">Select</option>{map.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
        <label>To <select value={to} onChange={e => setTo(e.target.value)}><option value="">Select</option>{map.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
        <label>Travel hours <input type="number" min="0" max="1000000" step="0.25" value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
        <label>Distance ({map.unit}) <input type="number" min="0" max="1000000" step="0.1" value={distance} onChange={e => setDistance(Number(e.target.value))} /></label>
        <button className="btn btn-ghost" disabled={!from || !to || from === to} onClick={() => change({ routes: [...map.routes, { id: crypto.randomUUID(), from, to, hours, distance, visible: false }] })}>Add hidden route</button>
        {map.routes.map(r => <div key={r.id}>{map.nodes.find(n => n.id === r.from)?.label} → {map.nodes.find(n => n.id === r.to)?.label}
          <label>Travel hours <input aria-label={`Travel hours for ${r.id}`} type="number" min="0" max="1000000" step="0.25" value={r.hours} onChange={e => change({ routes: map.routes.map(o => o.id === r.id ? { ...o, hours: Number(e.target.value) } : o) })} /></label>
          <label>Distance ({map.unit}) <input aria-label={`Distance for ${r.id}`} type="number" min="0" max="1000000" step="0.1" value={r.distance} onChange={e => change({ routes: map.routes.map(o => o.id === r.id ? { ...o, distance: Number(e.target.value) } : o) })} /></label>
          <label><input type="checkbox" checked={r.visible} onChange={e => change({ routes: map.routes.map(o => o.id === r.id ? { ...o, visible: e.target.checked } : o) })} /> Revealed route</label>
          <button className="btn btn-ghost" onClick={() => change({ routes: map.routes.filter(o => o.id !== r.id) })}>Remove route</button></div>)}
      </fieldset>}
      {saveBar}
    </fieldset>}
    </aside>
    </div>
  </section>;
}
