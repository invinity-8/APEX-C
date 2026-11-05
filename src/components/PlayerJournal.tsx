import { useEffect, useState } from 'react';
import { api } from '../online/api';
import { journalMarkdown, type JournalDraft, type JournalEntry } from '../server/journals';

const blank = (): JournalDraft => ({ title: '', body: '', category: 'Personal Notes', tags: [], pinned: false, sharing: 'private', scene_id: null, game_date: '' });
const categories = ['Personal Notes', 'Quest Notes', 'Places', 'People', 'Mysteries', 'Session Recap', 'Custom'];
export function PlayerJournal() {
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
      const p = await api.journalList(next);
      setEntries(old => [...old, ...p.entries.filter(e => !old.some(o => o.id === e.id))]); setNext(p.nextOffset);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([journalMarkdown(entries.filter(e => e.owner_id === owner))], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'apex-journal.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="journal-panel" aria-label="Campaign journal">
    <h3>Campaign Journal</h3>
    <p>Personal notes stay private unless you explicitly share them. Save before changing tabs.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="journal-toolbar"><button className="btn btn-ghost" disabled={busy} onClick={() => open()}>New entry</button>
      <button className="btn btn-ghost" onClick={download}>Export loaded personal entries (.md)</button></div>
    <label>Search loaded notes <input className="input" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <label>Category <select className="input" value={category} onChange={e => setCategory(e.target.value)}><option value="">All</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
    <ul>{[...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at)).filter(e => (!category || e.category === category) && `${e.title} ${e.body} ${e.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(e => <li key={e.id}>
      <button className="btn btn-ghost" disabled={busy} onClick={() => open(e)}>{e.pinned ? '★ ' : ''}{e.title}</button> <small>{e.sharing} · {new Date(e.created_at).toLocaleDateString()}</small>
      {e.owner_id === owner && <button className="btn btn-ghost" disabled={busy} onClick={() => void remove(e)}>Delete</button>}
    </li>)}</ul>
    {next !== null && <button className="btn btn-ghost" disabled={busy} onClick={() => void more()}>Load older entries</button>}
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy || (!!entries.find(e => e.id === editing.id) && entries.find(e => e.id === editing.id)?.owner_id !== owner)}>
        <label>Title <input className="input" required maxLength={200} value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
        <label>Category <select className="input" value={draft.category} onChange={e => change({ category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>In-game date <input className="input" maxLength={120} value={draft.game_date} onChange={e => change({ game_date: e.target.value })} /></label>
        <label>Tags (comma separated) <input className="input" value={draft.tags.join(', ')} onChange={e => change({ tags: e.target.value.split(',').map(t => t.trim()).slice(0, 20) })} /></label>
        <label>Notes (Markdown) <textarea aria-label="Notes (Markdown)" className="input journal-writing" required maxLength={100000} value={draft.body} onChange={e => change({ body: e.target.value })} /></label>
        <label>Visibility <select className="input" value={draft.sharing} onChange={e => change({ sharing: e.target.value as JournalDraft['sharing'] })}><option value="private">Private</option><option value="gm">Shared with GM</option><option value="party">Shared with party</option></select></label>
        <label><input type="checkbox" checked={draft.pinned} onChange={e => change({ pinned: e.target.checked })} /> Pin entry</label>
        <button className="btn btn-primary" disabled={!dirty || !draft.title.trim()}>{busy ? 'Saving…' : 'Save entry'}</button>
      </fieldset>
    </form>
    <article className="journal-reading" aria-label="Reading preview">{draft.body.split('\n').map((line, i) => line.startsWith('# ') ? <h4 key={i}>{line.slice(2)}</h4> : <p key={i}>{line || '\u00a0'}</p>)}</article>
  </section>;
}
