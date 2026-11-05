import { useEffect, useRef, useState } from 'react';
import { api } from '../online/api';
import { SCENE_CATEGORIES, type SceneCategory, type SceneDefinition, type SceneSummary } from '../server/scenes';

const labels = { celestial: 'Celestial Maps', world: 'World Maps', region: 'Region Maps', battle: 'Battle Maps' };

/** Mounted lazily inside the existing GM campaign workspace. Preview never assigns players. */
export function SceneDirector() {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [category, setCategory] = useState<SceneCategory>('region');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<SceneDefinition | null>(null);
  const [offset, setOffset] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    api.sceneList().then(result => {
      if (live) { setScenes(result.scenes); setOffset(result.nextOffset); }
    }).catch(e => { if (live) setError(String(e)); });
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
    {error && <p role="alert">{error}</p>}
    <ul>{scenes.filter(s => s.category === category && s.name.toLowerCase().includes(search.toLowerCase())).map(s =>
      <li key={s.id}><strong>{s.name}</strong> · {s.is_legacy_arena ? 'Legacy Arena' : s.is_draft ? 'Draft' : 'Published'} <button onClick={() => void open(s.id)}>Private preview</button></li>)}</ul>
    {offset !== null && <button disabled={busy} onClick={() => void more()}>Load more scenes</button>}
    {preview && <aside aria-label="Private scene preview"><h4>{preview.name}</h4>
      <p>GM-only definition preview. Player assignments are unchanged.</p>
      <p>{labels[preview.category]} · {preview.is_draft ? 'Draft' : 'Published'}</p>
      {preview.is_legacy_arena && <p>This scene references the existing saved Arena. Its terrain and progress are preserved.</p>}
      <button onClick={() => { generation.current++; setPreview(null); }}>Close preview</button>
    </aside>}
  </section>;
}
