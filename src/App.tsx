import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityLog } from './components/ActivityLog';
import { GmPanel } from './components/GmPanel';
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

type View = 'map' | 'character' | 'inventory';

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
    if (game.busy) return;
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

  const tabs: Array<{ id: View; label: string }> = [
    { id: 'map', label: '🗺 Map' },
    { id: 'character', label: isGm ? '📜 Character sheets' : '📜 Character' },
    { id: 'inventory', label: '🎒 Inventory' },
  ];

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      {game.demo && (
        <div role="note" className="bg-arcane-500/25 px-4 py-1 text-center text-[12px] font-medium text-arcane-300">
          DEMO MODE – this game is stored only in this browser and is NOT shared with other players.
        </div>
      )}
      {game.online?.connection === 'offline' && (
        <div role="alert" className="bg-blood-600/85 px-4 py-1.5 text-center text-[12px] font-medium text-white">
          Connection to the APEX server lost{game.online.syncError ? ` – ${game.online.syncError.replace(/\.$/, '')}` : ''}. Reconnecting automatically. Moves cannot be
          saved until the connection is back.
        </div>
      )}
      {game.online?.connection === 'degraded' && (
        <div role="status" className="bg-amber-500/20 px-4 py-1 text-center text-[12px] text-amber-200">
          Live updates are temporarily unavailable – APEX checks for changes every few seconds instead.
        </div>
      )}
      <Header
        game={game}
        notify={notify}
        onAdvancePhase={async () => {
          const next = view.phase === 'day' ? phaseName('night', view.day) : phaseName('day', view.day + 1);
          if ((await run({ type: 'advancePhase' })).ok) notify(`${next} begins.`, 'info');
        }}
      />
      <nav className="flex flex-wrap items-center gap-1 border-b border-gold-700/30 bg-ink-900/70 px-3 py-1.5" aria-label="Player navigation">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setScreen(t.id)}
            aria-current={screen === t.id ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              screen === t.id ? 'bg-gold-400/20 text-gold-200 shadow-[inset_0_0_0_1px_rgba(212,166,74,.6)]' : 'text-marble-300 hover:bg-ink-800 hover:text-marble-50'
            }`}
          >
            {t.label}
          </button>
        ))}
        {isGm && screen !== 'map' && (
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
          {!sheetToken ? (
            <p className="p-6 text-sm text-marble-500">No character available.</p>
          ) : screen === 'character' ? (
            <CharacterPanel key={sheetToken.id} game={game} token={sheetToken} isGm={isGm} run={run} notify={notify} />
          ) : (
            <InventoryPanel key={sheetToken.id} token={sheetToken} run={run} busy={game.busy} />
          )}
        </div>
      )}
      <main className={`min-h-0 flex-1 flex-col lg:flex-row ${screen === 'map' ? 'flex' : 'hidden'}`}>
        <div className="relative h-[65vh] min-h-[420px] flex-1 lg:h-auto">
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
          <ActivityLog log={view.log} isGm={isGm} />
          {!isGm && (
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-arcane-500/50 bg-ink-900/90 px-3 py-1 text-[11px] text-arcane-300">
              Playing as {view.tokens.find((t) => t.id === view.viewerId)?.name}
            </div>
          )}
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
        </div>

        <aside className="w-full space-y-3 overflow-y-auto border-gold-700/30 p-3 lg:w-[380px] lg:border-l xl:w-[400px]">
          <PartyPanel view={view} selectedTokenId={selectedTokenId} onSelect={selectAndFocus} />
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
          {isGm && state ? (
            <>
              <GmPanel
                state={state}
                run={run}
                onSelectToken={selectAndFocus}
                showPartyFog={showPartyFog}
                setShowPartyFog={setShowPartyFog}
                onRegenerate={async (radius, seed) => {
                  const res = await game.regenerate(radius, seed);
                  if (!res.ok) return notify(res.error ?? 'Could not generate the arena.');
                  setSelectedTokenId(null);
                  setSelectedHex(null);
                  notify(`New arena generated (radius ${radius}).`, 'info');
                }}
              />
              {game.online && <PlayersPanel state={state} online={game.online} notify={notify} />}
            </>
          ) : (
            <IntelPanel view={view} onFocus={(q, r) => mapRef.current?.focus(hexKey({ q, r }))} />
          )}
        </aside>
      </main>
    </div>
  );
}
