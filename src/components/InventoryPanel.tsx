/**
 * Inventory (APEX 0.3, reworked in 0.6). Reads the character's inventory from the authoritative game state and
 * changes it only through server-validated commands. Every item edit names the item's revision, so a change made
 * on another device is never silently overwritten.
 *
 * 0.6 usability: search, sort (view only – the manual order is what is stored), category filter, drag & drop to
 * reorder or move between containers (with ↑/↓ and a move menu as click/keyboard alternatives), delete with a
 * short undo window, split and merge of plain stacks, clear "equipped" badges. Free-text items stay first-class:
 * "Old iron key wrapped in red cloth" needs no template.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Command } from '../game/commands';
import { SLOT_LABEL, equipmentOf, slotOfItem, suggestSlot, type Equipment } from '../game/equipment';
import { balanceOf, CURRENCIES } from '../game/items/currency';
import { canActivate, canAscend, canAugment, canIdentify, canReroll, canSalvage, salvageReward, type Check } from '../game/items/loot';
import { addableMods } from '../game/items/generate';
import { AFFIX_RULES } from '../game/items/rules';
import { uniqueDef } from '../game/items/uniques';
import { DEFAULT_ITEM_RULES, RARITY_LABEL, type ItemRules } from '../game/items/rules';
import { CarryGauge, CurrencyBar, ItemInspect } from './items/ItemUi';
import { BAG_CAPACITY_KG, bagContentsKg, carryLoad, itemWeightKg, strengthScore } from '../game/items/weight';
import { activeSlots, itemBonuses } from '../game/equipment';
import type { GameApi } from '../state/gameApi';
import { DEFAULT_CONTAINERS, INVENTORY_LIMITS, canMerge, containerOfItem, isStackable } from '../game/inventory';
import { newEntryId } from '../game/sheet';
import type { Item } from '../game/types';
import type { TokenView } from '../game/visibility';
import type { DispatchResult } from '../state/gameApi';
import { baseItem } from '../game/items/bases';
import { itemSortKeys, ItemBadges, ItemModLines, itemCategory, type ItemCategory } from './itemPresentation';

interface Props {
  token: TokenView;
  run: (cmd: Command) => Promise<DispatchResult>;
  busy: boolean;
  /** Inside the character dashboard (no outer page padding). */
  embedded?: boolean;
  /** Effective balance rules (fragment ratio, caps). */
  rules?: ItemRules;
  /** The GM looks at a character's inventory: extra actions (revoke, restrict). */
  isGm?: boolean;
  /** APEX 0.7: used to read the Strength score for the carry-weight gauge (one sheet request). */
  game?: GameApi;
}

const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const DND = 'application/x-apex-inventory-item';
const UNDO_MS = 5000;
type Sort = 'manual' | 'name' | 'type' | 'quantity' | 'rarity' | 'level';
type Filter = 'all' | 'equipped' | 'unequipped' | ItemCategory;
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['equipped', 'Equipped'],
  ['unequipped', 'Not equipped'],
  ['weapon', 'Weapons'],
  ['armor', 'Armour & shields'],
  ['accessory', 'Accessories'],
  ['consumable', 'Consumables & currency'],
  ['other', 'Other'],
];

