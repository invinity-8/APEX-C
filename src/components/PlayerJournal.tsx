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
  const writingId = useId();
  const [selectedReference, setSelectedReference] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [backlinks, setBacklinks] = useState<JournalEntry[]>([]);
  const [backlinksNext, setBacklinksNext] = useState<number | null>(null);
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
  // APEX 2.4 – the book: read the open page, or write on it; the index can be narrowed by a ribbon (chapter)
  const [mode, setMode] = useState<'read' | 'write'>('write');
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => { let live=true; setImageUrl(null); if(draft.image_id) api.journalImage(draft.image_id).then(r=>{ if(live) setImageUrl(r.url); }).catch(e=>{ if(live) setError(String(e)); }); return ()=>{ live=false; }; },[draft.image_id]);
  useEffect(() => {
    let live = true;
    api.journalList().then(p => { if (live) { setEntries(p.entries); setOwner(p.ownerId); setNext(p.nextOffset); } }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    setBacklinks([]); setBacklinksNext(null);
    api.journalBacklinks(editing.id).then(p => {
      if (live) { setBacklinks(p.entries.filter(entry => entry.id !== editing.id)); setBacklinksNext(p.nextOffset); }
    }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [editing.id, editing.version]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(patch: Partial<JournalDraft>) { setDraft(old => ({ ...old, ...patch })); setDirty(true); setNotice(''); }
  function open(entry?: JournalEntry, newCategory?: string) {
    if (busy || (dirty && !window.confirm('Discard unsaved journal changes?'))) return;
    const value = entry ?? blank();
    if (newCategory) value.category = newCategory;
    setDraft(value); setEditing({ id: entry?.id ?? crypto.randomUUID(), version: entry?.version ?? 0 }); setDirty(false); setNotice('');
    setMode(entry ? 'read' : 'write');
  }
  async function openReference(id: string) {
    try {
      const entry = entries.find(item => item.id === id) ?? (await api.journalRead(id)).entry;
      if (!['People', 'Places'].includes(entry.category)) throw new Error('This reference is unavailable.');
      open(entry);
    } catch { setError('This reference is private, missing, or unavailable.'); }
  }
  function insertReference() {
    const target = referenceEntries.find(entry => entry.id === selectedReference);
    if (!target) return;
    const textarea = document.getElementById(writingId) as HTMLTextAreaElement | null;
    const start = textarea?.selectionStart ?? draft.body.length, end = textarea?.selectionEnd ?? draft.body.length;
    const marker = '[[ref:' + target.id + ']]';
    change({ body: draft.body.slice(0, start) + marker + draft.body.slice(end) });
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + marker.length, start + marker.length); });
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
  async function moreBacklinks() {
    if (backlinksNext === null || busy) return;
    setBusy(true); setError('');
    try {
      const p = await api.journalBacklinks(editing.id, backlinksNext);
      setBacklinks(old => [...old, ...p.entries.filter(e => e.id !== editing.id && !old.some(item => item.id === e.id))]);
      setBacklinksNext(p.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function searchAll(over: { category?: string } = {}) {
    if(busy) return; setBusy(true); setError('');
    const cat = over.category ?? category;
    const filters:JournalFilters={search:search.trim()||undefined,category:cat||undefined,tag:tag.trim()||undefined,sort};
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
  const referenceEntries = entries.filter(entry => ['People', 'Places'].includes(entry.category));
  const references = Object.fromEntries(referenceEntries.map(entry => [entry.id, entry.title]));
  const readOnly = !!entries.find(e => e.id === editing.id) && entries.find(e => e.id === editing.id)?.owner_id !== owner;
  const chapter = (c: string) => { setCategory(c); void searchAll({ category: c }); };
  const sharingLabel = { private: '🔒 private', gm: '👁 shared with the GM', party: '👥 shared with the party' } as const;
  return <section className="journal-book" aria-label="Campaign journal" data-testid="journal-book">
    <header className="journal-book-bar">
      <h3>📖 Campaign Journal</h3>
      <span className="journal-book-hint">Personal notes stay private unless you share them. Save before changing tabs.</span>
      <span className="journal-book-actions">
        <button type="button" disabled={busy} onClick={() => open()}>✒ New entry</button>
        <button type="button" disabled={busy} onClick={() => open(undefined, 'People')}>👤 New person</button>
        <button type="button" disabled={busy} onClick={() => open(undefined, 'Places')}>🏰 New place</button>
        <button type="button" disabled={busy} onClick={() => void download()} title="Export personal journal (.md)">⤓ Export (.md)</button>
      </span>
    </header>
    {(error || notice) && <div className="journal-book-messages">{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>}
    <div className="journal-book-spread">
      <nav className="journal-ribbons" aria-label="Chapters">
        {['', ...categories].map(c => <button key={c || 'all'} type="button" aria-pressed={category === c} disabled={busy} onClick={() => chapter(c)} className={`journal-ribbon journal-ribbon-${(c || 'all').split(' ')[0].toLowerCase()}`}>{c || 'All'}</button>)}
      </nav>
      {/* left page: the index */}
      <div className="journal-page journal-page-left" aria-label="Index">
        <h4 className="journal-page-title">{category || 'Contents'}</h4>
        <div className="journal-search">
          <label className="sr-only" htmlFor={categoryList + '-q'}>Search journal</label>
          <input id={categoryList + '-q'} aria-label="Search journal" placeholder="Search the journal…" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchAll(); }} />
          <button type="button" disabled={busy} onClick={() => void searchAll()} aria-label="Search all entries">🔍</button>
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)} title="More filters">⋯</button>
        </div>
        {filtersOpen && <div className="journal-filters">
          <label>Category filter <input list={categoryList+'-filter'} placeholder="All categories" maxLength={80} value={category} onChange={e=>setCategory(e.target.value)} /></label><datalist id={categoryList+'-filter'}>{[...new Set([...categories,...entries.map(e=>e.category)])].map(c=><option key={c} value={c}/>)}</datalist>
          <label>Tag filter <input maxLength={40} value={tag} onChange={e=>setTag(e.target.value)} /></label>
          <label>Sort <select value={sort} onChange={e=>setSort(e.target.value as 'newest'|'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        </div>}
        <ol className="journal-toc">
          {entries.map(e => <li key={e.id} className={e.id === editing.id ? 'is-open' : ''}>
            <button type="button" disabled={busy} onClick={() => open(e)}><span className="journal-toc-title">{e.pinned ? '★ ' : ''}{e.title}</span><span className="journal-toc-dots" /><span className="journal-toc-date">{e.game_date || new Date(e.created_at).toLocaleDateString()}</span></button>
            <small>{e.category} · {sharingLabel[e.sharing as keyof typeof sharingLabel] ?? e.sharing}{e.owner_id === owner && <> · <button type="button" className="journal-link" disabled={busy} onClick={() => void remove(e)}>delete</button></>}</small>
          </li>)}
          {!entries.length && <li className="journal-empty">No entries yet – the first page is waiting.</li>}
        </ol>
        {next !== null && <button type="button" className="journal-link" disabled={busy} onClick={() => void more()}>Load older entries</button>}
        <section className="journal-refs" aria-label="People and Places references"><h4>People &amp; Places</h4>{referenceEntries.length ? <ul>{referenceEntries.map(entry => <li key={entry.id}><button type="button" disabled={busy} onClick={() => open(entry)}>{entry.category === 'People' ? '👤' : '🏰'} {entry.title}</button></li>)}</ul> : <p>No references yet. Add a person or place when you need one.</p>}</section>
      </div>
      {/* right page: the open entry – read or write */}
      <div className="journal-page journal-page-right" aria-label="Entry">
        <div className="journal-page-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'read'} onClick={() => setMode('read')}>📜 Read</button>
          <button type="button" role="tab" aria-selected={mode === 'write'} disabled={readOnly} onClick={() => setMode('write')}>✒ Write</button>
          {dirty && <span className="journal-unsaved">unsaved</span>}
        </div>
        {mode === 'read' ? <article className="journal-reading" aria-label="Reading preview">
          <h2 className="journal-entry-title">{draft.title || 'Untitled page'}</h2>
          <div className="journal-entry-meta">{draft.category}{draft.game_date ? ` · ${draft.game_date}` : ''}{draft.tags.length ? ` · ${draft.tags.map(t => '#' + t).join(' ')}` : ''} · {sharingLabel[draft.sharing]}</div>
          {imageUrl && <img src={imageUrl} alt="Journal attachment" loading="lazy" />}
          <JournalMarkdown body={draft.body} references={references} onReference={id => void openReference(id)}/>
          {backlinks.length > 0 && <aside aria-label="Journal backlinks" className="journal-backlinks"><h4>Referenced by</h4><ul>{backlinks.map(entry => <li key={entry.id}><button type="button" onClick={() => open(entry)}>{entry.title}</button></li>)}</ul>{backlinksNext !== null && <button type="button" className="journal-link" disabled={busy} onClick={() => void moreBacklinks()}>Load older backlinks</button>}</aside>}
        </article> : <form className="journal-write" onSubmit={e => { e.preventDefault(); void save(); }}>
          <fieldset disabled={busy || readOnly}>
            <input className="journal-title-input" aria-label="Title" placeholder="Title of the page" required maxLength={200} value={draft.title} onChange={e => change({ title: e.target.value })} />
            <div className="journal-write-meta">
              <label>Category <input required list={categoryList} maxLength={80} value={draft.category} onChange={e => change({ category:e.target.value })} /></label><datalist id={categoryList}>{categories.map(c=><option key={c} value={c}/>)}</datalist>
              <label>In-game date <input maxLength={120} value={draft.game_date} onChange={e => change({ game_date: e.target.value })} /></label>
              <label>Tags (comma separated) <input value={draft.tags.join(', ')} onChange={e => change({ tags: e.target.value.split(',').map(t => t.trim()).slice(0, 20) })} /></label>
              <label>Scene reference <select value={draft.scene_id ?? ''} onChange={e=>change({scene_id:e.target.value||null})}><option value="">No scene</option>{sceneReference && <option value={sceneReference.id}>{sceneReference.name}</option>}{draft.scene_id && draft.scene_id!==sceneReference?.id && <option value={draft.scene_id}>Previously recorded scene</option>}</select></label>
              <label>Visibility <select value={draft.sharing} onChange={e => change({ sharing: e.target.value as JournalDraft['sharing'] })}><option value="private">Private</option><option value="gm">Shared with GM</option><option value="party">Shared with party</option></select></label>
              <label className="journal-check"><input type="checkbox" checked={draft.pinned} onChange={e => change({ pinned: e.target.checked })} /> Pin entry</label>
            </div>
            <div className="journal-insert"><select aria-label="Link a person or place" value={selectedReference} onChange={e => setSelectedReference(e.target.value)}><option value="">Link a person or place…</option>{referenceEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.category}: {entry.title}</option>)}</select><button type="button" disabled={!selectedReference || busy} onClick={insertReference}>Insert link at cursor</button></div>
            <textarea id={writingId} aria-label="Notes (Markdown)" className="journal-writing" placeholder="Write here… (Markdown: # heading, **bold**, - list)" required maxLength={100000} value={draft.body} onChange={e => change({ body: e.target.value })} />
            <div className="journal-write-foot">
              <label>Image attachment <input type="file" accept="image/png,image/jpeg,image/webp" disabled={editing.version===0} onChange={e=>{ void upload(e.target.files?.[0]); e.target.value=''; }} /></label>
              {editing.version===0 && <small>Save the entry before uploading a private image.</small>}
              {draft.image_id && <button type="button" onClick={()=>change({image_id:null})}>Remove image attachment</button>}
              <button className="journal-save" disabled={!dirty || !draft.title.trim()}>{busy ? 'Saving…' : 'Save entry'}</button>
            </div>
          </fieldset>
        </form>}
      </div>
    </div>
  </section>;
}
