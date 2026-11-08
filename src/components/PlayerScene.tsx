import { combatAttacks } from '../game/effectiveStats';
import { PlayerCombat, type ReadyAction } from './PlayerCombat';
import type { SceneInteraction } from './SceneSurface';
import { pcInteraction } from './pcInteraction';
import { activeActors, blockOf, pcActor, withShillelagh, withSrdSpells } from '../game/sceneActions';
import type { CharacterSheet, SheetAttack } from '../game/sheet';
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
  const [attackIndex, setAttackIndex] = useState<number | null>(null);
  const [attacks, setAttacks] = useState<SheetAttack[]>([]);
  // Attacks: equipped weapons (derived from the inventory, same rule as the server) and the sheet's attacks.
  const myDetails = me?.details;
  const [mySheet, setMySheet] = useState<CharacterSheet | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadyAction>(null);
  // targets chosen with right-clicks for a multi-target spell (Bless, Scorching Ray …)
  const [spellTargets, setSpellTargets] = useState<Array<{ kind: 'pc'; tokenId: string; name: string } | { kind: 'npc'; id: string; name: string }>>([]);
  useEffect(() => setSpellTargets([]), [ready]);
  // the readied attack is the character's default attack (right-click an enemy) – remembered on this device
  useEffect(() => { if (!me?.id) return; try { const v = localStorage.getItem(`apex.defaultAttack.${me.id}`); if (v !== null) setReady({ kind: 'attack', index: Number(v) }); } catch { /* storage unavailable */ } }, [me?.id]);
  useEffect(() => { if (!me?.id || ready?.kind !== 'attack') return; try { localStorage.setItem(`apex.defaultAttack.${me.id}`, String(ready.index)); } catch { /* storage unavailable */ } }, [me?.id, ready]);
  useEffect(() => { let live = true; if (me?.id && scene?.scene?.category === 'battle') void game.sheets.load(me.id).then(r => { if (live && r.ok) { setMySheet(withSrdSpells(r.sheet.sheet)); setAttacks(myDetails ? combatAttacks(r.sheet.sheet, { inventory: myDetails.inventory, equipment: myDetails.equipment, armorWornAt: myDetails.armorWornAt }, game.view.itemRules) : r.sheet.sheet.attacks); } }); return () => { live = false; }; }, [me?.id, scene?.scene?.category, game.sheets.revision, myDetails, game.view.itemRules, me?.id ? scene?.vitals?.[me.id]?.form : undefined, me?.id ? scene?.vitals?.[me.id]?.hp : undefined]); // a Wild Shape or damage changes the attacks and slots
  const [uncertain, setUncertain] = useState<Record<string, unknown> | null>(null);
  const pendingRef = useRef(false);
  /** Sends a move; resolves true when the character arrived (not paused by an opportunity attack). */
  async function send(input: Record<string, unknown>): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true; setPending(true); setMessage('');
    try { const r = await api.sceneMove(input) as { message?: string; paused?: boolean }; setUncertain(null); setMessage(r.message ?? 'Movement saved.'); setMoveMode(false); game.online?.refresh(); return !r.paused; }
    catch (e) { setMessage(String(e)); if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setUncertain(input); else { setUncertain(null); game.online?.refresh(); } return false; }
    finally { pendingRef.current = false; setPending(false); }
  }
  function move(x: number, y: number, viaRightClick = false): Promise<boolean> {
    if (!scene?.scene || !me || (!moveMode && !viaRightClick) || uncertain || pendingRef.current) return Promise.resolve(false);
    const token = scene.motion?.tokens.find(t => t.tokenId === me.id);
    return send({ action: 'move', requestId: crypto.randomUUID(), tokenId: me.id, tokenVersion: token?.version ?? 0, sceneId: scene.scene.id, sceneRevision: scene.scene.revision, assignmentRevision: scene.assignmentRevision, epoch: scene.scene.category === 'battle' ? scene.motion?.round ?? 0 : scene.motion?.hour ?? 0, x, y });
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
  // consecutive characters act together (block); a character that ended its part waits
  const myTurn = !!me && !!liveEncounter && activeActors(liveEncounter).includes(pcActor(me.id));
  void liveTurn;
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
  async function sceneAction(input: Record<string, unknown>): Promise<boolean> {
    if (!scene?.scene || pendingRef.current) return false;
    pendingRef.current = true; setPending(true); setMessage('');
    try { const r = await api.sceneTurn({ sceneId: scene.scene.id, ...input }); setMessage(r.message ?? 'Done.'); game.online?.refresh(); return true; }
    catch (e) { setMessage(String(e)); game.online?.refresh(); return false; }
    finally { pendingRef.current = false; setPending(false); }
  }
  function figureClick(id: string) {
    if (!me || moveMode) return;
    const f = (scene?.figures ?? []).find(x => x.kind === 'enemy' && x.id === id);
    if (!f || f.condition === 'down' || f.side === 'ally') return;
    if (attackIndex !== null) { setAttackIndex(null); void sceneAction({ action: 'attack', tokenId: me.id, enemyId: id, attackIndex }); return; }
    setTarget(id);
  }
  const enemiesInSight = (scene.figures ?? []).filter(f => f.kind === 'enemy' && f.condition !== 'down');
  // Shillelagh on: the staff attacks with Wisdom and a d8 (the server applies the same rule)
  const attacksNow = mySheet && me ? withShillelagh(attacks, mySheet, !mySheet.wildShape && !!scene.self?.[me.id]?.effects.some(e => e.key === 'shillelagh')) : attacks;
  // APEX 1.4 map interaction (shared with the GM acting for a character): reach, path, LoS, right-click rules
  const acting = category === 'battle' && (myTurn || free);
  const interaction: SceneInteraction = category !== 'battle' || !me ? {} : pcInteraction({
    snapshot: scene, tokenId: me.id, name: me.name, sheet: mySheet, attacks: attacksNow, acting, canMove, remaining: free ? null : remaining,
    ready, setReady, setSpellTargets, act: (input) => sceneAction(input), move: (x, y) => move(x, y, true),
    openTargetMenu: (id) => setTarget(id), notify: setMessage,
    focusKey: myTurn && liveEncounter ? `${liveEncounter.id}:${liveEncounter.turnSerial ?? 0}` : null,
  });

  const canAttack = category === 'battle' && (free || myTurn) && attacks.length > 0;
  const status = !mv ? '' : free ? 'Free movement – no initiative running.' : mv.mode === 'turn' ? (myTurn ? `Your turn · ${remaining.toFixed(0)} ft left` : mv.reason ?? 'Waiting for your turn.') : `${remaining.toFixed(1)} of ${mv.allowance.toFixed(1)} miles left today (day ${scene.clock?.day ?? 1}${scene.clock?.phase === 'night' ? ', night' : ''})`;
  return <div className="player-scene">
    {liveEncounter && <InitiativeBar encounter={liveEncounter} tokens={game.view.tokens} myTokenId={me?.id ?? null} />}
    {['battle', 'region'].includes(category) && <div className="journal-toolbar">
      <button className="btn btn-gold" disabled={pending || !!uncertain || !canMove} aria-pressed={moveMode} onClick={() => setMoveMode(!moveMode)}>{moveMode ? 'Cancel movement' : 'Move your character'}</button>
      {myTurn && <button className="btn btn-gold" disabled={pending} onClick={() => void endTurn()} data-testid="end-turn">End turn</button>}
      {category === 'battle' && me && <button className="btn btn-ghost" disabled={pending} aria-pressed={!!scene.torch} onClick={() => void sceneAction({ action: 'torch', tokenId: me.id, on: !scene.torch })} data-testid="torch">{scene.torch ? '🔥 Put out light' : '🕯 Light a torch'}</button>}
      <span role="status" data-testid="movement-status">{status}</span>
    </div>}
    {category === 'battle' && me && <PlayerCombat snapshot={scene} encounter={liveEncounter} tokenId={me.id} sheet={mySheet} attacks={attacksNow} myTurn={myTurn} free={free} pending={pending} act={(input) => void sceneAction(input)} target={target} setTarget={setTarget} ready={ready} setReady={setReady} spellTargets={spellTargets} setSpellTargets={setSpellTargets} movement={mv && mv.mode === 'turn' ? { allowance: mv.allowance, spent: mv.spent, dashed: mv.dashed } : null} />}
    {canAttack && attackIndex !== null && <p className="text-xs text-gold-200">{enemiesInSight.length ? 'Click an enemy on the map.' : 'No enemy in sight.'}</p>}
    {!!scene.combatLog?.length && <details className="combat-log" open><summary>Combat log</summary><ol>{scene.combatLog.slice().reverse().map(l => <li key={l.id}>{l.text}</li>)}</ol></details>}
    {moveMode && <p>Choose a destination on the map. The server checks your path, terrain, walls and {free ? 'nothing else – movement is free' : mv?.mode === 'turn' ? 'your speed this turn' : 'how far you can travel today'}.</p>}
    {message && <p role="status">{message}</p>}
    {uncertain && <button className="btn btn-ghost" disabled={pending} onClick={() => void send(uncertain)}>Verify or retry previous movement</button>}
    {!!game.view.sceneAnnouncements.length && <section className="mx-auto my-2 w-full max-w-4xl space-y-2" aria-label="Scene announcements">
      {game.view.sceneAnnouncements.map(item => <article key={item.id} className="rounded-lg border border-gold-700/60 bg-ink-950/90 p-3"><p className="eyebrow">Scene event</p><h2 className="font-display text-lg text-gold-200">{item.title}</h2><p className="whitespace-pre-wrap text-sm text-marble-200">{item.text}</p></article>)}
    </section>}
    <SceneSurface snapshot={scene} tokenId={me?.id} name={me?.name} color={me?.color} tokenViews={game.view.tokens} reachBudget={(moveMode || (myTurn && canMove)) && !free ? remaining : null} onDestination={moveMode ? move : undefined} interaction={interaction} onFigureClick={figureClick} targets={attackIndex !== null ? enemiesInSight.map(f => f.id) : target ? [target] : undefined} />
    {category === 'world' && scene.travel && <WorldTravel sceneId={scene.scene.id} sceneRevision={scene.scene.revision} assignmentRevision={scene.assignmentRevision} map={scene.scene.map} travel={scene.travel} onChanged={() => game.online?.refresh()} />}
    <p>The Game Master controls scene transitions{category === 'region' ? ', day and night' : category === 'battle' ? ' and initiative' : ''}.</p>
  </div>;
}

