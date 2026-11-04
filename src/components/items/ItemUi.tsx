/**
 * Shared item UI (APEX 0.6): original currency glyphs, the currency bar, and the item inspection card ("tooltip").
 * Everything here renders data the viewer already has – no requests on hover or open.
 */
import { useState, type FormEvent } from 'react';
import { EQUIP_SLOTS, SLOT_LABEL, activeSlots, equipmentOf, itemBonuses, slotOfItem, type Equipment, type EquipSlot } from '../../game/equipment';
import { baseItem } from '../../game/items/bases';
import { balanceOf, CURRENCIES, CURRENCY_IDS, type CurrencyId } from '../../game/items/currency';
import { modifier, modText } from '../../game/items/modifiers';
import { uniqueDef } from '../../game/items/uniques';
import type { CarryLoad } from '../../game/items/weight';
import { formatReduction } from '../../game/items/resistance';
import { DEFAULT_ITEM_RULES, RARITY_LABEL, type ItemRules } from '../../game/items/rules';
import type { Item } from '../../game/types';
import { RARITY_STYLE } from '../itemPresentation';

// ---------------------------------------------------------------- currency glyphs (original SVG)

export function CurrencyIcon({ id, size = 20 }: { id: CurrencyId; size?: number }) {
  const c = CURRENCIES[id].color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {id === 'seal' && (
        <>
          <circle cx="12" cy="12" r="9" fill="#3a2a10" stroke={c} strokeWidth="1.6" />
          <path d="M12 6.5l1.6 3.4 3.7.4-2.8 2.5.8 3.7L12 14.6l-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z" fill={c} />
        </>
      )}
      {id === 'orb' && (
        <>
          <circle cx="12" cy="12" r="8.5" fill="#152447" stroke={c} strokeWidth="1.6" />
          <path d="M7.5 12a4.5 4.5 0 0 1 7.7-3.2M16.5 12a4.5 4.5 0 0 1-7.7 3.2" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M15.6 6.6v2.4h-2.4M8.4 17.4V15h2.4" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {id === 'fragment' && (
        <>
          <path d="M12 3l5.5 6.5L13 21l-6.5-9z" fill="#2b1d3d" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M12 3l1 18M6.5 12l11-2.5" stroke={c} strokeWidth=".8" opacity=".7" />
        </>
      )}
    </svg>
  );
}

