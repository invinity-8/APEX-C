import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { GameApi } from '../state/gameApi';
import type { SceneSummary } from '../server/scenes';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { Command } from '../game/commands';
import type { DispatchResult } from '../state/gameApi';
import { api, ApiError } from '../online/api';
import { SceneSurface } from './SceneSurface';
import { GmLootRolls } from './LootRolls';

interface PlayerAssignment {
  userId: string; name: string; tokenIds: string[]; sceneId: string | null; revision: number; inheritedArena: boolean;
}
export function assignmentLocation(player: Pick<PlayerAssignment, 'sceneId'>, focusId: string | null, scenes: Pick<SceneSummary, 'id' | 'name'>[]): string {
  if (!player.sceneId) return 'Sanctuary';
  if (focusId && player.sceneId === focusId) return 'here';
  return scenes.find(scene => scene.id === player.sceneId)?.name ?? 'another scene';
}
const FOCUS_EVENT = 'apex:scene-focus-changed';
const focusKey = (campaignId: string) => `apex.map.gm-focus.${campaignId}`;

function readFocus(campaignId: string): string | null {
  try { return localStorage.getItem(focusKey(campaignId)); } catch { return null; }
}

/**
 * Map is the GM's operational view. A selected focus is a private GM presentation
 * choice; player transfers are separate explicit actions against server revisions.
 */
