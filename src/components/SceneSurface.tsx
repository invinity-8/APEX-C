import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { SceneSnapshot } from '../server/sceneRuntime';
import { api } from '../online/api';
import { hexCorners } from '../game/hex';
import type { SceneMap } from '../campaign/maps';
import { useMapZoom } from './map/MapStage';
import { HexSceneMap, type SceneToken } from './map/HexSceneMap';
import { hexReach } from '../campaign/hexScene';
import { stealthWatch } from '../game/stealth';
import type { TokenView } from '../game/visibility';
import { figureIcons } from './map/effectIcons';

const HexScene3D = lazy(() => import('./map/HexScene3D'));

export function SceneGrid({ map, id }: { map: Pick<SceneMap, 'grid' | 'cell' | 'width' | 'height'>; id: string }) {
  if (map.grid === 'none') return null;
  const r = map.cell / 2, w = Math.sqrt(3) * r, h = 3 * r;
  return <><defs><pattern id={id} width={map.grid === 'hex' ? w : map.cell} height={map.grid === 'hex' ? h : map.cell} patternUnits="userSpaceOnUse">
    {map.grid === 'hex' ? [[0,0],[w,0],[w/2,h/2],[0,h],[w,h]].map(([x,y],i) => <polygon key={i} points={hexCorners(x,y,r)} fill="none" stroke="#9c896a" strokeWidth=".7" />) : <path d={'M' + map.cell + ' 0 H0 V' + map.cell} fill="none" stroke="#9c896a" strokeWidth=".7" />}
  </pattern></defs><rect width={map.width} height={map.height} fill={'url(#' + id + ')'} pointerEvents="none" /></>;
}

export interface SceneInteraction {
  /** `point.alt`: the chosen aim height in feet above that hex's ground (Shift + mouse wheel, APEX 1.9). */
  onHexContext?: (key: string, point: { x: number; y: number; alt?: number }) => void;
  onTokenContext?: (id: string) => void;
  pathFrom?: { x: number; y: number } | null;
  pathBudget?: number | null;
  lineFrom?: { x: number; y: number } | null;
  lineRangeFt?: number | null;
  /** Sight preview origin (the acting figure) and whose opponents are shown. */
  sightFrom?: { x: number; y: number } | null;
  sightSide?: 'hostile' | 'party' | null;
  areaAt?: ((point: { x: number; y: number }) => string[]) | null;
  focus?: { key: string; x: number; y: number } | null;
  /** APEX 1.9 – how the figure moves (flying in the air, climbing speed) for reach and path previews. */
  moveMode?: { fly?: boolean; climb?: boolean };
  /** Reach area origin (default: the viewer's own token). */
  reachFrom?: { x: number; y: number } | null;
}

