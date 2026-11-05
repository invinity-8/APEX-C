import { useState } from 'react';
import type { GameApi } from '../state/gameApi';
import { CharacterPortrait } from './CharacterVisuals';

export function PlayerScene({ game, open }: { game: GameApi; open: (screen: 'character' | 'inventory') => void }) {
  const scene = game.scene;
  const me = game.view.tokens.find(t => t.id === game.view.viewerId);
  const [background, setBackground] = useState(() => { try { return localStorage.getItem('apex.sanctuary.background') ?? 'hall'; } catch { return 'hall'; } });
  if (!scene || scene.kind === 'arena') return null;
  if (scene.kind === 'sanctuary') return <section className={`sanctuary sanctuary-${['hall', 'campfire', 'starlight'].includes(background) ? background : 'hall'}`} aria-label="Character Sanctuary">
    <div className="sanctuary-glow" aria-hidden="true" />
    <div className="sanctuary-card"><p className="eyebrow">APEX · A moment between adventures</p><h1>Character Sanctuary</h1>
      {me && <CharacterPortrait tokenId={me.id} portraitV={me.portraitV} online color={me.color} accent={me.accent} initials={me.initials} name={me.name} size={148} zoomable />}
      <h2>{me?.name ?? 'Adventurer'}</h2><p>Your character is resting here until the Game Master assigns a scene.</p>
      <div className="journal-toolbar"><button className="btn btn-gold" onClick={() => open('character')}>Character sheet</button><button className="btn btn-ghost" onClick={() => open('inventory')}>Inventory & equipment</button></div>
      <p>Open Campaign Journal in your workspace to record your adventures.</p>
      <label>Sanctuary atmosphere <select value={background} onChange={e => { setBackground(e.target.value); try { localStorage.setItem('apex.sanctuary.background', e.target.value); } catch { /* personal preference can remain session-local */ } }}><option value="hall">Stone hall</option><option value="campfire">Campfire</option><option value="starlight">Starlight</option></select></label>
      <small>Scene transitions do not restore movement points or character resources.</small>
    </div>
  </section>;
  if (!scene.scene) return null;
  const { map, name, category } = scene.scene;
  return <section className="player-scene" aria-label="Assigned campaign scene"><h2>{name}</h2><p>{category} · {map.interval} scale · {map.unitsPerCell} {map.unit} per cell</p>
    <div className="scene-canvas-scroll"><svg role="img" aria-label={name} viewBox={`0 0 ${map.width} ${map.height}`} width={map.width} height={map.height}>
      <rect width={map.width} height={map.height} fill={category === 'celestial' ? '#101626' : '#302a20'} />
      {map.routes.map(r => { const a = map.nodes.find(n => n.id === r.from), b = map.nodes.find(n => n.id === r.to); return a && b ? <g key={r.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#beab80" strokeDasharray="8 6" /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fill="#f3e4bd">{r.hours}h</text></g> : null; })}
      {map.nodes.map(n => <g key={n.id}>{n.kind === 'wall' || n.kind === 'area' ? <rect x={n.x} y={n.y} width={n.width} height={n.height} fill={n.kind === 'wall' ? '#877566' : '#52664d'} /> : <circle cx={n.x} cy={n.y} r="8" fill="#d9bd76" />}<text x={n.x + 14} y={n.y} fill="#f3e4bd">{n.label}</text></g>)}
      {scene.spawn && <g><circle cx={scene.spawn.x} cy={scene.spawn.y} r="14" fill={me?.color ?? '#8bb5dc'} stroke="#fff" /><text x={scene.spawn.x + 18} y={scene.spawn.y} fill="#fff">{me?.name ?? 'You'}</text></g>}
    </svg></div><p>The Game Master controls scene transitions.</p>
  </section>;
}
