import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chronicle } from './components/ActivityLog';
import { LegendContent } from './components/map/Legend';
import { ArenaTab, SitesList, TeamsTab } from './components/GmPanel';
import { CharacterSummary, PartyHealth } from './components/PartyWidgets';
import { EquipmentPanel } from './components/EquipmentPanel';
import { VitalsPanel } from './components/ResourceOrbs';
import { WidgetTabs } from './workspace/WidgetTabs';
import { Workspace, type WidgetDef } from './workspace/Workspace';
import { defaultLayout, layoutKey } from './workspace/layout';
import { AnnouncementsPanel, EventsPanel, GmEventModal } from './components/GmEvents';
import { AnnouncementHistory, AnnouncementOverlay } from './components/AnnouncementOverlay';
import { Header } from './components/Header';
import { IntelPanel } from './components/IntelPanel';
import { PartyPanel } from './components/PartyPanel';
import { SelectionPanel } from './components/SelectionPanel';
import { ArenaMap, type MapHandle } from './components/map/ArenaMap';
import type { Command } from './game/commands';
import { hexKey, type HexKey } from './game/hex';
import { explainReach, viewFullReach, viewReach } from './game/viewRules';
import { visibleFrom, type Fog } from './game/visibility';
import type { GameApi } from './state/gameApi';
import { phaseName } from './game/text';
import { PlayersPanel } from './components/PlayersPanel';
import { CharacterPanel } from './components/CharacterPanel';
import { InventoryPanel } from './components/InventoryPanel';
import { ArsenalPanel } from './components/ArsenalPanel';
import { LootRollDock } from './components/LootRolls';
import { MerchantShop } from './components/Merchant';
import { FeedbackInbox } from './components/Feedback';
import { WorldPanel } from './components/WorldPanel';
import { SceneDirector } from './components/SceneDirector';
import { CampaignMapDirector } from './components/CampaignMapDirector';
import { PlayerJournal } from './components/PlayerJournal';
import { PlayerScene } from './components/PlayerScene';