/** The same filtered renderer is used by assigned players and exact GM player previews. */
export function SceneSurface({ snapshot, tokenId, name = 'You', color = '#8bb5dc', tokenLabels, onDestination, tokenViews = [], reachBudget = null, gm = false, onFigureClick, targets, selectedId = null, interaction = {}, compact = false }: { snapshot: SceneSnapshot; tokenId?: string; name?: string; color?: string; tokenLabels?: Array<{ tokenId: string; name: string; color: string }>; onDestination?: (x: number, y: number) => void; tokenViews?: TokenView[]; /** Remaining movement (feet/miles) – shows the gold reach area on hex scenes. */ reachBudget?: number | null; gm?: boolean; /** Click on another character or an enemy (id: token id or enemy id). */ onFigureClick?: (id: string) => void; /** Highlighted figure ids (attack mode). */ targets?: string[]; /** GM: the selected figure (token or NPC id). */ selectedId?: string | null; /** APEX 1.2 right-click, previews, camera focus. */ interaction?: SceneInteraction; /** APEX 1.9: inside the battle layout – the map only, no title. */ compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const zoom = useMapZoom();
  const [info, setInfo] = useState<string | null>(null);
  // APEX 1.8: 2D or 3D battle map (remembered per device)
  const [view3d, setView3dState] = useState(() => { try { return localStorage.getItem('apex.map.view3d') === '1'; } catch { return false; } });
  // APEX 1.9: aim height (Shift + mouse wheel) – where a flyer moves to, where a sphere's centre lies
  const [aimAlt, setAimAlt] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      const d = (e.deltaY || e.deltaX) < 0 ? 5 : -5;
      setAimAlt((a) => Math.max(0, Math.min(120, a + d)));
    };
    el.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', wheel, { capture: true } as EventListenerOptions);
  });
  const setView3d = (on: boolean) => { setView3dState(on); try { localStorage.setItem('apex.map.view3d', on ? '1' : '0'); } catch { /* private mode */ } };
  const id = snapshot.scene?.map.playerBackgroundAsset;
  useEffect(() => { let live = true; setUrl(null); if (id) api.mapImage(id).then(r => { if (live) setUrl(r.url); }).catch(() => undefined); return () => { live = false; }; }, [id]);
  if (snapshot.kind !== 'scene' || !snapshot.scene) return <p>{snapshot.kind === 'arena' ? 'Legacy Arena' : 'Character Sanctuary'}</p>;
  const { map, name: title, category } = snapshot.scene;
  const terrainColors = { tree: '#41664b', rock: '#877c6e', obstacle: '#78553d', water: '#3d7485' } as const;
  const point = category === 'world' && snapshot.travel ? map.nodes.find(n => n.id === snapshot.travel?.partyNode) : snapshot.motion?.tokens.find(t => t.tokenId === tokenId) ?? snapshot.spawn;
  const positions = tokenLabels
    ? (snapshot.motion?.tokens ?? []).filter(position => tokenLabels.some(token => token.tokenId === position.tokenId))
    : point ? [{ tokenId: tokenId ?? 'party', x: point.x, y: point.y }] : [];
  if (map.hex) {
    // Battle and region scenes: the Arena hex engine with this scene's content.
    const view = (id: string) => tokenViews.find(t => t.id === id);
    // Assigned characters that have not moved yet stand on the spawn (the server starts them there too).
    const spawnNode = map.nodes.find(n => n.kind === 'spawn');
    const waiting = spawnNode ? (tokenLabels ?? []).filter(t => !positions.some(p => p.tokenId === t.tokenId)).map(t => ({ tokenId: t.tokenId, x: spawnNode.x, y: spawnNode.y })) : [];
    const figures = snapshot.figures ?? [];
    // GM: figures carry every character and enemy; players: own token plus what they can see.
    const own = gm && figures.length ? [] : [...positions, ...waiting].filter(p => !figures.some(f => f.tokenId === p.tokenId)).map(p => {
      const marker = tokenLabels?.find(t => t.tokenId === p.tokenId);
      return { tokenId: p.tokenId, x: p.x, y: p.y, name: marker?.name ?? (category === 'world' ? 'Party' : name), color: marker?.color ?? color, view: view(p.tokenId), torch: !gm && p.tokenId === tokenId && !!snapshot.torch } as SceneToken;
    });
    const tokens: SceneToken[] = [...own, ...figures.map(f => ({
      tokenId: f.kind === 'pc' ? f.tokenId! : f.id, x: f.x, y: f.y, name: f.name, color: f.color, torch: f.torch,
      view: f.tokenId ? view(f.tokenId) : undefined,
      enemy: f.kind === 'enemy' ? { icon: f.icon ?? '?', ally: f.side === 'ally', elite: f.elite, condition: f.condition, hp: f.hp, maxHp: f.maxHp, tempHp: f.tempHp, size: f.size, build: f.build, look: f.look, breed: f.breed, creature: f.creature } : undefined,
      target: !!targets?.includes(f.kind === 'pc' ? f.tokenId! : f.id),
      ...((f.effects ?? (f.tokenId ? snapshot.self?.[f.tokenId]?.effects : undefined) ?? []).some((e) => e.key === 'hidden') ? { sneaking: true } : {}),
      badges: [f.concentration ? `◎ ${f.concentration}` : '', ...(f.effects ?? []).map((e) => (e.key === 'hidden' ? `🥷 ${e.name}` : e.name))].filter(Boolean).join(' · ') || undefined,
      icons: figureIcons(f.effects, f.concentration),
      ...(f.alt ? { alt: f.alt } : {}),
      ...(f.kind === 'pc' && snapshot.vitals?.[f.tokenId!] ? { vitals: snapshot.vitals[f.tokenId!] } : {}),
    }))].map((t) => {
      // the viewer's own characters: effects from `self`, hit points from `vitals`
      const mine = snapshot.self?.[t.tokenId];
      return { ...t, ...(t.tokenId === tokenId && snapshot.movement?.alt ? { alt: snapshot.movement.alt } : {}), ...(mine && !t.icons?.length ? { icons: figureIcons(mine.effects, mine.concentration) } : {}), ...(!t.enemy && !t.vitals && snapshot.vitals?.[t.tokenId] ? { vitals: snapshot.vitals[t.tokenId] } : {}) };
    });
    // APEX 2.4 – sneaking: awareness rings of the opponents (everyone), spotted / heard marks (GM only)
    const watch = category === 'battle' && snapshot.clock ? stealthWatch(map, figures.map((f) => ({ ...f, effects: f.effects ?? (f.tokenId ? snapshot.self?.[f.tokenId]?.effects : undefined) })), snapshot.clock.lighting) : null;
    const stealth = watch && watch.rings.length ? { rings: watch.rings, ...(gm ? { marks: watch.marks } : {}) } : null;
    const reachOrigin = interaction.reachFrom ?? point;
    const reachArea = reachOrigin && reachBudget !== null && reachBudget > 0 ? hexReach(map, reachOrigin, reachBudget, interaction.moveMode) : null;
    // Scene-local light: region night like the Arena; battle lighting dim/dark.
    const clock = snapshot.clock;
    const phase = !clock ? 'day' : category === 'battle' ? (clock.lighting === 'dark' ? 'night' : clock.lighting === 'dim' ? 'dusk' : 'day') : clock.phase === 'night' ? 'night' : 'day';
    const lightLabel = !clock ? '' : category === 'battle' ? ` · ${clock.lighting} light` : ` · day ${clock.day}, ${clock.phase}`;
    return <section className="player-scene hex-scene" aria-label="Assigned campaign scene">{!compact && <><h2>{title}</h2><p>{category} · {map.unitsPerCell} {map.unit === 'feet' ? 'ft' : 'mi'} per hex{lightLabel} · mouse wheel zooms, drag pans</p></>}
      <div className="hex-scene-frame" ref={frameRef}>
        {stealth && view3d && <div className="stealth-legend" data-testid="stealth-legend">🥷 Sneaking – rings: how far opponents pay attention. <b style={{ color: '#ff8a7a' }}>red</b> = it would notice your Stealth when it sees you · <b style={{ color: '#f3dc9a' }}>dashed</b> = you beat its passive Perception</div>}
        {category === 'battle' && (aimAlt > 0 || snapshot.movement?.fly) && <div className="aim-level" data-testid="aim-level" title="Shift + mouse wheel: aim height for flying and spell centres">⇕ Aim {aimAlt} ft{aimAlt ? '' : ' (ground)'} <small>Shift+wheel</small>{aimAlt > 0 && <button type="button" onClick={() => setAimAlt(0)} aria-label="Back to the ground">×</button>}</div>}
        {category === 'battle' && <button type="button" className="map-view-toggle" aria-pressed={view3d} onClick={() => setView3d(!view3d)} data-testid="toggle-3d" title={view3d ? 'Back to the 2D map' : '3D view: hold the middle mouse button to orbit and tilt'}>{view3d ? '⬢ 2D' : '⛰ 3D'}</button>}
        {view3d && category === 'battle' ? (
          <Suspense fallback={<p className="p-4 text-marble-300">Loading 3D view…</p>}>
            <HexScene3D map={map} label={title} tokens={tokens} gm={gm} fog={snapshot.fog} phase={phase} selectedTokenId={selectedId ?? tokenId ?? null} reach={reachArea} onTokenClick={onFigureClick} onHexClick={onDestination ? (_k, p) => onDestination(p.x, p.y) : undefined} onHexContext={interaction.onHexContext ? (k, p) => interaction.onHexContext!(k, { ...p, alt: aimAlt }) : undefined} onTokenContext={interaction.onTokenContext} pathFrom={interaction.pathFrom} pathBudget={interaction.pathBudget} pathMode={interaction.moveMode} areaAt={interaction.areaAt} focus={interaction.focus} aimAlt={aimAlt} flyAlt={snapshot.movement?.fly ? snapshot.movement.alt ?? 0 : null} stealth={stealth} fx={snapshot.fx} sightFrom={interaction.sightFrom} sightSide={interaction.sightSide} lineRangeFt={interaction.lineRangeFt} />
          </Suspense>
        ) : (
          <HexSceneMap map={map} label={title} tokens={tokens} gm={gm} fog={snapshot.fog} phase={phase} selectedTokenId={selectedId ?? tokenId ?? null} reach={reachArea} onTokenClick={onFigureClick} onHexClick={onDestination ? (_k, p) => onDestination(p.x, p.y) : undefined} onHexContext={interaction.onHexContext ? (k, p) => interaction.onHexContext!(k, { ...p, alt: aimAlt }) : undefined} onTokenContext={interaction.onTokenContext} pathFrom={interaction.pathFrom} pathBudget={interaction.pathBudget} pathMode={interaction.moveMode} lineFrom={interaction.lineFrom} lineRangeFt={interaction.lineRangeFt} sightFrom={interaction.sightFrom} sightSide={interaction.sightSide} areaAt={interaction.areaAt} focus={interaction.focus} fx={snapshot.fx} aimAlt={aimAlt} />
        )}
      </div>
    </section>;
  }
  function destination(e: PointerEvent<SVGSVGElement>) {
    if (!onDestination) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onDestination((e.clientX - rect.left) / rect.width * map.width, (e.clientY - rect.top) / rect.height * map.height);
  }
  return <section className="player-scene" aria-label="Assigned campaign scene"><h2>{title}</h2><p>{category} · {map.interval} scale · {map.unitsPerCell} {map.unit} per cell</p>
    <div className="scene-canvas-scroll"><svg role="img" aria-label={title} viewBox={'0 0 ' + map.width + ' ' + map.height} width={Math.round(map.width * zoom)} height={Math.round(map.height * zoom)} onPointerDown={destination}>
      <rect width={map.width} height={map.height} fill={category === 'celestial' ? '#101626' : '#302a20'} />
      {url && <image href={url} width={map.width} height={map.height} preserveAspectRatio="none" />}
      <SceneGrid map={map} id={'player-grid-' + snapshot.scene.id} />
      {map.routes.map(r => { const a = map.nodes.find(n => n.id === r.from), b = map.nodes.find(n => n.id === r.to); return a && b ? <g key={r.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#beab80" strokeDasharray="8 6" /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fill="#f3e4bd">{r.hours}h</text></g> : null; })}
      {map.nodes.map(n => <g key={n.id} style={n.kind === 'location' ? { cursor: 'pointer' } : undefined} onPointerDown={n.kind === 'location' ? (e => { e.stopPropagation(); setInfo(info === n.id ? null : n.id); }) : undefined} data-testid={n.kind === 'location' ? 'map-location' : undefined}>{n.kind === 'wall' || n.kind === 'area' ? <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={n.proceduralFeature === 'water' ? 12 : 3} fill={n.proceduralFeature ? terrainColors[n.proceduralFeature] : n.kind === 'wall' ? '#877566' : '#52664d'} opacity={n.proceduralFeature === 'water' ? '.72' : '.5'} /> : <circle cx={n.x} cy={n.y} r="8" fill="#d9bd76" />}<text x={n.x + 14} y={n.y} fill="#f3e4bd">{n.label}</text></g>)}
      {positions.map(position => {
        const marker = tokenLabels?.find(token => token.tokenId === position.tokenId);
        return <g key={position.tokenId}><circle cx={position.x} cy={position.y} r="14" fill={marker?.color ?? color} stroke="#fff" /><text x={position.x + 18} y={position.y} fill="#fff">{marker?.name ?? (category === 'world' ? 'Party' : name)}</text></g>;
      })}
    </svg></div>
    {(() => { const n = map.nodes.find(x => x.id === info); return n ? <aside className="location-card" role="dialog" aria-label={n.label}><button type="button" className="ws-icon" aria-label="Close" onClick={() => setInfo(null)}>×</button><h3>{n.label}</h3>{n.description ? <p>{n.description}</p> : <p className="text-marble-500">No description yet.</p>}</aside> : null; })()}
  </section>;
}
