/**
 * Class abilities & hit points (APEX 0.7) – shown on the character sheet for the owner and the GM.
 *  - Damage / Healing / Temporary HP (temporary HP absorb damage first and never stack);
 *  - Wild Shape status (druid level ≥ 2, SRD 5.1); since APEX 2.4 Sneak and Wild Shape are used only in the Game tab;
 *  - Font of Magic (sorcerer level ≥ 2, SRD 5.1) with the exact conversion table.
 * Every rule is validated by the server (`/api/apex?op=sheet`, version-checked); this component only asks.
 */
import { useState, type FormEvent } from 'react';
import { wildShapeLevel, SLOT_COST, sorceryPointsMax, SORCERY_RESOURCE, wildShapeView } from '../game/abilities';
import { findBeast } from '../game/beastCatalog';
import { speedLabel, type BeastForm } from '../game/beasts';
import type { Command } from '../game/commands';
import { SLOT_RE } from '../game/resources';
import type { TokenView } from '../game/visibility';
import type { SheetPayload } from '../server/protocol';
import type { DispatchResult, GameApi } from '../state/gameApi';

const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function ClassAbilities({
  game,
  token,
  data,
  onSheet,
  notify,
}: {
  game: GameApi;
  token: TokenView;
  data: SheetPayload | null;
  onSheet: (p: SheetPayload) => void;
  /** unused since APEX 2.4 (scene actions moved to the Game tab) */
  run?: (cmd: Command) => Promise<DispatchResult>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'sorcery' | null>(null);
  const sheet = data?.sheet;
  const druid = sheet ? wildShapeLevel(sheet) : null;
  const spMax = sheet ? sorceryPointsMax(sheet) : null;
  const ability = async (body: Record<string, unknown>) => {
    if (!data) return false;
    setBusy(true);
    try {
      const r = await game.sheets.ability(token.id, { ...body, expectedVersion: data.version });
      if (r.ok) {
        onSheet(r.sheet);
        if (r.sheet.message) notify(r.sheet.message, 'info');
        return true;
      }
      if (r.conflict) onSheet(r.conflict);
      notify(r.error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const sneaking = !!token.details?.sneaking;
  const ws = sheet?.wildShape;
  const form = ws ? findBeast(game.view.customBeasts, ws.formId) : undefined;

  return (
    <section className="panel space-y-2 p-3" aria-label="Class abilities">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="panel-title mr-2">Actions</h3>
        {spMax !== null && (
          <button className="btn btn-ghost" onClick={() => setOpen(open === 'sorcery' ? null : 'sorcery')} aria-expanded={open === 'sorcery'}>
            ✦ Font of Magic
          </button>
        )}
      </div>
      {(sneaking || (druid !== null && druid >= 2)) && <p className="text-[11px] text-marble-400" data-testid="sneak-note">{sneaking ? '🥷 Sneaking (half speed). ' : ''}Sneak, Wild Shape and other scene actions are used in the Game tab, on the battle map.</p>}
      {sheet?.hitPoints && <HitPointControls busy={busy} onAction={ability} temp={sheet.hitPoints.temp} />}
      {ws && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-900/20 p-2 text-xs" data-testid="wild-shape-active">
          <div className="flex flex-wrap items-center gap-2">
            <BeastPicture game={game} token={token} formId={ws.formId} size={44} />
            <b className="text-emerald-200">
              Wild Shape: {ws.formName} · {ws.hp}/{ws.maxHp} HP
            </b>
            <span className="text-marble-400">
              Own HP {sheet!.hitPoints?.current}/{sheet!.hitPoints?.max} kept · equipment merged into the form · no spellcasting{druid !== null && druid >= 18 ? ' (except Beast Spells)' : ''}
            </span>
            <span className="flex-1" />
            <span className="text-marble-500">revert in the Game tab</span>
          </div>
          {form && sheet && <BeastStats form={form} view={wildShapeView(sheet, form)} />}
        </div>
      )}
      {open === 'sorcery' && sheet && spMax !== null && <FontOfMagic sheet={sheet} spMax={spMax} busy={busy} onConvert={(direction, level) => void ability({ action: 'sorcery', direction, level })} />}
    </section>
  );
}

function HitPointControls({ busy, temp, onAction }: { busy: boolean; temp: number; onAction: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [n, setN] = useState(1);
  const go = (e: FormEvent, action: string, extra: Record<string, unknown> = {}) => {
    e.preventDefault();
    void onAction({ action, amount: n, ...extra });
  };
  return (
    <form className="flex flex-wrap items-center gap-1.5 text-xs text-marble-300" aria-label="Hit points" onSubmit={(e) => go(e, 'damage')}>
      <label>
        Amount{' '}
        <input className={`${input} w-16 py-0.5`} type="number" min={0} max={1000} value={n} onChange={(e) => setN(Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))))} aria-label="HP amount" />
      </label>
      <button className="btn btn-ghost px-2 py-0.5" disabled={busy} type="submit">
        Damage
      </button>
      <button className="btn btn-ghost px-2 py-0.5" disabled={busy} type="button" onClick={(e) => go(e, 'heal')}>
        Heal
      </button>
      <span className="mx-1 h-4 w-px bg-ink-600" />
      <span className="text-[#6fb1e0]">Temporary HP {temp}</span>
      <button className="btn btn-ghost px-2 py-0.5" disabled={busy} type="button" title="Keeps the higher value – temporary HP never stack" onClick={(e) => go(e, 'tempHp', { mode: 'grant' })}>
        Grant temp
      </button>
      <button className="btn btn-ghost px-2 py-0.5" disabled={busy} type="button" onClick={(e) => go(e, 'tempHp', { mode: 'replace' })}>
        Replace
      </button>
      <button className="btn btn-ghost px-2 py-0.5" disabled={busy || !temp} type="button" onClick={(e) => go(e, 'tempHp', { mode: 'remove' })}>
        Remove
      </button>
    </form>
  );
}

function BeastPicture({ game, token, formId, size }: { game: GameApi; token: TokenView; formId: string; size: number }) {
  const v = token.details?.beastImageV?.[formId];
  if (!v || game.mode !== 'online') {
    return (
      <span className="grid shrink-0 place-items-center rounded-full border border-emerald-500/40 bg-ink-800 text-emerald-200" style={{ width: size, height: size }} aria-hidden>
        🐾
      </span>
    );
  }
  return <img src={`/api/apex?op=beast-image&token=${encodeURIComponent(token.id)}&form=${encodeURIComponent(formId)}&v=${v}`} alt="" width={size} height={size} className="shrink-0 rounded-full border border-emerald-500/50 object-cover" style={{ width: size, height: size }} data-testid="beast-picture" />;
}

function BeastStats({ form, view }: { form: BeastForm; view: ReturnType<typeof wildShapeView> }) {
  const order = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
  return (
    <div className="mt-2 space-y-1 text-[11px] text-marble-300" data-testid="beast-stats">
      <p>
        AC {view.ac} · {speedLabel(view.speed)} · {view.senses}
      </p>
      <div className="grid grid-cols-6 gap-1 text-center">
        {order.map((a) => (
          <div key={a} className={`rounded border px-1 py-0.5 ${a === 'int' || a === 'wis' || a === 'cha' ? 'border-gold-600/50' : 'border-ink-600'}`} data-score={a}>
            <div className="text-[9px] uppercase text-marble-500">{a}</div>
            <div className="font-semibold text-marble-50">{view.scores[a]}</div>
            <div className="text-[10px]">
              {fmtMod(view.mods[a])} · save {fmtMod(view.saves[a])}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-marble-500">Gold boxes: your own Intelligence, Wisdom and Charisma. Saves use your proficiencies; if the beast&apos;s bonus is higher, use the beast&apos;s.</p>
      <ul>
        {form.attacks.map((a) => (
          <li key={a.name}>
            <b className="text-marble-100">{a.name}</b> {fmtMod(a.toHit)} to hit · {a.damage}
            {a.notes ? ` · ${a.notes}` : ''}
          </li>
        ))}
      </ul>
      {form.traits.length > 0 && <p className="text-marble-400">{form.traits.join(' ')}</p>}
    </div>
  );
}

function FontOfMagic({ sheet, spMax, busy, onConvert }: { sheet: SheetPayload['sheet']; spMax: number; busy: boolean; onConvert: (d: 'toSlot' | 'toPoints', level: number) => void }) {
  const sp = sheet.resources.find((r) => r.name.toLowerCase() === SORCERY_RESOURCE.toLowerCase());
  const points = sp?.current ?? spMax;
  const slot = (l: number) => sheet.resources.find((r) => SLOT_RE.exec(r.name.trim())?.[1] === String(l));
  return (
    <div className="space-y-1 rounded-lg border border-arcane-400/40 bg-ink-900/60 p-2 text-xs" aria-label="Font of Magic">
      <p className="text-marble-300">
        Sorcery Points <b className="text-arcane-300" data-testid="sorcery-points">{points}/{spMax}</b>
        {!sp && ' (created at the maximum on first use)'} · created slots are extra and vanish on a long rest.
      </p>
      <table className="w-full text-left">
        <thead className="text-marble-500">
          <tr>
            <th className="font-normal">Slot</th>
            <th className="font-normal">You have</th>
            <th className="font-normal">Create (cost)</th>
            <th className="font-normal">Convert (gain)</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5].map((l) => {
            const s = slot(l);
            const cost = SLOT_COST[l];
            return (
              <tr key={l} className="border-t border-ink-800" data-sorcery-level={l}>
                <td>Level {l}</td>
                <td className="tabular-nums">{s ? `${s.current}/${s.max ?? '–'}` : '—'}</td>
                <td>
                  <button className="btn btn-ghost px-2 py-0.5" disabled={busy || points < cost} onClick={() => onConvert('toSlot', l)} aria-label={`Create a level ${l} slot for ${cost} sorcery points`}>
                    {points} → {points - cost} SP ({cost})
                  </button>
                </td>
                <td>
                  <button className="btn btn-ghost px-2 py-0.5" disabled={busy || !s || s.current < 1 || points + l > spMax} onClick={() => onConvert('toPoints', l)} aria-label={`Convert a level ${l} slot into ${l} sorcery points`}>
                    {points} → {points + l} SP (+{l})
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
