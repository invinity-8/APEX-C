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
  type BonusLine,
  type EquipSlot,
  type ItemBonuses,
  type ItemEquip,
} from '../game/equipment';
import { ELEMENTS } from '../game/items/modifiers';
import { formatReduction, resistanceLabel } from '../game/items/resistance';
import type { CharacterSheet } from '../game/sheet';
import type { BodyType, Item } from '../game/types';
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
  const derived = sheet ? deriveStats(sheet, { inventory: inv, equipment: token.details?.equipment }, game.view.itemRules) : null;
  const active = new Set(activeSlots(eq));
  if (!token.details) return <p className="text-xs text-marble-500">This equipment is not visible.</p>;

  const equip = (itemId: string, slot: EquipSlot) => void run({ type: 'equipItem', tokenId: token.id, itemId, slot });
  const carried = inv.filter((i) => !slotOfItem(eq, i.id));
  const wornKind = (sl: EquipSlot) => (active.has(sl) && eq.slots[sl] ? items.get(eq.slots[sl]!)?.equip?.kind : undefined);
  const set = eq.activeSet;
  const worn: Worn = {
    head: !!wornKind('head'),
    cloak: !!wornKind('cloak'),
    chest: !!wornKind('chest'),
    gloves: !!wornKind('gloves'),
    boots: !!wornKind('boots'),
    amulet: !!wornKind('amulet'),
    rings: !!(wornKind('ring1') || wornKind('ring2')),
    main: !!wornKind(set === 1 ? 'main1' : 'main2'),
    shield: wornKind(set === 1 ? 'off1' : 'off2') === 'shield',
    offWeapon: !!wornKind(set === 1 ? 'off1' : 'off2') && wornKind(set === 1 ? 'off1' : 'off2') !== 'shield',
  };

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
          title={item ? `${item.name.replace(/[[\]]/g, '')} – ${itemSummary(item.equip)}${item.description ? `\n${item.description}` : ''}${!counts ? '\n(not active: other weapon set or resting)' : ''}` : `${SLOT_LABEL[slot]}: drop or choose an item`}
        >
          <span className="apex-slot-label">
            <SlotIcon slot={slot} /> {SLOT_LABEL[slot]}
          </span>
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
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-marble-400" title="Cosmetic only – no effect on attributes, slots or rules">
          Silhouette
          <select
            className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] text-marble-100"
            aria-label="Body type"
            value={token.details?.bodyType ?? 'masculine'}
            onChange={(e) => void run({ type: 'setAppearance', tokenId: token.id, bodyType: e.target.value as BodyType })}
          >
            <option value="masculine">Masculine-presenting</option>
            <option value="feminine">Feminine-presenting</option>
          </select>
        </label>
      </div>

      {sheet?.wildShape && (
        <p role="status" className="rounded-md border border-emerald-500/50 bg-emerald-900/20 p-2 text-emerald-200" data-testid="wild-shape-equipment">
          🐾 Wild Shape ({sheet.wildShape.formName}): your equipment has merged into the beast form and has no effect until you revert. Nothing leaves the inventory.
        </p>
      )}
      <div className="apex-doll">
        <div className="apex-doll-col">
          {renderSlot('head')}
          {renderSlot('amulet')}
          {renderSlot('cloak')}
          {renderSlot('chest')}
        </div>
        <div className="apex-doll-figure">
          <HeroFigure worn={worn} body={token.details?.bodyType} />
        </div>
        <div className="apex-doll-col">
          {renderSlot('gloves')}
          {renderSlot('ring1')}
          {renderSlot('ring2')}
          {renderSlot('belt')}
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

      <DerivedPanel derived={derived} eq={eq} onConfig={isGm ? (c) => void run({ type: 'setEquipConfig', tokenId: token.id, ...c }) : undefined} />

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
                {s && isGm && (
                  <button className="text-[11px] text-gold-300 hover:underline" onClick={() => void run({ type: 'setItemEquip', tokenId: token.id, itemId: i.id, rev: i.rev ?? 0, equip: s.equip })}>
                    Use SRD “{s.preset}”
                  </button>
                )}
                {isGm && <button className="text-[11px] text-marble-500 hover:text-gold-200" onClick={() => setEditing(i)}>
                  {i.equip ? 'Edit' : 'Define…'}
                </button>}
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