export function InventoryPanel({ token, run, busy, embedded, rules = DEFAULT_ITEM_RULES, isGm = false, game }: Props) {
  const strength = useStrength(game, token.id);
  const details = token.details;
  const containers = details?.containers?.length ? details.containers : DEFAULT_CONTAINERS.map((c) => ({ ...c }));
  const items = useMemo(() => details?.inventory ?? [], [details?.inventory]);
  const eq = equipmentOf({ equipment: details?.equipment });
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [target, setTarget] = useState(containers[0]?.id ?? 'backpack');
  const [newContainer, setNewContainer] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('manual');
  const [filter, setFilter] = useState<Filter>('all');
  const [dragId, setDragId] = useState<string | null>(null);
  // delete with undo: the item disappears at once, the command is sent only after the undo window
  const [pending, setPending] = useState<Record<string, { item: Item; timer: number }>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      // leaving the screen confirms pending deletions (the user already chose to delete)
      for (const p of Object.values(pendingRef.current)) {
        clearTimeout(p.timer);
        void run({ type: 'invRemoveItem', tokenId: token.id, itemId: p.item.id, rev: p.item.rev ?? 0 });
      }
    },
    [run, token.id],
  );

  if (!details) return <p className="p-4 text-sm text-marble-500">This inventory is not visible.</p>;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await run({ type: 'invAddItem', tokenId: token.id, itemId: newEntryId('itm'), name: name.trim(), quantity: qty, container: target });
    if (r.ok) {
      setName('');
      setQty(1);
    }
  };
  const addContainer = async (e: FormEvent) => {
    e.preventDefault();
    if (!newContainer.trim()) return;
    if ((await run({ type: 'invAddContainer', tokenId: token.id, containerId: newEntryId('c'), name: newContainer.trim() })).ok) setNewContainer('');
  };
  const remove = (item: Item) => {
    const timer = window.setTimeout(() => {
      setPending((p) => {
        const { [item.id]: _gone, ...rest } = p;
        return rest;
      });
      void run({ type: 'invRemoveItem', tokenId: token.id, itemId: item.id, rev: item.rev ?? 0 });
    }, UNDO_MS);
    setPending((p) => ({ ...p, [item.id]: { item, timer } }));
  };
  const undo = (id: string) =>
    setPending((p) => {
      if (p[id]) clearTimeout(p[id].timer);
      const { [id]: _back, ...rest } = p;
      return rest;
    });
  const move = (item: Item, container: string, beforeItemId?: string | null) =>
    void run({ type: 'invMoveItem', tokenId: token.id, itemId: item.id, rev: item.rev ?? 0, container, ...(beforeItemId ? { beforeItemId } : {}) });

  const needle = q.trim().toLowerCase();
  const visible = items.filter((i) => !pending[i.id]);
  const matches = (i: Item) => {
    if (needle && !`${i.name} ${i.description} ${i.notes ?? ''}`.toLowerCase().includes(needle)) return false;
    const equipped = !!slotOfItem(eq, i.id);
    if (filter === 'equipped') return equipped;
    if (filter === 'unequipped') return !equipped;
    if (filter !== 'all') return itemCategory(i) === filter;
    return true;
  };
  const sorted = (list: Item[]) => (sort === 'manual' ? list : [...list].sort((a, b) => itemSortKeys[sort](a, b)));
  const viewFiltered = needle || filter !== 'all' || sort !== 'manual';

  return (
    <div className={embedded ? 'space-y-3' : 'mx-auto max-w-5xl space-y-3 p-3'} aria-label={`Inventory of ${token.name}`}>
      <section className="panel space-y-2 p-3">
        <h2 className="font-display text-2xl font-black text-gold-200">Inventory – {token.name}</h2>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-xs text-marble-300">
            New entry
            <input className={`${input} mt-1 w-full`} placeholder="e.g. Old iron key, wrapped in red cloth" value={name} maxLength={INVENTORY_LIMITS.name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-xs text-marble-300">
            Qty
            <input className={`${input} mt-1 w-16`} type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </label>
          <label className="text-xs text-marble-300">
            Put into
            <select className={`${input} mt-1 block`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-gold" disabled={busy || !name.trim()}>
            + Add
          </button>
        </form>
        <div className="flex flex-wrap items-end gap-2 border-t border-ink-700 pt-2 text-xs" role="search">
          <label className="min-w-[10rem] flex-1 text-marble-300">
            Search
            <input className={`${input} mt-1 w-full`} placeholder="Find an item…" aria-label="Search inventory" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="text-marble-300">
            Sort
            <select className={`${input} mt-1 block`} aria-label="Sort inventory" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="manual">Manual order</option>
              <option value="name">Name</option>
              <option value="type">Type</option>
              <option value="rarity">Rarity</option>
              <option value="level">Item level</option>
              <option value="quantity">Quantity</option>
            </select>
          </label>
          <label className="text-marble-300">
            Show
            <select className={`${input} mt-1 block`} aria-label="Filter inventory" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {FILTERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {viewFiltered && <p className="text-[11px] text-marble-500">Filtered or sorted view – drag & drop and ↑/↓ reorder the stored order only in “Manual order” without search or filter.</p>}
      </section>

      <div className="flex flex-wrap items-stretch gap-3">
        <CarryGauge load={carryLoad({ inventory: items, currency: token.details?.currency }, strength, carryBonusLb(items, eq, rules), rules.encumbranceVariant === 1)} />
        <div className="min-w-0 flex-1">
      <CurrencyBar
        currency={details.currency}
        currencyRev={details.currencyRev ?? 0}
        rules={rules}
        onCombine={async (sets, currencyRev) => (await run({ type: 'combineFragments', tokenId: token.id, sets, currencyRev })).ok}
        onTransmute={async (sets, currencyRev) => (await run({ type: 'transmuteFragments', tokenId: token.id, sets, currencyRev })).ok}
        lastTransmute={details.lastTransmute}
        transmuteUnlocked={!!details.transmuteUnlocked}
      />
        </div>
      </div>
      {details.timeTwist && (
        <p role="status" className="panel border-arcane-400/60 p-2 text-xs text-arcane-300" data-testid="time-twist">
          ⏳ Twist of Time pending ({details.timeTwist.itemName}, day {details.timeTwist.day}): your next turn will be two consecutive turns. APEX has no turn tracker yet – the GM resolves it at the table.
        </p>
      )}

      {Object.values(pending).map(({ item }) => (
        <div key={item.id} role="status" className="flex items-center gap-3 rounded-lg border border-blood-600/60 bg-blood-800/40 px-3 py-2 text-xs text-marble-100" data-undo={item.id}>
          <span className="flex-1">
            “{item.name}” will be removed{slotOfItem(eq, item.id) ? ' (it is equipped and will be unequipped)' : ''}.
          </span>
          <button className="btn btn-ghost px-2 py-0.5" onClick={() => undo(item.id)}>
            ↶ Undo
          </button>
        </div>
      ))}

      <div className="grid gap-3 md:grid-cols-2">
        {containers.map((c) => {
          const inside = visible.filter((i) => containerOfItem(i, containers) === c.id);
          return (
            <ContainerCard
              key={c.id}
              token={token}
              container={c}
              items={sorted(inside.filter(matches))}
              allInside={inside}
              allItems={visible}
              containers={containers}
              run={run}
              canDelete={containers.length > 1}
              reorderable={!viewFiltered}
              eqSlot={(id) => slotOfItem(eq, id)}
              dragId={dragId}
              setDragId={setDragId}
              onMove={move}
              onRemove={remove}
              eq={eq}
              rules={rules}
              isGm={isGm}
            />
          );
        })}
      </div>

      <section className="panel p-3">
        <form onSubmit={addContainer} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1 text-xs text-marble-300">
            New container
            <input className={`${input} mt-1 w-full`} placeholder="e.g. Saddlebag" maxLength={INVENTORY_LIMITS.containerName} value={newContainer} onChange={(e) => setNewContainer(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-ghost" disabled={busy || !newContainer.trim()}>
            + Create container
          </button>
        </form>
      </section>
    </div>
  );
}

interface CardProps {
  token: TokenView;
  container: { id: string; name: string };
  items: Item[];
  allInside: Item[];
  allItems: Item[];
  containers: Array<{ id: string; name: string }>;
  run: (cmd: Command) => Promise<DispatchResult>;
  canDelete: boolean;
  reorderable: boolean;
  eqSlot: (id: string) => ReturnType<typeof slotOfItem>;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onMove: (item: Item, container: string, beforeItemId?: string | null) => void;
  onRemove: (item: Item) => void;
  eq: Equipment;
  rules: ItemRules;
  isGm: boolean;
}

function ContainerCard(props: CardProps) {
  const { token, container, items, run } = props;
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(container.name);
  const [over, setOver] = useState(false);
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if ((await run({ type: 'invRenameContainer', tokenId: token.id, containerId: container.id, name: title })).ok) setRenaming(false);
  };
  const dragged = props.allItems.find((i) => i.id === props.dragId);
  return (
    <section
      className={`panel p-3 transition-colors ${over ? 'border-gold-400/80' : ''}`}
      aria-label={container.name}
      data-container={container.id}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DND)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!dragged) return;
        e.preventDefault();
        props.onMove(dragged, container.id, null);
        props.setDragId(null);
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        {renaming ? (
          <form onSubmit={rename} className="flex flex-1 gap-1">
            <input className={`${input} flex-1`} aria-label="Container name" value={title} maxLength={INVENTORY_LIMITS.containerName} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <button className="btn btn-gold px-2 py-0.5" type="submit">
              Save
            </button>
            <button className="btn btn-ghost px-2 py-0.5" type="button" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h3 className="panel-title flex-1">
              {container.name} <span className="text-marble-500">({props.allInside.length})</span>
              {(container as { holding?: string }).holding && (
                <span className="ml-2 font-sans text-[10px] normal-case tracking-normal text-arcane-300" data-testid="bag-capacity">
                  ✦ Bag of Holding · {bagContentsKg({ inventory: props.allItems }, (container as { holding?: string }).holding!).toFixed(1)} / {BAG_CAPACITY_KG.toFixed(1)} kg · contents do not count towards carry weight
                </span>
              )}
            </h3>
            <button
              className="text-[11px] text-marble-500 hover:text-gold-200"
              onClick={() => {
                setTitle(container.name);
                setRenaming(true);
              }}
            >
              Rename
            </button>
            {props.canDelete && (
              <button
                className="text-[11px] text-marble-500 hover:text-blood-400 disabled:opacity-40"
                disabled={props.allInside.length > 0}
                title={props.allInside.length ? 'Only empty containers can be deleted' : 'Delete this container'}
                onClick={() => void run({ type: 'invRemoveContainer', tokenId: token.id, containerId: container.id })}
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((i, idx) => (
            <ItemRow key={i.id} {...props} item={i} prev={items[idx - 1]} next={items[idx + 1]} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-ink-600 px-2 py-3 text-center text-xs text-marble-500">{props.allInside.length ? 'No item matches the search or filter.' : 'Empty – drop an item here.'}</p>
      )}
    </section>
  );
}

function ItemRow(props: CardProps & { item: Item; prev?: Item; next?: Item }) {
  const { token, item, containers, run, reorderable } = props;
  const [mode, setMode] = useState<'view' | 'edit' | 'split' | 'reroll' | 'salvage' | 'revoke' | 'augment' | 'ascend' | 'activate'>('view');
  const [inspect, setInspect] = useState(false);
  const [menu, setMenu] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState('');
  const structured = !!item.baseId;
  const fixedQty = !!item.rarity || !!item.mods?.length;
  const [draft, setDraft] = useState({ name: item.name, description: item.description, notes: item.notes ?? '', quantity: item.quantity, weightKg: item.weightKg !== undefined ? String(item.weightKg) : '' });
  const [splitQty, setSplitQty] = useState(1);
  const rev = item.rev ?? 0;
  const slot = props.eqSlot(item.id);
  const mergeTarget = props.allItems.find((o) => o.id !== item.id && canMerge(item, o));
  const update = (patch: Partial<{ name: string; description: string; notes: string; quantity: number; weightKg: number }>) => run({ type: 'invUpdateItem', tokenId: token.id, itemId: item.id, rev, ...patch });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { weightKg, ...rest } = draft;
    const w = weightKg.trim() === '' ? undefined : Math.max(0, Math.min(2000, Number(weightKg)));
    if ((await update({ ...rest, ...(w !== undefined && Number.isFinite(w) && w !== item.weightKg ? { weightKg: w } : {}) })).ok) setMode('view');
  };
  if (mode === 'edit') {
    return (
      <li className="rounded-lg border border-gold-700/50 bg-ink-900/60 p-2">
        <form onSubmit={save} className="space-y-1.5 text-xs text-marble-300">
          <input className={`${input} w-full`} aria-label="Item name" value={draft.name} maxLength={INVENTORY_LIMITS.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <textarea className={`${input} min-h-12 w-full`} aria-label="Description" placeholder="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <textarea className={`${input} min-h-12 w-full`} aria-label="Notes" placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="flex items-center gap-2">
            <label>
              kg{' '}
              <input className={`${input} w-20`} type="number" min={0} step={0.1} aria-label="Weight in kg" value={draft.weightKg} onChange={(e) => setDraft({ ...draft, weightKg: e.target.value })} placeholder={itemWeightKg({ baseId: item.baseId }).toString()} />
            </label>
            <label className={item.rarity || item.mods?.length ? 'hidden' : undefined}>
              Qty{' '}
              <input className={`${input} w-16`} type="number" min={0} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </label>
            <span className="flex-1" />
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setMode('view')}>
              Cancel
            </button>
            <button type="submit" className="btn btn-gold px-2 py-0.5">
              Save
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li
      className={`rounded-lg border bg-ink-800/50 p-2 ${slot ? 'border-gold-600/60' : 'border-ink-600'} ${props.dragId === item.id ? 'opacity-40' : ''}`}
      data-item={item.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DND, item.id);
        props.setDragId(item.id);
      }}
      onDragEnd={() => props.setDragId(null)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DND) || !reorderable) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        const dragged = props.allItems.find((i) => i.id === props.dragId);
        if (!dragged || dragged.id === item.id || !reorderable) return;
        e.preventDefault();
        e.stopPropagation();
        props.onMove(dragged, containerOfItem(item, containers), item.id);
        props.setDragId(null);
      }}
    >
      <div className="flex items-start gap-2">
        <span className="cursor-grab select-none pt-0.5 text-marble-600" aria-hidden title="Drag to reorder or move">
          ⠿
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-marble-50">
            {item.quantity !== 1 && <span className="mr-1 font-semibold text-gold-200 tabular-nums">{item.quantity}×</span>}
            <ItemBadges item={item} />
            {itemWeightKg(item) > 0 && <span className="ml-1.5 text-[10px] tabular-nums text-marble-500">{(itemWeightKg(item) * item.quantity).toFixed(1)} kg</span>}
            {slot && (
              <span className="ml-1.5 rounded border border-gold-500/50 px-1 text-[10px] uppercase tracking-wider text-gold-300" title="Equipped – see the Equipment tab">
                equipped · {SLOT_LABEL[slot]}
              </span>
            )}
          </div>
          <ItemModLines item={item} />
          {item.description && <p className="text-xs text-marble-300">{item.description}</p>}
          {item.notes && <p className="text-xs italic text-marble-500">{item.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {structured && (
            <button className="btn btn-ghost h-7 px-2 text-[11px]" aria-expanded={inspect} aria-label={`Inspect ${item.name}`} onClick={() => setInspect((v) => !v)}>
              Inspect
            </button>
          )}
          {structured && (
            <button className="btn btn-ghost h-7 px-2 text-[11px]" aria-haspopup="menu" aria-expanded={menu} aria-label={`Actions for ${item.name}`} onClick={() => setMenu((v) => !v)}>
              Actions ▾
            </button>
          )}
          {!fixedQty && (
            <button className="btn btn-ghost h-7 w-7 px-0" aria-label={`Decrease quantity of ${item.name}`} onClick={() => void update({ quantity: Math.max(0, item.quantity - 1) })}>
            −
            </button>
          )}
          {!fixedQty && (
            <button className="btn btn-ghost h-7 w-7 px-0" aria-label={`Increase quantity of ${item.name}`} onClick={() => void update({ quantity: item.quantity + 1 })}>
              +
            </button>
          )}
          <button
            className="btn btn-ghost h-7 w-7 px-0 hover:border-blood-400/70 hover:text-blood-400 disabled:opacity-30"
            aria-label={`Delete ${item.name}`}
            title={item.locked && !props.isGm ? 'Restricted by the Game Master – cannot be deleted' : 'Delete (you can undo for 5 seconds)'}
            disabled={!!item.locked && !props.isGm}
            onClick={() => props.onRemove(item)}
          >
            ✕
          </button>
        </div>
      </div>
      {menu && structured && <ItemActions {...props} close={() => setMenu(false)} onMode={(m) => (setMenu(false), setMode(m))} onRevealed={() => (setRevealed(true), setInspect(true), window.setTimeout(() => setRevealed(false), 1600))} />}
      {mode === 'reroll' && (
        <Confirm
          tone="arcane"
          title={`Reroll ${item.name}?`}
          confirm="Spend 1 Orb of Renewal and reroll"
          onCancel={() => setMode('view')}
          onConfirm={async () => {
            const r = await run({ type: 'itemReroll', tokenId: token.id, itemId: item.id, rev });
            if (r.ok) (setMode('view'), setInspect(true), setRevealed(true), window.setTimeout(() => setRevealed(false), 1600));
          }}
        >
          <p>
            All {item.mods?.length ?? 0} modifiers are replaced by a new random set that fits a {RARITY_LABEL[item.rarity ?? 'normal']} {baseItem(item.baseId)?.name ?? 'item'} of item level {item.itemLevel}. Base item, item level, rarity, owner and equipment slot stay the same.
          </p>
          <p className="text-amber-200">The new result can be worse and cannot be undone or previewed. You have {balanceOf({ currency: token.details?.currency }, 'orb')} Orb(s) of Renewal.</p>
        </Confirm>
      )}
      {(mode === 'augment' || mode === 'ascend') && (() => {
        const base = baseItem(item.baseId);
        const target = mode === 'ascend' ? (item.rarity === 'normal' ? 'magic' : 'rare') : (item.rarity as 'magic' | 'rare');
        const pool = base ? addableMods(base, target, item.itemLevel ?? 1, item.mods ?? []) : [];
        const adds = mode === 'augment' ? 1 : Math.max(1, AFFIX_RULES[target].min - (item.mods?.length ?? 0));
        const orb = mode === 'augment' ? 'augment' : 'ascend';
        return (
          <Confirm
            tone="arcane"
            title={mode === 'augment' ? `Augment ${item.name}?` : `Ascend ${item.name} to ${RARITY_LABEL[target]}?`}
            confirm={mode === 'augment' ? 'Spend 1 Orb of Augmentation' : 'Spend 1 Orb of Ascension'}
            onCancel={() => setMode('view')}
            onConfirm={async () => {
              const r = await run({ type: mode === 'augment' ? 'itemAugment' : 'itemAscend', tokenId: token.id, itemId: item.id, rev });
              if (r.ok) (setMode('view'), setInspect(true), setRevealed(true), window.setTimeout(() => setRevealed(false), 1600));
            }}
          >
            <p>
              {mode === 'augment'
                ? `Adds 1 random modifier. The ${item.mods?.length ?? 0} existing modifier(s) stay unchanged.`
                : `${RARITY_LABEL[item.rarity ?? 'normal']} → ${RARITY_LABEL[target]}: all existing modifiers stay; ${adds} random modifier${adds === 1 ? ' is' : 's are'} added. Base item and item level stay the same.`}
            </p>
            <p className="text-marble-400" data-testid="orb-outcomes">
              Possible outcomes (one of {pool.length}, by weight): {pool.slice(0, 10).map((d) => d.name).join(', ')}
              {pool.length > 10 ? ' …' : ''}. The actual roll happens on the server after you confirm – it cannot be previewed or undone.
            </p>
            <p className="text-marble-500">You have {balanceOf({ currency: token.details?.currency }, orb)} {orb === 'augment' ? 'Orb(s) of Augmentation' : 'Orb(s) of Ascension'}.</p>
          </Confirm>
        );
      })()}
      {mode === 'activate' && (
        <Confirm
          tone="arcane"
          title={`Activate ${uniqueDef(item.uniqueId)?.ability?.name ?? 'ability'}?`}
          confirm="Twist time – skip this turn"
          onCancel={() => setMode('view')}
          onConfirm={async () => {
            if ((await run({ type: 'itemActivate', tokenId: token.id, itemId: item.id, rev })).ok) setMode('view');
          }}
        >
          <p>{uniqueDef(item.uniqueId)?.ability?.text}</p>
          <ul className="list-disc pl-4 text-marble-400">
            {uniqueDef(item.uniqueId)?.ability?.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Confirm>
      )}
      {mode === 'salvage' && (
        <Confirm
          tone="blood"
          title={`Salvage ${item.name}?`}
          confirm={`Salvage for ${salvageReward(item)} Arcane Fragment${salvageReward(item) === 1 ? '' : 's'}`}
          onCancel={() => setMode('view')}
          onConfirm={async () => {
            if ((await run({ type: 'itemSalvage', tokenId: token.id, itemId: item.id, rev })).ok) setMode('view');
          }}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3">
            <dt className="text-marble-500">Item</dt>
            <dd>{item.identified === false ? `Unidentified ${item.name}` : item.name}</dd>
            <dt className="text-marble-500">Rarity</dt>
            <dd>{RARITY_LABEL[item.rarity ?? 'normal']}</dd>
            <dt className="text-marble-500">Item level</dt>
            <dd>{item.itemLevel ?? '—'}</dd>
            <dt className="text-marble-500">Reward</dt>
            <dd className="font-semibold text-arcane-300" data-testid="salvage-reward">
              {salvageReward(item)} Arcane Fragment{salvageReward(item) === 1 ? '' : 's'}
            </dd>
          </dl>
          <p className="text-amber-200">The item is destroyed permanently.</p>
        </Confirm>
      )}
      {mode === 'revoke' && (
        <Confirm
          tone="blood"
          title={`Revoke ${item.name} from ${token.name}?`}
          confirm="Revoke item"
          onCancel={() => setMode('view')}
          onConfirm={async () => {
            if ((await run({ type: 'gmRevokeItem', tokenId: token.id, itemId: item.id, ...(reason.trim() ? { reason: reason.trim() } : {}) })).ok) setMode('view');
          }}
        >
          <p>Generated items return to the Arsenal tray; the action is recorded in the item audit log.</p>
          <input className={`${input} w-full`} placeholder="Reason (optional)" aria-label="Revoke reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
        </Confirm>
      )}
      {inspect && structured && (
        <div className={`mt-2 ${revealed ? 'apex-reveal' : ''}`}>
          <ItemInspect item={item} inventory={props.allItems} equipment={props.eq} containers={containers} rules={props.rules} gmView={props.isGm} onClose={() => setInspect(false)} />
        </div>
      )}
      {mode === 'split' && (
        <form
          className="mt-1.5 flex items-center gap-2 text-[11px] text-marble-300"
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await run({ type: 'invSplitStack', tokenId: token.id, itemId: item.id, rev, quantity: splitQty, newItemId: newEntryId('itm') })).ok) setMode('view');
          }}
        >
          Split off
          <input className={`${input} w-16 py-0.5 text-xs`} aria-label={`Quantity to split from ${item.name}`} type="number" min={1} max={item.quantity - 1} value={splitQty} onChange={(e) => setSplitQty(Math.max(1, Math.min(item.quantity - 1, Math.round(Number(e.target.value) || 1))))} />
          <button className="btn btn-gold px-2 py-0.5" type="submit">
            Confirm split
          </button>
          <button className="btn btn-ghost px-2 py-0.5" type="button" onClick={() => setMode('view')}>
            Cancel
          </button>
        </form>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <select
          aria-label={`Move ${item.name} to`}
          className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] text-marble-300"
          value={containerOfItem(item, containers)}
          onChange={(e) => props.onMove(item, e.target.value, null)}
        >
          {containers.map((c) => (
            <option key={c.id} value={c.id}>
              → {c.name}
            </option>
          ))}
        </select>
        {reorderable && (
          <>
            <button className="text-marble-500 hover:text-gold-200 disabled:opacity-30" aria-label={`Move ${item.name} up`} disabled={!props.prev} onClick={() => props.prev && props.onMove(item, containerOfItem(item, containers), props.prev.id)}>
              ↑
            </button>
            <button className="text-marble-500 hover:text-gold-200 disabled:opacity-30" aria-label={`Move ${item.name} down`} disabled={!props.next} onClick={() => props.next && props.onMove(props.next, containerOfItem(item, containers), item.id)}>
              ↓
            </button>
          </>
        )}
        <button
          className="text-marble-500 hover:text-gold-200"
          onClick={() => {
            setDraft({ name: item.name, description: item.description, notes: item.notes ?? '', quantity: item.quantity, weightKg: item.weightKg !== undefined ? String(item.weightKg) : '' });
            setMode('edit');
          }}
        >
          Edit
        </button>
        {isStackable(item) && item.quantity > 1 && (
          <button className="text-marble-500 hover:text-gold-200" onClick={() => (setSplitQty(1), setMode('split'))}>
            Split
          </button>
        )}
        {mergeTarget && (
          <button className="text-marble-500 hover:text-gold-200" title={`Merge into the other “${mergeTarget.name}” stack`} onClick={() => void run({ type: 'invMergeStack', tokenId: token.id, itemId: item.id, rev, intoItemId: mergeTarget.id, intoRev: mergeTarget.rev ?? 0 })}>
            Merge stacks
          </button>
        )}
      </div>
    </li>
  );
}

