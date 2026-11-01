/**
 * Free-text inventory (APEX 0.3). Reads the character's inventory from the authoritative game
 * state and changes it only through commands (validated on the server). Every item edit names
 * the item's revision, so a change made on another device is never silently overwritten.
 */
import { useState, type FormEvent } from 'react';
import type { Command } from '../game/commands';
import { containerOfItem, DEFAULT_CONTAINERS, INVENTORY_LIMITS } from '../game/inventory';
import { newEntryId } from '../game/sheet';
import type { Item } from '../game/types';
import type { TokenView } from '../game/visibility';
import type { DispatchResult } from '../state/gameApi';

interface Props {
  token: TokenView;
  run: (cmd: Command) => Promise<DispatchResult>;
  busy: boolean;
}

const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';

export function InventoryPanel({ token, run, busy }: Props) {
  const details = token.details;
  const containers = details?.containers?.length ? details.containers : DEFAULT_CONTAINERS.map((c) => ({ ...c }));
  const items = details?.inventory ?? [];
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [target, setTarget] = useState(containers[0]?.id ?? 'backpack');
  const [newContainer, setNewContainer] = useState('');

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

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3" aria-label={`Inventory of ${token.name}`}>
      <section className="panel p-3">
        <h2 className="font-display text-2xl font-black text-gold-200">Inventory – {token.name}</h2>
        <form onSubmit={add} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-xs text-marble-300">
            New entry
            <input
              className={`${input} mt-1 w-full`}
              placeholder="e.g. Old iron key, wrapped in red cloth"
              value={name}
              maxLength={INVENTORY_LIMITS.name}
              onChange={(e) => setName(e.target.value)}
            />
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
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {containers.map((c) => {
          const inside = items.filter((i) => containerOfItem(i, containers) === c.id);
          return <ContainerCard key={c.id} token={token} container={c} items={inside} containers={containers} run={run} canDelete={containers.length > 1} />;
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

function ContainerCard({
  token,
  container,
  items,
  containers,
  run,
  canDelete,
}: {
  token: TokenView;
  container: { id: string; name: string };
  items: Item[];
  containers: Array<{ id: string; name: string }>;
  run: (cmd: Command) => Promise<DispatchResult>;
  canDelete: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(container.name);
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if ((await run({ type: 'invRenameContainer', tokenId: token.id, containerId: container.id, name: title })).ok) setRenaming(false);
  };
  return (
    <section className="panel p-3" aria-label={container.name} data-container={container.id}>
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
              {container.name} <span className="text-marble-500">({items.length})</span>
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
            {canDelete && (
              <button
                className="text-[11px] text-marble-500 hover:text-blood-400 disabled:opacity-40"
                disabled={items.length > 0}
                title={items.length ? 'Only empty containers can be deleted' : 'Delete this container'}
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
          {items.map((i) => (
            <ItemRow key={i.id} token={token} item={i} containers={containers} run={run} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-marble-500">Empty.</p>
      )}
    </section>
  );
}

function ItemRow({ token, item, containers, run }: { token: TokenView; item: Item; containers: Array<{ id: string; name: string }>; run: (cmd: Command) => Promise<DispatchResult> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: item.name, description: item.description, notes: item.notes ?? '', quantity: item.quantity });
  const rev = item.rev ?? 0;
  const update = (patch: Partial<{ name: string; description: string; notes: string; quantity: number; container: string }>) =>
    run({ type: 'invUpdateItem', tokenId: token.id, itemId: item.id, rev, ...patch });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if ((await update(draft)).ok) setEditing(false);
  };
  if (editing) {
    return (
      <li className="rounded-lg border border-gold-700/50 bg-ink-900/60 p-2">
        <form onSubmit={save} className="space-y-1.5 text-xs text-marble-300">
          <input className={`${input} w-full`} aria-label="Item name" value={draft.name} maxLength={INVENTORY_LIMITS.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <textarea className={`${input} min-h-12 w-full`} aria-label="Description" placeholder="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <textarea className={`${input} min-h-12 w-full`} aria-label="Notes" placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="flex items-center gap-2">
            <label>
              Qty{' '}
              <input className={`${input} w-16`} type="number" min={0} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </label>
            <span className="flex-1" />
            <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setEditing(false)}>
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
    <li className="rounded-lg border border-ink-600 bg-ink-800/50 p-2" data-item={item.id}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-marble-50">
            {item.quantity !== 1 && <span className="mr-1 font-semibold text-gold-200 tabular-nums">{item.quantity}×</span>}
            {item.name}
          </div>
          {item.description && <p className="text-xs text-marble-300">{item.description}</p>}
          {item.notes && <p className="text-xs italic text-marble-500">{item.notes}</p>}
          {item.willCapacity !== undefined && (
            <p className="text-[11px] text-arcane-300">
              Will charge {item.willCharge ?? 0} / {item.willCapacity}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button className="btn btn-ghost h-7 w-7 px-0" aria-label={`Decrease quantity of ${item.name}`} onClick={() => void update({ quantity: Math.max(0, item.quantity - 1) })}>
            −
          </button>
          <button className="btn btn-ghost h-7 w-7 px-0" aria-label={`Increase quantity of ${item.name}`} onClick={() => void update({ quantity: item.quantity + 1 })}>
            +
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <select
          aria-label={`Move ${item.name} to`}
          className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] text-marble-300"
          value={containerOfItem(item, containers)}
          onChange={(e) => void update({ container: e.target.value })}
        >
          {containers.map((c) => (
            <option key={c.id} value={c.id}>
              → {c.name}
            </option>
          ))}
        </select>
        <button
          className="text-marble-500 hover:text-gold-200"
          onClick={() => {
            setDraft({ name: item.name, description: item.description, notes: item.notes ?? '', quantity: item.quantity });
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          className="text-marble-500 hover:text-blood-400"
          onClick={() => confirm(`Remove “${item.name}” from the inventory?`) && void run({ type: 'invRemoveItem', tokenId: token.id, itemId: item.id, rev })}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
