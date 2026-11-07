import { useEffect, useState, type PointerEvent } from 'react';
import type { SceneSnapshot } from '../server/sceneRuntime';
import { api } from '../online/api';
import { hexCorners } from '../game/hex';
import type { SceneMap } from '../campaign/maps';
import { useMapZoom } from './map/MapStage';

export function SceneGrid({ map, id }: { map: Pick<SceneMap, 'grid' | 'cell' | 'width' | 'height'>; id: string }) {
  if (map.grid === 'none') return null;
  const r = map.cell / 2, w = Math.sqrt(3) * r, h = 3 * r;
  return <><defs><pattern id={id} width={map.grid === 'hex' ? w : map.cell} height={map.grid === 'hex' ? h : map.cell} patternUnits="userSpaceOnUse">
    {map.grid === 'hex' ? [[0,0],[w,0],[w/2,h/2],[0,h],[w,h]].map(([x,y],i) => <polygon key={i} points={hexCorners(x,y,r)} fill="none" stroke="#9c896a" strokeWidth=".7" />) : <path d={'M' + map.cell + ' 0 H0 V' + map.cell} fill="none" stroke="#9c896a" strokeWidth=".7" />}
  </pattern></defs><rect width={map.width} height={map.height} fill={'url(#' + id + ')'} pointerEvents="none" /></>;
}

/** The same filtered renderer is used by assigned players and exact GM player previews. */
export function SceneSurface({ snapshot, tokenId, name = 'You', color = '#8bb5dc', tokenLabels, onDestination }: { snapshot: SceneSnapshot; tokenId?: string; name?: string; color?: string; tokenLabels?: Array<{ tokenId: string; name: string; color: string }>; onDestination?: (x: number, y: number) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const zoom = useMapZoom();
  const id = snapshot.scene?.map.playerBackgroundAsset;
  useEffect(() => { let live = true; setUrl(null); if (id) api.mapImage(id).then(r => { if (live) setUrl(r.url); }).catch(() => undefined); return () => { live = false; }; }, [id]);
  if (snapshot.kind !== 'scene' || !snapshot.scene) return <p>{snapshot.kind === 'arena' ? 'Legacy Arena' : 'Character Sanctuary'}</p>;
  const { map, name: title, category } = snapshot.scene;
  const terrainColors = { tree: '#41664b', rock: '#877c6e', obstacle: '#78553d', water: '#3d7485' } as const;
  const point = category === 'world' && snapshot.travel ? map.nodes.find(n => n.id === snapshot.travel?.partyNode) : snapshot.motion?.tokens.find(t => t.tokenId === tokenId) ?? snapshot.spawn;
  const positions = tokenLabels
    ? (snapshot.motion?.tokens ?? []).filter(position => tokenLabels.some(token => token.tokenId === position.tokenId))
    : point ? [{ tokenId: tokenId ?? 'party', x: point.x, y: point.y }] : [];
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
      {map.nodes.map(n => <g key={n.id}>{n.kind === 'wall' || n.kind === 'area' ? <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={n.proceduralFeature === 'water' ? 12 : 3} fill={n.proceduralFeature ? terrainColors[n.proceduralFeature] : n.kind === 'wall' ? '#877566' : '#52664d'} opacity={n.proceduralFeature === 'water' ? '.72' : '.5'} /> : <circle cx={n.x} cy={n.y} r="8" fill="#d9bd76" />}<text x={n.x + 14} y={n.y} fill="#f3e4bd">{n.label}</text></g>)}
      {positions.map(position => {
        const marker = tokenLabels?.find(token => token.tokenId === position.tokenId);
        return <g key={position.tokenId}><circle cx={position.x} cy={position.y} r="14" fill={marker?.color ?? color} stroke="#fff" /><text x={position.x + 18} y={position.y} fill="#fff">{marker?.name ?? (category === 'world' ? 'Party' : name)}</text></g>;
      })}
    </svg></div>
  </section>;
}