/** Item action menu: every action is listed; unavailable ones are disabled with the reason shown. */
function ItemActions(props: CardProps & { item: Item; close: () => void; onMode: (m: 'reroll' | 'salvage' | 'revoke' | 'augment' | 'ascend' | 'activate') => void; onRevealed: () => void }) {
  const { token, item, run, eq } = props;
  const purse = { currency: token.details?.currency };
  const actor = props.isGm ? ({ role: 'gm' } as const) : ({ role: 'player', tokenId: token.id } as const);
  const slot = slotOfItem(eq, item.id);
  const target = suggestSlot(eq, item);
  const rev = item.rev ?? 0;
  const rows: Array<{ label: string; check: Check; act: () => void }> = [
    {
      label: 'Identify',
      check: canIdentify(purse, item),
      act: async () => {
        props.close();
        if ((await run({ type: 'itemIdentify', tokenId: token.id, itemId: item.id, rev })).ok) props.onRevealed();
      },
    },
    slot
      ? { label: `Unequip (${SLOT_LABEL[slot]})`, check: { ok: true }, act: () => (props.close(), void run({ type: 'unequipSlot', tokenId: token.id, slot })) }
      : {
          label: target ? `Equip (${SLOT_LABEL[target]}${eq.slots[target] ? ', replaces current' : ''})` : 'Equip',
          check: item.identified === false ? { ok: false, reason: 'Identify this item before equipping it.' } : !item.equip ? { ok: false, reason: 'This item cannot be equipped.' } : !target ? { ok: false, reason: 'No fitting slot in the active weapon set.' } : { ok: true },
          act: () => (props.close(), target && void run({ type: 'equipItem', tokenId: token.id, itemId: item.id, slot: target })),
        },
    { label: 'Reroll (Orb of Renewal)', check: canReroll(purse, item), act: () => props.onMode('reroll') },
    { label: 'Augment (Orb of Augmentation)', check: canAugment(purse, item), act: () => props.onMode('augment') },
    { label: 'Ascend (Orb of Ascension)', check: canAscend(purse, item), act: () => props.onMode('ascend') },
    ...(uniqueDef(item.uniqueId)?.ability
      ? [{ label: `Activate: ${uniqueDef(item.uniqueId)!.ability!.name}`, check: canActivate({ equipment: token.details?.equipment, timeTwist: token.details?.timeTwist }, item), act: () => props.onMode('activate') }]
      : []),
    { label: 'Salvage', check: canSalvage({ equipment: token.details?.equipment }, item, actor), act: () => props.onMode('salvage') },
  ];
  if (props.isGm && item.charge) rows.push({ label: 'Recharge (GM, long rest)', check: item.charge.spent ? { ok: true } : { ok: false, reason: 'Already charged.' }, act: () => (props.close(), void run({ type: 'gmRechargeItem', tokenId: token.id, itemId: item.id })) });
  if (props.isGm) {
    rows.push({ label: 'Revoke (GM)', check: { ok: true }, act: () => props.onMode('revoke') });
    rows.push({ label: item.locked ? 'Lift GM restriction' : 'Restrict (no salvage/delete)', check: { ok: true }, act: () => (props.close(), void run({ type: 'gmSetItemLock', tokenId: token.id, itemId: item.id, locked: !item.locked })) });
  }
  rows.push({ label: 'Send to player', check: { ok: false, reason: 'Player-to-player transfers arrive in a later update.' }, act: () => undefined });
  return (
    <div role="menu" aria-label={`Actions for ${item.name}`} className="mt-1.5 grid gap-1 rounded-lg border border-gold-700/40 bg-ink-950/90 p-1.5 text-xs sm:grid-cols-2">
      {rows.map((r) => (
        <button
          key={r.label}
          role="menuitem"
          disabled={!r.check.ok}
          onClick={r.act}
          className="rounded-md border border-ink-600 px-2 py-1 text-left text-marble-100 hover:border-gold-400/70 hover:bg-gold-400/10 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-ink-600 disabled:hover:bg-transparent"
        >
          <span className="block font-medium">{r.label}</span>
          {!r.check.ok && <span className="block text-[10px] text-marble-500">{r.check.reason}</span>}
          {r.check.ok && r.label === 'Identify' && <span className="block text-[10px] text-marble-500">Uses 1 {CURRENCIES.seal.name} (you have {balanceOf(purse, 'seal')})</span>}
        </button>
      ))}
    </div>
  );
}

