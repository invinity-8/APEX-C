/**
 * Paper-doll equipment (APEX 0.5) – original APEX design.
 * Slots around an imperial silhouette; items are dragged from the "Carried" list onto a slot, or chosen with
 * the slot's click menu (keyboard/touch alternative). Two weapon sets, a Resting / Unarmored preset, and a
 * derived-stat panel that explains every step. All changes are server-validated commands.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Command } from '../game/commands';
import {
  DEFAULT_RESTING_KEEP,
  EQUIP_SLOTS,
  ITEM_KINDS,
  SLOT_LABEL,
  WEAPON_PROPERTIES,
  activeSlots,
  deriveStats,
  equipmentOf,
  fmt,
  slotAccepts,
  slotOfItem,
  suggestEquip,
  type Ability,
  type EquipSlot,
  type ItemEquip,
} from '../game/equipment';
import type { CharacterSheet } from '../game/sheet';
import type { Item } from '../game/types';
import type { TokenView } from '../game/visibility';
import type { DispatchResult, GameApi } from '../state/gameApi';

type Run = (cmd: Command) => Promise<DispatchResult>;
const input = 'w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const DND = 'application/x-apex-item';

export function useSheet(game: GameApi, tokenId: string | null): CharacterSheet | null {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const { sheets } = game;
  useEffect(() => {
    if (!tokenId) return setSheet(null);
    let live = true;
    void sheets.load(tokenId).then((r) => live && setSheet(r.ok ? r.sheet.sheet : null));
    return () => {
      live = false;
    };
  }, [tokenId, sheets]);
  return sheet;
}

function itemSummary(e: ItemEquip | undefined): string {
  if (!e) return 'properties not defined';
  if (e.kind === 'armor') return `${e.armorType ?? ''} armour · AC ${e.armorBase ?? '?'}`;
  if (e.kind === 'shield') return `shield · AC ${fmt(e.acBonus ?? 0)}`;
  if (e.kind === 'weapon') return `${e.damage ?? '?'} ${e.damageType ?? ''}${e.properties?.length ? ` · ${e.properties.join(', ')}` : ''}`;
  return `${e.kind}${e.acBonus ? ` · AC ${fmt(e.acBonus)}` : ''}${e.attackBonus ? ` · attack ${fmt(e.attackBonus)}` : ''}`;
}

export function EquipmentPanel({ game, token, run, isGm }: { game: GameApi; token: TokenView; run: Run; isGm: boolean }) {
  const sheet = useSheet(game, token.id);
  const inv = useMemo(() => token.details?.inventory ?? [], [token.details?.inventory]);
  const eq = equipmentOf({ equipment: token.details?.equipment });
  const items = useMemo(() => new Map(inv.map((i) => [i.id, i])), [inv]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [chooser, setChooser] = useState<EquipSlot | null>(null);
  const [over, setOver] = useState<EquipSlot | null>(null);
  const derived = sheet ? deriveStats(sheet, { inventory: inv, equipment: token.details?.equipment }) : null;
  const active = new Set(activeSlots(eq));
  if (!token.details) return <p className="text-xs text-marble-500">This equipment is not visible.</p>;

  const equip = (itemId: string, slot: EquipSlot) => void run({ type: 'equipItem', tokenId: token.id, itemId, slot });
  const carried = inv.filter((i) => !slotOfItem(eq, i.id));

  // A render FUNCTION, not a nested component: a nested component would re-mount on every hover re-render
  // and lose the drag-and-drop target.
  const renderSlot = (slot: EquipSlot, compact = false) => {
    const item = eq.slots[slot] ? items.get(eq.slots[slot]!) : undefined;
    const counts = active.has(slot);
    return (
      <div className="relative" key={slot}>
        <button
          type="button"
          data-slot={slot}
          aria-label={`${SLOT_LABEL[slot]}${slot.endsWith('2') && slot.startsWith('ring') ? ' 2' : ''}: ${item ? item.name : 'empty'}${!counts && item ? ' (not active)' : ''}`}
          className={`apex-slot ${item ? 'apex-slot-filled' : ''} ${!counts ? 'apex-slot-inactive' : ''} ${over === slot ? 'apex-slot-over' : ''} ${compact ? 'apex-slot-compact' : ''}`}
          onClick={() => setChooser(chooser === slot ? null : slot)}
          onDragOver={(e) => {
            const id = e.dataTransfer.types.includes(DND) ? 'x' : null;
            if (id) {
              e.preventDefault();
              setOver(slot);
            }
          }}
          onDragLeave={() => setOver((o) => (o === slot ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData(DND);
            if (id) equip(id, slot);
          }}
          draggable={!!item}
          onDragStart={(e) => item && e.dataTransfer.setData(DND, item.id)}
        >
          <span className="apex-slot-label">{SLOT_LABEL[slot]}</span>
          <span className="apex-slot-item">{item ? item.name.replace(/[[\]]/g, '') : '—'}</span>
          {item?.equip && <span className="apex-slot-meta">{itemSummary(item.equip)}</span>}
        </button>
        {chooser === slot && (
          <div role="menu" className="ws-menu left-0 right-auto w-64" onMouseLeave={() => setChooser(null)}>
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-marble-500">{SLOT_LABEL[slot]}</div>
            {inv
              .filter((i) => slotAccepts(slot, i.equip) && eq.slots[slot] !== i.id)
              .map((i) => (
                <button key={i.id} role="menuitem" className="ws-menu-item" onClick={() => (equip(i.id, slot), setChooser(null))}>
                  {i.name.replace(/[[\]]/g, '')} <span className="text-marble-500">· {itemSummary(i.equip)}</span>
                </button>
              ))}
            {item && (
              <button role="menuitem" className="ws-menu-item" onClick={() => (void run({ type: 'unequipSlot', tokenId: token.id, slot }), setChooser(null))}>
                ⤺ Unequip {item.name.replace(/[[\]]/g, '')}
              </button>
            )}
            {item && (
              <button role="menuitem" className="ws-menu-item" onClick={() => (setEditing(item), setChooser(null))}>
                ✎ Item properties…
              </button>
            )}
            {!inv.some((i) => slotAccepts(slot, i.equip)) && <div className="px-2 py-1 text-[11px] text-marble-500">No carried item fits. Define an item’s properties first.</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 text-xs" aria-label={`Equipment of ${token.name}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {([1, 2] as const).map((n) => (
          <button key={n} className={`btn ${eq.activeSet === n && !eq.resting ? 'btn-active' : 'btn-ghost'}`} aria-pressed={eq.activeSet === n} onClick={() => void run({ type: 'setWeaponSet', tokenId: token.id, set: n })}>
            ⚔ Weapon Set {n === 1 ? 'I' : 'II'}
          </button>
        ))}
        <button
          className={`btn ${eq.resting ? 'btn-active' : 'btn-ghost'}`}
          aria-pressed={eq.resting}
          title="Armour and selected equipment count as taken off. Does not heal or grant rest benefits."
          onClick={() => void run({ type: 'setResting', tokenId: token.id, resting: !eq.resting })}
        >
          ☾ Resting / Unarmored
        </button>
      </div>

      <div className="apex-doll">
        <div className="apex-doll-col">
          {renderSlot('head')}
          {renderSlot('amulet')}
          {renderSlot('cloak')}
          {renderSlot('chest')}
        </div>
        <div className="apex-doll-figure" aria-hidden>
          <ImperialSilhouette resting={eq.resting} />
        </div>
        <div className="apex-doll-col">
          {renderSlot('gloves')}
          {renderSlot('ring1')}
          {renderSlot('ring2')}
          {renderSlot('boots')}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([1, 2] as const).map((n) => (
          <div key={n} className={`rounded-lg border p-1.5 ${eq.activeSet === n ? 'border-gold-500/60 bg-gold-400/5' : 'border-ink-600 opacity-70'}`}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-marble-500">
              Set {n === 1 ? 'I' : 'II'} {eq.activeSet === n ? '· active' : ''}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {renderSlot(n === 1 ? 'main1' : 'main2', true)}
              {renderSlot(n === 1 ? 'off1' : 'off2', true)}
            </div>
          </div>
        ))}
      </div>

      {eq.resting && <RestingKeep keep={eq.restingKeep} onChange={(keep) => void run({ type: 'setResting', tokenId: token.id, resting: true, keep })} />}

      <DerivedPanel derived={derived} eq={eq} onConfig={(c) => void run({ type: 'setEquipConfig', tokenId: token.id, ...c })} />

      <section>
        <div className="label mb-1">Carried items – drag onto a slot, or use a slot’s menu</div>
        <ul className="space-y-1">
          {carried.map((i) => {
            const s = !i.equip ? suggestEquip(i.name) : null;
            return (
              <li
                key={i.id}
                draggable={!!i.equip}
                onDragStart={(e) => e.dataTransfer.setData(DND, i.id)}
                className={`flex items-center gap-2 rounded-md border border-ink-600 bg-ink-800/50 px-2 py-1 ${i.equip ? 'cursor-grab' : ''}`}
                data-carried={i.id}
              >
                <span className="min-w-0 flex-1 truncate text-marble-100">
                  {i.quantity !== 1 && <b className="mr-1 text-gold-200">{i.quantity}×</b>}
                  {i.name}
                  <span className="ml-1 text-marble-500">· {itemSummary(i.equip)}</span>
                </span>
                {s && (
                  <button className="text-[11px] text-gold-300 hover:underline" onClick={() => void run({ type: 'setItemEquip', tokenId: token.id, itemId: i.id, rev: i.rev ?? 0, equip: s.equip })}>
                    Use SRD “{s.preset}”
                  </button>
                )}
                <button className="text-[11px] text-marble-500 hover:text-gold-200" onClick={() => setEditing(i)}>
                  {i.equip ? 'Edit' : 'Define…'}
                </button>
              </li>
            );
          })}
          {!carried.length && <li className="text-marble-500">Everything is equipped.</li>}
        </ul>
      </section>
      {editing && <ItemEquipEditor item={editing} isGm={isGm} onClose={() => setEditing(null)} onSave={async (equip, gmLocked) => (await run({ type: 'setItemEquip', tokenId: token.id, itemId: editing.id, rev: editing.rev ?? 0, equip, ...(isGm ? { gmLocked } : {}) })).ok && setEditing(null)} />}
    </div>
  );
}

function RestingKeep({ keep, onChange }: { keep: EquipSlot[]; onChange: (k: EquipSlot[]) => void }) {
  const opts = EQUIP_SLOTS.filter((s) => !s.startsWith('main') && !s.startsWith('off'));
  return (
    <fieldset className="rounded-lg border border-ink-600 p-2">
      <legend className="px-1 text-[10px] uppercase tracking-wider text-marble-500">Kept on while resting</legend>
      <div className="flex flex-wrap gap-2">
        {opts.map((s) => (
          <label key={s} className="flex items-center gap-1 text-marble-300">
            <input type="checkbox" checked={keep.includes(s)} onChange={() => onChange(keep.includes(s) ? keep.filter((k) => k !== s) : [...keep, s])} />
            {SLOT_LABEL[s]}
            {s === 'ring2' ? ' 2' : ''}
          </label>
        ))}
        <button className="text-[11px] text-marble-500 hover:text-gold-200" onClick={() => onChange([...DEFAULT_RESTING_KEEP])}>
          default
        </button>
      </div>
    </fieldset>
  );
}

function DerivedPanel({ derived, eq, onConfig }: { derived: ReturnType<typeof deriveStats> | null; eq: ReturnType<typeof equipmentOf>; onConfig: (c: { unarmoredAbility?: Ability | null; acOther?: number; acOtherLabel?: string }) => void }) {
  const [open, setOpen] = useState(false);
  if (!derived) return <p className="text-marble-500">Load or import a character sheet to calculate Armor Class and attacks.</p>;
  const { ac } = derived;
  return (
    <section className="rounded-lg border border-gold-700/40 bg-ink-900/50 p-2" aria-label="Derived statistics">
      <div className="flex items-baseline gap-3">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-marble-500">Armor Class</div>
          <div className="font-display text-3xl font-black text-gold-200" data-testid="derived-ac">
            {ac.value ?? '—'}
          </div>
        </div>
        <div className="flex-1 text-[11px] text-marble-300">
          <Steps steps={ac.steps} total={ac.value} />
          {ac.source === 'derived' && ac.imported !== null && ac.imported !== ac.value && <p className="mt-1 text-amber-200">Imported sheet value: AC {ac.imported} (kept unchanged on the sheet).</p>}
          {ac.source === 'imported' && <p className="mt-1 text-marble-500">Define armour/shield properties and equip them to calculate AC from equipment.</p>}
          {ac.note && <p className="mt-1 text-amber-200">{ac.note}</p>}
        </div>
      </div>
      {derived.attacks.length > 0 && (
        <table className="mt-2 w-full text-[11px]">
          <thead className="text-marble-500">
            <tr>
              <th className="text-left font-normal">Attack (active set)</th>
              <th className="font-normal">To hit</th>
              <th className="text-left font-normal">Damage</th>
            </tr>
          </thead>
          <tbody>
            {derived.attacks.map((a) => (
              <tr key={a.slot} title={a.steps.map((s) => `${s.label} ${fmt(s.value)}`).join(' · ')}>
                <td className="text-marble-50">{a.name.replace(/[[\]]/g, '')}</td>
                <td className="text-center tabular-nums text-gold-200">{a.toHit === null ? '—' : fmt(a.toHit)}</td>
                <td className="text-marble-300">{a.damage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="mt-1 text-[11px] text-marble-500 hover:text-gold-200" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Manual AC modifiers
      </button>
      {open && (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className="text-marble-300">
            Unarmored defence adds
            <select className={input} value={eq.unarmoredAbility ?? ''} onChange={(e) => onConfig({ unarmoredAbility: (e.target.value || null) as Ability | null })}>
              <option value="">nothing</option>
              {(['con', 'wis', 'cha', 'int', 'str'] as Ability[]).map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()} modifier
                </option>
              ))}
            </select>
          </label>
          <label className="text-marble-300">
            Other AC modifier
            <input className={input} type="number" min={-10} max={10} defaultValue={eq.acOther ?? 0} onBlur={(e) => onConfig({ acOther: Math.max(-10, Math.min(10, Math.round(Number(e.target.value) || 0))) })} />
          </label>
          <label className="col-span-2 text-marble-300">
            Reason (e.g. “Shield of Faith”)
            <input className={input} maxLength={60} defaultValue={eq.acOtherLabel ?? ''} onBlur={(e) => onConfig({ acOtherLabel: e.target.value })} />
          </label>
        </div>
      )}
    </section>
  );
}

function Steps({ steps, total }: { steps: Array<{ label: string; value: number; op: string }>; total: number | null }): ReactNode {
  if (!steps.length) return null;
  return (
    <ol className="space-y-0.5" aria-label="Calculation">
      {steps.map((s, i) => (
        <li key={i} className="flex justify-between gap-2">
          <span>{s.label}</span>
          <span className="tabular-nums text-marble-100">{s.op === '=' ? s.value : fmt(s.value)}</span>
        </li>
      ))}
      <li className="flex justify-between gap-2 border-t border-ink-600 pt-0.5 font-semibold text-gold-200">
        <span>Final</span>
        <span className="tabular-nums">{total}</span>
      </li>
    </ol>
  );
}

function ItemEquipEditor({ item, isGm, onClose, onSave }: { item: Item; isGm: boolean; onClose: () => void; onSave: (e: ItemEquip | null, gmLocked: boolean) => void }) {
  const sug = suggestEquip(item.name);
  const [e, setE] = useState<ItemEquip>(item.equip ?? sug?.equip ?? { kind: 'weapon' });
  const [locked, setLocked] = useState(!!item.equip?.gmLocked);
  const readOnly = !!item.equip?.gmLocked && !isGm;
  const set = (patch: Partial<ItemEquip>) => setE((x) => ({ ...x, ...patch }));
  const numIn = (label: string, key: 'armorBase' | 'acBonus' | 'attackBonus', min: number, max: number) => (
    <label className="text-marble-300">
      {label}
      <input className={input} type="number" min={min} max={max} value={e[key] ?? ''} onChange={(ev) => set({ [key]: ev.target.value === '' ? undefined : Math.max(min, Math.min(max, Math.round(Number(ev.target.value)))) })} />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Equipment properties of ${item.name}`}>
      <div className="panel w-full max-w-md space-y-2 p-4 text-xs">
        <h2 className="font-display text-lg font-bold text-gold-200">{item.name}</h2>
        <p className="text-marble-500">Define what this item does. APEX never invents rules for unknown items.{readOnly ? ' The GM has locked these properties.' : ''}</p>
        {sug && !readOnly && (
          <button className="btn btn-ghost" onClick={() => setE(structuredClone(sug.equip))}>
            Fill from SRD “{sug.preset}”
          </button>
        )}
        <fieldset disabled={readOnly} className="grid grid-cols-2 gap-2">
          <label className="col-span-2 text-marble-300">
            Kind
            <select className={input} value={e.kind} onChange={(ev) => setE({ kind: ev.target.value as ItemEquip['kind'] })}>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {e.kind === 'armor' && (
            <>
              <label className="text-marble-300">
                Armour type
                <select className={input} value={e.armorType ?? 'light'} onChange={(ev) => set({ armorType: ev.target.value as ItemEquip['armorType'] })}>
                  <option value="light">light (full DEX)</option>
                  <option value="medium">medium (DEX max +2)</option>
                  <option value="heavy">heavy (no DEX)</option>
                </select>
              </label>
              {numIn('Base AC', 'armorBase', 0, 30)}
            </>
          )}
          {e.kind === 'weapon' && (
            <>
              <label className="text-marble-300">
                Damage dice
                <input className={input} placeholder="1d8" value={e.damage ?? ''} onChange={(ev) => set({ damage: ev.target.value })} />
              </label>
              <label className="text-marble-300">
                Damage type
                <input className={input} placeholder="slashing" value={e.damageType ?? ''} onChange={(ev) => set({ damageType: ev.target.value })} />
              </label>
              {numIn('Attack/damage bonus', 'attackBonus', -10, 10)}
              <label className="flex items-center gap-2 self-end text-marble-300">
                <input type="checkbox" checked={e.proficient !== false} onChange={(ev) => set({ proficient: ev.target.checked })} /> Proficient
              </label>
              <div className="col-span-2 flex flex-wrap gap-2">
                {WEAPON_PROPERTIES.map((p) => (
                  <label key={p} className="flex items-center gap-1 text-marble-300">
                    <input
                      type="checkbox"
                      checked={!!e.properties?.includes(p)}
                      onChange={() => set({ properties: e.properties?.includes(p) ? e.properties.filter((x) => x !== p) : [...(e.properties ?? []), p] })}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </>
          )}
          {e.kind !== 'weapon' && numIn(e.kind === 'shield' ? 'Shield AC bonus' : 'AC bonus (optional)', 'acBonus', -10, 10)}
          {e.kind !== 'weapon' && e.kind !== 'armor' && e.kind !== 'shield' && numIn('Attack bonus (optional)', 'attackBonus', -10, 10)}
        </fieldset>
        {isGm && (
          <label className="flex items-center gap-2 text-marble-300">
            <input type="checkbox" checked={locked} onChange={(ev) => setLocked(ev.target.checked)} /> Lock properties (only the GM can change them)
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {item.equip && !readOnly && (
            <button className="btn btn-danger" onClick={() => onSave(null, false)}>
              Clear properties
            </button>
          )}
          {!readOnly && (
            <button className="btn btn-gold ml-auto" onClick={() => onSave(e, locked)}>
              Save properties
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Original APEX figure: a legionary-like silhouette with a crested helm (not based on any existing artwork). */
function ImperialSilhouette({ resting }: { resting: boolean }) {
  return (
    <svg viewBox="0 0 120 240" className="h-full w-full">
      <defs>
        <linearGradient id="apex-doll-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c09b58" stopOpacity=".35" />
          <stop offset="1" stopColor="#8c806a" stopOpacity=".12" />
        </linearGradient>
      </defs>
      <g fill="url(#apex-doll-g)" stroke="#c09b58" strokeOpacity=".55" strokeWidth="1.2">
        {!resting && <path d="M46 14 Q60 -2 74 14 L72 18 Q60 10 48 18 Z" fill="#8e2f2f" fillOpacity=".6" />}
        <ellipse cx="60" cy="30" rx="13" ry="15" />
        <path d="M50 46 L70 46 L74 54 L92 62 L98 112 L88 114 L82 76 L80 120 L86 168 L78 232 L66 232 L62 174 L58 174 L54 232 L42 232 L34 168 L40 120 L38 76 L32 114 L22 112 L28 62 L46 54 Z" />
        {!resting && <path d="M40 66 L80 66 L82 112 L60 120 L38 112 Z" fill="#c09b58" fillOpacity=".18" />}
        {!resting && <path d="M38 120 L82 120 L84 134 L36 134 Z" fill="#8e2f2f" fillOpacity=".45" />}
      </g>
      <path d="M60 140 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0" fill="none" stroke="#c09b58" strokeOpacity=".25" />
    </svg>
  );
}
