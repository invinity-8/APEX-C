import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../online/api';
import { SCENE_CATEGORIES, type SceneCategory, type SceneDefinition, type SceneSummary } from '../server/scenes';
import { SceneMapEditor } from './SceneMapEditor';
import { SceneSurface } from './SceneSurface';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { MotionSnapshot } from '../server/sceneMotion';
import { SCENE_TEMPLATES } from '../campaign/templates';
import { parseMap } from '../campaign/maps';
import { WorldTravel } from './WorldTravel';
import type { TravelSnapshot } from '../server/sceneTravel';
import { SceneThumbnail } from './SceneThumbnail';
import { SanctuarySettingsPanel } from './SanctuarySettings';

const labels = { celestial: 'Celestial Maps', world: 'World Maps', region: 'Region Maps', battle: 'Battle Maps' };

/** Mounted lazily inside the existing GM campaign workspace. Preview never assigns players. */
export function SceneDirector({ version = 0 }: { version?: number }) {
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
  const [notice, setNotice] = useState('');
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof api.scenePlayers>>['players']>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState<{ sceneId: string | null; targets: { userId: string; revision: number }[]; requestId: string } | null>(null);
  const [playerPreview, setPlayerPreview] = useState<SceneSnapshot | null>(null);
  const [previewUser, setPreviewUser] = useState('');
  const [placementToken, setPlacementToken] = useState('');
  const [placementX, setPlacementX] = useState(100), [placementY, setPlacementY] = useState(100);
  const [motion, setMotion] = useState<MotionSnapshot | null>(null);
  const [uncertainMotion, setUncertainMotion] = useState<Record<string, unknown> | null>(null);
  const [travel, setTravel] = useState<{ sceneId: string; data: TravelSnapshot } | null>(null);
  const generation = useRef(0);
  const playerGeneration=useRef(0), previewIdRef=useRef<string|null>(null); previewIdRef.current=preview?.id??null;
  function cache(rows:SceneSummary[]) {
    setScenes(old => {
      const uniqueRows = new Map(rows.map(row => [row.id, row]));
      return [...old.filter(scene => !uniqueRows.has(scene.id)), ...uniqueRows.values()];
    });
  }
  useEffect(()=>{
    let live=true; setLibraryLoading(true);
    api.sceneList(0,{category,archived,sort,search:appliedSearch||undefined}).then(page=>{if(live){cache(page.scenes);setLibraryIds(page.scenes.map(s=>s.id));setOffset(page.nextOffset);}}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setLibraryLoading(false);});
    return()=>{live=false;};
  },[category,archived,sort,appliedSearch]);
  useEffect(()=>{
    let live=true; setParentOffset(null); const parent=preview?({world:'celestial',region:'world',battle:'region',celestial:null} as const)[preview.category]:null;
    if(parent) api.sceneList(0,{category:parent,archived:false,sort:'name'}).then(page=>{if(live){cache(page.scenes);setParentOffset(page.nextOffset);}}).catch(e=>{if(live)setError(String(e));});
    return()=>{live=false;};
  },[preview?.id,preview?.category]);
  useEffect(() => {
    let live = true;
    if (preview && preview.category === 'world' && !preview.is_draft) api.sceneTravelState(preview.id).then(data => { if (live) setTravel({ sceneId: preview.id, data }); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [preview?.id, preview?.revision, preview?.category, preview?.is_draft, version]);
  useEffect(() => {
    let live = true; setMotion(null);
    if (preview && placementToken && !preview.is_draft && !preview.is_legacy_arena) api.sceneMotionState(preview.id, placementToken).then(m => { if (live) setMotion(m); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [preview?.id, preview?.revision, preview?.is_draft, preview?.is_legacy_arena, placementToken]);
  useEffect(() => {
    let live = true;
    api.scenePlayers().then(p => { if (live) setPlayers(p.players); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; generation.current++; playerGeneration.current++; };
  }, []);
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
      cache([scene]); setName(''); setPreview(scene);
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
    if(force || previewIdRef.current===scene.id) setPreview(scene); cache([scene]);
    setLibraryIds(old=>scene.category===category && scene.archived===archived && scene.name.toLowerCase().includes(appliedSearch.toLowerCase())?[...new Set([scene.id,...old])]:old.filter(id=>id!==scene.id));
  }
  async function action(action: string, fields: Record<string, unknown> = {}) {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try { saved((await api.sceneAction(preview.id, preview.revision, action, fields)).scene,action==='duplicate'); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function assign(sceneId: string | null) {
    if (busy) return;
    const intent = uncertain ?? { sceneId, targets: players.filter(p => selectedPlayers.includes(p.userId)).map(p => ({ userId: p.userId, revision: p.revision })), requestId: crypto.randomUUID() };
    if (!intent.targets.length) { setError('Select players first.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await api.sceneAssign(intent.sceneId, intent.targets, intent.requestId); setUncertain(null); setNotice('Selected players transferred. Private GM preview is unchanged.');
      setPlayers((await api.scenePlayers()).players);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setUncertain(intent);
      else { setUncertain(null); api.scenePlayers().then(p => setPlayers(p.players)).catch(() => undefined); }
      setError(String(e));
    } finally { setBusy(false); }
  }
  async function previewPlayer(userId: string) {
    setPreviewUser(userId); setPlayerPreview(null); setError('');
    const request = ++playerGeneration.current;
    if (!userId) return;
    try { const snapshot = await api.playerScenePreview(userId); if (playerGeneration.current === request) setPlayerPreview(snapshot); }
    catch (e) { if (playerGeneration.current === request) setError(String(e)); }
  }
  async function runMotion(input: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.sceneMove(input); setUncertainMotion(null); setNotice(input.action === 'advance' ? 'Movement interval advanced. Character resources and legacy MP are unchanged.' : 'Token placement saved.');
      if (preview && placementToken) setMotion(await api.sceneMotionState(preview.id, placementToken));
      if (previewUser) setPlayerPreview(await api.playerScenePreview(previewUser));
    } catch (e) { if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setUncertainMotion(input); else setUncertainMotion(null); setError(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="scene-director scene-director-full" aria-label="Scene library and editor">
    <header className="scene-director-heading"><div><p className="eyebrow">Campaign workspace</p><h1>Scenes</h1><p>Search, prepare and edit maps. Private previews never move players.</p></div><span className="chip">{scenes.length} loaded</span></header>
    <div className="scene-director-layout">
    <aside className="scene-director-library" aria-label="Scene library">
    <div role="group" aria-label="Scene categories">{SCENE_CATEGORIES.map(c =>
      <button key={c} disabled={busy} aria-pressed={c === category} onClick={() => setCategory(c)}>{labels[c]}</button>)}</div>
    <form onSubmit={e => { e.preventDefault(); void create(); }}>
      <label>Scene name <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Starter template <select value={SCENE_TEMPLATES.some(t => t.id === template && t.category === category) ? template : ''} onChange={e => setTemplate(e.target.value)}><option value="">Empty draft</option>{SCENE_TEMPLATES.filter(t => t.category === category).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <button disabled={busy || libraryLoading || !name.trim()}>Create draft</button>
    </form>
    <label>Search scene library <input maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /></label><button disabled={busy} onClick={()=>setAppliedSearch(search.trim())}>Search all scenes</button>
    <label>Sort <select disabled={busy} value={sort} onChange={e => setSort(e.target.value as 'name' | 'updated')}><option value="updated">Recently modified</option><option value="name">Name</option></select></label>
    <label><input type="checkbox" disabled={busy} checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived scenes</label>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !!uncertain}><legend>Player assignments</legend>
      <button type="button" onClick={() => setSelectedPlayers(players.map(p => p.userId))}>Select entire party</button>
      {players.map(p => <label key={p.userId}><input type="checkbox" checked={selectedPlayers.includes(p.userId)} onChange={e => setSelectedPlayers(old => e.target.checked ? [...old, p.userId] : old.filter(id => id !== p.userId))} />{p.name} · {p.inheritedArena ? 'Arena' : p.sceneId ? scenes.find(s => s.id === p.sceneId)?.name ?? 'Assigned scene' : 'Sanctuary'}</label>)}
      <button disabled={!selectedPlayers.length} onClick={() => void assign(null)}>Return selected players to Sanctuary</button>
    </fieldset>
    {uncertain && <button disabled={busy} onClick={() => void assign(uncertain.sceneId)}>Verify or retry previous transfer</button>}
    <label>Preview a player's assigned scene <select value={previewUser} onChange={e => void previewPlayer(e.target.value)}><option value="">Choose player</option>{players.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select></label>
    {playerPreview && <aside aria-label="Exact player scene preview"><h4>Player visibility preview</h4><SceneSurface snapshot={playerPreview} tokenId={playerPreview.viewer?.tokenId} name={playerPreview.viewer?.name} color={playerPreview.viewer?.color} /></aside>}
    {libraryLoading && <p role="status">Loading scene metadata…</p>}
    <ul className="scene-library">{[...scenes].filter(s => libraryIds.includes(s.id)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.updated_at.localeCompare(a.updated_at)).map(s =>
      <li key={s.id}><SceneThumbnail assetId={s.thumbnail_asset_id} label={s.name} /><strong>{s.name}</strong><span>{labels[s.category]} · {s.is_legacy_arena ? 'Legacy Arena' : s.archived ? 'Archived' : s.is_draft ? 'Draft' : 'Published'}</span><small>Modified {new Date(s.updated_at).toLocaleDateString()} · Parent: {scenes.find(p => p.id === s.parent_scene_id)?.name ?? (s.parent_scene_id ? 'Linked location' : 'Campaign root')} · {players.filter(p => p.sceneId === s.id).map(p => p.name).join(', ') || 'No players assigned'}</small><button disabled={busy} onClick={() => void open(s.id)}>Private preview</button></li>)}</ul>
    {offset !== null && <button disabled={busy || libraryLoading} onClick={() => void more()}>Load more scenes</button>}
    </aside>
    <main className="scene-director-detail" aria-label="Scene editing workspace">
    {preview ? <section className="scene-private-editor"><h2>{preview.name}</h2>
      <p>GM-only definition preview. Player assignments are unchanged.</p>
      <p>{labels[preview.category]} · {preview.is_draft ? 'Draft' : 'Published'}</p>
      <button disabled={busy || !!uncertain || preview.is_draft || preview.archived || !selectedPlayers.length} onClick={() => void assign(preview.id)}>Assign selected players to this scene</button>
      {preview.is_legacy_arena && <p>This scene references the existing saved Arena. Its terrain and progress are preserved.</p>}
      <SanctuarySettingsPanel candidateAsset={parseMap(preview.metadata)?.playerBackgroundAsset} candidateName={preview.name} />
      <label>Associated parent scene <select disabled={busy} value={preview.parent_scene_id ?? ''} onChange={e => void action('parent', { parentId: e.target.value || null })}><option value="">Campaign root</option>{scenes.filter(s => !s.archived && s.category === ({ world: 'celestial', region: 'world', battle: 'region', celestial: null }[preview.category])).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {parentOffset!==null && <button disabled={busy} onClick={()=>{const parent=({world:'celestial',region:'world',battle:'region',celestial:null} as const)[preview.category];if(parent){setBusy(true);api.sceneList(parentOffset,{category:parent,archived:false,sort:'name'}).then(page=>{cache(page.scenes);setParentOffset(page.nextOffset);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}}>Load more parent locations</button>}
      {!preview.is_legacy_arena && <>
        <form key={preview.id + preview.name} onSubmit={e => { e.preventDefault(); void action('rename', { name: new FormData(e.currentTarget).get('name') }); }}><label>Rename scene <input name="name" defaultValue={preview.name} maxLength={120} required /></label><button disabled={busy}>Rename</button></form>
        <button disabled={busy} onClick={() => void action('duplicate')}>Duplicate as draft</button>
        <button disabled={busy} onClick={() => void action(preview.archived ? 'restore' : 'archive')}>{preview.archived ? 'Restore scene' : 'Archive scene'}</button>
        <SceneMapEditor key={`map-${preview.id}`} scene={preview} onSaved={saved} />
        {!preview.is_draft && ['battle', 'region'].includes(preview.category) && <fieldset disabled={busy || !!uncertainMotion}><legend>Tokens & movement interval</legend>
          <label>Character token <select value={placementToken} onChange={e => setPlacementToken(e.target.value)}><option value="">Select character</option>{players.flatMap(p => p.tokenIds.map(id => <option key={p.userId + id} value={id}>{p.name} · {id}</option>))}</select></label>
          <label>Token X <input type="number" value={placementX} min="0" onChange={e => setPlacementX(Number(e.target.value))} /></label>
          <label>Token Y <input type="number" value={placementY} min="0" onChange={e => setPlacementY(Number(e.target.value))} /></label>
          <button disabled={!motion || !placementToken} onClick={() => void runMotion({ action: 'place', sceneId: preview.id, sceneRevision: preview.published_revision ?? 0, tokenId: placementToken, tokenVersion: motion?.tokens.find(t => t.tokenId === placementToken)?.version ?? 0, assignmentRevision: 0, epoch: 0, x: placementX, y: placementY, requestId: crypto.randomUUID() })}>Place character token</button>
          <p>Round {motion?.round ?? '—'} · Exploration hour {motion?.hour ?? '—'}. Interval budgets are shared across scenes; transfers never refresh them.</p>
          <button disabled={!motion} onClick={() => void runMotion({ action: 'advance', interval: preview.category === 'battle' ? 'round' : 'hour', expected: preview.category === 'battle' ? motion?.round : motion?.hour, requestId: crypto.randomUUID() })}>{preview.category === 'battle' ? 'Advance tactical round' : 'Advance exploration hour'}</button>
        </fieldset>}
        {uncertainMotion && <button disabled={busy} onClick={() => void runMotion(uncertainMotion)}>Verify or retry previous token action</button>}
        {preview.category === 'world' && !preview.is_draft && travel?.sceneId === preview.id && parseMap(preview.metadata) && <WorldTravel key={`travel-${preview.id}`} gm sceneId={preview.id} sceneRevision={preview.published_revision ?? 0} assignmentRevision={0} map={parseMap(preview.metadata)!} travel={travel.data} onChanged={() => { api.sceneTravelState(preview.id).then(data => setTravel({ sceneId: preview.id, data })).catch(e => setError(String(e))); }} />}
      </>}
      <button className="btn btn-ghost" onClick={() => { generation.current++; setPreview(null); }}>Back to scene library</button>
    </section> : <div className="scene-editor-empty"><span aria-hidden="true">🗺</span><h2>Select a scene to edit</h2><p>Create a draft or open a private preview from the library. Players will see only published, assigned scenes.</p></div>}
    </main>
    </div>
  </section>;
}
