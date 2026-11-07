import { useEffect, useRef, useState } from 'react';
import type { GameApi } from '../state/gameApi';
import { CharacterPortrait } from './CharacterVisuals';
import { api, ApiError } from '../online/api';
import { SceneSurface } from './SceneSurface';
import { WorldTravel } from './WorldTravel';
import type { SanctuarySettings } from '../server/sanctuary';

export function PlayerScene({ game, open }: { game: GameApi; open: (screen: 'character' | 'inventory') => void }) {
  const scene = game.scene;
  const me = game.view.tokens.find(t => t.id === game.view.viewerId);
  const [background, setBackground] = useState(() => { try { return localStorage.getItem('apex.sanctuary.background') ?? 'campaign'; } catch { return 'campaign'; } });
  const [settings, setSettings] = useState<SanctuarySettings | null>(null), [sanctuaryImage, setSanctuaryImage] = useState<string | null>(null);
  useEffect(() => { let live = true; if (scene?.kind === 'sanctuary') api.sanctuary().then(s => { if (live) setSettings(s); }).catch(() => undefined); return () => { live = false; }; }, [scene?.kind]);
  const preset = ['hall','campfire','starlight'].includes(background);
  const personalAsset = settings?.backgrounds.some(b => b.assetId === background) ? background : null;
  const chosenAsset = preset ? null : personalAsset ?? settings?.defaultAsset;
  useEffect(() => { let live = true; setSanctuaryImage(null); if (chosenAsset && scene?.kind === 'sanctuary') api.mapImage(chosenAsset).then(r => { if (live) setSanctuaryImage(r.url); }).catch(() => undefined); return () => { live = false; }; }, [chosenAsset, scene?.kind]);
  const [moveMode, setMoveMode] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState<Record<string, unknown> | null>(null);
  const pendingRef = useRef(false);
  async function send(input: Record<string, unknown>) {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true); setMessage('');
    try { await api.sceneMove(input); setUncertain(null); setMessage('Movement saved.'); setMoveMode(false); game.online?.refresh(); }
    catch (e) { setMessage(String(e)); if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setUncertain(input); else { setUncertain(null); game.online?.refresh(); } }
    finally { pendingRef.current = false; setPending(false); }
  }
  function move(x: number, y: number) {
    if (!scene?.scene || !me || !moveMode || uncertain || pendingRef.current) return;
    const token = scene.motion?.tokens.find(t => t.tokenId === me.id);
    void send({ action: 'move', requestId: crypto.randomUUID(), tokenId: me.id, tokenVersion: token?.version ?? 0, sceneId: scene.scene.id, sceneRevision: scene.scene.revision, assignmentRevision: scene.assignmentRevision, epoch: scene.scene.category === 'battle' ? scene.motion?.round ?? 0 : scene.motion?.hour ?? 0, x, y });
  }
  if (!scene || scene.kind === 'arena') return null;
  if (scene.kind === 'sanctuary') return <section className={`sanctuary sanctuary-${preset ? background : settings?.atmosphere ?? 'hall'}`} aria-label="Character Sanctuary">
    {sanctuaryImage && <img className="sanctuary-art" src={sanctuaryImage} alt="" loading="lazy" />}
    <div className="sanctuary-glow" aria-hidden="true" />
    <div className="sanctuary-card"><p className="eyebrow">APEX · A moment between adventures</p><h1>Character Sanctuary</h1>
      {me && <CharacterPortrait tokenId={me.id} portraitV={me.portraitV} online color={me.color} accent={me.accent} initials={me.initials} name={me.name} size={148} zoomable />}
      <h2>{me?.name ?? 'Adventurer'}</h2><p>Your character is resting here until the Game Master assigns a scene.</p>
      <div className="journal-toolbar"><button className="btn btn-gold" onClick={() => open('character')}>Character sheet</button><button className="btn btn-ghost" onClick={() => open('inventory')}>Inventory & equipment</button></div>
      <p>Open Campaign Journal in your workspace to record your adventures.</p>
      <label>Sanctuary atmosphere <select aria-label="Sanctuary atmosphere" value={preset || personalAsset ? background : 'campaign'} onChange={e => { setBackground(e.target.value); try { localStorage.setItem('apex.sanctuary.background', e.target.value); } catch { /* personal preference can remain session-local */ } }}><option value="campaign">Campaign default</option><option value="hall">Stone hall</option><option value="campfire">Campfire</option><option value="starlight">Starlight</option>{settings?.backgrounds.map(b => <option key={b.assetId} value={b.assetId}>{b.name}</option>)}</select></label>
      <small>Scene transitions do not restore movement points or character resources.</small>
    </div>
  </section>;
  if (!scene.scene) return null;
  const { category } = scene.scene;
  const liveEncounter = game.view.sceneEncounter?.status === 'active' ? game.view.sceneEncounter : null;
  const liveTurn = liveEncounter && liveEncounter.turnIndex >= 0 ? liveEncounter.participants[liveEncounter.turnIndex] : null;
  const mv = scene.movement;
  const myTurn = !!liveTurn?.tokenId && liveTurn.tokenId === me?.id;
  const free = mv?.mode === 'free';
  const remaining = mv ? Math.max(0, mv.allowance - mv.spent) : 0;
  const canMove = !!mv?.canMove && (free || remaining > 0);
  async function endTurn() {
    if (!liveEncounter || !scene?.scene || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setMessage('');
    try { const r = await api.sceneTurn({ action: 'endTurn', sceneId: scene.scene.id, encounterId: liveEncounter.id, turnSerial: liveEncounter.turnSerial ?? 0 }); setMoveMode(false); setMessage(r.message ?? 'Turn ended.'); game.online?.refresh(); }
    catch (e) { setMessage(String(e)); game.online?.refresh(); }
    finally { pendingRef.current = false; setPending(false); }
  }
  const status = !mv ? '' : free ? 'Free movement – no initiative running.' : mv.mode === 'turn' ? (myTurn ? `Your turn · ${remaining.toFixed(0)} ft left` : mv.reason ?? 'Waiting for your turn.') : `${remaining.toFixed(1)} of ${mv.allowance.toFixed(1)} miles left today (day ${scene.clock?.day ?? 1}${scene.clock?.phase === 'night' ? ', night' : ''})`;
  return <div className="player-scene">
    {liveEncounter && <InitiativeBar encounter={liveEncounter} tokens={game.view.tokens} myTokenId={me?.id ?? null} />}
    {['battle', 'region'].includes(category) && <div className="journal-toolbar">
      <button className="btn btn-gold" disabled={pending || !!uncertain || !canMove} aria-pressed={moveMode} onClick={() => setMoveMode(!moveMode)}>{moveMode ? 'Cancel movement' : 'Move your character'}</button>
      {myTurn && <button className="btn btn-gold" disabled={pending} onClick={() => void endTurn()} data-testid="end-turn">End turn</button>}
      <span role="status" data-testid="movement-status">{status}</span>
    </div>}
    {moveMode && <p>Choose a destination on the map. The server checks your path, terrain, walls and {free ? 'nothing else – movement is free' : mv?.mode === 'turn' ? 'your speed this turn' : 'how far you can travel today'}.</p>}
    {message && <p role="status">{message}</p>}
    {uncertain && <button className="btn btn-ghost" disabled={pending} onClick={() => void send(uncertain)}>Verify or retry previous movement</button>}
    {!!game.view.sceneAnnouncements.length && <section className="mx-auto my-2 w-full max-w-4xl space-y-2" aria-label="Scene announcements">
      {game.view.sceneAnnouncements.map(item => <article key={item.id} className="rounded-lg border border-gold-700/60 bg-ink-950/90 p-3"><p className="eyebrow">Scene event</p><h2 className="font-display text-lg text-gold-200">{item.title}</h2><p className="whitespace-pre-wrap text-sm text-marble-200">{item.text}</p></article>)}
    </section>}
    <SceneSurface snapshot={scene} tokenId={me?.id} name={me?.name} color={me?.color} tokenViews={game.view.tokens} reachBudget={moveMode && !free ? remaining : null} onDestination={moveMode ? move : undefined} />
    {category === 'world' && scene.travel && <WorldTravel sceneId={scene.scene.id} sceneRevision={scene.scene.revision} assignmentRevision={scene.assignmentRevision} map={scene.scene.map} travel={scene.travel} onChanged={() => game.online?.refresh()} />}
    <p>The Game Master controls scene transitions{category === 'region' ? ', day and night' : category === 'battle' ? ' and initiative' : ''}.</p>
  </div>;
}

/** Turn order across the top of the map: portraits in initiative order, the active turn highlighted. */
function InitiativeBar({ encounter, tokens, myTokenId }: { encounter: NonNullable<GameApi['view']['sceneEncounter']>; tokens: GameApi['view']['tokens']; myTokenId: string | null }) {
  return <section className="initiative-bar" aria-label={`Initiative, round ${encounter.round}`} data-testid="initiative-bar">
    <span className="initiative-round">Round {encounter.round}</span>
    <ol>{encounter.participants.map((p, i) => {
      const t = p.tokenId ? tokens.find(x => x.id === p.tokenId) : undefined;
      return <li key={p.id} aria-current={encounter.turnIndex === i ? 'true' : undefined} className={p.tokenId && p.tokenId === myTokenId ? 'is-mine' : ''} title={`${p.name} · initiative ${p.initiative}`}>
        {t ? <CharacterPortrait tokenId={t.id} portraitV={t.portraitV} online color={t.color} accent={t.accent} initials={t.initials} name={t.name} size={40} /> : <span className="initiative-npc">{p.name.slice(0, 2)}</span>}
        <small>{p.name}</small><em>{p.initiative}</em>
      </li>;
    })}</ol>
  </section>;
}