/** Prominent balances + "Combine Fragments" (players and GM on a character's inventory). */
export function CurrencyBar({
  currency,
  currencyRev,
  rules = DEFAULT_ITEM_RULES,
  onCombine,
  onTransmute,
  lastTransmute,
}: {
  currency: Partial<Record<CurrencyId, number>> | undefined;
  currencyRev: number;
  rules?: ItemRules;
  onCombine?: (sets: number, currencyRev: number) => Promise<boolean>;
  onTransmute?: (sets: number, currencyRev: number) => Promise<boolean>;
  lastTransmute?: { rev: number; result: Partial<Record<CurrencyId, number>> };
}) {
  const purse = { currency };
  const per = rules.fragmentsPerOrb;
  const max = Math.floor(balanceOf(purse, 'fragment') / per);
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState(1);
  const [tOpen, setTOpen] = useState(false);
  const [tSets, setTSets] = useState(1);
  const [shownRev, setShownRev] = useState<number | null>(null);
  const tPer = rules.fragmentsPerRandomOrb;
  const tMax = Math.floor(balanceOf(purse, 'fragment') / tPer);
  const w = [rules.transmuteWeightRenewal, rules.transmuteWeightAugment, rules.transmuteWeightAscension];
  const wSum = w.reduce((a, b) => a + b, 0) || 1;
  const odds = (i: number) => `${Math.round((w[i] / wSum) * 100)}%`;
  const transmute = async (e: FormEvent) => {
    e.preventDefault();
    if (onTransmute && (await onTransmute(Math.min(tSets, tMax), currencyRev))) (setTOpen(false), setTSets(1), setShownRev(currencyRev + 1));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (onCombine && (await onCombine(Math.min(sets, max), currencyRev))) (setOpen(false), setSets(1));
  };
  return (
    <section className="panel p-3" aria-label="Magical currency">
      <div className="flex flex-wrap items-center gap-2">
        {CURRENCY_IDS.map((id) => (
          <div key={id} className="flex min-w-[9.5rem] flex-1 items-center gap-2 rounded-lg border border-ink-600 bg-ink-900/60 px-2 py-1.5" title={CURRENCIES[id].purpose} data-currency={id}>
            <CurrencyIcon id={id} size={26} />
            <div className="leading-tight">
              <div className="font-display text-xl font-black tabular-nums" style={{ color: CURRENCIES[id].color }} data-testid={`balance-${id}`}>
                {balanceOf(purse, id)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-marble-500">{CURRENCIES[id].plural}</div>
            </div>
          </div>
        ))}
        {onTransmute && (
          <button className="btn btn-ghost text-xs" disabled={tMax < 1} title={tMax < 1 ? `Requires ${tPer} Arcane Fragments` : `${tPer} Arcane Fragments → 1 random Orb`} onClick={() => setTOpen((o) => !o)}>
            Arcane Transmutation
          </button>
        )}
        {onCombine && (
          <button className="btn btn-ghost text-xs" disabled={max < 1} title={max < 1 ? `Requires ${per} Arcane Fragments` : `${per} Arcane Fragments → 1 Orb of Renewal`} onClick={() => setOpen((o) => !o)}>
            Combine Fragments
          </button>
        )}
      </div>
      {max < 1 && onCombine && <p className="mt-1 text-[11px] text-marble-500">Combine Fragments: requires {per} Arcane Fragments for one Orb of Renewal.</p>}
      {lastTransmute && shownRev !== null && lastTransmute.rev === shownRev && (
        <p role="status" className="apex-reveal mt-2 rounded-lg border border-arcane-400/50 bg-arcane-500/10 p-2 text-xs text-arcane-300" data-testid="transmute-result">
          Arcane Transmutation:{' '}
          {(Object.entries(lastTransmute.result) as Array<[CurrencyId, number]>).map(([c, n]) => `${n} × ${n === 1 ? CURRENCIES[c].name : CURRENCIES[c].plural}`).join(', ')}
        </p>
      )}
      {tOpen && tMax >= 1 && (
        <form onSubmit={transmute} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-arcane-400/40 bg-ink-900/70 p-2 text-xs text-marble-300" aria-label="Arcane transmutation">
          <label>
            Random Orbs{' '}
            <input className="w-16 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50" type="number" min={1} max={tMax} value={tSets} onChange={(e) => setTSets(Math.max(1, Math.min(tMax, Math.round(Number(e.target.value) || 1))))} aria-label="Random orbs to create" />
          </label>
          <span>
            Uses <strong className="text-marble-50">{tSets * tPer}</strong> fragments. Each Orb is rolled on the server: Renewal {odds(0)} · Augmentation {odds(1)} · Ascension {odds(2)}.
          </span>
          <button type="submit" className="btn btn-gold px-2 py-0.5">
            Transmute
          </button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setTOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      {open && max >= 1 && (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-arcane-400/40 bg-ink-900/70 p-2 text-xs text-marble-300" aria-label="Combine fragments">
          <label>
            Orbs to create{' '}
            <input className="w-16 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50" type="number" min={1} max={max} value={sets} onChange={(e) => setSets(Math.max(1, Math.min(max, Math.round(Number(e.target.value) || 1))))} aria-label="Orbs to create" />
          </label>
          <span>
            Uses <strong className="text-marble-50">{sets * per}</strong> of {balanceOf(purse, 'fragment')} Arcane Fragments → <strong className="text-marble-50">{sets}</strong> Orb{sets === 1 ? '' : 's'} of Renewal
          </span>
          <button type="submit" className="btn btn-gold px-2 py-0.5">
            Combine
          </button>
          <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- inspection card

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function baseStatLines(item: Item): string[] {
  const e = item.equip;
  const base = baseItem(item.baseId);
  const out: string[] = [];
  if (e?.kind === 'weapon') out.push(`${e.damage ?? '?'} ${e.damageType ?? ''}`.trim() + (e.properties?.length ? ` · ${e.properties.join(', ')}` : ''));
  if (e?.kind === 'armor' && e.armorBase) out.push(`AC ${e.armorBase}${e.armorType === 'heavy' ? '' : e.armorType === 'medium' ? ' + Dex (max 2)' : ' + Dex'} · ${e.armorType} armour`);
  if (e?.acBonus) out.push(`AC ${fmt(e.acBonus)}`);
  if (e?.attackBonus) out.push(`${fmt(e.attackBonus)} to attack and damage`);
  if (base?.description && base.category === 'weapon') out.push(base.description);
  return out;
}

/** Where an item is: equipped slot (active or not) or its container. */
export function locationOf(item: Item, eq: Equipment, containers: Array<{ id: string; name: string }>): string {
  const slot = slotOfItem(eq, item.id);
  if (slot) return `Equipped · ${SLOT_LABEL[slot]}${activeSlots(eq).includes(slot) ? '' : ' (inactive)'}`;
  return containers.find((c) => c.id === item.container)?.name ?? containers[0]?.name ?? 'Inventory';
}

export function ItemInspect({
  item,
  inventory,
  equipment,
  containers = [],
  rules = DEFAULT_ITEM_RULES,
  gmView = false,
  onClose,
}: {
  item: Item;
  inventory: Item[];
  equipment?: Equipment;
  containers?: Array<{ id: string; name: string }>;
  rules?: ItemRules;
  /** The GM sees hidden modifiers of unidentified items (marked as hidden from the player). */
  gmView?: boolean;
  onClose?: () => void;
}) {
  const eq = equipmentOf({ equipment });
  const base = baseItem(item.baseId);
  const r = item.rarity ? RARITY_STYLE[item.rarity] : null;
  const hidden = item.identified === false;
  const items = new Map(inventory.map((i) => [i.id, i]));
  const worn = activeSlots(eq)
    .map((s) => ({ slot: s, item: eq.slots[s] ? items.get(eq.slots[s]!) : undefined }))
    .filter((x): x is { slot: EquipSlot; item: Item } => !!x.item?.equip);
  const totals = itemBonuses(worn, rules);
  const equippedActive = worn.some((w) => w.item.id === item.id);
  const showMods = !hidden || gmView;
  return (
    <div className="rounded-lg border bg-ink-950/95 p-3 text-xs shadow-2xl" style={{ borderColor: r?.border ?? 'rgba(192,155,88,.4)' }} role="dialog" aria-label={`Details of ${item.name}`} data-inspect={item.id}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-black leading-tight" style={{ color: r?.color ?? '#efe7d6' }}>
            {hidden ? `Unidentified ${item.name}` : item.name}
          </div>
          <div className="text-[11px] text-marble-400">
            {r && <span style={{ color: r.color }}>{RARITY_LABEL[item.rarity!]}</span>}
            {base && <span> · {base.name}</span>}
            {base && <span className="text-marble-500"> ({base.subtype})</span>}
            {item.itemLevel !== undefined && <span> · Item level {item.itemLevel}</span>}
          </div>
        </div>
        {onClose && (
          <button className="text-marble-500 hover:text-gold-200" aria-label="Close details" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      {baseStatLines(item).length > 0 && (
        <ul className="mt-2 border-t border-ink-700 pt-1.5 text-marble-200">
          {baseStatLines(item).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 border-t border-ink-700 pt-1.5" aria-label="Modifiers">
        {hidden && !gmView && <p className="italic text-marble-400">Unidentified – its modifiers are unknown. Use a Seal of Revelation to reveal them.</p>}
        {hidden && gmView && <p className="mb-1 text-[10px] uppercase tracking-wider text-amber-300">Hidden from the player until identified</p>}
        {showMods && (item.mods ?? []).length === 0 && !hidden && <p className="text-marble-500">No modifiers.</p>}
        {showMods && (
          <ul className="space-y-0.5">
            {(item.mods ?? []).map((m, i) => {
              const def = modifier(m.modId);
              if (!def) return <li key={i}>Unknown modifier</li>;
              const e = def.effect;
              const res = e.type === 'resistance' ? totals.resistances[e.element] : null;
              return (
                <li key={i} data-mod={m.modId}>
                  <span style={{ color: def.flavor ? '#b9b2a2' : r?.color }}>{modText(def, m.value)}</span>
                  <span className="ml-1 text-[10px] text-marble-500">
                    ({item.rarity === 'unique' ? 'fixed' : `${def.affix}, tier ${m.tier}`}
                    {def.flavor ? ` · ${def.flavor}` : ''})
                  </span>
                  {res && equippedActive && (
                    <div className="pl-2 text-[11px] text-marble-400">
                      {e.type === 'resistance' && `${e.element[0].toUpperCase()}${e.element.slice(1)} Resistance total: ${res.total} points${res.total > res.value ? ` (capped at ${res.cap})` : ''} · Effective damage reduction: ${formatReduction(res.reduction)}`}
                    </div>
                  )}
                  {res && !equippedActive && <div className="pl-2 text-[11px] text-marble-500">{`${m.value} points = ${formatReduction(m.value / 200)} damage reduction on its own (equip it to count)`}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {uniqueDef(item.uniqueId) && (
        <div className="mt-2 border-t border-ink-700 pt-1.5" data-unique={item.uniqueId}>
          <p className="italic text-[#d9a273]">{uniqueDef(item.uniqueId)!.flavor}</p>
          {uniqueDef(item.uniqueId)!.ability && (
            <div className="mt-1.5 rounded-md border border-[#c9733a]/50 bg-[#c9733a]/10 p-2">
              <p className="font-semibold text-[#e8a06a]">
                {uniqueDef(item.uniqueId)!.ability!.name}
                <span className="ml-2 text-[10px] font-normal text-marble-400" data-testid="unique-charge">
                  {item.charge?.spent ? 'Spent – recharges once per long rest' : 'Charged'}
                </span>
              </p>
              <p className="text-marble-200">{uniqueDef(item.uniqueId)!.ability!.text}</p>
              <ul className="mt-1 list-disc pl-4 text-[11px] text-marble-400">
                {uniqueDef(item.uniqueId)!.ability!.rules.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {base?.requirements?.str && <p className="mt-1.5 text-marble-400">Requires Strength {base.requirements.str} (otherwise −10 ft speed)</p>}
      {base?.stealthDisadvantage && <p className="text-marble-400">Disadvantage on Stealth checks</p>}
      <p className="mt-1.5 text-marble-400">
        Location: <span className="text-marble-200">{locationOf(item, eq, containers)}</span>
        {item.locked && <span className="ml-2 text-amber-300">· Restricted by the GM</span>}
      </p>
      {item.history && item.history.length > 0 && (
        <details className="mt-1 text-marble-500">
          <summary className="cursor-pointer">History</summary>
          <ul>
            {item.history.map((h, i) => (
              <li key={i}>
                Day {h.day}: {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      {base && base.source.name === 'SRD 5.1' && <p className="mt-1 text-[10px] text-marble-600">Base statistics: SRD 5.1, CC BY 4.0.</p>}
    </div>
  );
}

export const EQUIP_ORDER = EQUIP_SLOTS;

// ---------------------------------------------------------------- carry weight gauge (APEX 0.7)

const LOAD_TONE: Record<CarryLoad['state'], { color: string; label: string }> = {
  ok: { color: '#7cc98a', label: 'Unburdened' },
  encumbered: { color: '#e3c25b', label: 'Encumbered (−10 ft)' },
  heavily: { color: '#e08a4a', label: 'Heavily encumbered (−20 ft, disadvantage)' },
  over: { color: '#e05252', label: 'Overburdened' },
};

/** Compact vertical gauge: current load / capacity in kg, percentage and state. */
export function CarryGauge({ load }: { load: CarryLoad }) {
  const pct = load.pct === null ? 0 : Math.min(100, load.pct);
  const tone = LOAD_TONE[load.state];
  return (
    <div className="flex items-stretch gap-2 rounded-lg border border-ink-600 bg-ink-900/60 p-2" aria-label="Carry weight" data-testid="carry-gauge" data-state={load.state}>
      <div className="relative w-3.5 overflow-hidden rounded-full border border-ink-500 bg-ink-800" style={{ minHeight: 76 }} role="meter" aria-valuemin={0} aria-valuemax={load.capacityKg ?? 0} aria-valuenow={load.loadKg} aria-label="Carried weight">
        <div className="absolute inset-x-0 bottom-0 transition-[height] duration-500 motion-reduce:transition-none" style={{ height: `${pct}%`, background: tone.color }} />
        {load.encumberedAtKg && load.capacityKg ? <div className="absolute inset-x-0 border-t border-dashed border-gold-200/60" style={{ bottom: `${(load.encumberedAtKg / load.capacityKg) * 100}%` }} /> : null}
        {load.heavilyAtKg && load.capacityKg ? <div className="absolute inset-x-0 border-t border-dashed border-amber-300/70" style={{ bottom: `${(load.heavilyAtKg / load.capacityKg) * 100}%` }} /> : null}
      </div>
      <div className="flex flex-col justify-between text-[11px] leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-marble-500">Carry weight</span>
        <span className="font-display text-base font-black tabular-nums text-marble-50" data-testid="carry-load">
          {load.loadKg.toFixed(1)}
          <span className="text-marble-400"> / {load.capacityKg === null ? '?' : load.capacityKg.toFixed(1)} kg</span>
        </span>
        <span className="tabular-nums text-marble-400">{load.pct === null ? 'Strength missing on the sheet' : `${load.pct} %`}</span>
        <span style={{ color: tone.color }}>{tone.label}</span>
      </div>
    </div>
  );
}
