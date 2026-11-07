/**
 * Game – the GM's live table. The active map fills the centre; scene selection, player locations and
 * scene tools are ordinary workspace widgets (left or right dock, order and placement persisted).
 *
 * Flow: clicking a scene only SELECTS it (map preview). "Switch Scene" makes the selected scene the
 * GM's current scene and asks whether all players come along. Individual players can then be sent to
 * the selected scene or back to the Sanctuary. Selection, current scene and player assignments are
 * separate state (src/game/sceneDirector.ts) and never reset each other; every transfer carries the
 * player revisions the GM saw, and stale revisions are reported instead of being overwritten.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { GameApi, DispatchResult } from '../state/gameApi';
import type { SceneCategory, SceneSummary } from '../server/scenes';
import type { SceneSnapshot } from '../server/sceneRuntime';
import type { TravelSnapshot } from '../server/sceneTravel';
import type { Command } from '../game/commands';
import type { WidgetDef } from '../workspace/Workspace';
import { api, ApiError } from '../online/api';
import {
  ARENA_ID,
  assignmentDestination,
  canMove,
  currentToStored,
  describeTransferError,
  directorReducer,
  initialDirector,
  locationLabel,
  storedToCurrent,
  transferTargets,
  type DirectorPlayer,
} from '../game/sceneDirector';
import { SceneSurface } from './SceneSurface';
import { SceneThumbnail } from './SceneThumbnail';
import { GmLootRolls } from './LootRolls';
import { SceneLiveControls } from './SceneLiveControls';
import { WorldTravel } from './WorldTravel';

/** Kept for existing callers/tests: a short location label relative to a focused scene. */
export function assignmentLocation(player: { sceneId: string | null }, focusId: string | null, scenes: Pick<SceneSummary, 'id' | 'name'>[]): string {
  if (!player.sceneId) return 'Sanctuary';
  if (focusId && player.sceneId === focusId) return 'here';
  return scenes.find((scene) => scene.id === player.sceneId)?.name ?? 'another scene';
}

const CATEGORY_LABEL: Record<SceneCategory, string> = { celestial: 'Celestial map', world: 'World map', region: 'Region map', battle: 'Battle map' };
const focusKey = (campaignId: string) => `apex.map.gm-focus.${campaignId}`;
function readFocus(campaignId: string): string | null {
  try {
    return localStorage.getItem(focusKey(campaignId));
  } catch {
    return null;
  }
}
function writeFocus(campaignId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(focusKey(campaignId), id);
    else localStorage.removeItem(focusKey(campaignId));
  } catch {
    /* the current scene stays session-local if storage is unavailable */
  }
}

interface Transfer {
  destination: string | null;
  targets: Array<{ userId: string; revision: number }>;
  requestId: string;
  /** Scene to make current after a successful "Switch Scene and bring everyone". */
  switchTo?: string;
  label: string;
}

export interface GameDirector {
  enabled: boolean;
  /** True when the map shows the Arena (Arena-only widgets are active). */
  arenaShown: boolean;
  /** Scene maps support stage zoom; the Arena keeps its own zoom. */
  zoomable: boolean;
  widgets: WidgetDef[];
  renderMap: (arena: ReactNode) => ReactNode;
}