function Confirm({ title, confirm, tone, children, onConfirm, onCancel }: { title: string; confirm: string; tone: 'arcane' | 'blood'; children: React.ReactNode; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div role="alertdialog" aria-label={title} className={`mt-1.5 space-y-1.5 rounded-lg border p-2 text-xs text-marble-200 ${tone === 'arcane' ? 'border-arcane-400/60 bg-arcane-500/10' : 'border-blood-400/60 bg-blood-800/30'}`}>
      <p className="font-semibold text-marble-50">{title}</p>
      {children}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost px-2 py-0.5" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-gold px-2 py-0.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirm}
        </button>
      </div>
    </div>
  );
}

/** Strength score from the character sheet (one request; refreshed on sheet pings). */
function useStrength(game: GameApi | undefined, tokenId: string): number | null {
  const [str, setStr] = useState<number | null>(null);
  const sheets = game?.sheets;
  useEffect(() => {
    if (!sheets) return;
    let live = true;
    void sheets.load(tokenId).then((r) => live && setStr(r.ok ? strengthScore(r.sheet.sheet) : null));
    return () => {
      live = false;
    };
  }, [sheets, tokenId]);
  return str;
}

/** Carrying-capacity bonus (lb) from equipped, identified modifiers in active slots. */
function carryBonusLb(items: Item[], eq: Equipment, rules: ItemRules): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  const worn = activeSlots(eq)
    .map((slot) => ({ slot, item: eq.slots[slot] ? byId.get(eq.slots[slot]!) : undefined }))
    .filter((x): x is { slot: typeof x.slot; item: Item } => !!x.item);
  return itemBonuses(worn, rules).carry.value;
}
