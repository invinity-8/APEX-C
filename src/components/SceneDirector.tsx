import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../online/api';
import { SCENE_CATEGORIES, type SceneCategory, type SceneDefinition, type SceneSummary } from '../server/scenes';
import { SceneMapEditor } from './SceneMapEditor';

const labels = { celestial: 'Celestial Maps', world: 'World Maps', region: 'Region Maps', battle: 'Battle Maps' };

/** Mounted lazily inside the existing GM campaign workspace. Preview never assigns players. */
export function SceneDirector() {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [category, setCategory] = useState<SceneCategory>('region');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
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
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    api.sceneList().then(result => {
      if (live) { setScenes(result.scenes); setOffset(result.nextOffset); }
    }).catch(e => { if (live) setError(String(e)); });
    api.scenePlayers().then(p => { if (live) setPlayers(p.players); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; generation.current++; };
  }, []);
  async function more() {
    if (offset === null || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.sceneList(offset);
      setScenes(old => [...old, ...result.scenes.filter(s => !old.some(o => o.id === s.id))]);
      setOffset(result.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function create() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { scene } = await api.sceneCreate(name, category);
      setScenes(old => [scene, ...old]); setName(''); setPreview(scene);
      // Reset pagination after insertion to keep the server's page boundaries authoritative.
      const page = await api.sceneList(); setScenes(page.scenes); setOffset(page.nextOffset);
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
  function saved(scene: SceneDefinition) {
    setPreview(scene); setScenes(old => [scene, ...old.filter(s => s.id !== scene.id)]);
  }
  async function action(action: string, fields: Record<string, unknown> = {}) {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try { saved((await api.sceneAction(preview.id, preview.revision, action, fields)).scene); }
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
  return <section aria-label="Scene Director">
    <h3>Scene Director</h3>
    <p>Scene preparation · Players remain in the existing Arena.</p>
    <div role="group" aria-label="Scene categories">{SCENE_CATEGORIES.map(c =>
      <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{labels[c]}</button>)}</div>
    <form onSubmit={e => { e.preventDefault(); void create(); }}>
      <label>Scene name <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim()}>Create draft</button>
    </form>
    <label>Search loaded scenes <input value={search} onChange={e => setSearch(e.target.value)} /></label>
    <label>Sort <select value={sort} onChange={e => setSort(e.target.value as 'name' | 'updated')}><option value="updated">Recently modified</option><option value="name">Name</option></select></label>
    <label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived scenes</label>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !!uncertain}><legend>Player assignments</legend>
      <button type="button" onClick={() => setSelectedPlayers(players.map(p => p.userId))}>Select entire party</button>
      {players.map(p => <label key={p.userId}><input type="checkbox" checked={selectedPlayers.includes(p.userId)} onChange={e => setSelectedPlayers(old => e.target.checked ? [...old, p.userId] : old.filter(id => id !== p.userId))} />{p.name} · {p.inheritedArena ? 'Arena' : p.sceneId ? scenes.find(s => s.id === p.sceneId)?.name ?? 'Assigned scene' : 'Sanctuary'}</label>)}
      <button disabled={!selectedPlayers.length} onClick={() => void assign(null)}>Return selected players to Sanctuary</button>
    </fieldset>
    {uncertain && <button disabled={busy} onClick={() => void assign(uncertain.sceneId)}>Verify or retry previous transfer</button>}
    <ul>{[...scenes].filter(s => s.category === category && s.archived === archived && s.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.updated_at.localeCompare(a.updated_at)).map(s =>
      <li key={s.id}><strong>{s.name}</strong> · {s.is_legacy_arena ? 'Legacy Arena' : s.is_draft ? 'Draft' : 'Published'} · <small>{new Date(s.updated_at).toLocaleDateString()}</small> <button onClick={() => void open(s.id)}>Private preview</button></li>)}</ul>
    {offset !== null && <button disabled={busy} onClick={() => void more()}>Load more scenes</button>}
    {preview && <aside aria-label="Private scene preview"><h4>{preview.name}</h4>
      <p>GM-only definition preview. Player assignments are unchanged.</p>
      <p>{labels[preview.category]} · {preview.is_draft ? 'Draft' : 'Published'}</p>
      <button disabled={busy || !!uncertain || preview.is_draft || preview.archived || !selectedPlayers.length} onClick={() => void assign(preview.id)}>Assign selected players to this scene</button>
      {preview.is_legacy_arena && <p>This scene references the existing saved Arena. Its terrain and progress are preserved.</p>}
      {!preview.is_legacy_arena && <>
        <form key={preview.id + preview.name} onSubmit={e => { e.preventDefault(); void action('rename', { name: new FormData(e.currentTarget).get('name') }); }}><label>Rename scene <input name="name" defaultValue={preview.name} maxLength={120} required /></label><button disabled={busy}>Rename</button></form>
        <button disabled={busy} onClick={() => void action('duplicate')}>Duplicate as draft</button>
        <button disabled={busy} onClick={() => void action(preview.archived ? 'restore' : 'archive')}>{preview.archived ? 'Restore scene' : 'Archive scene'}</button>
        <SceneMapEditor key={preview.id} scene={preview} onSaved={saved} />
      </>}
      <button onClick={() => { generation.current++; setPreview(null); }}>Close preview</button>
    </aside>}
  </section>;
}
