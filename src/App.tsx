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

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <Header
        game={game}
        notify={notify}
        onAdvancePhase={async () => {
          const next = view.phase === 'day' ? phaseName('night', view.day) : phaseName('day', view.day + 1);
          if ((await run({ type: 'advancePhase' })).ok) notify(`${next} begins.`, 'info');
        }}
      />
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
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
