/**
 * Party loot rolls (APEX 0.7): the player's Need / Distribute / Pass dock and the GM's roll controls.
 * All decisions and dice happen on the server (src/game/items/partyLoot.ts); this file only displays and sends.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Command } from '../game/commands';
import { CHOICE_LABEL, LOOT_CHOICES, ROLL_MINUTES, type LootChoice, type LootRoll } from '../game/items/partyLoot';
import type { Item } from '../game/types';
import type { DispatchResult } from '../state/gameApi';
import { ItemBadges, RARITY_STYLE } from './itemPresentation';
import { ItemInspect } from './items/ItemUi';

type Run = (cmd: Command) => Promise<DispatchResult>;

/** Seconds left until the deadline, by server time (device clock offset from the view's serverTime). */
function useCountdown(rolls: LootRoll[], serverTime: string | undefined) {
  const offset = useMemo(() => (serverTime ? Date.parse(serverTime) - Date.now() : 0), [serverTime]);
  const [now, setNow] = useState(() => Date.now() + offset);
  const anyOpen = rolls.some((r) => r.status === 'open');
  useEffect(() => {
    setNow(Date.now() + offset);
    if (!anyOpen) return;
    const id = setInterval(() => setNow(Date.now() + offset), 1000); // local clock only – no network polling
    return () => clearInterval(id);
  }, [anyOpen, offset]);
  return (r: LootRoll) => Math.max(0, Math.ceil((Date.parse(r.deadline) - now) / 1000));
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function RollResults({ roll, nameOf }: { roll: LootRoll; nameOf: (id: string) => string }) {
  if (roll.status === 'open') return null;
  return (
    <div className="text-[11px]" data-testid="roll-results">
      {roll.status === 'won' ? (
        <p className="text-gold-200">
          🏆 <strong>{nameOf(roll.winner!)}</strong> receives {roll.itemName}.
        </p>
      ) : (
        <p className="text-marble-400">Returned to the Game Master – {roll.note ?? 'nobody took it'}.</p>
      )}
      <ul className="mt-0.5 text-marble-400">
        {(roll.results ?? []).map((r) => (
          <li key={r.tokenId}>
            {nameOf(r.tokenId)}: {CHOICE_LABEL[r.choice]}
            {r.rolls.length ? <span className="tabular-nums text-marble-200"> · d100 {r.rolls.join(' → ')}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Player dock: open rolls the character takes part in, plus the most recent results. */
export function LootRollDock({ rolls, viewerId, serverTime, run }: { rolls: LootRoll[]; viewerId: string | null; serverTime?: string; run: Run }) {
  const left = useCountdown(rolls, serverTime);
  const [busy, setBusy] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [minimized, setMinimized] = useState(false);
  if (!viewerId) return null;
  const mine = rolls.filter((r) => r.eligible.includes(viewerId));
  const open = mine.filter((r) => r.status === 'open');
  const recent = mine.filter((r) => r.status !== 'open' && !seen.includes(r.id) && r.resolvedAt && Date.parse(serverTime ?? '') - Date.parse(r.resolvedAt) < 15 * 60_000).slice(-3);
  if (!open.length && !recent.length) return null;
  const send = async (cmd: Command, key: string) => {
    setBusy(key);
    try {
      await run(cmd);
    } finally {
      setBusy(null);
    }
  };
  if (minimized) return <button className="fixed bottom-3 left-3 z-40 rounded-full border border-gold-400/60 bg-ink-950/95 px-4 py-2 text-sm font-bold text-gold-200 shadow-2xl" aria-label={`Reopen loot chest (${open.length} open)`} onClick={() => setMinimized(false)}>🎁 Loot chest {open.length ? `· ${open.length} open` : '· results'}</button>;
  return (
    <aside className="fixed left-1/2 top-24 z-40 max-h-[70vh] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 space-y-2 overflow-y-auto rounded-2xl border border-gold-400/60 bg-ink-950/95 p-4 shadow-2xl" aria-label="Loot rolls">
      <div className="flex items-center justify-between gap-2"><h2 className="font-display text-sm font-black uppercase tracking-widest text-gold-200">🎁 You found something</h2><button className="btn btn-ghost px-2 py-1 text-xs" aria-label="Minimize loot chest" onClick={() => setMinimized(true)}>Minimize</button></div>
      {open.map((r) => {
        const mineChoice = r.choices[viewerId];
        const secs = left(r);
        return (
          <div key={r.id} className="space-y-1.5 rounded-lg border border-ink-700 p-2" data-roll={r.id}>
            {r.item && <ItemInspect item={r.item} inventory={[]} />}
            <div className="flex items-center justify-between text-[11px] text-marble-400">
              <span>
                Decided: {(r.decided ?? []).length}/{r.eligible.length}
              </span>
              <span className="tabular-nums" aria-label="Time left">
                {secs > 0 ? `⏳ ${mmss(secs)}` : 'Time is up'}
              </span>
            </div>
            {secs > 0 ? (
              <div className="flex gap-1" role="group" aria-label={`Your choice for ${r.itemName}`}>
                {LOOT_CHOICES.map((c) => (
                  <button
                    key={c}
                    className={`btn flex-1 px-2 py-1 text-xs ${mineChoice === c ? 'btn-gold' : 'btn-ghost'}`}
                    aria-pressed={mineChoice === c}
                    disabled={busy === r.id}
                    onClick={() => void send({ type: 'lootRollChoose', rollId: r.id, tokenId: viewerId, choice: c }, r.id)}
                    title={c === 'need' ? 'You need it for your character – Need beats Distribute.' : c === 'distribute' ? 'You would take it (to share, sell or pass on) if nobody needs it.' : 'You do not want it.'}
                  >
                    {CHOICE_LABEL[c]}
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn btn-gold w-full text-xs" disabled={busy === r.id} onClick={() => void send({ type: 'lootRollClaimExpired', rollId: r.id, tokenId: viewerId }, r.id)}>
                Roll now (unanswered choices count as Pass)
              </button>
            )}
            {mineChoice && <p className="text-[11px] text-marble-500">Your choice: {CHOICE_LABEL[mineChoice]} – you can change it until everyone has decided.</p>}
          </div>
        );
      })}
      {recent.map((r) => (
        <div key={r.id} className="rounded-lg border border-ink-700 p-2" data-roll={r.id}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs" style={r.rarity ? { color: RARITY_STYLE[r.rarity].color } : undefined}>
              {r.itemName}
            </span>
            <button className="text-[11px] text-marble-500 hover:text-gold-200" aria-label={`Dismiss result for ${r.itemName}`} onClick={() => setSeen([...seen, r.id])}>
              ✕
            </button>
          </div>
          <RollResults roll={r} nameOf={(id) => r.names?.[id] ?? id} />
        </div>
      ))}
    </aside>
  );
}

/** GM: start rolls from tray items, watch choices, resolve or cancel. */
export function GmLootRolls({ rolls, staged, players, serverTime, run, sceneId }: { rolls: LootRoll[]; staged: Item[]; players: Array<{ id: string; name: string }>; serverTime?: string; run: Run; sceneId?: string }) {
  const left = useCountdown(rolls, serverTime);
  const [pick, setPick] = useState<string[]>([]);
  const [who, setWho] = useState<string[]>(() => players.map((p) => p.id));
  const [minutes, setMinutes] = useState<number>(ROLL_MINUTES.default);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const valid = pick.filter((id) => staged.some((i) => i.id === id));
  const open = rolls.filter((r) => r.status === 'open');
  const done = rolls.filter((r) => r.status !== 'open').slice(-5).reverse();
  const go = async (cmd: Command) => {
    setBusy(true);
    try {
      return await run(cmd);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel space-y-2 p-3" aria-label="Party loot rolls">
      <h3 className="panel-title">Party loot · Need / Distribute / Pass</h3>
      <p className="text-xs text-marble-500">Put tray items up for a public roll. Need beats Distribute; each roller gets a server d100, ties are re-rolled. Unanswered choices count as Pass at the deadline.</p>
      <fieldset className="text-xs text-marble-300">
        <legend className="mb-1">Items from the tray</legend>
        {!staged.length && <p className="text-marble-500">The tray is empty.</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {staged.map((i) => (
            <label key={i.id} className="inline-flex items-center gap-1">
              <input type="checkbox" aria-label={`Roll for ${i.name}`} checked={valid.includes(i.id)} onChange={(e) => setPick(e.target.checked ? [...valid, i.id] : valid.filter((x) => x !== i.id))} />
              <ItemBadges item={i} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3 text-xs text-marble-300">
        <fieldset>
          <legend className="mb-1">Characters</legend>
          <div className="flex flex-wrap gap-x-3">
            {players.map((p) => (
              <label key={p.id} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={who.includes(p.id)} onChange={(e) => setWho(e.target.checked ? [...who, p.id] : who.filter((x) => x !== p.id))} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-0.5">
          Minutes
          <input className="w-16 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm" type="number" min={ROLL_MINUTES.min} max={ROLL_MINUTES.max} aria-label="Minutes to decide" value={minutes} onChange={(e) => setMinutes(Math.max(ROLL_MINUTES.min, Math.min(ROLL_MINUTES.max, Number(e.target.value) || ROLL_MINUTES.default)))} />
        </label>
        <button
          className="btn btn-gold"
          disabled={busy || !valid.length || !who.length}
          onClick={async () => {
            const r = await go({ type: 'lootRollStart', rollId: `roll${Date.now().toString(36)}`, stagedIds: valid, tokenIds: who, minutes, ...(sceneId ? { sceneId } : {}) });
            if (r.ok) setPick([]);
          }}
        >
          Start loot roll ({valid.length})
        </button>
      </div>
      {open.length > 0 && (
        <ul className="space-y-1.5" aria-label="Open loot rolls">
          {open.map((r) => {
            const secs = left(r);
            return (
              <li key={r.id} className="rounded border border-ink-700 bg-ink-900/50 p-2 text-xs" data-roll={r.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1" style={r.rarity ? { color: RARITY_STYLE[r.rarity].color } : undefined}>
                    {r.itemName}
                  </span>
                  <span className="tabular-nums text-marble-400">{secs > 0 ? `⏳ ${mmss(secs)}` : 'time is up'}</span>
                  <button className="btn btn-gold px-2 py-0.5" disabled={busy} onClick={() => void go({ type: 'lootRollResolve', rollId: r.id })}>
                    Resolve now
                  </button>
                  <button className="btn btn-ghost px-2 py-0.5" disabled={busy} onClick={() => void go({ type: 'lootRollCancel', rollId: r.id })}>
                    Cancel
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-marble-400">
                  {r.eligible.map((id) => `${nameOf(id)}: ${r.choices[id] ? CHOICE_LABEL[r.choices[id] as LootChoice] : '…'}`).join(' · ')}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {done.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-marble-400">Recent results</summary>
          <ul className="mt-1 space-y-1">
            {done.map((r) => (
              <li key={r.id} className="rounded border border-ink-800 p-1.5">
                <div className="text-marble-200">{r.itemName}</div>
                <RollResults roll={r} nameOf={nameOf} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
