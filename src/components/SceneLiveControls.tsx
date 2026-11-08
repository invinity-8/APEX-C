import { useEffect, useState, type FormEvent } from 'react';
import type { Command } from '../game/commands';
import type { DispatchResult, GameApi } from '../state/gameApi';
import type { SceneSummary } from '../server/scenes';
import type { SceneEncounterParticipant } from '../game/types';

type Character = { tokenId: string; name: string };
type Run = (cmd: Command) => Promise<DispatchResult>;

export function SceneLiveControls({ game, scene, characters, run }: { game: GameApi; scene: SceneSummary; characters: Character[]; run: Run }) {
  // Battle maps start initiative with server dice (Scene tools → Initiative); here it can only be adjusted.
  const rolledInitiative = scene.category === 'battle';
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>(() => characters.map(c => c.tokenId));
  const [npcName, setNpcName] = useState('');
  const [npcInitiative, setNpcInitiative] = useState(10);
  const [busy, setBusy] = useState(false);
  const announcements = (game.gmState?.sceneAnnouncements ?? []).filter(item => item.sceneId === scene.id).slice(-10).reverse();
  const encounter = game.gmState?.sceneEncounters?.[scene.id];
  const characterKey = characters.map(c => c.tokenId).join('|');

  useEffect(() => {
    const next = characterKey ? characterKey.split('|') : [];
    setSelected(current => current.join('|') === next.join('|') ? current : next);
  }, [scene.id, characterKey]);

  async function act(command: Command) {
    if (busy) return false;
    setBusy(true);
    try { return (await run(command)).ok; }
    finally { setBusy(false); }
  }
  async function announce(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !message.trim()) return;
    const ok = await act({ type: 'sceneAnnounce', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, announcementId: crypto.randomUUID(), title, text: message });
    if (ok) { setTitle(''); setMessage(''); }
  }
  function pcParticipant(tokenId: string): SceneEncounterParticipant | null {
    const character = characters.find(c => c.tokenId === tokenId);
    return character ? { id: `pc-${tokenId}`, tokenId, name: character.name, initiative: 10, visible: true } : null;
  }
  async function startEncounter(event: FormEvent) {
    event.preventDefault();
    const participants = selected.map(pcParticipant).filter((p): p is SceneEncounterParticipant => !!p);
    if (npcName.trim()) participants.push({ id: `npc-${crypto.randomUUID()}`, name: npcName.trim(), initiative: npcInitiative, visible: true });
    if (!participants.length) return;
    const ok = await act({ type: 'sceneEncounterStart', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: crypto.randomUUID(), title: 'Encounter', participants });
    if (ok) { setNpcName(''); }
  }
  async function addNpc(event: FormEvent) {
    event.preventDefault();
    if (!encounter || !npcName.trim()) return;
    const ok = await act({ type: 'sceneEncounterAdd', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: encounter.id, expectedVersion: encounter.version,
      participant: { id: `npc-${crypto.randomUUID()}`, name: npcName.trim(), initiative: npcInitiative, visible: true } });
    if (ok) setNpcName('');
  }

  return <div className="mt-2 grid gap-2 lg:grid-cols-2" aria-label="Scene events and encounter controls">
    <section className="rounded-md border border-ink-700 p-2" aria-label="Scene announcement controls">
      <h3 className="text-xs font-bold text-marble-300">Scene announcements · {scene.name}</h3>
      <form className="mt-2 space-y-1.5" onSubmit={announce}>
        <label className="sr-only" htmlFor="scene-announcement-title">Announcement title</label>
        <input id="scene-announcement-title" className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm" maxLength={120} placeholder="Event or announcement title" value={title} onChange={e => setTitle(e.target.value)} />
        <label className="sr-only" htmlFor="scene-announcement-message">Announcement message</label>
        <textarea id="scene-announcement-message" className="w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm" maxLength={1000} rows={2} placeholder="Shared with players currently assigned to this scene" value={message} onChange={e => setMessage(e.target.value)} />
        <button className="btn btn-gold" disabled={busy || !title.trim() || !message.trim()}>Announce to scene</button>
      </form>
      {announcements.length > 0 && <ul className="mt-2 space-y-1 text-xs" aria-label="Recent scene announcements">
        {announcements.map(item => <li key={item.id} className="flex items-start gap-2 rounded border border-ink-700 p-1.5"><span className="min-w-0 flex-1"><strong>{item.title}</strong><span className="block text-marble-400">{item.text}</span></span><button className="btn btn-ghost px-1 py-0" disabled={busy} aria-label={`Remove announcement ${item.title}`} onClick={() => void act({ type: 'sceneAnnouncementDismiss', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, announcementId: item.id })}>×</button></li>)}
      </ul>}
    </section>

    <section className="rounded-md border border-ink-700 p-2" aria-label="Scene encounter controls">
      <h3 className="text-xs font-bold text-marble-300">{rolledInitiative ? 'Adjust initiative' : 'Encounter'} · {scene.name}</h3>
      {(!encounter || encounter.status === 'ended') && rolledInitiative ? <p className="mt-1 text-xs text-marble-500">Start initiative in Scene tools – everyone on the map rolls automatically. Here you can then change values, add NPCs without a map figure or hide them.</p> : !encounter || encounter.status === 'ended' ? <form className="mt-2 space-y-2" onSubmit={startEncounter}>
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-xs" disabled={busy || !characters.length}>
          <legend className="mb-1 text-marble-400">Player characters · initiative starts at 10; edit after starting</legend>
          {characters.map(character => <label key={character.tokenId} className="inline-flex items-center gap-1"><input type="checkbox" checked={selected.includes(character.tokenId)} onChange={e => setSelected(current => e.target.checked ? [...current, character.tokenId] : current.filter(id => id !== character.tokenId))} />{character.name}</label>)}
          {!characters.length && <span className="text-marble-500">No players are assigned to this scene.</span>}
        </fieldset>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs text-marble-400">NPC / opponent
            <input className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm" maxLength={80} value={npcName} onChange={e => setNpcName(e.target.value)} placeholder="Optional participant" />
          </label>
          <label className="text-xs text-marble-400">Initiative
            <input className="mt-1 w-20 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm" type="number" min={-100} max={1000} value={npcInitiative} onChange={e => setNpcInitiative(Number(e.target.value))} />
          </label>
          <button className="btn btn-gold" disabled={busy || (!selected.length && !npcName.trim())}>Start encounter</button>
        </div>
      </form> : <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs"><strong>{encounter.title}</strong><span className="chip">Round {encounter.round}</span><button className="btn btn-gold" disabled={busy} onClick={() => void act({ type: 'sceneEncounterAdvance', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: encounter.id, expectedVersion: encounter.version })}>Next turn</button><button className="btn btn-ghost" disabled={busy} onClick={() => void act({ type: 'sceneEncounterEnd', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: encounter.id, expectedVersion: encounter.version })}>End encounter</button></div>
        <ol className="space-y-1 text-xs" aria-label="Initiative order">
          {encounter.participants.map((participant, index) => <li key={participant.id} className={`flex items-center gap-2 rounded border p-1.5 ${index === encounter.turnIndex ? 'border-gold-600/70 bg-gold-900/20' : 'border-ink-700'}`}>
            <span className="min-w-0 flex-1">{index === encounter.turnIndex ? '▶ ' : ''}{participant.name}{participant.tokenId ? ' · Player' : ' · NPC'}</span>
            <label className="flex items-center gap-1 text-marble-500">Init <input key={`${participant.id}-${encounter.version}`} className="w-14 rounded border border-ink-600 bg-ink-900 px-1 py-0.5 text-marble-100" type="number" min={-100} max={1000} defaultValue={participant.initiative} disabled={busy} onBlur={e => {
              const initiative = Number(e.target.value);
              if (Number.isInteger(initiative) && initiative >= -100 && initiative <= 1000 && initiative !== participant.initiative) void act({ type: 'sceneEncounterInitiative', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: encounter.id, expectedVersion: encounter.version, participantId: participant.id, initiative });
            }} /></label>
            <label className="flex items-center gap-1 text-marble-500"><input type="checkbox" checked={participant.visible} disabled={busy || !!participant.tokenId} onChange={e => void act({ type: 'sceneEncounterVisibility', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: encounter.id, expectedVersion: encounter.version, participantId: participant.id, visible: e.target.checked })} />Show</label>
            <button className="btn btn-ghost px-1 py-0" disabled={busy} aria-label={`Remove ${participant.name}`} onClick={() => void act({ type: 'sceneEncounterRemove', sceneId: scene.id, publishedRevision: scene.published_revision ?? 0, encounterId: encounter.id, expectedVersion: encounter.version, participantId: participant.id })}>×</button>
          </li>)}
        </ol>
        <form className="flex flex-wrap items-end gap-2" onSubmit={addNpc}>
          <label className="flex-1 text-xs text-marble-400">Add NPC
            <input className="mt-1 w-full rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm" maxLength={80} value={npcName} onChange={e => setNpcName(e.target.value)} placeholder="Name" />
          </label><label className="text-xs text-marble-400">Init <input className="mt-1 w-16 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm" type="number" min={-100} max={1000} value={npcInitiative} onChange={e => setNpcInitiative(Number(e.target.value))} /></label>
          <button className="btn btn-ghost" disabled={busy || !npcName.trim()}>Add</button>
        </form>
      </div>}
    </section>
  </div>;
}
