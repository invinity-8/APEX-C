import { useEffect, useRef, useState } from 'react';
import { api } from '../online/api';
import { SCENE_CATEGORIES, type SceneCategory, type SceneDefinition, type SceneSummary } from '../server/scenes';
import { SceneMapEditor } from './SceneMapEditor';
import { SCENE_TEMPLATES } from '../campaign/templates';
import { parseMap } from '../campaign/maps';
import { SceneThumbnail } from './SceneThumbnail';
import { HexThumbnail } from './HexThumbnail';
import { SanctuarySettingsPanel } from './SanctuarySettings';

const labels = { celestial: 'Celestial Maps', world: 'World Maps', region: 'Region Maps', battle: 'Battle Maps' };

/**
 * Scenes: library and editor only – create, organise, edit and publish maps. Player assignment, the
 * current scene and live tools (tokens, travel, encounters) belong to Game.
 */
export function SceneDirector() {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [category, setCategory] = useState<SceneCategory>('region');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch,setAppliedSearch]=useState(''),[libraryIds,setLibraryIds]=useState<string[]>([]),[libraryLoading,setLibraryLoading]=useState(false);
  const [parentOffset,setParentOffset]=useState<number|null>(null);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<'name' | 'updated'>('updated');
  const [preview, setPreview] = useState<SceneDefinition | null>(null);
  const [offset, setOffset] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const previewIdRef=useRef<string|null>(null); previewIdRef.current=preview?.id??null;
  function cache(rows:SceneSummary[]) {
    setScenes(old => {
      const uniqueRows = new Map(rows.map(row => [row.id, row]));
      return [...old.filter(scene => !uniqueRows.has(scene.id)), ...uniqueRows.values()];
    });
  }
  useEffect(()=>{
    // A new filter starts from an empty list, so the previous category can never remain visible.
    let live=true; setLibraryLoading(true); setLibraryIds([]); setOffset(null);
    api.sceneList(0,{category,archived,sort,search:appliedSearch||undefined}).then(page=>{if(live){cache(page.scenes);setLibraryIds(page.scenes.map(s=>s.id));setOffset(page.nextOffset);}}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setLibraryLoading(false);});
    return()=>{live=false;};
  },[category,archived,sort,appliedSearch]);
  useEffect(()=>{
    let live=true; setParentOffset(null); const parent=preview?({world:'celestial',region:'world',battle:'region',celestial:null} as const)[preview.category]:null;
    if(parent) api.sceneList(0,{category:parent,archived:false,sort:'name'}).then(page=>{if(live){cache(page.scenes);setParentOffset(page.nextOffset);}}).catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};
  },[preview?.id,preview?.category]);
  useEffect(() => () => { generation.current++; }, []);
  async function more() {
    if (offset === null || busy || libraryLoading) return;
    setBusy(true); setError('');
    try {
      const result = await api.sceneList(offset,{category,archived,sort,search:appliedSearch||undefined});
      cache(result.scenes); setLibraryIds(old=>[...new Set([...old,...result.scenes.map(s=>s.id)])]);
      setOffset(result.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function create() {
    if (busy || libraryLoading) return;
    setBusy(true); setError('');
    try {
      const { scene } = await api.sceneCreate(name, category, SCENE_TEMPLATES.some(t => t.id === template && t.category === category) ? template : undefined);
      cache([{ ...scene, hex: (scene.metadata as { hex?: SceneSummary['hex'] })?.hex ?? null, palette: (scene.metadata as { palette?: SceneSummary['palette'] })?.palette ?? null }]); setName(''); setPreview(scene);
      // Reset pagination after insertion to keep the server's page boundaries authoritative.
      const page = await api.sceneList(0,{category,archived,sort,search:appliedSearch||undefined}); cache(page.scenes);setLibraryIds(page.scenes.map(s=>s.id));setOffset(page.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function open(id: string) {
    const request = ++generation.current;
    setPreview(null); setError('');
    try {
      const result = await api.scenePreview(id);
      if (generation.current === request) setPreview(result.scene);
    } catch (e) { if (generation.current === request) setError(String(e)); }
  }
  function saved(scene: SceneDefinition,force=false) {
    if(force || previewIdRef.current===scene.id) setPreview(scene);
    // Library preview follows the saved draft (tiles + colour scheme).
    const meta = scene.metadata as { hex?: SceneSummary['hex']; palette?: SceneSummary['palette'] };
    cache([{ ...scene, hex: meta?.hex ?? null, palette: meta?.palette ?? null }]);
    setLibraryIds(old=>scene.category===category && scene.archived===archived && scene.name.toLowerCase().includes(appliedSearch.toLowerCase())?[...new Set([scene.id,...old])]:old.filter(id=>id!==scene.id));
  }
  async function action(action: string, fields: Record<string, unknown> = {}) {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try { saved((await api.sceneAction(preview.id, preview.revision, action, fields)).scene,action==='duplicate'); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="scene-director scene-director-full" aria-label="Scene library and editor">
    <header className="scene-director-heading"><div><p className="eyebrow">Campaign workspace</p><h1>Scenes</h1><p>Create, organise and edit maps. Publish a scene here, then switch to it and move players in Game.</p></div><span className="chip">{scenes.length} loaded</span></header>
    <div className="scene-director-layout">
    <aside className="scene-director-library" aria-label="Scene library">
    <div role="group" aria-label="Scene categories" className="scene-category-filter">{SCENE_CATEGORIES.map(c =>
      <button key={c} type="button" aria-pressed={c === category} onClick={() => setCategory(c)}>{labels[c]}</button>)}</div>
    <form onSubmit={e => { e.preventDefault(); void create(); }}>
      <label>Scene name <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Starter template <select value={SCENE_TEMPLATES.some(t => t.id === template && t.category === category) ? template : ''} onChange={e => setTemplate(e.target.value)}><option value="">Empty draft</option>{SCENE_TEMPLATES.filter(t => t.category === category).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <button disabled={busy || libraryLoading || !name.trim()}>Create draft</button>
    </form>
    <label>Search scene library <input maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /></label><button disabled={busy} onClick={()=>setAppliedSearch(search.trim())}>Search all scenes</button>
    <label>Sort <select disabled={busy} value={sort} onChange={e => setSort(e.target.value as 'name' | 'updated')}><option value="updated">Recently modified</option><option value="name">Name</option></select></label>
    <label><input type="checkbox" disabled={busy} checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived scenes</label>
    {error && <p role="alert">{error}</p>}
    {libraryLoading && <p role="status">Loading scene metadata…</p>}
    <ul className="scene-library">{[...scenes].filter(s => libraryIds.includes(s.id) && s.category === category && s.archived === archived).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.updated_at.localeCompare(a.updated_at)).map(s =>
      <li key={s.id}>{s.hex ? <HexThumbnail hex={s.hex} palette={s.palette} label={s.name} /> : <SceneThumbnail assetId={s.thumbnail_asset_id} label={s.name} />}<strong>{s.name}</strong><span>{labels[s.category]} · {s.is_legacy_arena ? 'Legacy Arena' : s.archived ? 'Archived' : s.is_draft ? 'Draft' : 'Published'}</span><small>Modified {new Date(s.updated_at).toLocaleDateString()} · Parent: {scenes.find(p => p.id === s.parent_scene_id)?.name ?? (s.parent_scene_id ? 'Linked location' : 'Campaign root')}</small><button disabled={busy} onClick={() => void open(s.id)}>Edit scene</button></li>)}</ul>
    {!libraryLoading && !scenes.some(s => libraryIds.includes(s.id) && s.category === category && s.archived === archived) && <p role="status">No {archived ? 'archived ' : ''}{labels[category].toLowerCase()} yet.</p>}
    {offset !== null && <button disabled={busy || libraryLoading} onClick={() => void more()}>Load more scenes</button>}
    </aside>
    <main className="scene-director-detail" aria-label="Scene editing workspace">
    {preview ? <section className="scene-private-editor">
      {/* APEX 2.4 – compact head: name, status and the scene actions in one row; the map and its tools follow at once */}
      <div className="scene-editor-head">
        <h2>{preview.name}</h2>
        <span className="chip">{labels[preview.category]} · {preview.is_draft ? 'Draft' : 'Published'}</span>
        <span className="scene-editor-head-actions">
          {!preview.is_legacy_arena && <button disabled={busy} onClick={() => void action('duplicate')}>Duplicate as draft</button>}
          {!preview.is_legacy_arena && <button disabled={busy} onClick={() => void action(preview.archived ? 'restore' : 'archive')}>{preview.archived ? 'Restore scene' : 'Archive scene'}</button>}
          <button className="btn btn-ghost" onClick={() => { generation.current++; setPreview(null); }}>← Library</button>
        </span>
      </div>
      {preview.is_legacy_arena && <p>This scene references the existing saved Arena. Its terrain and progress are preserved.</p>}
      {!preview.is_legacy_arena && <SceneMapEditor key={`map-${preview.id}`} scene={preview} onSaved={saved} />}
      <details className="scene-settings" data-testid="scene-settings">
        <summary>⚙ Scene settings – name, parent scene, default atmosphere and background</summary>
        <p className="scene-settings-note">GM-only editor. Players only see the published version, once you switch to it in Game.</p>
        {!preview.is_legacy_arena && <form key={preview.id + preview.name} onSubmit={e => { e.preventDefault(); void action('rename', { name: new FormData(e.currentTarget).get('name') }); }}><label>Rename scene <input name="name" defaultValue={preview.name} maxLength={120} required /></label><button disabled={busy}>Rename</button></form>}
        <label>Associated parent scene <select disabled={busy} value={preview.parent_scene_id ?? ''} onChange={e => void action('parent', { parentId: e.target.value || null })}><option value="">Campaign root</option>{scenes.filter(s => !s.archived && s.category === ({ world: 'celestial', region: 'world', battle: 'region', celestial: null }[preview.category])).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {parentOffset!==null && <button disabled={busy} onClick={()=>{const parent=({world:'celestial',region:'world',battle:'region',celestial:null} as const)[preview.category];if(parent){setBusy(true);api.sceneList(parentOffset,{category:parent,archived:false,sort:'name'}).then(page=>{cache(page.scenes);setParentOffset(page.nextOffset);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}}>Load more parent locations</button>}
        <SanctuarySettingsPanel candidateAsset={parseMap(preview.metadata)?.playerBackgroundAsset} candidateName={preview.name} />
      </details>
    </section> : <div className="scene-editor-empty"><span aria-hidden="true">🗺</span><h2>Select a scene to edit</h2><p>Create a draft or open a scene from the library. Upload a PNG background in the map editor, set a spawn point and publish.</p></div>}
    </main>
    </div>
  </section>;
}