export function useGameDirector({ game, enabled, run }: { game: GameApi; enabled: boolean; run: (cmd: Command) => Promise<DispatchResult> }): GameDirector {
  const online = enabled ? game.online : undefined;
  const campaignId = online?.campaignId ?? '';
  const [state, dispatch] = useReducer(directorReducer, undefined, () => initialDirector(storedToCurrent(campaignId ? readFocus(campaignId) : null)));
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<DirectorPlayer[]>([]);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const [mapError, setMapError] = useState('');
  const [travel, setTravel] = useState<{ sceneId: string; data: TravelSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState<Transfer | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [placementToken, setPlacementToken] = useState('');
  const [placeMode, setPlaceMode] = useState(false);
  const snapshotRequest = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (campaignId) dispatch({ type: 'restore', current: storedToCurrent(readFocus(campaignId)) });
  }, [campaignId]);

  const loadScenes = useCallback(async (searchText: string) => {
    const page = await api.sceneList(0, { archived: false, sort: 'name', search: searchText.trim() || undefined });
    setScenes(page.scenes);
    setNextOffset(page.nextOffset);
  }, []);
  const loadPlayers = useCallback(async () => {
    const result = await api.scenePlayers();
    setPlayers(result.players);
    dispatch({ type: 'playersLoaded', players: result.players });
    return result.players;
  }, []);

  useEffect(() => {
    if (!online) return;
    loadScenes('').catch((e) => setError(String(e)));
  }, [online?.campaignId, loadScenes]);
  useEffect(() => {
    if (!online) return;
    loadPlayers().catch((e) => setError(String(e)));
  }, [online?.campaignId, online?.version, loadPlayers]);

  const shown = state.selected;
  // Published map of the shown scene (selected preview or current scene). Stale answers are ignored.
  useEffect(() => {
    if (!online) return;
    const request = ++snapshotRequest.current;
    setMapError('');
    if (shown === ARENA_ID) {
      setSnapshot(null);
      return;
    }
    api
      .sceneFocus(shown)
      .then((s) => {
        if (snapshotRequest.current === request) setSnapshot(s);
      })
      .catch((e) => {
        if (snapshotRequest.current !== request) return;
        setSnapshot(null);
        setMapError(e instanceof ApiError && e.status === 404 ? 'This scene is not published (or was archived). Publish it in Scenes first.' : String(e));
      });
  }, [online?.campaignId, online?.version, shown]);
  useEffect(() => {
    setPlaceMode(false);
    setPlacementToken('');
    setConfirmSwitch(false);
  }, [shown]);

  const shownScene = snapshot?.scene && snapshot.scene.id === shown ? snapshot.scene : null;
  useEffect(() => {
    let live = true;
    if (online && shownScene?.category === 'world')
      api
        .sceneTravelState(shownScene.id)
        .then((data) => {
          if (live) setTravel({ sceneId: shownScene.id, data });
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [online?.version, shownScene?.id, shownScene?.category]);

  const published = useMemo(() => scenes.filter((s) => !s.is_legacy_arena && !s.is_draft && !s.archived), [scenes]);
  const listName = (id: string) => (id === ARENA_ID ? 'Arena' : (scenes.find((s) => s.id === id)?.name ?? (snapshot?.scene?.id === id ? snapshot.scene.name : 'Scene')));
  const destinationFor = (id: string) => assignmentDestination(id, scenes);
  const assignedTo = (id: string) => {
    const dest = destinationFor(id);
    return dest ? players.filter((p) => p.sceneId === dest) : [];
  };
  const shownPlayers = assignedTo(shown);
  const tokenIds = [...new Set(shownPlayers.flatMap((p) => p.tokenIds))];
  const markers = tokenIds
    .map((tokenId) => {
      const t = game.gmState?.tokens[tokenId];
      return t ? { tokenId, name: t.name, color: t.color } : null;
    })
    .filter((t): t is { tokenId: string; name: string; color: string } => !!t);

  function commitSwitch(id: string) {
    dispatch({ type: 'switched', id });
    writeFocus(campaignId, currentToStored(id));
  }

  /** Sends one transfer. Returns true on success; failures leave the current scene untouched. */
  async function send(intent: Transfer): Promise<boolean> {
    try {
      await api.sceneAssign(intent.destination, intent.targets, intent.requestId);
      setUncertain(null);
      if (intent.switchTo) commitSwitch(intent.switchTo);
      setNotice(intent.label);
      await loadPlayers().catch(() => undefined);
      return true;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setError(describeTransferError(status, e instanceof Error ? e.message : String(e)));
      if (status === 0 || status >= 500) setUncertain(intent);
      else {
        setUncertain(null);
        await loadPlayers().catch(() => undefined);
      }
      return false;
    }
  }

  async function guarded(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function switchScene(bringAll: boolean) {
    const target = state.selected;
    setConfirmSwitch(false);
    void guarded(async () => {
      if (!bringAll) {
        commitSwitch(target);
        setNotice(`${listName(target)} is now the current scene. Player locations are unchanged.`);
        return;
      }
      const dest = destinationFor(target);
      if (!dest) {
        setError('This scene cannot receive players (the Arena scene record is missing). Switch without players or reload.');
        return;
      }
      const fresh = await loadPlayers();
      const targets = transferTargets(fresh, fresh.map((p) => p.userId), dest);
      if (!targets.length) {
        commitSwitch(target);
        setNotice(`${listName(target)} is now the current scene. All players were already there.`);
        return;
      }
      await send({ destination: dest, targets, requestId: crypto.randomUUID(), switchTo: target, label: `${listName(target)} is now the current scene. ${targets.length} player${targets.length === 1 ? '' : 's'} moved along.` });
    });
  }

  function transferSelected(toSanctuary: boolean) {
    void guarded(async () => {
      const dest = toSanctuary ? null : destinationFor(state.selected);
      if (dest === undefined) {
        setError('Choose a published scene first.');
        return;
      }
      const targets = transferTargets(players, state.selectedPlayers, dest);
      if (!targets.length) {
        setNotice('The selected players are already there.');
        return;
      }
      const where = toSanctuary ? 'the Sanctuary' : listName(state.selected);
      if (await send({ destination: dest, targets, requestId: crypto.randomUUID(), label: `${targets.length} player${targets.length === 1 ? '' : 's'} sent to ${where}. The current scene is unchanged.` }))
        dispatch({ type: 'selectPlayers', userIds: [] });
    });
  }

  function retryUncertain() {
    const intent = uncertain;
    if (intent) void guarded(async () => void (await send(intent)));
  }

  function placeToken(x: number, y: number) {
    const scene = shownScene;
    if (!scene || !placementToken || !placeMode) return;
    void guarded(async () => {
      const position = snapshot?.motion?.tokens.find((t) => t.tokenId === placementToken);
      const assignment = shownPlayers.find((p) => p.tokenIds.includes(placementToken));
      const interval = scene.category === 'battle' ? 'round' : 'hour';
      await api.sceneMove({
        action: 'place',
        requestId: crypto.randomUUID(),
        sceneId: scene.id,
        sceneRevision: scene.revision,
        tokenId: placementToken,
        tokenVersion: position?.version ?? 0,
        assignmentRevision: assignment?.revision ?? 0,
        epoch: interval === 'round' ? (snapshot?.motion?.round ?? 0) : (snapshot?.motion?.hour ?? 0),
        x,
        y,
      });
      setSnapshot(await api.sceneFocus(scene.id));
      setNotice('Token position saved to this scene.');
    });
  }

  function advanceInterval() {
    const scene = shownScene;
    if (!scene) return;
    void guarded(async () => {
      const interval = scene.category === 'battle' ? 'round' : 'hour';
      await api.sceneMove({ action: 'advance', requestId: crypto.randomUUID(), interval, expected: interval === 'round' ? (snapshot?.motion?.round ?? 0) : (snapshot?.motion?.hour ?? 0) });
      setSnapshot(await api.sceneFocus(scene.id));
      setNotice(interval === 'round' ? 'Next tactical round.' : 'Next exploration hour.');
    });
  }

  async function searchScenes(event: FormEvent) {
    event.preventDefault();
    await guarded(() => loadScenes(search));
  }
  async function loadMore() {
    if (nextOffset === null) return;
    await guarded(async () => {
      const page = await api.sceneList(nextOffset, { archived: false, sort: 'name', search: search.trim() || undefined });
      setScenes((old) => [...old, ...page.scenes.filter((s) => !old.some((o) => o.id === s.id))]);
      setNextOffset(page.nextOffset);
    });
  }

  const status = (
    <>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-xs text-gold-200">
          {notice}
        </p>
      )}
    </>
  );

  if (!online) return { enabled: false, arenaShown: true, zoomable: false, widgets: [], renderMap: (arena) => arena };

  const previewing = state.selected !== state.current;
  const movable = players.filter(canMove);
  const selectedDest = destinationFor(state.selected);
  const entries: Array<{ id: string; name: string; meta: string; thumb?: string | null }> = [
    { id: ARENA_ID, name: 'Arena', meta: 'Arena · hex campaign map', thumb: null },
    ...published.map((s) => ({ id: s.id, name: s.name, meta: CATEGORY_LABEL[s.category], thumb: s.thumbnail_asset_id })),
  ];

  const scenesWidget: WidgetDef = {
    id: 'game-scenes',
    title: 'Scenes',
    icon: '🗺',
    render: () => (
      <div className="space-y-2" data-testid="game-scenes">
        <p className="text-xs text-marble-400">
          Current scene: <strong className="text-gold-200">{listName(state.current)}</strong>
          {previewing && (
            <>
              {' '}
              · previewing <strong className="text-marble-100">{listName(state.selected)}</strong>
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-gold" type="button" disabled={busy || !previewing || (state.selected !== ARENA_ID && !published.some((s) => s.id === state.selected))} onClick={() => setConfirmSwitch(true)}>
            Switch Scene
          </button>
          {previewing && (
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => dispatch({ type: 'select', id: state.current })}>
              Back to current scene
            </button>
          )}
        </div>
        {confirmSwitch && (
          <div role="alertdialog" aria-labelledby="switch-scene-title" className="rounded-md border border-gold-500/60 bg-ink-900 p-2 text-xs">
            <p id="switch-scene-title" className="font-semibold text-gold-200">
              Make “{listName(state.selected)}” the current scene?
            </p>
            <p className="mt-1 text-marble-400">
              Bring all players along? {players.length ? `${transferTargets(players, players.map((p) => p.userId), selectedDest ?? null).length} of ${players.length} would move${players.length > movable.length ? ` (${players.length - movable.length} not joined yet)` : ''}.` : 'No active players.'} You can still move single players or send them to the Sanctuary afterwards.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn btn-gold" type="button" disabled={busy || !selectedDest || !movable.length} onClick={() => switchScene(true)}>
                Switch and move all players
              </button>
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => switchScene(false)}>
                Switch only – players stay
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmSwitch(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <form className="flex gap-2" onSubmit={(e) => void searchScenes(e)}>
          <label className="sr-only" htmlFor="game-scene-search">
            Search published scenes
          </label>
          <input id="game-scene-search" className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-marble-100" placeholder="Search published scenes" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn btn-ghost" disabled={busy}>
            Search
          </button>
        </form>
        <ul className="game-scene-list" aria-label="Published scenes">
          {entries.map((entry) => {
            const here = assignedTo(entry.id).length;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="game-scene-card"
                  aria-pressed={state.selected === entry.id}
                  aria-current={state.current === entry.id ? 'true' : undefined}
                  onClick={() => dispatch({ type: 'select', id: entry.id })}
                >
                  {entry.id === ARENA_ID ? (
                    <div className="scene-thumbnail">
                      <span aria-hidden="true">⬢</span>
                    </div>
                  ) : (
                    <SceneThumbnail assetId={entry.thumb} label={entry.name} />
                  )}
                  <span className="min-w-0">
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.meta}
                      {here ? ` · ${here} player${here === 1 ? '' : 's'}` : ''}
                    </small>
                  </span>
                  {state.current === entry.id ? <em className="chip">Current</em> : state.selected === entry.id ? <em className="chip">Preview</em> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {!published.length && <p className="text-xs text-marble-500">No published scenes match. Create and publish maps in Scenes.</p>}
        {nextOffset !== null && (
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void loadMore()}>
            Load more scenes
          </button>
        )}
        {status}
      </div>
    ),
  };

  const allSelected = movable.length > 0 && movable.every((p) => state.selectedPlayers.includes(p.userId));
  const playersWidget: WidgetDef = {
    id: 'game-players',
    title: 'Player locations',
    icon: '👥',
    render: () => (
      <div className="space-y-2" data-testid="game-players">
        <fieldset disabled={busy || !!uncertain} className="space-y-1">
          <legend className="text-xs text-marble-400">Tick players, then send them to the selected scene ({listName(state.selected)}) or to the Sanctuary.</legend>
          {players.length ? (
            players.map((p) => (
              <label key={p.userId} className={`flex items-center gap-2 text-xs ${canMove(p) ? 'text-marble-200' : 'text-marble-500'}`}>
                <input type="checkbox" disabled={!canMove(p)} checked={canMove(p) && state.selectedPlayers.includes(p.userId)} onChange={(e) => dispatch({ type: 'togglePlayer', userId: p.userId, on: e.target.checked })} />
                <span className="flex-1">{p.name}</span>
                <span className="text-marble-500">{canMove(p) ? locationLabel(p, scenes, state.current) : 'not joined yet – signs in first'}</span>
              </label>
            ))
          ) : (
            <p className="text-xs text-marble-500">No active players.</p>
          )}
          {movable.length > 0 && (
            <button className="btn btn-ghost" type="button" onClick={() => dispatch({ type: 'selectPlayers', userIds: allSelected ? [] : movable.map((p) => p.userId) })}>
              {allSelected ? 'Clear selection' : 'Select all players'}
            </button>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className="btn btn-gold" type="button" disabled={!state.selectedPlayers.length || selectedDest === undefined} onClick={() => transferSelected(false)}>
              Send selected to {listName(state.selected)}
            </button>
            <button className="btn btn-ghost" type="button" disabled={!state.selectedPlayers.length} onClick={() => transferSelected(true)}>
              Send selected to Sanctuary
            </button>
          </div>
        </fieldset>
        {uncertain && (
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={retryUncertain}>
            Verify or retry previous transfer
          </button>
        )}
        <button className="btn btn-ghost text-[11px]" type="button" disabled={busy} onClick={() => void guarded(async () => void (await loadPlayers()))}>
          ↻ Refresh locations
        </button>
        {status}
      </div>
    ),
  };

  const placeable = !!shownScene && ['battle', 'region'].includes(shownScene.category) && markers.length > 0;
  const toolsWidget: WidgetDef = {
    id: 'game-scene-tools',
    title: 'Scene tools',
    icon: '🎲',
    inactive: !shownScene,
    render: () =>
      shownScene ? (
        <div className="space-y-3" data-testid="game-scene-tools">
          <p className="text-xs text-marble-400">
            {shownScene.name} · {CATEGORY_LABEL[shownScene.category]}
            {previewing ? ' · preview (not the current scene)' : ''}
          </p>
          {placeable && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="text-marble-300">
                Character
                <select className="ml-2 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs" value={placementToken} onChange={(e) => setPlacementToken(e.target.value)}>
                  <option value="">Choose</option>
                  {markers.map((t) => (
                    <option key={t.tokenId} value={t.tokenId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-ghost" type="button" disabled={!placementToken || busy} aria-pressed={placeMode} onClick={() => setPlaceMode((v) => !v)}>
                {placeMode ? 'Cancel placement' : 'Place on map'}
              </button>
            </div>
          )}
          {snapshot?.motion && ['battle', 'region'].includes(shownScene.category) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-marble-400">{shownScene.category === 'battle' ? `Round ${snapshot.motion.round}` : `Hour ${snapshot.motion.hour}`}</span>
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={advanceInterval}>
                {shownScene.category === 'battle' ? 'Next round' : 'Next hour'}
              </button>
            </div>
          )}
          {shownScene.category === 'world' && travel?.sceneId === shownScene.id && (
            <WorldTravel key={`travel-${shownScene.id}`} gm sceneId={shownScene.id} sceneRevision={shownScene.revision} assignmentRevision={0} map={shownScene.map} travel={travel.data} onChanged={() => void api.sceneTravelState(shownScene.id).then((data) => setTravel({ sceneId: shownScene.id, data })).catch((e) => setError(String(e)))} />
          )}
          {(() => {
            const summary = scenes.find((s) => s.id === shownScene.id);
            return summary?.published_revision ? <SceneLiveControls key={`live-${shownScene.id}`} game={game} scene={summary} characters={markers.map((m) => ({ tokenId: m.tokenId, name: m.name }))} run={run} /> : null;
          })()}
          <section aria-label="Scene loot">
            <h3 className="text-xs font-bold text-marble-300">Loot</h3>
            <GmLootRolls key={`loot-${shownScene.id}`} rolls={(game.gmState?.lootRolls ?? []).filter((r) => r.sceneId === shownScene.id)} staged={game.gmState?.arsenal?.staged ?? []} players={markers.map((m) => ({ id: m.tokenId, name: m.name }))} run={run} sceneId={shownScene.id} />
          </section>
          {status}
        </div>
      ) : null,
  };

  const renderMap = (arena: ReactNode) => {
    const banner = previewing ? (
      <div className="game-map-banner" role="status">
        Preview of <strong>{listName(state.selected)}</strong> – not the current scene. Use “Switch Scene” to go live.
      </div>
    ) : null;
    if (shown === ARENA_ID)
      return (
        <>
          {banner}
          {arena}
        </>
      );
    return (
      <div className="game-map" aria-label="Campaign map">
        {banner}
        {shownScene && snapshot ? (
          <SceneSurface snapshot={snapshot} tokenLabels={markers} onDestination={placeMode ? placeToken : undefined} />
        ) : mapError ? (
          <p role="alert" className="p-6 text-sm text-red-300">
            {mapError}
          </p>
        ) : (
          <p role="status" className="p-6 text-sm text-marble-400">
            Loading map…
          </p>
        )}
      </div>
    );
  };

  return { enabled: true, arenaShown: shown === ARENA_ID, zoomable: shown !== ARENA_ID, widgets: [scenesWidget, playersWidget, toolsWidget], renderMap };
}
