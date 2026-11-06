import { useState } from 'react';
import type { SceneMap } from '../campaign/maps';
import type { TravelSnapshot } from '../server/sceneTravel';
import { api, ApiError } from '../online/api';

export function WorldTravel({ sceneId, sceneRevision, assignmentRevision, map, travel, gm = false, onChanged }: { sceneId: string; sceneRevision: number; assignmentRevision: number; map: Pick<SceneMap,'nodes'|'routes'>; travel: TravelSnapshot; gm?: boolean; onChanged: () => void }) {
  const [node, setNode] = useState(''), [route, setRoute] = useState(''), [hours, setHours] = useState(1), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState<Record<string, unknown> | null>(null);
  const routes = map.routes.filter(r => r.visible && [r.from,r.to].includes(travel.partyNode ?? ''));
  const active = travel.proposals.some(p => p.status === 'traveling');
  async function act(fields: Record<string, unknown>) {
    if (busy) return;
    const input = uncertain ?? { ...fields, sceneId, sceneRevision, assignmentRevision, partyRevision: travel.revision, requestId: crypto.randomUUID() };
    setBusy(true); setMessage('');
    try { await api.sceneTravelAction(input); setUncertain(null); setMessage('Travel update saved.'); onChanged(); }
    catch (e) { setMessage(String(e)); if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) setUncertain(input); else { setUncertain(null); onChanged(); } }
    finally { setBusy(false); }
  }
  return <section aria-label="World travel"><h3>Party travel</h3><p>Current location: {map.nodes.find(n => n.id === travel.partyNode)?.label ?? 'Waiting for the GM to choose a starting location'}</p>
    <fieldset disabled={busy || !!uncertain}>
      {gm && <><label>Party location <select aria-label="Party location" value={node} onChange={e => setNode(e.target.value)}><option value="">Select location</option>{map.nodes.filter(n => n.kind === 'location').map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label><button className="btn btn-ghost" disabled={!node || active} onClick={() => void act({ action: 'locate', nodeId: node })}>Set party location</button></>}
      <label>Travel destination <select aria-label="Travel destination" value={route} onChange={e => setRoute(e.target.value)}><option value="">Select a known route</option>{routes.map(r => <option key={r.id} value={r.id}>{map.nodes.find(n => n.id === (r.from === travel.partyNode ? r.to : r.from))?.label ?? 'Known destination'} · {r.hours}h · {r.distance} miles</option>)}</select></label>
      <button className="btn btn-gold" disabled={!routes.some(r => r.id === route) || active} onClick={() => void act({ action: 'propose', routeId: route })}>Propose destination to GM</button>
      {gm && <label>Hours to progress <input type="number" min="0.01" max="1000000" step="0.25" value={hours} onChange={e => setHours(Number(e.target.value))} /></label>}
      <ul>{travel.proposals.map(p => <li key={p.id}>{map.nodes.find(n => n.id === p.from_node)?.label ?? p.from_node} → {map.nodes.find(n => n.id === p.to_node)?.label ?? p.to_node}: {p.status} · {p.elapsed_hours}/{p.total_hours}h <progress max={p.total_hours || 1} value={p.status === 'complete' ? p.total_hours || 1 : p.elapsed_hours} />
        {gm && p.status === 'proposed' && <button className="btn btn-gold" onClick={() => void act({ action: 'confirm', proposalId: p.id, version: p.version })}>Confirm travel</button>}
        {gm && p.status === 'traveling' && <button className="btn btn-ghost" onClick={() => void act({ action: 'progress', proposalId: p.id, version: p.version, hours })}>Progress journey</button>}
        {gm && ['proposed','traveling'].includes(p.status) && <button className="btn btn-ghost" onClick={() => void act({ action: 'cancel', proposalId: p.id, version: p.version })}>Cancel journey</button>}
      </li>)}</ul>
    </fieldset>
    {uncertain && <button className="btn btn-ghost" disabled={busy} onClick={() => void act(uncertain)}>Verify or retry previous travel update</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
