import { useEffect, useState } from 'react';
import { api } from '../online/api';
import type { SanctuarySettings } from '../server/sanctuary';
export function SanctuarySettingsPanel({ candidateAsset, candidateName }: { candidateAsset?: string | null; candidateName: string }) {
  const [settings, setSettings] = useState<SanctuarySettings | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let live = true; api.sanctuary().then(s => { if (live) setSettings(s); }).catch(e => { if (live) setMessage(String(e)); }); return () => { live = false; }; }, []);
  async function save() { if (!settings || busy) return; setBusy(true); setMessage(''); try { setSettings(await api.sanctuarySave(settings)); setMessage('Sanctuary defaults saved. Players receive them when opening Sanctuary.'); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }
  if (!settings) return <p role="status">{message || 'Loading Sanctuary defaults…'}</p>;
  return <fieldset disabled={busy}><legend>Campaign Sanctuary</legend>
    <label>Default atmosphere <select value={settings.atmosphere} onChange={e => setSettings({ ...settings, atmosphere: e.target.value as SanctuarySettings['atmosphere'] })}><option value="hall">Stone hall</option><option value="campfire">Campfire</option><option value="starlight">Starlight</option></select></label>
    <label>Default background <select aria-label="Default background" value={settings.defaultAsset ?? ''} onChange={e => setSettings({ ...settings, defaultAsset: e.target.value || null })}><option value="">Atmosphere only</option>{settings.backgrounds.map(b => <option key={b.assetId} value={b.assetId}>{b.name}</option>)}</select></label>
    <p>Only approved player-safe images are available for personal backgrounds.</p>
    {candidateAsset && <button disabled={settings.backgrounds.length >= 20 || settings.backgrounds.some(b => b.assetId === candidateAsset)} onClick={() => setSettings({ ...settings, backgrounds: [...settings.backgrounds, { assetId: candidateAsset, name: candidateName.slice(0,120) }] })}>Approve this scene's published player image</button>}
    {settings.backgrounds.map(b => <div key={b.assetId}><label>Background name <input maxLength={120} value={b.name} onChange={e => setSettings({ ...settings, backgrounds: settings.backgrounds.map(o => o.assetId === b.assetId ? { ...o, name: e.target.value } : o) })} /></label><button onClick={() => setSettings({ ...settings, backgrounds: settings.backgrounds.filter(o => o.assetId !== b.assetId), defaultAsset: settings.defaultAsset === b.assetId ? null : settings.defaultAsset })}>Remove approval</button></div>)}
    <button onClick={() => void save()}>Save Sanctuary defaults</button>{message && <p role="status">{message}</p>}
  </fieldset>;
}