/** Character-wide bonuses from equipped item modifiers (active set only), each with its sources and cap. */
function BonusSummary({ b }: { b: ItemBonuses }) {
  const rows: Array<{ key: string; label: string; detail: string; title: string }> = [];
  const tip = (l: BonusLine) => l.steps.map((s) => (s.op === 'cap' ? s.label : `${s.label} +${s.value}`)).join(' · ');
  for (const el of ELEMENTS) {
    const r = b.resistances[el];
    if (r.total) rows.push({ key: `res-${el}`, label: resistanceLabel(el, r.total, r.cap).split(':')[0], detail: `${r.total} points${r.total > r.value ? ` (capped at ${r.cap})` : ''} · ${formatReduction(r.reduction)} damage reduction`, title: tip(r) });
  }
  const simple: Array<[string, BonusLine, string]> = [
    ['Max HP', b.maxHp, ''],
    ['Initiative', b.initiative, ''],
    ['Walking speed', b.speed, ' ft'],
    ['Carrying capacity', b.carry, ' lb'],
  ];
  for (const [label, l, unit] of simple) if (l.total) rows.push({ key: label, label, detail: `+${l.value}${unit}${l.total > l.value ? ` (capped, ${l.total} total)` : ''}`, title: tip(l) });
  for (const [a, l] of Object.entries(b.saves)) if (l?.total) rows.push({ key: `save-${a}`, label: `${a.toUpperCase()} saves`, detail: `+${l.value}${l.total > l.value ? ' (capped)' : ''}`, title: tip(l) });
  for (const [label, l] of [['Spell attack', b.spellAttack], ['Spell save DC', b.spellDc]] as const) if (l.total) rows.push({ key: label, label, detail: `+${l.value}${l.total > l.value ? ` (capped, ${l.total} total)` : ''}`, title: tip(l) });
  for (const [a, l] of Object.entries(b.abilities)) if (l?.total) rows.push({ key: `attr-${a}`, label: a.toUpperCase(), detail: `+${l.value}${l.total > l.value ? ' (capped)' : ''} · never above 20 from items`, title: tip(l) });
  if (b.thorns.total) rows.push({ key: 'thorns', label: 'Thorns', detail: `${b.thorns.value} piercing${b.thorns.total > b.thorns.value ? ' (capped)' : ''} · melee hit within 5 ft, once per turn`, title: tip(b.thorns) });
  for (const [s, l] of Object.entries(b.skills)) if (l.total) rows.push({ key: `skill-${s}`, label: s, detail: `+${l.value}${l.total > l.value ? ' (capped)' : ''}`, title: tip(l) });
  if (!rows.length) return null;
  return (
    <div className="mt-2 border-t border-gold-700/20 pt-1 text-[11px]" aria-label="Item modifier bonuses">
      <div className="text-[10px] uppercase tracking-wider text-marble-500">From equipped modifiers</div>
      <ul>
        {rows.map((r) => (
          <li key={r.key} className="flex justify-between gap-2" title={r.title}>
            <span className="text-marble-300">{r.label}</span>
            <span className="tabular-nums text-gold-200">{r.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DerivedPanel({ derived, eq, onConfig }: { derived: ReturnType<typeof deriveStats> | null; eq: ReturnType<typeof equipmentOf>; onConfig?: (c: { unarmoredAbility?: Ability | null; acOther?: number; acOtherLabel?: string }) => void }) {
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
                <td className="text-marble-300">
                  {a.damage}
                  {a.extra.length > 0 && <span className="block text-[10px] text-marble-500">{a.extra.join(' · ')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <BonusSummary b={derived.bonuses} />
      {onConfig && <button className="mt-1 text-[11px] text-marble-500 hover:text-gold-200" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Manual AC modifiers
      </button>}
      {open && onConfig && (
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

export type Worn = Partial<Record<'head' | 'cloak' | 'chest' | 'gloves' | 'boots' | 'amulet' | 'rings' | 'main' | 'shield' | 'offWeapon', boolean>>;

/**
 * Equipment figure (APEX 0.6): a neutral, well-proportioned silhouette (≈ 7.5 heads tall) with layered
 * equipment overlays that appear only for what is actually worn in the active set / preset. Original artwork.
 */
function HeroFigure({ worn, body = 'masculine' }: { worn: Worn; body?: BodyType }) {
  const gold = '#c09b58';
  return (
    <svg viewBox="0 0 160 320" className="h-full w-full" role="img" aria-label={`Figure wearing: ${Object.entries(worn).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing'}`}>
      <defs>
        <linearGradient id="hf-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4e565d" />
          <stop offset="1" stopColor="#2c3237" />
        </linearGradient>
        <linearGradient id="hf-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bcb29e" />
          <stop offset="1" stopColor="#6f675a" />
        </linearGradient>
        <linearGradient id="hf-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8d4a6" />
          <stop offset="1" stopColor="#a2803f" />
        </linearGradient>
        <radialGradient id="hf-halo" cx=".5" cy=".42" r=".55">
          <stop offset="0" stopColor={gold} stopOpacity=".16" />
          <stop offset="1" stopColor={gold} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="80" cy="150" rx="78" ry="150" fill="url(#hf-halo)" />
      <ellipse cx="80" cy="308" rx="44" ry="7" fill="#000" opacity=".35" />
      {worn.cloak && <path data-layer="cloak" d="M50 72 Q80 64 110 72 L122 250 Q80 268 38 250 Z" fill="#8e2f2f" stroke="#5a1d1d" strokeWidth="1.2" />}
      {/* body – APEX 0.7: two cosmetic silhouettes sharing the same slot anchors, so every overlay fits both */}
      {body === 'feminine' && !worn.head && <path data-layer="hair" d="M63 36 Q62 18 80 18 Q98 18 97 36 L100 70 Q92 64 89 52 L71 52 Q68 64 60 70 Z" fill="#3a2c22" stroke="#22190f" strokeWidth="1" />}
      <g fill="url(#hf-body)" stroke="#8c806a" strokeOpacity=".55" strokeWidth="1" data-body={body}>
        <circle cx="80" cy="38" r={body === 'feminine' ? 15 : 16} />
        <path d={body === 'feminine' ? 'M74 52 h12 v10 h-12 z' : 'M73 52 h14 v10 h-14 z'} />
        {body === 'feminine' ? (
          <>
            <path d="M54 70 Q80 62 106 70 L108 96 Q101 120 97 134 Q104 150 104 166 L56 166 Q56 150 63 134 Q59 120 52 96 Z" />
            <path d="M54 72 Q44 76 42 96 L38 150 Q37 168 41 178 L47 178 L48 150 L55 104 Z" />
            <path d="M106 72 Q116 76 118 96 L122 150 Q123 168 119 178 L113 178 L112 150 L105 104 Z" />
            <path d="M57 164 L103 164 L101 226 L95 298 L84 298 L81 214 L79 214 L76 298 L65 298 L59 226 Z" />
          </>
        ) : (
          <>
            <path d="M50 70 Q80 60 110 70 L114 100 Q108 132 100 156 L102 168 L58 168 L60 156 Q52 132 46 100 Z" />
            <path d="M50 72 Q40 76 38 96 L34 150 Q33 168 38 178 L45 178 L46 150 L52 104 Z" />
            <path d="M110 72 Q120 76 122 96 L126 150 Q127 168 122 178 L115 178 L114 150 L108 104 Z" />
            <path d="M58 166 L102 166 L100 226 L96 298 L84 298 L81 214 L79 214 L76 298 L64 298 L60 226 Z" />
          </>
        )}
      </g>
      {worn.boots && <path data-layer="boots" d="M62 262 L77 262 L77 300 L58 302 Q57 296 62 292 Z M83 262 L98 262 L98 292 Q103 296 102 302 L83 300 Z" fill="#4a3926" stroke="#2b2118" strokeWidth="1" />}
      {worn.chest && (
        <g data-layer="chest">
          <path d="M52 72 Q80 62 108 72 L111 100 Q105 128 98 150 L62 150 Q55 128 49 100 Z" fill="url(#hf-plate)" stroke="#4e463a" strokeWidth="1.2" />
          <path d="M80 70 L80 148" stroke="#5b5345" strokeWidth="1" />
          <path d="M60 150 L100 150 L102 168 L58 168 Z" fill="#8e2f2f" stroke="#5a1d1d" strokeWidth="1" />
          <path d="M52 74 Q80 66 108 74" fill="none" stroke={gold} strokeWidth="2" />
        </g>
      )}
      {worn.amulet && <g data-layer="amulet"><path d="M70 66 Q80 82 90 66" fill="none" stroke={gold} strokeWidth="1.2" /><circle cx="80" cy="82" r="4" fill="url(#hf-gold)" /></g>}
      {worn.gloves && <path data-layer="gloves" d="M33 158 h13 v22 h-13 z M114 158 h13 v22 h-13 z" fill="#5d4a34" stroke="#2b2118" strokeWidth="1" />}
      {worn.rings && <g data-layer="rings" fill={gold}><circle cx="40" cy="176" r="2" /><circle cx="120" cy="176" r="2" /></g>}
      {worn.head && (
        <g data-layer="head">
          <path d="M63 40 Q63 18 80 17 Q97 18 97 40 L97 46 L89 46 L89 36 L71 36 L71 46 L63 46 Z" fill="url(#hf-plate)" stroke="#4e463a" strokeWidth="1.2" />
          <path d="M70 18 Q80 4 92 16 L88 20 Q80 12 74 20 Z" fill="#8e2f2f" />
        </g>
      )}
      {worn.main && (
        <g data-layer="main">
          <path d="M38 178 L38 238 L41 246 L44 238 L44 178 Z" fill="#c8c3b8" stroke="#6f675a" strokeWidth=".8" />
          <rect x="31" y="172" width="20" height="5" rx="1.5" fill="url(#hf-gold)" />
          <rect x="38.5" y="160" width="5" height="12" fill="#5d4a34" />
        </g>
      )}
      {worn.shield && (
        <g data-layer="shield">
          <path d="M108 150 L146 150 L146 186 Q146 214 127 226 Q108 214 108 186 Z" fill="#8e2f2f" stroke={gold} strokeWidth="2.2" />
          <path d="M127 160 L127 214 M114 180 L140 180" stroke={gold} strokeWidth="1.4" opacity=".8" />
        </g>
      )}
      {worn.offWeapon && !worn.shield && (
        <g data-layer="offWeapon">
          <path d="M118 178 L118 218 L121 224 L124 218 L124 178 Z" fill="#c8c3b8" stroke="#6f675a" strokeWidth=".8" />
          <rect x="113" y="173" width="16" height="4" rx="1.5" fill="url(#hf-gold)" />
        </g>
      )}
    </svg>
  );
}

const SLOT_ICON: Record<string, string> = {
  head: 'M3 10 Q3 3 8 3 Q13 3 13 10 L13 12 L10 12 L10 8 L6 8 L6 12 L3 12 Z',
  amulet: 'M4 2 Q8 9 12 2 M8 9 a2.5 2.5 0 1 0 0.01 0',
  cloak: 'M5 2 L11 2 L14 14 L2 14 Z',
  chest: 'M3 3 Q8 1 13 3 L12 11 L8 14 L4 11 Z',
  gloves: 'M4 14 L4 6 L6 6 L6 3 L8 3 L8 6 L10 4 L12 5 L12 14 Z',
  ring: 'M8 4 a4 4 0 1 0 0.01 0 M6 2 L10 2',
  boots: 'M5 2 L9 2 L9 10 L14 12 L14 14 L5 14 Z',
  belt: 'M1 6 L15 6 L15 10 L1 10 Z M6 5 L10 5 L10 11 L6 11 Z',
  main: 'M12 2 L14 4 L6 12 L4 12 L4 10 Z M3 11 L5 13',
  off: 'M3 3 L13 3 L13 8 Q13 13 8 15 Q3 13 3 8 Z',
};
function SlotIcon({ slot }: { slot: EquipSlot }) {
  const key = slot.startsWith('ring') ? 'ring' : slot.startsWith('main') ? 'main' : slot.startsWith('off') ? 'off' : slot;
  return (
    <svg viewBox="0 0 16 16" className="mr-0.5 inline h-3 w-3 align-[-2px]" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d={SLOT_ICON[key]} />
    </svg>
  );
}

