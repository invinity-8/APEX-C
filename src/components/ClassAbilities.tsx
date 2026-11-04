/**
 * Class abilities & hit points (APEX 0.7) – shown on the character sheet for the owner and the GM.
 *  - Sneak (every player character): custom APEX movement rule, game state;
 *  - Damage / Healing / Temporary HP (temporary HP absorb damage first and never stack);
 *  - Wild Shape (druid level ≥ 2, SRD 5.1) with a searchable beast catalogue, per-form pictures, revert;
 *  - Font of Magic (sorcerer level ≥ 2, SRD 5.1) with the exact conversion table.
 * Every rule is validated by the server (`/api/apex?op=sheet`, version-checked); this component only asks.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { classLevel, formAllowed, SLOT_COST, sorceryPointsMax, SORCERY_RESOURCE, WILD_SHAPE_RESOURCE, wildShapeLimits, wildShapeView } from '../game/abilities';
import { beastsFor, findBeast } from '../game/beastCatalog';
import { crLabel, speedLabel, SRD_BEAST_ATTRIBUTION, type BeastForm } from '../game/beasts';
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
  run,
  notify,
}: {
  game: GameApi;
  token: TokenView;
  data: SheetPayload | null;
  onSheet: (p: SheetPayload) => void;
  run: (cmd: Command) => Promise<DispatchResult>;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'wild' | 'sorcery' | null>(null);
  const sheet = data?.sheet;
  const druid = sheet ? classLevel(sheet, 'druid') : null;
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
        {token.kind === 'player' && token.details && (
          <button
            className={`btn ${sneaking ? 'btn-active' : 'btn-ghost'}`}
            aria-pressed={sneaking}
            title="APEX rule: each step costs double movement points. Sneaking is not invisibility – avoiding notice still needs a Stealth check."
            onClick={() => void run({ type: 'setSneak', tokenId: token.id, on: !sneaking })}
          >
            🥷 Sneak{sneaking ? ': on' : ''}
          </button>
        )}
        {druid !== null && druid >= 2 && !ws && (
          <button className="btn btn-gold" onClick={() => setOpen(open === 'wild' ? null : 'wild')} aria-expanded={open === 'wild'}>
            🐾 Wild Shape
          </button>
        )}
        {spMax !== null && (
          <button className="btn btn-ghost" onClick={() => setOpen(open === 'sorcery' ? null : 'sorcery')} aria-expanded={open === 'sorcery'}>
            ✦ Font of Magic
          </button>
        )}
      </div>
      {sneaking && <p className="text-[11px] text-marble-400" data-testid="sneak-note">Sneaking: half speed (each step costs double movement points). Not invisible – the GM may call for a Stealth check.</p>}
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
            <button className="btn btn-ghost px-2 py-0.5" disabled={busy} onClick={() => void ability({ action: 'revert' })}>
              Revert to normal form
            </button>
          </div>
          {form && sheet && <BeastStats form={form} view={wildShapeView(sheet, form)} />}
        </div>
      )}
      {open === 'wild' && sheet && druid !== null && !ws && (
        <WildShapePicker
          game={game}
          token={token}
          druidLevel={druid}
          uses={sheet.resources.find((r) => r.name.toLowerCase() === WILD_SHAPE_RESOURCE.toLowerCase())}
          busy={busy}
          onTransform={async (id) => (await ability({ action: 'wildShape', formId: id })) && setOpen(null)}
        />
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

function WildShapePicker({ game, token, druidLevel, uses, busy, onTransform }: { game: GameApi; token: TokenView; druidLevel: number; uses?: { current: number; max: number | null }; busy: boolean; onTransform: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const limits = wildShapeLimits(druidLevel)!;
  const forms = useMemo(() => beastsFor(game.view.customBeasts).filter((b) => !q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())), [game.view.customBeasts, q]);
  const picked = forms.find((f) => f.id === sel);
  const upload = async (file: File | undefined) => {
    if (!file || !picked || !game.uploadBeastImage) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 1_500_000) return;
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(file);
    });
    await game.uploadBeastImage(token.id, picked.id, data);
  };
  return (
    <div className="space-y-2 rounded-lg border border-gold-700/40 bg-ink-900/60 p-2 text-xs" aria-label="Wild Shape forms">
      <p className="text-marble-300">
        Druid level {druidLevel}: CR ≤ {crLabel(limits.maxCr)}
        {!limits.swim ? ', no swimming speed' : ''}
        {!limits.fly ? ', no flying speed' : ''} · up to {limits.hours} hour{limits.hours === 1 ? '' : 's'} · uses left: {uses ? `${uses.current}/${uses.max ?? '–'}` : '2/2 (tracked as “Wild Shape”)'}
      </p>
      <input className={`${input} w-full`} placeholder="Search forms…" aria-label="Search beast forms" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid gap-2 md:grid-cols-[1fr_1.3fr]">
        <ul className="max-h-64 overflow-y-auto rounded-md border border-ink-700" role="listbox" aria-label="Beast forms">
          {forms.map((f) => {
            const why = formAllowed(f, druidLevel);
            return (
              <li key={f.id}>
                <button role="option" aria-selected={sel === f.id} className={`flex w-full items-center gap-2 px-2 py-1 text-left ${sel === f.id ? 'bg-gold-400/15' : 'hover:bg-ink-800'} ${why ? 'opacity-50' : ''}`} onClick={() => setSel(f.id)}>
                  <span className="flex-1 text-marble-100">{f.name}</span>
                  <span className="text-marble-500">CR {crLabel(f.cr)}</span>
                  {f.source === 'GM' && <span className="text-[10px] text-arcane-300">GM</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {picked ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <BeastPicture game={game} token={token} formId={picked.id} size={52} />
              <div>
                <b className="text-sm text-marble-50">{picked.name}</b>
                <div className="text-marble-400">
                  CR {crLabel(picked.cr)} · AC {picked.ac} · {picked.hp} HP ({picked.hitDice})
                </div>
              </div>
            </div>
            <p className="text-marble-300">Speed {speedLabel(picked.speed)} · {picked.senses}</p>
            <p className="text-marble-300">
              STR {picked.str} · DEX {picked.dex} · CON {picked.con} (yours: INT, WIS, CHA){picked.skills ? ` · ${picked.skills}` : ''}
            </p>
            <ul className="text-marble-300">
              {picked.attacks.map((a) => (
                <li key={a.name}>
                  <b>{a.name}</b> {fmtMod(a.toHit)} · {a.damage}
                  {a.notes ? ` · ${a.notes}` : ''}
                </li>
              ))}
            </ul>
            {picked.traits.length > 0 && <p className="text-marble-400">{picked.traits.join(' ')}</p>}
            {game.uploadBeastImage && (
              <label className="block text-marble-400">
                Your picture for this form (PNG/JPG/WebP, max. 1.5 MB):
                <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block text-[11px]" aria-label="Beast picture" onChange={(e) => void upload(e.target.files?.[0])} />
              </label>
            )}
            {formAllowed(picked, druidLevel) ? (
              <p className="text-amber-200">{formAllowed(picked, druidLevel)}</p>
            ) : (
              <button className="btn btn-gold" disabled={busy || (uses !== undefined && uses.current < 1)} onClick={() => onTransform(picked.id)}>
                Transform into {picked.name}
              </button>
            )}
          </div>
        ) : (
          <p className="text-marble-500">Choose a form to see its statistics.</p>
        )}
      </div>
      <p className="text-[10px] text-marble-600">{SRD_BEAST_ATTRIBUTION}</p>
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
