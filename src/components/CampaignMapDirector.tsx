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
import { BattleCommand, refKey, toSide, type BattleMode, type FigureRef } from './BattleCommand';
import { activeActors, budgetOf, isActiveActor } from '../game/sceneActions';
import { InitiativeBar } from './PlayerScene';
import type { SceneInteraction } from './SceneSurface';
import { areaHexes } from '../campaign/hexArea';
import { approachHex, pcInteraction, type SpellTarget } from './pcInteraction';
import { PlayerCombat, type ReadyAction } from './PlayerCombat';
import { withSrdSpells } from '../game/sceneActions';
import type { CharacterSheet, SheetAttack } from '../game/sheet';
import { hexAt } from '../campaign/hexScene';
import { distance, hexKey } from '../game/hex';
import { combatAttacks } from '../game/effectiveStats';
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
import { HexThumbnail } from './HexThumbnail';
import { GmLootRolls } from './LootRolls';
import { SceneLiveControls } from './SceneLiveControls';
import { WorldTravel } from './WorldTravel';
import { ENEMY_TEMPLATES, npcAttacks } from '../game/sceneCombat';
import { bestiary, displayName } from '../game/bestiary';

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

export function useGameDirector({ game, enabled, run, active = true }: { game: GameApi; enabled: boolean; run: (cmd: Command) => Promise<DispatchResult>; /** Game tab is visible: refresh the published scene list (e.g. after publishing in Scenes). */ active?: boolean }): GameDirector {
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
  // Enemy tools: place a new enemy / move the selected one by clicking a hex.
  const [enemyTemplate, setEnemyTemplate] = useState(ENEMY_TEMPLATES[0].id);
  const [enemyMode, setEnemyMode] = useState<null | 'place' | 'move'>(null);
  const [selectedEnemy, setSelectedEnemy] = useState<string | null>(null);
  const [enemyTarget, setEnemyTarget] = useState('');
  const [enemySide, setEnemySide] = useState<'enemy' | 'ally'>('enemy');
  // APEX 1.1 battle command: vision mode, selected figure, click mode, GM attack choice for characters
  const [view, setView] = useState('all');
  const [selected, setSelected] = useState<FigureRef | null>(null);
  const [battleMode, setBattleMode] = useState<BattleMode>(null);
  const [pcAttack, setPcAttack] = useState(0);
  const [npcAttack, setNpcAttack] = useState(0);
  const [areaMode, setAreaMode] = useState<number | null>(null);
  const [gmAdv, setGmAdv] = useState<'' | 'adv' | 'dis'>('');
  // APEX 1.4: the GM acts for a character with the same combat panel as its player
  const [pcSheet, setPcSheet] = useState<CharacterSheet | null>(null);
  const [pcAttacks, setPcAttacks] = useState<SheetAttack[]>([]);
  const [pcReady, setPcReady] = useState<ReadyAction>(null);
  const [pcTargets, setPcTargets] = useState<SpellTarget[]>([]);
  const [pcMenu, setPcMenu] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedPc = selected?.kind === 'pc' ? selected.id : null;
  useEffect(() => {
    let live = true;
    setPcReady(null); setPcTargets([]); setPcMenu(null);
    if (!selectedPc) { setPcSheet(null); setPcAttacks([]); return; }
    void game.sheets.load(selectedPc).then((r) => {
      if (!live || !r.ok) return;
      const details = game.view.tokens.find((t) => t.id === selectedPc)?.details;
      setPcSheet(withSrdSpells(r.sheet.sheet));
      setPcAttacks(details ? combatAttacks(r.sheet.sheet, { inventory: details.inventory, equipment: details.equipment, armorWornAt: details.armorWornAt }, game.view.itemRules) : r.sheet.sheet.attacks);
    });
    return () => { live = false; };
  }, [selectedPc, game.sheets.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPcTargets([]), [pcReady]);
  const sheets = game.sheets;
  const itemRules = game.view.itemRules;
  const tokensView = game.view.tokens;
  const loadAttacks = useCallback(async (tokenId: string) => {
    const r = await sheets.load(tokenId);
    const details = tokensView.find((t) => t.id === tokenId)?.details;
    if (!r.ok) return [];
    return details ? combatAttacks(r.sheet.sheet, { inventory: details.inventory, equipment: details.equipment, armorWornAt: details.armorWornAt }, itemRules) : r.sheet.sheet.attacks;
  }, [sheets, tokensView, itemRules]);
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
    if (!online || !active) return;
    loadScenes(search).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on entering Game, not on every keystroke
  }, [online?.campaignId, loadScenes, active]);
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
      .sceneFocus(shown, view)
      .then((s) => {
        if (snapshotRequest.current === request) setSnapshot(s);
      })
      .catch((e) => {
        if (snapshotRequest.current !== request) return;
        setSnapshot(null);
        setMapError(e instanceof ApiError && e.status === 404 ? 'This scene is not published (or was archived). Publish it in Scenes first.' : String(e));
      });
  }, [online?.campaignId, online?.version, shown, view]);
  useEffect(() => {
    setView('all');
    setSelected(null);
    setBattleMode(null);
    setPlaceMode(false);
    setPlacementToken('');
    setConfirmSwitch(false);
    setEnemyMode(null);
    setSelectedEnemy(null);
  }, [shown]);

  // APEX 1.2: the figure whose turn it is is selected automatically, its sight is shown and the camera follows it
  const liveEnc = game.gmState?.sceneEncounters?.[state.selected]?.status === 'active' ? game.gmState.sceneEncounters[state.selected] : null;
  const liveTurnKey = liveEnc ? `${liveEnc.id}:${liveEnc.turnSerial ?? 0}` : '';
  useEffect(() => {
    if (!liveEnc) return;
    const first = activeActors(liveEnc)[0];
    const p = liveEnc.participants.find((x) => x.id === first);
    if (!p) return;
    setBattleMode(null);
    setAreaMode(null);
    setNpcAttack(0);
    if (p.tokenId) { setSelected({ kind: 'pc', id: p.tokenId }); setView('party'); }
    else { const id = p.id.replace(/^npc-/, ''); setSelected({ kind: 'npc', id }); setView(id); }
  }, [liveTurnKey, state.selected]); // eslint-disable-line react-hooks/exhaustive-deps
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

  function enemyClick(x: number, y: number) {
    if (enemyMode === 'place') sceneTurn({ action: 'enemyAdd', templateId: enemyTemplate, x, y, side: enemySide });
    else if (enemyMode === 'move' && selectedEnemy) { sceneTurn({ action: 'enemyMove', id: selectedEnemy, x, y }); setEnemyMode(null); }
  }

  function placeToken(x: number, y: number) {
    if (placementToken && placeMode) moveCharacter(placementToken, x, y, 'place');
  }

  /** GM moves a character: 'place' sets it down anywhere (no cost), 'move' follows the movement rules. */
  function moveCharacter(tokenId: string, x: number, y: number, how: 'place' | 'move') {
    const scene = shownScene;
    if (!scene) return;
    void guarded(async () => {
      const position = snapshot?.motion?.tokens.find((t) => t.tokenId === tokenId);
      const assignment = shownPlayers.find((p) => p.tokenIds.includes(tokenId));
      const interval = scene.category === 'battle' ? 'round' : 'hour';
      const r = await api.sceneMove({
        action: how,
        requestId: crypto.randomUUID(),
        sceneId: scene.id,
        sceneRevision: scene.revision,
        tokenId,
        tokenVersion: position?.version ?? 0,
        assignmentRevision: assignment?.revision ?? 0,
        epoch: interval === 'round' ? (snapshot?.motion?.round ?? 0) : (snapshot?.motion?.hour ?? 0),
        x,
        y,
      });
      setSnapshot(await api.sceneFocus(scene.id, viewRef.current));
      setNotice(r.message ?? (how === 'place' ? 'Token position saved to this scene.' : 'Moved.'));
      game.online?.refresh();
    });
  }

  /** Like sceneTurn, but resolves to whether it worked (and the server message). */
  async function sceneTurnP(input: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    const scene = shownScene;
    if (!scene) return { ok: false };
    let out: { ok: boolean; message?: string } = { ok: false };
    await guarded(async () => {
      const r = await api.sceneTurn({ sceneId: scene.id, ...input });
      out = { ok: true, message: r.message };
      setNotice(r.message ?? 'Done.');
      game.online?.refresh();
      setSnapshot(await api.sceneFocus(scene.id, viewRef.current));
    });
    return out;
  }
  /** GM moves a character by the rules; resolves true when it arrived (not paused by an opportunity attack). */
  async function moveCharacterP(tokenId: string, x: number, y: number): Promise<boolean> {
    const scene = shownScene;
    if (!scene) return false;
    let arrived = false;
    await guarded(async () => {
      const position = snapshot?.motion?.tokens.find((t) => t.tokenId === tokenId);
      const assignment = shownPlayers.find((p) => p.tokenIds.includes(tokenId));
      const r = (await api.sceneMove({ action: 'move', requestId: crypto.randomUUID(), sceneId: scene.id, sceneRevision: scene.revision, tokenId, tokenVersion: position?.version ?? 0, assignmentRevision: assignment?.revision ?? 0, epoch: snapshot?.motion?.round ?? 0, x, y })) as { message?: string; paused?: boolean };
      arrived = !r.paused;
      setSnapshot(await api.sceneFocus(scene.id, viewRef.current));
      setNotice(r.message ?? 'Moved.');
      game.online?.refresh();
    });
    return arrived;
  }

  /** Scene time & initiative (scene-local; the Arena clock is never touched). */
  function sceneTurn(input: Record<string, unknown>) {
    const scene = shownScene;
    if (!scene) return;
    void guarded(async () => {
      const r = await api.sceneTurn({ sceneId: scene.id, ...input });
      setNotice(r.message ?? 'Done.');
      game.online?.refresh();
      setSnapshot(await api.sceneFocus(scene.id, viewRef.current));
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
  const entries: Array<{ id: string; name: string; meta: string; thumb?: string | null; hex?: SceneSummary['hex']; palette?: SceneSummary['palette'] }> = [
    { id: ARENA_ID, name: 'Arena', meta: 'Arena · hex campaign map', thumb: null },
    ...published.map((s) => ({ id: s.id, name: s.name, meta: CATEGORY_LABEL[s.category], thumb: s.thumbnail_asset_id, hex: s.hex, palette: s.palette })),
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
                  ) : entry.hex ? (
                    <HexThumbnail hex={entry.hex} palette={entry.palette} label={entry.name} width={72} height={48} />
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

  const clock = snapshot?.clock;
  const encounter = shownScene && game.gmState?.sceneEncounters?.[shownScene.id]?.status === 'active' ? game.gmState.sceneEncounters[shownScene.id] : null;
  const enemies = shownScene ? (game.gmState?.sceneEnemies?.[shownScene.id] ?? []) : [];
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
          {clock && shownScene.category === 'region' && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="scene-time">
              <span className="text-marble-300">
                Day {clock.day} · {clock.phase === 'night' ? '🌙 Night' : '☀ Day'} · travel 24 mi (8 hexes) per day at speed 30
              </span>
              {clock.phase === 'day' ? (
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => sceneTurn({ action: 'clock', expectedVersion: clock.version, phase: 'night' })}>
                  Begin night
                </button>
              ) : (
                <button className="btn btn-gold" type="button" disabled={busy} onClick={() => sceneTurn({ action: 'clock', expectedVersion: clock.version, nextDay: true })}>
                  Begin day {clock.day + 1}
                </button>
              )}
            </div>
          )}
          {clock && shownScene.category === 'battle' && (
            <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Battle lighting" data-testid="scene-lighting">
              <span className="text-marble-300">Light:</span>
              {(['bright', 'dim', 'dark'] as const).map((l) => (
                <button key={l} type="button" className="btn btn-ghost" aria-pressed={clock.lighting === l} disabled={busy || clock.lighting === l} onClick={() => sceneTurn({ action: 'clock', expectedVersion: clock.version, lighting: l })}>
                  {l === 'bright' ? '☀ Bright' : l === 'dim' ? '◐ Dim' : '🌑 Dark'}
                </button>
              ))}
            </div>
          )}
          {shownScene.category === 'battle' && shownScene.map.hex && (
            <section className="space-y-1 text-xs" aria-label="Enemies" data-testid="gm-enemies">
              <h3 className="font-bold text-marble-300">Enemies & allies · {enemies.filter((e) => !e.defeated && e.side !== 'ally').length} enemies, {enemies.filter((e) => !e.defeated && e.side === 'ally').length} allies</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Enemy type" className="rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs" value={enemyTemplate} onChange={(e) => setEnemyTemplate(e.target.value)}>
                  {bestiary(game.gmState ?? {}).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.elite ? '🐉 ' : ''}{displayName(t)} · CR {t.cr} · AC {t.ac} · HP {t.hp}
                    </option>
                  ))}
                </select>
                <select aria-label="Side" className="rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs" value={enemySide} onChange={(e) => setEnemySide(e.target.value as 'enemy' | 'ally')}>
                  <option value="enemy">as enemy</option>
                  <option value="ally">as ally (fights with the party)</option>
                </select>
                <button type="button" className="btn btn-ghost" aria-pressed={enemyMode === 'place'} disabled={busy} onClick={() => setEnemyMode((m) => (m === 'place' ? null : 'place'))}>
                  {enemyMode === 'place' ? 'Done placing' : 'Place on map'}
                </button>
              </div>
              {enemyMode && <p className="text-gold-200">{enemyMode === 'place' ? 'Click free hexes to place enemies.' : 'Click the destination hex.'}</p>}
              <ul className="space-y-1">
                {enemies.map((e) => (
                  <li key={e.id} className={`rounded border px-1.5 py-1 ${selectedEnemy === e.id ? 'border-gold-500' : 'border-ink-700'} ${e.defeated ? 'opacity-50' : ''}`}>
                    <button type="button" className="font-semibold text-marble-100" onClick={() => (setSelectedEnemy(e.id), setSelected({ kind: 'npc', id: e.id }))}>
                      {e.side === 'ally' ? '🛡 ' : ''}{e.name}
                    </button>{' '}
                    <span className="text-marble-400">
                      AC {e.ac} · HP {e.hp}/{e.maxHp}
                      {e.defeated ? ' · defeated' : ''} · {npcAttacks(e).map((a) => `${a.name} +${a.bonus}`).join(', ')}
                    </span>
                    {selectedEnemy === e.id && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {[-10, -5, -1, 1, 5].map((d) => (
                          <button key={d} type="button" className="btn btn-ghost px-1.5 py-0.5" disabled={busy} onClick={() => sceneTurn({ action: 'enemyHp', id: e.id, delta: d })}>
                            {d > 0 ? `+${d}` : d}
                          </button>
                        ))}
                        <button type="button" className="btn btn-ghost px-1.5 py-0.5" disabled={busy || e.defeated} onClick={() => setEnemyMode('move')}>
                          Move
                        </button>
                        <select aria-label={`${e.name} attacks`} className="rounded border border-ink-600 bg-ink-900 px-1 py-0.5" value={enemyTarget} onChange={(ev) => setEnemyTarget(ev.target.value)}>
                          <option value="">Target…</option>
                          {markers.map((m) => (
                            <option key={m.tokenId} value={m.tokenId}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <button type="button" className="btn btn-gold px-1.5 py-0.5" disabled={busy || !enemyTarget || e.defeated} onClick={() => sceneTurn({ action: 'enemyAttack', id: e.id, tokenId: enemyTarget })}>
                          Attack
                        </button>
                        <button type="button" className="btn btn-ghost px-1.5 py-0.5" disabled={busy} onClick={() => (sceneTurn({ action: 'enemyRemove', id: e.id }), setSelectedEnemy(null))}>
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!snapshot?.combatLog?.length && (
            <details className="combat-log" open>
              <summary>Combat log</summary>
              <ol>{snapshot.combatLog.slice().reverse().map((l) => <li key={l.id}>{l.text}</li>)}</ol>
            </details>
          )}
          {shownScene.category === 'battle' && (
            <section className="space-y-1 text-xs" aria-label="Initiative" data-testid="gm-initiative">
              <h3 className="font-bold text-marble-300">Initiative{encounter ? ` · round ${encounter.round}` : ' · off (free movement)'}</h3>
              {encounter ? (
                <>
                  <p className="text-marble-400">The order is shown as portraits above the map – click one to select that creature. Active: <b className="text-gold-200">{activeActors(encounter).map((id) => encounter.participants.find((p) => p.id === id)?.name).join(' & ')}</b></p>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-gold" type="button" disabled={busy} onClick={() => sceneTurn({ action: 'endTurn', encounterId: encounter.id, turnSerial: encounter.turnSerial ?? 0 })}>
                      Next turn
                    </button>
                    <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => sceneTurn({ action: 'endInitiative' })}>
                      End initiative
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn btn-gold" type="button" disabled={busy || !markers.length} onClick={() => sceneTurn({ action: 'startInitiative' })}>
                  Start initiative (roll for everyone here)
                </button>
              )}
            </section>
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

  const gmEncounter = shownScene && game.gmState?.sceneEncounters?.[shownScene.id]?.status === 'active' ? game.gmState.sceneEncounters[shownScene.id] : null;
  const gmEnemies = shownScene ? (game.gmState?.sceneEnemies?.[shownScene.id] ?? []) : [];
  const refOf = (id: string): FigureRef | null => {
    const f = (snapshot?.figures ?? []).find((x) => (x.kind === 'pc' ? x.tokenId === id : x.id === id));
    return f ? (f.kind === 'pc' ? { kind: 'pc', id: f.tokenId! } : { kind: 'npc', id: f.id }) : markers.some((m) => m.tokenId === id) ? { kind: 'pc', id } : null;
  };
  function figureClick(id: string) {
    const ref = refOf(id);
    if (!ref) return;
    if (battleMode === 'attack' && selected && refKey(ref) !== refKey(selected)) {
      setBattleMode(null);
      sceneTurn({ action: 'strike', attacker: toSide(selected), target: toSide(ref), ...(selected.kind === 'pc' ? { attackIndex: pcAttack } : {}) });
      return;
    }
    setSelected(ref);
    setBattleMode(null);
    if (ref.kind === 'npc') setSelectedEnemy(ref.id);
  }
  function battleMove(x: number, y: number) {
    if (!selected) return;
    setBattleMode(null);
    if (selected.kind === 'npc') sceneTurn({ action: 'enemyMove', id: selected.id, x, y });
    else moveCharacter(selected.id, x, y, 'move');
  }

  const turnKey = gmEncounter ? `${gmEncounter.id}:${gmEncounter.turnSerial ?? 0}` : '';
  const battle = (() => {
    const none = { reach: null as number | null, interaction: {} as SceneInteraction };
    const map = shownScene?.map;
    if (!snapshot || !map?.hex || shownScene?.category !== 'battle' || !selected) return none;
    const fig = (snapshot.figures ?? []).find((f) => (selected.kind === 'pc' ? f.kind === 'pc' && f.tokenId === selected.id : f.kind === 'enemy' && f.id === selected.id));
    if (!fig) return none;
    const actor = refKey(selected);
    const active = !gmEncounter || isActiveActor(gmEncounter, actor);
    if (selected.kind === 'pc') {
      // the GM acts for the character exactly like its player (reach, ready bar, right-click rules)
      const mv = snapshot.pcMovement?.[selected.id];
      const free = !gmEncounter;
      const left = mv ? Math.max(0, mv.allowance - mv.spent) : null;
      const interaction = pcInteraction({
        snapshot, tokenId: selected.id, name: fig.name, sheet: pcSheet, attacks: pcAttacks, acting: active, canMove: !!mv?.canMove && (free || (left ?? 0) > 0), remaining: free ? null : left,
        ready: pcReady, setReady: setPcReady, setSpellTargets: setPcTargets,
        act: async (input) => (await sceneTurnP(input)).ok, move: (x, y) => moveCharacterP(selected.id, x, y),
        openTargetMenu: (id) => setPcMenu(id), notify: setNotice,
        focusKey: gmEncounter && active ? `${turnKey}:${actor}` : null,
      });
      return { reach: active && !free && left !== null ? left : null, interaction };
    }
    const npc = selected.kind === 'npc' ? gmEnemies.find((e) => e.id === selected.id) : undefined;
    const b = budgetOf(gmEncounter, actor);
    const left = npc && gmEncounter ? Math.max(0, npc.speedFt * (b.dash ? 2 : 1) - (b.moved ?? 0)) : null;
    const attack = npc ? npcAttacks(npc)[npcAttack] : undefined;
    const range = attack ? (attack.kind === 'melee' ? attack.reachFt : attack.rangeFt ?? attack.reachFt) : null;
    const area = npc && areaMode !== null ? npc.areas?.[areaMode] : undefined;
    const interaction: SceneInteraction = {
      reachFrom: fig,
      pathFrom: active && !area ? fig : null,
      pathBudget: left,
      lineFrom: active && !area && range && range > 10 ? fig : null,
      lineRangeFt: range,
      areaAt: active && area ? (pt) => areaHexes(map, fig, pt, { shape: area.shape, sizeFt: area.sizeFt }) : null,
      focus: gmEncounter && active ? { key: `${turnKey}:${actor}`, x: fig.x, y: fig.y } : null,
      onHexContext: (_k, p) => {
        if (!active) return setNotice(`It is not ${fig.name}'s turn – only the creature whose turn it is acts.`);
        if (area && npc && areaMode !== null) { setAreaMode(null); return sceneTurn({ action: 'npcArea', id: npc.id, area: areaMode, point: p }); }
        battleMove(p.x, p.y);
      },
      onTokenContext: (id) => {
        const ref = refOf(id);
        if (!ref || refKey(ref) === actor) return;
        if (!active) return setNotice(`It is not ${fig.name}'s turn.`);
        const strike = () => sceneTurn({ action: 'strike', attacker: toSide(selected), target: toSide(ref), attackIndex: npcAttack, ...(gmAdv ? { adv: gmAdv } : {}) });
        const tf = (snapshot.figures ?? []).find((f) => (ref.kind === 'pc' ? f.tokenId === ref.id : f.id === ref.id));
        if (!tf || !attack) return strike();
        // out of melee reach: walk into reach first (within the movement left), then attack
        const dist = distance(hexAt(map, fig), hexAt(map, tf)) * 5;
        if (attack.kind !== 'melee' || dist <= attack.reachFt) return strike();
        const occupied = new Set((snapshot.figures ?? []).filter((f) => f !== fig && f.condition !== 'down').map((f) => hexKey(hexAt(map, f))));
        const spot = approachHex(map, fig, tf, attack.reachFt, occupied, left);
        if (!spot) return setNotice(`${tf.name} cannot be reached with ${fig.name}'s movement left.`);
        void sceneTurnP({ action: 'enemyMove', id: npc!.id, x: spot.x, y: spot.y }).then((r) => { if (r.ok && !/ stops /.test(r.message ?? '')) strike(); });
      },
    };
    return { reach: active && left !== null ? left : null, interaction };
  })();

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
          <>
            {gmEncounter && <InitiativeBar encounter={gmEncounter} tokens={game.view.tokens} myTokenId={null} onSelect={(p: { id: string; tokenId?: string }) => setSelected(p.tokenId ? { kind: 'pc', id: p.tokenId } : { kind: 'npc', id: p.id.replace(/^npc-/, '') })} elites={new Set(gmEnemies.filter((e) => e.elite).map((e) => `npc-${e.id}`))} />}
            {shownScene.category === 'battle' && shownScene.map.hex && (
              <BattleCommand snapshot={snapshot} encounter={gmEncounter} enemies={gmEnemies} view={view} setView={setView} selected={selected} setSelected={(r) => (setSelected(r), setAreaMode(null), setNpcAttack(0))} mode={battleMode} setMode={setBattleMode} busy={busy} act={sceneTurn} loadAttacks={loadAttacks} pcAttack={pcAttack} setPcAttack={setPcAttack} npcAttack={npcAttack} setNpcAttack={setNpcAttack} areaMode={areaMode} setAreaMode={setAreaMode} adv={gmAdv} setAdv={setGmAdv} />
            )}
            {shownScene.category === 'battle' && selected?.kind === 'pc' && (() => {
              const fig = (snapshot.figures ?? []).find((f) => f.kind === 'pc' && f.tokenId === selected.id);
              const mv = snapshot.pcMovement?.[selected.id];
              const pcSnapshot = { ...snapshot, reactions: [], self: { [selected.id]: { effects: fig?.effects ?? [], concentration: fig?.concentration } } };
              return (
                <div data-testid="gm-pc-panel">
                  <p className="px-1 text-[11px] text-marble-400">Acting for <b className="text-gold-200">{fig?.name ?? 'character'}</b> – same panel as the player; right-click on the map like the player.</p>
                  <PlayerCombat snapshot={pcSnapshot} encounter={gmEncounter} tokenId={selected.id} sheet={pcSheet} attacks={pcAttacks} myTurn={!!gmEncounter && isActiveActor(gmEncounter, `pc-${selected.id}`)} free={!gmEncounter} pending={busy} act={(input) => void sceneTurnP(input)} target={pcMenu} setTarget={setPcMenu} ready={pcReady} setReady={setPcReady} spellTargets={pcTargets} setSpellTargets={setPcTargets} movement={mv && mv.mode === 'turn' ? { allowance: mv.allowance, spent: mv.spent, dashed: mv.dashed } : null} />
                </div>
              );
            })()}
            <SceneSurface
              snapshot={snapshot}
              tokenLabels={markers}
              tokenViews={game.view.tokens}
              gm
              selectedId={selected?.id ?? null}
              onDestination={enemyMode ? enemyClick : placeMode ? placeToken : battleMode === 'move' && selected ? battleMove : undefined}
              onFigureClick={figureClick}
              targets={battleMode === 'attack' ? (snapshot.figures ?? []).map((f) => (f.kind === 'pc' ? f.tokenId! : f.id)).filter((id) => id !== selected?.id) : selectedEnemy ? [selectedEnemy] : undefined}
              reachBudget={battle.reach}
              interaction={battle.interaction}
            />
          </>
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

  return { enabled: true, arenaShown: shown === ARENA_ID, zoomable: shown !== ARENA_ID && !shownScene?.map.hex, widgets: [scenesWidget, playersWidget, toolsWidget], renderMap };
}
