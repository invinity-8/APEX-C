/**
 * APEX 2.9 – "Create random encounter" (Game tab): setting, band, party and difficulty → a complete proposal (map,
 * creatures, how they are met). The GM rerolls the map or the band, removes or adds creatures, adds quest characters
 * from the library (with the party or against it, with a name) and creates the scene – published, creatures placed.
 */
import { useEffect, useMemo, useState } from 'react';
import { generateBattleScene, newHexScene } from '../campaign/hexScene';
import type { SceneMap } from '../campaign/maps';
import { displayName, type StatBlock } from '../game/bestiary';
import { crXp, rate, SITUATIONS, THEMES, type Difficulty, type Situation } from '../game/encounters';
import { proposeEncounter, SITE_CHOICES, siteLabel } from '../game/randomEncounter';
import { api } from '../online/api';
import { EnemyPicker } from './EnemyPicker';
import { HexThumbnail } from './HexThumbnail';

type Entry = { key: string; templateId: string; name: string; cr: string; xp: number; role: string; side: 'enemy' | 'ally'; customName?: string };
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'deadly'];
const BADGE = { trivial: 'text-marble-300', easy: 'text-emerald-300', medium: 'text-amber-200', hard: 'text-orange-300', deadly: 'text-rose-300' } as const;
const newSeed = () => Math.floor(Math.random() * 1_000_000);