type View = 'map' | 'scenes' | 'character' | 'spells' | 'inventory' | 'journal' | 'merchant' | 'arsenal' | 'feedback';

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export default function App({ game }: { game: GameApi }) {
  const { view, gmState, dispatch } = game;
  const state = gmState;
  const isGm = view.role === 'gm' && !!gmState;

  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedHex, setSelectedHex] = useState<HexKey | null>(null);
  const [placeMode, setPlaceMode] = useState(false);
  const [showPartyFog, setShowPartyFog] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [screen, setScreen] = useState<View>('map');
  const [gmCharacter, setGmCharacter] = useState<string | null>(null);
  const mapRef = useRef<MapHandle>(null);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'error') => setToast({ id: Date.now(), text, kind }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);

  const run = useCallback(
    async (cmd: Command) => {
      const res = await dispatch(cmd);
      if (!res.ok) notify(res.error ?? 'The action failed.');
      return res;
    },
    [dispatch, notify],
  );

  // Clear the selection if the character no longer exists in the current view.
  const selectedToken = view.tokens.find((t) => t.id === selectedTokenId) ?? null;
  useEffect(() => {
    if (selectedTokenId && !selectedToken) setSelectedTokenId(null);
    if (!isGm) setPlaceMode(false);
  }, [selectedTokenId, selectedToken, isGm]);

  // A different world (reset / new world / restore): clear selections that referred to the old map.
  useEffect(() => {
    setSelectedHex(null);
    setPlaceMode(false);
  }, [view.worldId]);

  // When switching to a player perspective, select the own character.
  useEffect(() => {
    if (!isGm && view.viewerId) {
      setSelectedTokenId(view.viewerId);
      setSelectedHex(null);
    }
  }, [isGm, view.viewerId]);

  const canMove =
    !!selectedToken &&
    (isGm || (!!selectedToken.details && !!view.viewerId && (selectedToken.id === view.viewerId || selectedToken.details.controllers.includes(view.viewerId))));

  const reach = useMemo(() => (canMove && selectedToken && !placeMode ? viewReach(view, selectedToken) : null), [canMove, selectedToken, view, placeMode]);
  const fullReach = useMemo(() => (canMove && selectedToken ? viewFullReach(view, selectedToken) : null), [canMove, selectedToken, view]);
  const explain = useCallback(
    (key: HexKey) => (canMove && selectedToken && fullReach ? explainReach(view, selectedToken, key, fullReach) : null),
    [canMove, selectedToken, fullReach, view],
  );

  const onHexClick = async (key: HexKey) => {
    if (game.pending.includes('move') || game.pending.includes('world')) return;
    if (placeMode && selectedToken && isGm) {
      const [q, r] = key.split(',').map(Number);
      if ((await run({ type: 'place', tokenId: selectedToken.id, to: { q, r } })).ok) setPlaceMode(false);
      return;
    }
    if (canMove && selectedToken && key !== hexKey(selectedToken.pos)) {
      if (reach?.has(key)) {
        const [q, r] = key.split(',').map(Number);
        if ((await run({ type: 'move', tokenId: selectedToken.id, to: { q, r } })).ok) setSelectedHex(null);
        return;
      }
      const why = explain(key);
      setSelectedHex(key);
      if (why && !why.ok) notify(`${selectedToken.name} cannot go there: ${why.reason}.`, 'info');
      return;
    }
    setSelectedHex(key);
    if (!selectedToken) {
      const here = view.tokens.filter((t) => hexKey(t.pos) === key);
      const pick = here.find((t) => t.id === view.viewerId) ?? here[0];
      if (pick) setSelectedTokenId(pick.id);
    }
  };

  const onTokenClick = (id: string) => {
    const t = view.tokens.find((x) => x.id === id);
    if (!t) return;
    // Clicking a reachable hex that holds other characters moves the selected character there.
    if (canMove && selectedToken && id !== selectedToken.id && reach?.has(hexKey(t.pos)) && !placeMode) {
      void onHexClick(hexKey(t.pos));
      return;
    }
    if (placeMode) return void onHexClick(hexKey(t.pos));
    setSelectedTokenId(id === selectedTokenId ? null : id);
    setSelectedHex(null);
  };

  const selectAndFocus = (id: string) => {
    const t = view.tokens.find((x) => x.id === id);
    setSelectedTokenId(id);
    setSelectedHex(null);
    setPlaceMode(false);
    if (t) mapRef.current?.focus(hexKey(t.pos));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTokenId(null);
        setSelectedHex(null);
        setPlaceMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // GM overlay: what does the party see / know?
  const partyFog = useMemo(() => {
    if (!isGm || !showPartyFog || !state) return null;
    const vis = new Set<HexKey>();
    const known = new Set<HexKey>();
    for (const t of Object.values(state.tokens)) {
      if (t.kind !== 'player') continue;
      visibleFrom(state, t).forEach((k) => vis.add(k));
      Object.keys(state.knowledge[t.id]?.explored ?? {}).forEach((k) => known.add(k));
    }
    const out: Record<HexKey, Fog> = {};
    for (const k of Object.keys(state.hexes)) out[k] = vis.has(k) ? 'visible' : known.has(k) ? 'explored' : 'unexplored';
    return out;
  }, [isGm, showPartyFog, state]);

  const hiddenTeamIds = useMemo(
    () => new Set(isGm && state ? Object.values(state.teams).filter((t) => t.visibility === 'hidden').map((t) => t.id) : []),
    [isGm, state],
  );

  // Character & inventory: players see their own character, the GM picks any player character.
  const playerTokens = view.tokens.filter((t) => t.kind === 'player');
  const sheetTokenId = isGm ? (gmCharacter ?? (selectedToken?.kind === 'player' ? selectedToken.id : playerTokens[0]?.id) ?? null) : view.viewerId;
  const sheetToken = view.tokens.find((t) => t.id === sheetTokenId) ?? null;

  const announceScope = game.online ? `${game.online.campaignId}:${game.online.profileName}` : 'demo';
  const awaitingCount = state ? Object.values(state.events).filter((e) => e.status === 'awaiting').length : 0;
  const regenerate = useCallback(
    async (radius: number, seed: number) => {
      const res = await game.regenerate(radius, seed);
      if (!res.ok) return notify(res.error ?? 'Could not generate the arena.');
      setSelectedTokenId(null);
      setSelectedHex(null);
      notify(`New arena generated (radius ${radius}).`, 'info');
    },
    [game, notify],
  );
  const selectionPanel = (
    <SelectionPanel
      view={view}
      gmState={isGm ? state : null}
      selectedTokenId={selectedTokenId}
      selectedHex={selectedHex}
      placeMode={placeMode}
      setPlaceMode={setPlaceMode}
      run={run}
      onSelectToken={selectAndFocus}
      onClear={() => {
        setSelectedTokenId(null);
        setSelectedHex(null);
        setPlaceMode(false);
      }}
    />
  );
  const advancePhase = useCallback(async () => {
    const next = view.phase === 'day' ? phaseName('night', view.day) : phaseName('day', view.day + 1);
    if ((await run({ type: 'advancePhase' })).ok) notify(`${next} begins.`, 'info');
  }, [run, notify, view.phase, view.day]);

  // Workspace widgets (APEX 0.5). The set is decided by the SERVER-provided role and data: a player's client
  // never builds GM widget definitions (and never receives GM data), so a stored layout cannot unlock them.
  // Widgets render lazily (only while expanded); stable ids keep open widgets mounted.
  // APEX 0.7 consolidation: related panels share one widget (tabs inside); pages that have a navigation tab
  // (Character, Inventory, Arsenal, Feedback, Merchant) are not duplicated as widgets.
  const widgets: WidgetDef[] = [];
  if (isGm && state) {
    const partyFocus = selectedToken?.kind === 'player' ? selectedToken : (playerTokens[0] ?? null);
    widgets.push(
      { id: 'gm-control', title: 'Arena & Rules', icon: '⚜', render: () => <ArenaTab state={state} run={run} showPartyFog={showPartyFog} setShowPartyFog={setShowPartyFog} onRegenerate={regenerate} worldManaged={!!game.online} /> },
      {
        id: 'party',
        title: 'Party',
        icon: '♥',
        render: () => (
          <WidgetTabs
            id="gm-party"
            tabs={[
              { id: 'health', label: 'Health', render: () => <PartyHealth game={game} view={view} onSelect={selectAndFocus} selectedTokenId={selectedTokenId} /> },
              { id: 'character', label: partyFocus ? partyFocus.name : 'Character', render: () => <CharacterSummary game={game} token={partyFocus} /> },
            ]}
          />
        ),
      },
      { id: 'selection', title: 'Selection', icon: '◎', render: () => selectionPanel },
      {
        id: 'events',
        title: 'Events & Announcements',
        icon: '⚡',
        badge: awaitingCount,
        render: () => (
          <WidgetTabs
            id="gm-events"
            tabs={[
              { id: 'events', label: 'Events', badge: awaitingCount, render: () => <EventsPanel state={state} run={run} selectedHex={selectedHex} /> },
              { id: 'announce', label: 'Announce', render: () => <AnnouncementsPanel state={state} run={run} /> },
            ]}
          />
        ),
      },
      {
        id: 'rivals',
        title: 'Rivals & Sites',
        icon: '⚔',
        render: () => (
          <WidgetTabs
            id="gm-rivals"
            tabs={[
              { id: 'teams', label: 'Rival teams', render: () => <TeamsTab state={state} run={run} onSelectToken={selectAndFocus} /> },
              { id: 'sites', label: 'Sites', render: () => <SitesList state={state} run={run} /> },
            ]}
          />
        ),
      },
    );
    if (game.online) {
      const online = game.online;
      widgets.push({
        id: 'campaign',
        title: 'Campaign',
        icon: '🌍',
        render: () => (
          <WidgetTabs
            id="gm-campaign"
            tabs={[
              { id: 'world', label: 'Worlds', render: () => <WorldPanel state={state} online={online} notify={notify} pending={game.pending.includes('world')} /> },
              { id: 'scenes', label: 'Scenes', render: () => <SceneQuickAccess open={() => setScreen('scenes')} /> },
              { id: 'players', label: 'Players & access', render: () => <PlayersPanel state={state} online={online} notify={notify} /> },
            ]}
          />
        ),
      });
    }
  } else {
    const me = view.tokens.find((t) => t.id === view.viewerId) ?? null;
    widgets.push(
      {
        id: 'me',
        title: 'My Character',
        icon: '📜',
        render: () =>
          me ? (
            <div className="space-y-3">
              <VitalsPanel game={game} token={me} canEdit />
              <CharacterSummary game={game} token={me} />
            </div>
          ) : null,
      },
      {
        id: 'party',
        title: 'Party & Intel',
        icon: '⚑',
        render: () => (
          <WidgetTabs
            id="party"
            tabs={[
              { id: 'party', label: 'Party', render: () => <PartyPanel view={view} selectedTokenId={selectedTokenId} onSelect={selectAndFocus} online={game.mode === 'online'} /> },
              { id: 'intel', label: 'Intelligence', render: () => <IntelPanel view={view} onFocus={(q, r) => mapRef.current?.focus(hexKey({ q, r }))} /> },
            ]}
          />
        ),
      },
      { id: 'selection', title: 'Selection', icon: '◎', render: () => selectionPanel },
    );
  }
  widgets.push(
    {
      id: 'chronicle',
      title: 'Arena Chronicle',
      icon: '📜',
      render: () => (
        <WidgetTabs
          id="chronicle"
          tabs={[
            { id: 'log', label: 'Chronicle', render: () => <Chronicle log={view.log} isGm={isGm} /> },
            { id: 'announcements', label: 'Announcements', render: () => <AnnouncementHistory announcements={view.announcements} open /> },
          ]}
        />
      ),
    },
    { id: 'legend', title: 'Legend', icon: '🗺', render: () => <LegendContent /> },
  );
  const role = isGm ? 'gm' : 'player';
  const defaults = useMemo(
    () =>
      role === 'gm'
        ? defaultLayout({ right: ['gm-control', 'party', 'selection', 'events', 'rivals', 'campaign', 'legend'], bottom: ['chronicle'] }, ['rivals', 'campaign'], ['legend'])
        : defaultLayout({ right: ['me', 'party', 'selection', 'journal', 'legend'], bottom: ['chronicle'] }, ['journal'], ['legend']),
    [role],
  );

  const myToken = view.tokens.find((t) => t.id === view.viewerId) ?? null;
  const tabs: Array<{ id: View; label: string }> = [
    { id: 'map', label: '🗺 Map' },
    ...(isGm && game.online ? [{ id: 'scenes' as View, label: '🧭 Scenes' }] : []),
    { id: 'character', label: isGm ? '📜 Character sheets' : '📜 Character' },
    { id: 'spells', label: '✨ Spells' },
    ...(game.online ? [{ id: 'journal' as View, label: '📖 Journal' }] : []),
    { id: 'inventory', label: '🎒 Inventory' },
    ...(!isGm && view.merchant ? [{ id: 'merchant' as View, label: '🏛 Merchant' }] : []),
    ...(isGm && state ? [{ id: 'arsenal' as View, label: '⚔ Arsenal' }] : []),
    ...(isGm && game.online ? [{ id: 'feedback' as View, label: '📮 Feedback' }] : []),
  ];

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      {game.demo && (
        <div role="note" className="bg-arcane-500/25 px-4 py-1 text-center text-[12px] font-medium text-arcane-300">
          DEMO MODE – this game is stored only in this browser and is NOT shared with other players.
        </div>
      )}
      {game.online?.worldNotice && (
        <div role="alert" className="flex items-center justify-center gap-3 bg-gold-400/20 px-4 py-1.5 text-center text-[12px] font-medium text-gold-100">
          {game.online.worldNotice}
          <button className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={game.online.clearWorldNotice}>
            OK
          </button>
        </div>
      )}
      {game.online?.connection === 'unavailable' && (
        <div role="alert" className="bg-blood-600/85 px-4 py-1.5 text-center text-[12px] font-medium text-white">
          The APEX server is not answering{game.online.syncError ? ` – ${game.online.syncError.replace(/\.$/, '')}` : ''}. APEX retries with growing pauses. Actions
          cannot be saved until the server is back.
        </div>
      )}
      {game.online?.connection === 'unknown' && (
        <div role="alert" className="bg-amber-500/25 px-4 py-1.5 text-center text-[12px] font-medium text-amber-100">
          Checking whether “{game.online.unknownAction}” was saved – please do not repeat it. New actions are paused until the server confirms.
        </div>
      )}
      {game.online && !game.online.realtimeLive && game.online.connection === 'connected' && (
        <div role="status" className="bg-amber-500/20 px-4 py-1 text-center text-[12px] text-amber-200">
          Live updates are temporarily unavailable – APEX checks for changes every few seconds instead.
        </div>
      )}
      <AnnouncementOverlay announcements={view.announcements} scope={announceScope} serverTime={view.serverTime} />
      {!isGm && <LootRollDock rolls={view.lootRolls ?? []} viewerId={view.viewerId} serverTime={view.serverTime} run={run} />}
      {isGm && state && <GmEventModal state={state} run={run} />}
      <Header
        game={game}
        notify={notify}
        area={screen === 'map' ? 'Map' : screen === 'scenes' ? 'Scenes' : screen === 'character' ? 'Character' : screen === 'spells' ? 'Spells' : screen === 'inventory' ? 'Inventory' : screen === 'journal' ? 'Journal' : screen === 'arsenal' ? 'Arsenal' : 'Feedback'}
        onAdvancePhase={() => void advancePhase()}
      />
      <nav className="flex flex-wrap items-center gap-1 border-b border-gold-700/30 bg-ink-900/70 px-3 py-1.5" aria-label="Main navigation">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setScreen(t.id)}
            aria-current={screen === t.id ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              screen === t.id ? 'bg-gold-400/20 text-gold-200 shadow-[inset_0_0_0_1px_rgba(192,155,88,.6)]' : 'text-marble-300 hover:bg-ink-800 hover:text-marble-50'
            }`}
          >
            {t.label}
          </button>
        ))}
        {isGm && screen !== 'map' && screen !== 'arsenal' && screen !== 'feedback' && (
          <label className="ml-auto flex items-center gap-2 text-xs text-marble-300">
            Character
            <select
              aria-label="Character to inspect"
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-sm text-marble-50"
              value={sheetTokenId ?? ''}
              onChange={(e) => setGmCharacter(e.target.value)}
            >
              {playerTokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </nav>
      {screen !== 'map' && (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {toast && (
            <div
              key={toast.id}
              role="status"
              className={`fixed top-24 left-1/2 z-40 max-w-[90%] -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-2xl ${
                toast.kind === 'error' ? 'border-blood-400/60 bg-blood-600/90 text-white' : 'border-gold-400/50 bg-ink-900/95 text-gold-200'
              }`}
            >
              {toast.text}
            </div>
          )}
          {screen === 'journal' && game.online ? (
            <PlayerJournal sceneReference={game.scene?.scene ? { id: game.scene.scene.id, name: game.scene.scene.name } : undefined} />
          ) : screen === 'feedback' && isGm && game.online ? (
            <FeedbackInbox online={game.online} notify={notify} />
          ) : screen === 'scenes' && isGm && game.online ? (
            <SceneDirector version={game.online.version} campaignId={game.online.campaignId} />
          ) : screen === 'arsenal' && isGm && state ? (
            <ArsenalPanel state={state} run={run} />
          ) : screen === 'merchant' && !isGm && view.merchant && myToken ? (
            <MerchantShop merchant={view.merchant} me={myToken} run={run} busy={game.busy} />
          ) : screen === 'merchant' ? (
            <p className="p-6 text-sm text-marble-500">The merchant has closed shop.</p>
          ) : !sheetToken ? (
            <p className="p-6 text-sm text-marble-500">No character available.</p>
          ) : screen === 'character' || screen === 'spells' ? (
            <CharacterPanel key={sheetToken.id} game={game} token={sheetToken} isGm={isGm} run={run} notify={notify} initialTab={screen === 'spells' ? 'spells' : 'overview'} />
          ) : (
            // APEX 0.7 consolidation: one page for everything the character carries – worn equipment and inventory
            <div className="mx-auto grid max-w-7xl items-start gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_27rem]">
              <InventoryPanel key={sheetToken.id} token={sheetToken} run={run} busy={game.busy} rules={view.itemRules} isGm={isGm} game={game} />
              <section className="panel p-3 xl:sticky xl:top-2" aria-label="Equipment">
                <EquipmentPanel game={game} token={sheetToken} run={run} isGm={isGm} />
              </section>
            </div>
          )}
        </div>
      )}
      <div className={`min-h-0 flex-1 ${screen === 'map' ? 'flex' : 'hidden'}`}>
        <Workspace
          widgets={widgets}
          defaults={defaults}
          storageKey={layoutKey(announceScope, role)}
          center={
        <CampaignMapDirector game={game} enabled={isGm && !!game.online} openScenes={() => setScreen('scenes')}>
          {game.scene && game.scene.kind !== 'arena' ? <PlayerScene game={game} open={setScreen} /> :
        <>
          <ArenaMap
            mapRef={mapRef}
            view={view}
            selectedTokenId={selectedTokenId}
            selectedHex={selectedHex}
            reach={reach}
            fullReach={fullReach}
            explain={explain}
            placeMode={placeMode}
            overlayFog={partyFog}
            hiddenTeamIds={hiddenTeamIds}
            onHexClick={onHexClick}
            onTokenClick={onTokenClick}
          />
          {!isGm && (
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-arcane-500/50 bg-ink-900/90 px-3 py-1 text-[11px] text-arcane-300">
              Playing as {view.tokens.find((t) => t.id === view.viewerId)?.name}
            </div>
          )}
          {!isGm && <MovementPill token={view.tokens.find((t) => t.id === view.viewerId) ?? null} />}
          {toast && (
            <div
              key={toast.id}
              role="status"
              className={`absolute top-12 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-2xl ${
                toast.kind === 'error' ? 'border-blood-400/60 bg-blood-600/90 text-white' : 'border-gold-400/50 bg-ink-900/95 text-gold-200'
              }`}
            >
              {toast.text}
            </div>
          )}
        </>}
        </CampaignMapDirector>
          }
        />
      </div>
    </div>
  );
}

function SceneQuickAccess({ open }: { open: () => void }) {
  return <div className="space-y-2">
    <p className="text-xs text-marble-400">Browse, edit and privately preview campaign scenes in the full workspace.</p>
    <button className="btn btn-gold w-full" onClick={open}>Open Full View</button>
  </div>;
}

/** Players: compact daily-movement indicator at the bottom of the map (the gold reach area stays primary). */
function MovementPill({ token }: { token: import('./game/visibility').TokenView | null }) {
  const d = token?.details;
  if (!d) return null;
  const pct = d.maxMovePoints ? d.movePoints / d.maxMovePoints : 0;
  return (
    <div className="apex-move-pill" role="status" aria-label={`Movement: ${d.movePoints} of ${d.maxMovePoints} points left today`} data-testid="movement-pill">
      <span className="text-marble-500">Movement</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-700">
        <span className="block h-full rounded-full bg-gold-400 transition-[width] duration-500" style={{ width: `${pct * 100}%` }} />
      </span>
      <b className="tabular-nums text-gold-200">
        {d.movePoints}/{d.maxMovePoints}
      </b>
      {d.sneaking && (
        <span className="text-arcane-300" data-testid="sneak-indicator" title="Sneaking: each step costs double movement points">
          🥷 Sneaking
        </span>
      )}
      <span className="text-marble-500">MP{d.speedFt ? ` · ${d.speedFt} ft` : ''}</span>
    </div>
  );
}

