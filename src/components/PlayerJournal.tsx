import { useEffect, useId, useState } from 'react';
import { api } from '../online/api';
import { journalMarkdown, type JournalDraft, type JournalEntry, type JournalFilters } from '../server/journals';
import { prepareMapUpload } from '../campaign/imageUpload';
import { storedZip } from '../campaign/zip';
import { JournalMarkdown } from './JournalMarkdown';

const blank = (): JournalDraft => ({ title: '', body: '', category: 'Personal Notes', tags: [], pinned: false, sharing: 'private', scene_id: null, game_date: '' });
const categories = ['Personal Notes', 'Quest Notes', 'Places', 'People', 'Mysteries', 'Session Recap', 'Custom'];
export function PlayerJournal({ sceneReference }: { sceneReference?: { id:string; name:string } } = {}) {
  const categoryList = useId();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [owner, setOwner] = useState('');
  const [next, setNext] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState<JournalDraft>(blank);
  const [editing, setEditing] = useState<{ id: string; version: number }>({ id: crypto.randomUUID(), version: 0 });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sort, setSort] = useState<'newest'|'oldest'>('newest');
  const [tag, setTag] = useState(''), [activeFilters,setActiveFilters] = useState<JournalFilters>({});
  useEffect(() => { let live=true; setImageUrl(null); if(draft.image_id) api.journalImage(draft.image_id).then(r=>{ if(live) setImageUrl(r.url); }).catch(e=>{ if(live) setError(String(e)); }); return ()=>{ live=false; }; },[draft.image_id]);
  useEffect(() => {
    let live = true;
    api.journalList().then(p => { if (live) { setEntries(p.entries); setOwner(p.ownerId); setNext(p.nextOffset); } }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(patch: Partial<JournalDraft>) { setDraft(old => ({ ...old, ...patch })); setDirty(true); setNotice(''); }
  function open(entry?: JournalEntry) {
    if (busy || (dirty && !window.confirm('Discard unsaved journal changes?'))) return;
    setDraft(entry ?? blank()); setEditing({ id: entry?.id ?? crypto.randomUUID(), version: entry?.version ?? 0 }); setDirty(false); setNotice('');
  }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { entry } = await api.journalSave(editing.id, editing.version, draft);
      setEditing({ id: entry.id, version: entry.version }); setDraft(entry); setDirty(false);
      setEntries(old => [entry, ...old.filter(e => e.id !== entry.id)]); setNotice('Saved.');
      const page=await api.journalList(0,false,activeFilters); setEntries(page.entries); setNext(page.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function remove(entry: JournalEntry) {
    if (busy || !window.confirm(`Delete “${entry.title}”?`)) return;
    setBusy(true); setError('');
    try {
      await api.journalDelete(entry.id, entry.version); setEntries(old => old.filter(e => e.id !== entry.id));
      if (editing.id === entry.id) { setDraft(blank()); setEditing({ id: crypto.randomUUID(), version: 0 }); setDirty(false); }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function more() {
    if (next === null || busy) return;
    setBusy(true); setError('');
    try {
      const p = await api.journalList(next,false,activeFilters);
      setEntries(old => [...old, ...p.entries.filter(e => !old.some(o => o.id === e.id))]); setNext(p.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function searchAll() {
    if(busy) return; setBusy(true); setError('');
    const filters:JournalFilters={search:search.trim()||undefined,category:category||undefined,tag:tag.trim()||undefined,sort};
    try { const p=await api.journalList(0,false,filters); setEntries(p.entries); setNext(p.nextOffset); setActiveFilters(filters); }
    catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function download() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const all:JournalEntry[]=[]; let offset: number | null = 0;
      do { const p=await api.journalList(offset,true); all.push(...p.entries.filter(e=>!all.some(old=>old.id===e.id))); setNotice(`Exporting ${all.length} personal entries…`); offset=p.nextOffset; } while(offset!==null);
      const files:{name:string;data:Uint8Array}[]=[], paths:Record<string,string>={};
      for(const entry of all) if(entry.image_id && !paths[entry.image_id]) {
        const image=await api.journalImage(entry.image_id), response=await fetch(image.url); if(!response.ok) throw new Error('Could not export an image attachment.');
        const name=`attachments/${entry.image_id}.${image.mime==='image/png'?'png':image.mime==='image/jpeg'?'jpg':'webp'}`;
        paths[entry.image_id]=name; files.push({name,data:new Uint8Array(await response.arrayBuffer())});
      }
      const markdown=journalMarkdown(all,paths); const archive=files.length ? storedZip([{name:'journal.md',data:new TextEncoder().encode(markdown)},...files]) : null;
      const url=URL.createObjectURL(archive ? new Blob([archive.buffer as ArrayBuffer],{type:'application/zip'}) : new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
      const a=document.createElement('a'); a.href=url; a.download=archive?'apex-journal.zip':'apex-journal.md'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); setNotice(`Exported ${all.length} personal entries${archive?' with image attachments':''}.`);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function upload(file?:File) {
    if(!file || busy || editing.version===0) return;
    setBusy(true); setError('');
    try { const image=await prepareMapUpload(file); const result=await api.journalImageUpload(editing.id,image.image,image.thumbnail); change({image_id:result.id}); setNotice('Image uploaded privately. Save the entry to attach it.'); }
    catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="journal-panel" aria-label="Campaign journal">
    <h3>Campaign Journal</h3>
    <p>Personal notes stay private unless you explicitly share them. Save before changing tabs.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="journal-toolbar"><button className="btn btn-ghost" disabled={busy} onClick={() => open()}>New entry</button>
      <button className="btn btn-ghost" disabled={busy} onClick={() => void download()}>Export personal journal (.md)</button></div>
    <label>Search journal <input className="input" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} /></label>
    <label>Category filter <input className="input" list={categoryList+'-filter'} placeholder="All categories" maxLength={80} value={category} onChange={e=>setCategory(e.target.value)} /></label><datalist id={categoryList+'-filter'}>{[...new Set([...categories,...entries.map(e=>e.category)])].map(c=><option key={c} value={c}/>)}</datalist>
    <label>Tag filter <input maxLength={40} value={tag} onChange={e=>setTag(e.target.value)} /></label>
    <label>Sort <select value={sort} onChange={e=>setSort(e.target.value as 'newest'|'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
    <button className="btn btn-ghost" disabled={busy} onClick={()=>void searchAll()}>Search all entries</button>
    <ul>{entries.map(e => <li key={e.id}>
      <button className="btn btn-ghost" disabled={busy} onClick={() => open(e)}>{e.pinned ? '★ ' : ''}{e.title}</button> <small>{e.sharing} · {new Date(e.created_at).toLocaleDateString()}</small>
      {e.owner_id === owner && <button className="btn btn-ghost" disabled={busy} onClick={() => void remove(e)}>Delete</button>}
    </li>)}</ul>
    {next !== null && <button className="btn btn-ghost" disabled={busy} onClick={() => void more()}>Load older entries</button>}
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy || (!!entries.find(e => e.id === editing.id) && entries.find(e => e.id === editing.id)?.owner_id !== owner)}>
        <label>Title <input className="input" required maxLength={200} value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
        <label>Category <input className="input" required list={categoryList} maxLength={80} value={draft.category} onChange={e => change({ category:e.target.value })} /></label><datalist id={categoryList}>{categories.map(c=><option key={c} value={c}/>)}</datalist>
        <label>Scene reference <select value={draft.scene_id ?? ''} onChange={e=>change({scene_id:e.target.value||null})}><option value="">No scene</option>{sceneReference && <option value={sceneReference.id}>{sceneReference.name}</option>}{draft.scene_id && draft.scene_id!==sceneReference?.id && <option value={draft.scene_id}>Previously recorded scene</option>}</select></label>
        <label>In-game date <input className="input" maxLength={120} value={draft.game_date} onChange={e => change({ game_date: e.target.value })} /></label>
        <label>Tags (comma separated) <input className="input" value={draft.tags.join(', ')} onChange={e => change({ tags: e.target.value.split(',').map(t => t.trim()).slice(0, 20) })} /></label>
        <label>Notes (Markdown) <textarea aria-label="Notes (Markdown)" className="input journal-writing" required maxLength={100000} value={draft.body} onChange={e => change({ body: e.target.value })} /></label>
        <label>Visibility <select className="input" value={draft.sharing} onChange={e => change({ sharing: e.target.value as JournalDraft['sharing'] })}><option value="private">Private</option><option value="gm">Shared with GM</option><option value="party">Shared with party</option></select></label>
        <label><input type="checkbox" checked={draft.pinned} onChange={e => change({ pinned: e.target.checked })} /> Pin entry</label>
        <label>Image attachment <input type="file" accept="image/png,image/jpeg,image/webp" disabled={editing.version===0} onChange={e=>{ void upload(e.target.files?.[0]); e.target.value=''; }} /></label>
        {editing.version===0 && <small>Save the entry before uploading a private image.</small>}
        {draft.image_id && <button type="button" className="btn btn-ghost" onClick={()=>change({image_id:null})}>Remove image attachment</button>}
        <button className="btn btn-primary" disabled={!dirty || !draft.title.trim()}>{busy ? 'Saving…' : 'Save entry'}</button>
      </fieldset>
    </form>
    <article className="journal-reading" aria-label="Reading preview"><JournalMarkdown body={draft.body}/>{imageUrl && <img src={imageUrl} alt="Journal attachment" loading="lazy" />}</article>
  </section>;
}
