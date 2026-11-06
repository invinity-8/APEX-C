import { useEffect, useRef, useState } from 'react';
import type { GameApi } from '../state/gameApi';
import { CharacterPortrait } from './CharacterVisuals';
import { api, ApiError } from '../online/api';
import { SceneSurface } from './SceneSurface';
import { regionMilesPerHour } from '../campaign/maps';
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
  const ledger = scene.motion?.budgets[me?.id ?? ''];
  const speed = (me?.details?.speedFt ?? 30) / (me?.details?.sneaking ? 2 : 1);
  const remaining = category === 'battle' ? speed - (ledger?.tacticalSpent ?? 0) : regionMilesPerHour(speed) - (ledger?.regionSpent ?? 0);
  return <div className="player-scene">
    {['battle', 'region'].includes(category) && <div className="journal-toolbar"><button className="btn btn-gold" disabled={pending || !!uncertain} aria-pressed={moveMode} onClick={() => setMoveMode(!moveMode)}>{moveMode ? 'Cancel movement' : 'Move your character'}</button><span>{Math.max(0, remaining).toFixed(2)} {category === 'battle' ? 'feet this round' : 'miles this hour'} remaining</span></div>}
    {moveMode && <p>Choose a destination on the map. The server checks distance, terrain and walls.</p>}
    {message && <p role="status">{message}</p>}
    {uncertain && <button className="btn btn-ghost" disabled={pending} onClick={() => void send(uncertain)}>Verify or retry previous movement</button>}
    <SceneSurface snapshot={scene} tokenId={me?.id} name={me?.name} color={me?.color} onDestination={moveMode ? move : undefined} />
    {category === 'world' && scene.travel && <WorldTravel sceneId={scene.scene.id} sceneRevision={scene.scene.revision} assignmentRevision={scene.assignmentRevision} map={scene.scene.map} travel={scene.travel} onChanged={() => game.online?.refresh()} />}
    <p>The Game Master controls scene transitions and the next movement interval.</p>
  </div>;
}