/** Turn order across the top of the map: portraits in initiative order, the active turn (or block) highlighted. */
export function InitiativeBar({ encounter, tokens, myTokenId, onSelect, elites }: { encounter: NonNullable<GameApi['view']['sceneEncounter']>; tokens: GameApi['view']['tokens']; myTokenId: string | null; onSelect?: (p: { id: string; tokenId?: string }) => void; elites?: Set<string> }) {
  const live = new Set(activeActors(encounter));
  const block = new Set(blockOf(encounter));
  return <section className="initiative-bar" aria-label={`Initiative, round ${encounter.round}`} data-testid="initiative-bar">
    <span className="initiative-round">Round {encounter.round}</span>
    <ol>{encounter.participants.map((p, i) => {
      const t = p.tokenId ? tokens.find(x => x.id === p.tokenId) : undefined;
      void i;
      return <li key={p.id} aria-current={live.has(p.id) ? 'true' : undefined} className={`${p.tokenId && p.tokenId === myTokenId ? 'is-mine' : ''} ${block.has(p.id) && !live.has(p.id) ? 'opacity-50' : ''} ${onSelect ? 'cursor-pointer' : ''}`} title={`${p.name} · initiative ${p.initiative}${block.has(p.id) && !live.has(p.id) ? ' · done' : ''}`} onClick={onSelect ? () => onSelect(p) : undefined}>
        {t ? <CharacterPortrait tokenId={t.id} portraitV={t.portraitV} online color={t.color} accent={t.accent} initials={t.initials} name={t.name} size={40} /> : <span className={`initiative-npc ${elites?.has(p.id) ? 'ring-2 ring-amber-400' : ''}`}>{elites?.has(p.id) ? '🐉' : p.name.slice(0, 2)}</span>}
        <small>{p.name}</small><em>{p.initiative}</em>
      </li>;
    })}</ol>
  </section>;
}