export function RandomEncounterWizard({ library, busy, partySizeDefault, onClose, onCreated }: { library: StatBlock[]; busy: boolean; partySizeDefault: number; onClose: () => void; onCreated: (sceneId: string, message: string) => void }) {
  const [site, setSite] = useState<string>('any');
  const [theme, setTheme] = useState<string>('any');
  const [situation, setSituation] = useState<Situation | 'any'>('any');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [partySize, setPartySize] = useState(Math.max(1, Math.min(8, partySizeDefault || 4)));
  const [partyLevel, setPartyLevel] = useState(3);
  const [seed, setSeed] = useState(newSeed);
  const [mapSeed, setMapSeed] = useState(newSeed);
  const proposal = useMemo(() => proposeEncounter({ site: site as never, theme, situation, difficulty, partySize, partyLevel, seed, blocks: library }), [site, theme, situation, difficulty, partySize, partyLevel, seed, library]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState('');
  useEffect(() => {
    setEntries(proposal.plan.entries.map((e, i) => ({ key: `p${i}`, ...e, side: 'enemy' as const })));
    setName(proposal.name);
  }, [proposal]);
  const hex = useMemo(() => generateBattleScene(proposal.site, proposal.radius, mapSeed), [proposal.site, proposal.radius, mapSeed]);
  const [pick, setPick] = useState(library[0]?.id ?? '');
  const [questSide, setQuestSide] = useState<'enemy' | 'ally'>('ally');
  const [questName, setQuestName] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const foes = entries.filter((e) => e.side === 'enemy');
  const rating = rate(foes.map((e) => e.xp), partySize, partyLevel);
  const add = (side: 'enemy' | 'ally', custom?: string) => {
    const b = library.find((x) => x.id === pick);
    if (!b) return;
    setEntries((l) => [...l, { key: `a${Date.now()}${l.length}`, templateId: b.id, name: displayName(b), cr: b.cr, xp: crXp(b.cr), role: custom ? 'quest' : 'added', side, ...(custom ? { customName: custom } : {}) }]);
  };
  const create = async () => {
    setError(''); setWorking(true);
    try {
      const created = await api.sceneCreate(name.trim() || proposal.name, 'battle', 'hex-battle');
      const map = newHexScene(created.scene.metadata as unknown as SceneMap, proposal.site, proposal.radius, mapSeed, 'battle');
      const pub = await api.sceneAction(created.scene.id, created.scene.revision, 'publish', { map });
      const r = await api.sceneTurn({ sceneId: pub.scene.id, action: 'encounter', op: 'apply', situation: proposal.situation, seed, entries: entries.map((e) => ({ templateId: e.templateId, side: e.side, ...(e.customName ? { name: e.customName } : {}) })) });
      onCreated(pub.scene.id, `“${pub.scene.name}” created and published. ${r.message ?? ''}`);
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); } finally { setWorking(false); }
  };
  const sel = 'rounded border border-ink-600 bg-ink-900 px-1 py-0.5';
  return (
    <section className="space-y-3 rounded-xl border border-gold-400/60 bg-ink-950/95 p-3 text-xs shadow-2xl" aria-label="Create random encounter" data-testid="random-encounter">
      <div className="flex items-center gap-2">
        <b className="font-display text-base text-gold-100">🎲 Create random encounter</b>
        <button type="button" className="ml-auto rounded px-2 text-marble-400 hover:text-gold-200" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-0.5">Setting
          <select className={sel} value={site} onChange={(e) => setSite(e.target.value)} data-testid="re-site">
            <option value="any">✨ Surprise me (fits the band)</option>
            {SITE_CHOICES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">Enemies
          <select className={sel} value={theme} onChange={(e) => setTheme(e.target.value)} data-testid="re-theme">
            <option value="any">✨ Fitting the setting</option>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">Situation
          <select className={sel} value={situation} onChange={(e) => setSituation(e.target.value as Situation | 'any')}>
            <option value="any">✨ Typical for the band</option>
            {SITUATIONS.map((x) => <option key={x.id} value={x.id} title={x.text}>{x.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">Party size
          <input type="number" min={1} max={8} className={sel} value={partySize} onChange={(e) => setPartySize(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} data-testid="re-size" />
        </label>
        <label className="flex flex-col gap-0.5">Party level
          <input type="number" min={1} max={20} className={sel} value={partyLevel} onChange={(e) => setPartyLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} data-testid="re-level" />
        </label>
        <label className="flex flex-col gap-0.5">Difficulty
          <select className={sel} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>{DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </label>
      </div>

      <div className="flex flex-col gap-3 md:flex-row" data-testid="re-proposal">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <HexThumbnail hex={hex} label={proposal.name} width={260} height={180} />
          <span className="text-marble-400">{siteLabel(proposal.site)} · {SITUATIONS.find((x) => x.id === proposal.situation)?.label}</span>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setMapSeed(newSeed())} data-testid="re-reroll-map">🗺 Other map</button>
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setSeed(newSeed())} data-testid="re-reroll">🎲 New proposal</button>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <label className="flex items-center gap-2">Name <input className={`${sel} flex-1`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="re-name" /></label>
          <p>
            <span className="text-marble-400">{THEMES.find((t) => t.id === proposal.theme)?.label}: </span>
            <b className={BADGE[rating.difficulty]} data-testid="re-rating">{rating.difficulty}</b>
            <span className="text-marble-500"> · {rating.adjusted} XP adjusted (budget {proposal.plan.budget} for {partySize} × level {partyLevel})</span>
          </p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1" data-testid="re-entries">
            {entries.map((e) => (
              <li key={e.key} className={`flex items-center gap-2 rounded px-1 ${e.side === 'ally' ? 'bg-sky-900/30' : 'bg-ink-900/60'}`}>
                <span className="w-14 shrink-0 text-marble-500">{e.side === 'ally' ? 'with party' : e.role}</span>
                <span className="min-w-0 flex-1 truncate text-marble-100">{e.customName ? <><b>{e.customName}</b> <span className="text-marble-500">({e.name})</span></> : e.name}</span>
                <span className="text-marble-500">CR {e.cr}</span>
                <button type="button" className="rounded px-1 text-marble-400 hover:text-blood-300" aria-label={`Remove ${e.customName ?? e.name}`} onClick={() => setEntries((l) => l.filter((x) => x.key !== e.key))}>✕</button>
              </li>
            ))}
            {!entries.length && <li className="text-marble-500">No creatures – add some below.</li>}
          </ul>
        </div>
      </div>

      <details className="rounded-md border border-ink-700 p-2" open>
        <summary className="cursor-pointer text-gold-200">➕ Add creatures and quest characters from the library</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
          <EnemyPicker library={library} value={pick} onPick={setPick} height="10rem" />
          <div className="flex flex-col gap-1.5">
            <button type="button" className="btn btn-ghost" disabled={!pick} onClick={() => add('enemy')} data-testid="re-add">+ Add as enemy</button>
            <span className="mt-1 text-marble-400">Quest character</span>
            <input className={sel} placeholder="Name (e.g. Captain Varga)" value={questName} maxLength={60} onChange={(e) => setQuestName(e.target.value)} data-testid="re-quest-name" />
            <select className={sel} value={questSide} onChange={(e) => setQuestSide(e.target.value as 'enemy' | 'ally')}><option value="ally">with the party</option><option value="enemy">against the party</option></select>
            <button type="button" className="btn btn-ghost" disabled={!pick} onClick={() => { add(questSide, questName.trim() || undefined); setQuestName(''); }} data-testid="re-add-quest">+ Add quest character</button>
          </div>
        </div>
      </details>

      {error && <p role="alert" className="text-rose-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-gold px-4 py-1.5 text-sm" disabled={busy || working || !entries.length} onClick={() => void create()} data-testid="re-create">{working ? 'Creating…' : '⚔ Create encounter'}</button>
        <span className="text-marble-500">Creates a published battle scene with the creatures placed. Open it below and bring the players along.</span>
      </div>
    </section>
  );
}