export function CampaignMapDirector({ game, enabled, openScenes, run, children }: {
  game: GameApi; enabled: boolean; openScenes: () => void; run: (cmd: Command) => Promise<DispatchResult>; children: ReactNode;
}) {
  const online = game.online;
  const campaignId = online?.campaignId ?? '';
  const [focusId, setFocusId] = useState(() => enabled ? readFocus(campaignId) : null);
  const [focus, setFocus] = useState<SceneSnapshot | null>(null);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [players, setPlayers] = useState<PlayerAssignment[]>([]);
  const [selection, setSelection] = useState('');
  const [search, setSearch] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [placementToken, setPlacementToken] = useState('');
  const [placeMode, setPlaceMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadScenes(searchText = '') {
    const page = await api.sceneList(0, { archived: false, sort: 'name', search: searchText.trim() || undefined });
    setScenes(page.scenes);
    setNextOffset(page.nextOffset);
  }
  async function loadPlayers() {
    const result = await api.scenePlayers();
    setPlayers(result.players);
  }
  async function loadFocus(id: string | null) {
    if (!id) { setFocus(null); return; }
    try { setFocus(await api.sceneFocus(id)); setError(''); }
    catch (e) { setFocus(null); setError(String(e)); }
  }

  useEffect(() => {
    if (enabled) setFocusId(readFocus(campaignId));
  }, [enabled, campaignId]);

  useEffect(() => {
    if (!enabled || !online) return;
    let live = true;
    api.sceneList(0, { archived: false, sort: 'name' }).then(page => { if (live) { setScenes(page.scenes); setNextOffset(page.nextOffset); } }).catch(e => { if (live) setError(String(e)); });
    api.scenePlayers().then(result => { if (live) setPlayers(result.players); }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [enabled, campaignId]);

  useEffect(() => {
    if (!enabled || !online) return;
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ campaignId?: string; sceneId?: string | null }>).detail;
      if (detail?.campaignId !== campaignId) return;
      const id = detail.sceneId ?? null;
      setFocusId(id);
      void loadFocus(id);
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [enabled, online, campaignId]);

  useEffect(() => {
    if (!enabled || !online) return;
    void loadFocus(focusId);
    void loadPlayers().catch(e => setError(String(e)));
  }, [enabled, focusId, online?.version]);

  const publishedScenes = useMemo(
    () => scenes.filter(scene => !scene.is_legacy_arena && !scene.is_draft && !scene.archived),
    [scenes],
  );
  const focusedDefinition = focus?.scene ? scenes.find(scene => scene.id === focus.scene!.id) : undefined;
  const liveVisibilityNodes = focus?.scene?.map.nodes.filter(node => ['location', 'label', 'wall', 'area'].includes(node.kind)) ?? [];
  const assignedHere = players.filter(player => player.sceneId === focusId);
  const focusTokenIds = [...new Set(assignedHere.flatMap(player => player.tokenIds))];
  const markers = focusTokenIds.map(tokenId => {
    const token = game.gmState?.tokens[tokenId];
    return token ? { tokenId, name: token.name, color: token.color } : null;
  }).filter((token): token is { tokenId: string; name: string; color: string } => !!token);
  const allowedTokens = markers.filter(token => focusTokenIds.includes(token.tokenId));

  function changeFocus(id: string | null) {
    setFocusId(id);
    setSelection('');
    setSelectedPlayers([]);
    setPlaceMode(false);
    setNotice('');
    try {
      if (id) localStorage.setItem(focusKey(campaignId), id);
      else localStorage.removeItem(focusKey(campaignId));
    } catch { /* Map focus can remain session-local if storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { campaignId, sceneId: id } }));
    void loadFocus(id);
  }

  async function searchScenes(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await loadScenes(search); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function loadMoreScenes() {
    if (nextOffset === null || busy) return;
    setBusy(true); setError('');
    try {
      const page = await api.sceneList(nextOffset, { archived: false, sort: 'name', search: search.trim() || undefined });
      setScenes(old => [...old, ...page.scenes.filter(scene => !old.some(item => item.id === scene.id))]);
      setNextOffset(page.nextOffset);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function transfer(sceneId: string | null) {
    const targets = players.filter(player => selectedPlayers.includes(player.userId)).map(player => ({ userId: player.userId, revision: player.revision }));
    if (!targets.length || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.sceneAssign(sceneId, targets, crypto.randomUUID());
      setPlayers((await api.scenePlayers()).players);
      if (focusId) setFocus(await api.sceneFocus(focusId));
      setSelectedPlayers([]);
      setNotice(sceneId ? 'Selected players transferred. The GM focus stayed unchanged.' : 'Selected players returned to Sanctuary. The GM focus stayed unchanged.');
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setError('The transfer may still have completed. Refresh player assignments before retrying.');
      else setError(String(e));
    } finally { setBusy(false); }
  }

  async function advanceInterval() {
    if (!focus?.scene || busy) return;
    const interval = focus.scene.category === 'battle' ? 'round' : 'hour';
    const expected = interval === 'round' ? focus.motion?.round ?? 0 : focus.motion?.hour ?? 0;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.sceneMove({ action: 'advance', requestId: crypto.randomUUID(), interval, expected });
      setFocus(await api.sceneFocus(focus.scene.id));
      setNotice('Scene interval advanced.');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function setLiveVisibility(nodeId: string, visible: boolean) {
    const scene = focusedDefinition;
    if (!scene || scene.published_revision === undefined || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.sceneAction(scene.id, scene.revision, 'set_visibility', {
        nodeId, visible, publishedRevision: scene.published_revision,
      });
      setScenes(rows => rows.map(row => row.id === scene.id ? { ...row, ...result.scene } : row));
      setFocus(await api.sceneFocus(scene.id));
      setNotice(visible ? 'Marker revealed on the published map. Other draft changes remain private.' : 'Marker hidden on the published map. Other draft changes remain private.');
    } catch (e) {
      setError(String(e));
      void loadScenes(search);
      void loadFocus(scene.id);
    } finally { setBusy(false); }
  }

  async function placeToken(x: number, y: number) {
    if (!focus?.scene || !placementToken || busy || !placeMode) return;
    const tokenPosition = focus.motion?.tokens.find(position => position.tokenId === placementToken);
    const assignment = assignedHere.find(player => player.tokenIds.includes(placementToken));
    const interval = focus.scene.category === 'battle' ? 'round' : 'hour';
    const epoch = interval === 'round' ? focus.motion?.round ?? 0 : focus.motion?.hour ?? 0;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.sceneMove({
        action: 'place', requestId: crypto.randomUUID(), sceneId: focus.scene.id,
        sceneRevision: focus.scene.revision, tokenId: placementToken, tokenVersion: tokenPosition?.version ?? 0,
        assignmentRevision: assignment?.revision ?? 0, epoch, x, y,
      });
      setFocus(await api.sceneFocus(focus.scene.id));
      setNotice('Party position saved to this scene.');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  if (!enabled || !online) return <>{children}</>;
  const canPlace = !!focus?.scene && ['battle', 'region'].includes(focus.scene.category) && allowedTokens.length > 0;

  return <div className="flex h-full min-h-0 flex-col overflow-auto">
    <section className="border-b border-gold-700/30 bg-ink-950/90 p-3" aria-label="Live campaign map controls">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <p className="eyebrow">Live campaign director</p>
          <h2 className="font-display text-lg text-gold-200">{focus?.scene?.name ?? 'Arena focus'}</h2>
          <p className="text-xs text-marble-400">GM focus is private to you. Player assignments change only when you transfer selected players.</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={searchScenes}>
          <label className="text-xs text-marble-300">Prepared scene
            <select className="ml-2 min-w-48 rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-marble-100" value={selection} onChange={event => setSelection(event.target.value)}>
              <option value="">Choose a published scene</option>
              {publishedScenes.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
            </select>
          </label>
          <button className="btn btn-gold" type="button" disabled={busy || !selection} onClick={() => changeFocus(selection)}>Switch Scene</button>
          <button className="btn btn-ghost" type="button" disabled={busy || !focusId} onClick={() => changeFocus(null)}>Arena</button>
          <button className="btn btn-ghost" type="button" onClick={openScenes}>Scene Library</button>
        </form>
      </div>
      <form className="mt-2 flex gap-2" onSubmit={searchScenes}>
        <label className="sr-only" htmlFor="map-scene-search">Search scenes</label>
        <input id="map-scene-search" className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-100" placeholder="Search the scene library" value={search} onChange={event => setSearch(event.target.value)} />
        <button className="btn btn-ghost" disabled={busy}>Search</button>
        {nextOffset !== null && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void loadMoreScenes()}>More</button>}
      </form>
      {focus && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Players in this scene">
        <strong className="text-xs text-marble-300">Assigned here:</strong>
        {assignedHere.length ? assignedHere.map(player => <span key={player.userId} className="chip">{player.name}</span>) : <span className="text-xs text-marble-500">No players assigned</span>}
        {players.length > 0 && <button className="btn btn-ghost" type="button" onClick={() => setSelectedPlayers(selectedPlayers.length === players.length ? [] : players.map(player => player.userId))}>{selectedPlayers.length === players.length ? 'Clear selection' : 'Select party'}</button>}
      </div>}
      <fieldset className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-marble-300" disabled={busy} aria-label="Player assignments">
        <legend className="text-xs text-marble-400">Player assignments · separate from GM focus{focus?.scene ? ` · focus: ${focus.scene.name}` : ' · no scene focus'}</legend>
        {players.length > 0 ? players.map(player => <label key={player.userId} className="flex items-center gap-1"><input type="checkbox" checked={selectedPlayers.includes(player.userId)} onChange={event => setSelectedPlayers(old => event.target.checked ? [...old, player.userId] : old.filter(id => id !== player.userId))} />{player.name} · {assignmentLocation(player, focusId, scenes)}</label>) : <span role="status" className="text-marble-500">No active player assignments.</span>}
        <button className="btn btn-gold" type="button" disabled={!selection || !selectedPlayers.length} onClick={() => void transfer(selection)}>Send selected to chosen scene</button>
        <button className="btn btn-ghost" type="button" disabled={!selectedPlayers.length} onClick={() => void transfer(null)}>Send selected to Sanctuary</button>
      </fieldset>
      {focus?.scene && <fieldset className="mt-2 rounded-md border border-ink-700 p-2 text-xs" disabled={busy || !focusedDefinition?.published_revision} aria-label="Scene visibility and fog controls">
        <legend className="px-1 text-marble-300">Live visibility · {focus.scene.name}</legend>
        <p className="mb-2 text-marble-500">Reveal or hide markers on the published map now. The matching draft marker is synchronized; other draft edits stay private.</p>
        {liveVisibilityNodes.length ? <ul className="flex flex-wrap gap-1.5">
          {liveVisibilityNodes.map(node => <li key={node.id} className="flex items-center gap-1 rounded border border-ink-700 px-2 py-1">
            <span className="text-marble-300">{node.label}</span>
            <span className={node.visible ? 'text-emerald-300' : 'text-marble-500'}>{node.visible ? 'Revealed' : 'Hidden'}</span>
            <button className="btn btn-ghost px-2 py-0.5" type="button" disabled={!focusedDefinition?.published_revision} aria-label={`${node.visible ? 'Hide' : 'Reveal'} ${node.label}`} onClick={() => void setLiveVisibility(node.id, !node.visible)}>{node.visible ? 'Hide' : 'Reveal'}</button>
          </li>)}
        </ul> : <span className="text-marble-500">No revealable map markers.</span>}
      </fieldset>}
      {focus?.scene && <section className="mt-2 rounded-md border border-ink-700 p-2" aria-label="Scene loot controls">
        <h3 className="text-xs font-bold text-marble-300">Loot · {focus.scene.name}</h3>
        <p className="mb-2 text-xs text-marble-500">Only characters assigned to this scene can be selected for new rolls.</p>
        <GmLootRolls
          key={`scene-loot-${focus.scene.id}`}
          rolls={(game.gmState?.lootRolls ?? []).filter(roll => roll.sceneId === focus.scene!.id)}
          staged={game.gmState?.arsenal?.staged ?? []}
          players={markers.map(token => ({ id: token.tokenId, name: token.name }))}
          run={run}
          sceneId={focus.scene.id}
        />
      </section>}
      {canPlace && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="text-marble-300">Party character
          <select className="ml-2 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm" value={placementToken} onChange={event => setPlacementToken(event.target.value)}>
            <option value="">Choose character</option>
            {allowedTokens.map(token => <option key={token.tokenId} value={token.tokenId}>{token.name}</option>)}
          </select>
        </label>
        <button className="btn btn-ghost" type="button" disabled={!placementToken || busy} aria-pressed={placeMode} onClick={() => setPlaceMode(value => !value)}>{placeMode ? 'Cancel placement' : 'Place token'}</button>
        {focus?.motion && <span className="text-marble-400">{focus.scene?.category === 'battle' ? `Round ${focus.motion.round}` : `Hour ${focus.motion.hour}`}</span>}
        {focus?.motion && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void advanceInterval()}>Advance interval</button>}
      </div>}
      {error && <p role="alert" className="mt-2 text-sm text-blood-200">{error}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-gold-200">{notice}</p>}
    </section>
    <div className="min-h-0 flex-1 overflow-auto" aria-label="Campaign map">
      {focus?.scene
        ? <SceneSurface snapshot={focus} tokenLabels={markers} onDestination={placeMode ? placeToken : undefined} />
        : children}
    </div>
  </div>;
}
