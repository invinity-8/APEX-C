/**
 * GM Arsenal (APEX 0.6) – generate, preview and hand out items and magical currency during a live session.
 *
 * Flow: pick a base item → rarity → item level → identified or not → "Generate preview" (rolled on the SERVER into
 * the Arsenal tray, invisible to players) → "Give". "Generate & give" does both in one step. Generated items can be
 * revoked from inventories (they return to the tray) – everything is recorded in the item audit log.
 */
import { useMemo, useState } from 'react';
import type { Command } from '../game/commands';
import { BASE_ITEMS, baseItem, type BaseCategory, type BaseItem } from '../game/items/bases';
import { balanceOf, CURRENCIES, CURRENCY_IDS, type CurrencyId } from '../game/items/currency';
import { canRollMods } from '../game/items/generate';
import { CUBE_BASE, MAX_COUNT, MAX_STAGED, type GenRarity } from '../game/items/loot';
import { eligibleMods } from '../game/items/modifiers';
import { UNIQUES } from '../game/items/uniques';
import { CONSUMABLE_BASES, DRAFT_LIMITS, ENCOUNTER_TABLE, ENCOUNTERS, LOOT_CATEGORY_LABEL, POTION_BASE, ROLLED_CATEGORIES, type Encounter, type LootCategory, type LootDraft, type LootDraftEntry } from '../game/items/lootDraft';
import { BeastEditor } from './BeastEditor';
import { WidgetTabs } from '../workspace/WidgetTabs';
import { GmLootRolls } from './LootRolls';
import { MerchantAdmin } from './Merchant';
import { DEFAULT_MERCHANT } from '../game/items/merchant';
import { CosmeticGrants } from './Cosmetics';
import { itemRulesOf, ITEM_RULE_LIMITS, MAX_ITEM_LEVEL, RARITY_LABEL } from '../game/items/rules';
import { newEntryId } from '../game/sheet';
import type { GameState, Item, Token } from '../game/types';
import type { DispatchResult } from '../state/gameApi';
import { ItemBadges, RARITY_STYLE } from './itemPresentation';
import { CurrencyIcon, ItemInspect } from './items/ItemUi';

type Run = (cmd: Command) => Promise<DispatchResult>;
const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const CATEGORY_LABEL: Partial<Record<BaseCategory, string>> = {
  weapon: 'Weapons',
  armor: 'Armour',
  shield: 'Shields',
  ring: 'Rings',
  amulet: 'Amulets',
  cloak: 'Cloaks',
  head: 'Helmets',
  gloves: 'Gloves',
  boots: 'Boots',
  belt: 'Belts',
  gear: 'Gear',
  consumable: 'Consumables',
  material: 'Materials',
  quest: 'Quest items',
};

export function ArsenalPanel({ state, run }: { state: GameState; run: Run }) {
  const [requestEdits, setRequestEdits] = useState<Record<string, { name?: string; description?: string; notes?: string; quantity?: number }>>({});
  const players = Object.values(state.tokens).filter((t) => t.kind === 'player');
  const pendingItemRequests = players.flatMap(t => (t.itemRequests ?? []).filter(r => r.status === 'pending').map(request => ({ token: t, request })));
  const staged = state.arsenal?.staged ?? [];
  const open = (state.lootRolls ?? []).filter((r) => r.status === 'open').length;
  return (
    <div className="mx-auto max-w-7xl space-y-3 p-3" aria-label="GM Arsenal">
      <h2 className="font-display text-2xl font-black text-gold-200">Arsenal</h2>
      {pendingItemRequests.length > 0 && <section className="panel space-y-2 p-3" aria-label="Pending narrative item requests">
        <h3 className="panel-title">Pending player item requests <span className="ml-1 text-xs text-gold-200">{pendingItemRequests.length}</span></h3>
        <ul className="space-y-2">{pendingItemRequests.map(({ token, request }) => {
          const edit = requestEdits[request.id] ?? {};
          const set = (patch: typeof edit) => setRequestEdits(prev => ({ ...prev, [request.id]: { ...prev[request.id], ...patch } }));
          return <li key={`${token.id}:${request.id}`} className="grid gap-2 rounded-lg border border-ink-600 bg-ink-800/50 p-2 sm:grid-cols-[8rem_1fr_1fr_5rem_auto]" data-item-request={request.id}>
            <div className="text-xs text-marble-400">{token.name} · day {request.createdDay}</div>
            <input className={input} aria-label={`Edit ${request.name} name`} value={edit.name ?? request.name} onChange={e => set({ name: e.target.value })} />
            <input className={input} aria-label={`Edit ${request.name} description`} placeholder="Description" value={edit.description ?? request.description} onChange={e => set({ description: e.target.value })} />
            <input className={input} aria-label={`Edit ${request.name} quantity`} type="number" min={1} value={edit.quantity ?? request.quantity} onChange={e => set({ quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
            <div className="flex gap-1"><button className="btn btn-gold px-2" onClick={() => void run({ type: 'gmReviewItemRequest', tokenId: token.id, requestId: request.id, decision: 'approve', edits: { name: edit.name ?? request.name, description: edit.description ?? request.description, notes: edit.notes ?? request.notes ?? '', quantity: edit.quantity ?? request.quantity, ...(request.weightKg !== undefined ? { weightKg: request.weightKg } : {}), ...(request.container ? { container: request.container } : {}) } })}>Approve</button><button className="btn btn-ghost px-2" onClick={() => void run({ type: 'gmReviewItemRequest', tokenId: token.id, requestId: request.id, decision: 'reject' })}>Reject</button></div>
            <label className="text-xs text-marble-400 sm:col-start-2 sm:col-span-2">Notes<input className={`${input} mt-1 w-full`} aria-label={`Edit ${request.name} notes`} value={edit.notes ?? request.notes ?? ''} onChange={e => set({ notes: e.target.value })} /></label>
          </li>;
        })}</ul>
      </section>}
      {/* APEX 0.7 consolidation: one area per task; the tray (shared by all of them) stays visible on the side */}
      <div className="grid items-start gap-3 lg:grid-cols-[1fr_22rem]">
        <WidgetTabs
          id="arsenal"
          tabs={[
            {
              id: 'items',
              label: '⚒ Create items',
              render: () => (
                <div className="space-y-3">
                  <Generator players={players} run={run} trayFull={staged.length >= MAX_STAGED} />
                  <UniquesAndTwists players={players} run={run} />
                </div>
              ),
            },
            {
              id: 'loot',
              label: '🎲 Loot',
              badge: open,
              render: () => (
                <div className="space-y-3">
                  <LootDraftPanel draft={state.arsenal?.draft} run={run} trayFree={MAX_STAGED - staged.length} />
                  <GmLootRolls rolls={state.lootRolls ?? []} staged={staged} players={players.map((p) => ({ id: p.id, name: p.name }))} run={run} />
                </div>
              ),
            },
            { id: 'merchant', label: `🏛 Merchant${state.merchant?.active ? ' (open)' : ''}`, render: () => <MerchantAdmin merchant={state.merchant ?? DEFAULT_MERCHANT} staged={staged} run={run} /> },
            {
              id: 'characters',
              label: '👥 Characters',
              render: () => (
                <div className="space-y-3">
                  <CurrencyGrants players={players} run={run} />
                  <Inventories players={players} run={run} rules={itemRulesOf(state)} />
                  <CosmeticGrants players={players} run={run} />
                </div>
              ),
            },
            {
              id: 'rules',
              label: '⚖ Rules & log',
              render: () => (
                <div className="space-y-3">
                  <Balance state={state} run={run} />
                  <BeastEditor beasts={state.customBeasts ?? []} run={run} />
                  <AuditLog state={state} />
                </div>
              ),
            },
          ]}
        />
        <div className="lg:sticky lg:top-2">
          <Tray staged={staged} players={players} run={run} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- generator

function Generator({ players, run, trayFull }: { players: Token[]; run: Run; trayFull: boolean }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<BaseCategory | 'all'>('all');
  const [baseId, setBaseId] = useState('srd-longsword');
  const [rarity, setRarity] = useState<GenRarity>('rare');
  const [ilvl, setIlvl] = useState(12);
  const [unidentified, setUnidentified] = useState(true);
  const [count, setCount] = useState(1);
  const [target, setTarget] = useState(players[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [showMods, setShowMods] = useState(false);
  const base = baseItem(baseId);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return BASE_ITEMS.filter((b) => b.category !== 'currency' && (cat === 'all' || b.category === cat) && (!n || `${b.name} ${b.subtype}`.toLowerCase().includes(n)));
  }, [q, cat]);
  const rollable = !!base?.equip && canRollMods(base);
  const effRarity: GenRarity = rollable ? rarity : 'normal';
  const hidden = unidentified && effRarity !== 'normal';
  const go = async (giveTo?: string) => {
    if (!base) return;
    setBusy(true);
    try {
      await run({
        type: 'arsenalGenerate',
        stagedId: newEntryId('itm'),
        baseId: base.id,
        rarity: effRarity,
        itemLevel: ilvl,
        identified: !hidden,
        ...(base.stackable ? { quantity: count } : count > 1 ? { count } : {}),
        ...(giveTo ? { giveTo } : {}),
      });
    } finally {
      setBusy(false);
    }
  };
  const pool = base ? eligibleMods(base.modTags, ilvl) : [];
  return (
    <section className="panel space-y-2 p-3" aria-label="Generate item">
      <h3 className="panel-title">Generate an item</h3>
      <div className="flex flex-wrap gap-2 text-xs">
        <input className={`${input} min-w-[10rem] flex-1`} placeholder="Search base items…" aria-label="Search base items" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={input} aria-label="Base item category" value={cat} onChange={(e) => setCat(e.target.value as BaseCategory | 'all')}>
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ul className="max-h-48 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900/50 text-sm" role="listbox" aria-label="Base items">
        {list.map((b) => (
          <li key={b.id}>
            <button role="option" aria-selected={b.id === baseId} className={`flex w-full items-baseline gap-2 px-2 py-1 text-left ${b.id === baseId ? 'bg-gold-400/15 text-gold-100' : 'text-marble-200 hover:bg-ink-800'}`} onClick={() => setBaseId(b.id)}>
              <span className="flex-1">{b.name}</span>
              <span className="text-[10px] text-marble-500">{b.subtype}</span>
              <span className="text-[10px] text-marble-600">{b.source.name === 'SRD 5.1' ? 'SRD' : 'APEX'}</span>
            </button>
          </li>
        ))}
        {!list.length && <li className="px-2 py-2 text-xs text-marble-500">No base item matches.</li>}
      </ul>
      {base && <BaseSummary base={base} />}
      <div className="grid gap-2 text-xs text-marble-300 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-1">Rarity</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Rarity">
            {(['normal', 'magic', 'rare'] as GenRarity[]).map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={effRarity === r}
                disabled={!rollable && r !== 'normal'}
                onClick={() => setRarity(r)}
                className="flex-1 rounded-md border px-2 py-1 font-semibold disabled:opacity-40"
                style={{ color: RARITY_STYLE[r].color, borderColor: effRarity === r ? RARITY_STYLE[r].color : 'rgba(80,80,90,.6)', background: effRarity === r ? 'rgba(227,194,91,.08)' : undefined }}
              >
                {RARITY_LABEL[r]}
              </button>
            ))}
          </div>
          {!rollable && <p className="mt-1 text-[10px] text-marble-500">This base cannot carry modifiers.</p>}
        </fieldset>
        <label>
          Item level <strong className="text-marble-50">{ilvl}</strong>
          <div className="flex items-center gap-2">
            <input type="range" min={1} max={MAX_ITEM_LEVEL} value={ilvl} onChange={(e) => setIlvl(Number(e.target.value))} className="flex-1 accent-amber-400" aria-label="Item level slider" />
            <input className={`${input} w-16`} type="number" min={1} max={MAX_ITEM_LEVEL} value={ilvl} aria-label="Item level" onChange={(e) => setIlvl(Math.max(1, Math.min(MAX_ITEM_LEVEL, Math.round(Number(e.target.value) || 1))))} />
          </div>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hidden} disabled={effRarity === 'normal'} onChange={(e) => setUnidentified(e.target.checked)} />
          Unidentified (needs a Seal of Revelation)
        </label>
        <label>
          {base?.stackable ? 'Quantity' : 'Number of items (each rolled separately)'}
          <input className={`${input} ml-2 w-16`} type="number" min={1} max={base?.stackable ? 99 : MAX_COUNT} value={count} aria-label={base?.stackable ? 'Quantity' : 'Number of items'} onChange={(e) => setCount(Math.max(1, Math.min(base?.stackable ? 99 : MAX_COUNT, Math.round(Number(e.target.value) || 1))))} />
        </label>
      </div>
      {rollable && (
        <div className="text-xs">
          <button className="text-marble-400 hover:text-gold-200" aria-expanded={showMods} onClick={() => setShowMods((v) => !v)}>
            {showMods ? '▾' : '▸'} Possible modifiers at item level {ilvl} ({pool.length})
          </button>
          {showMods && (
            <ul className="mt-1 grid gap-x-3 text-[11px] text-marble-300 sm:grid-cols-2" aria-label="Possible modifiers">
              {pool.map(({ def, tiers }) => (
                <li key={def.id}>
                  <span className="text-marble-500">{def.affix === 'prefix' ? 'P' : 'S'}</span> {def.text.replace('{v}', `${tiers[0].min}–${tiers[tiers.length - 1].max}`)} <span className="text-marble-600">(T{tiers.map((t) => t.tier).join(',')})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 pt-2">
        <button className="btn btn-ghost" disabled={busy || !base || trayFull} onClick={() => void go()} title={trayFull ? 'The tray is full' : 'Roll on the server and show the result in the tray first'}>
          Generate preview
        </button>
        <span className="flex-1" />
        <select className={input} aria-label="Give to character" value={target} onChange={(e) => setTarget(e.target.value)}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="btn btn-gold" disabled={busy || !base || !target} onClick={() => void go(target)}>
          Generate &amp; give
        </button>
      </div>
      <p className="text-[11px] text-marble-500">
        {RARITY_LABEL[effRarity]} {base?.name ?? ''}, item level {ilvl}
        {hidden ? ', unidentified' : ''} – modifiers are rolled on the server; players never see unidentified modifiers.
      </p>
    </section>
  );
}

function BaseSummary({ base }: { base: BaseItem }) {
  const e = base.equip;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/50 px-2 py-1.5 text-[11px] text-marble-300">
      <span className="font-semibold text-marble-50">{base.name}</span> · {base.subtype}
      {e?.damage && ` · ${e.damage} ${e.damageType}`}
      {e?.properties?.length ? ` · ${e.properties.join(', ')}` : ''}
      {e?.armorBase && ` · AC ${e.armorBase}`}
      {e?.acBonus && ` · AC +${e.acBonus}`}
      {base.requirements?.str && ` · Str ${base.requirements.str}`}
      {` · ${base.weight} lb`}
      {base.price !== undefined && ` · ${base.price} gp`}
      <span className="ml-1 text-marble-600">({base.source.name})</span>
    </div>
  );
}

// ---------------------------------------------------------------- uniques + pending time twists (APEX 0.7)

function UniquesAndTwists({ players, run }: { players: Token[]; run: Run }) {
  const [to, setTo] = useState(players[0]?.id ?? '');
  const pending = players.filter((p) => p.timeTwist);
  const spent = players.flatMap((p) => p.inventory.filter((i) => i.charge?.spent).map((i) => ({ p, i })));
  return (
    <section className="panel space-y-2 p-3" aria-label="Unique items">
      <h3 className="panel-title">Unique items</h3>
      <p className="text-[11px] text-marble-500">Uniques are created by hand only – they never appear in random loot.</p>
      {UNIQUES.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#c9733a]/50 bg-[#c9733a]/10 p-2 text-xs" data-unique-def={u.id}>
          <b className="text-[#e8a06a]">{u.name}</b>
          <span className="text-marble-400">
            {baseItem(u.baseId)?.name} · item level {u.itemLevel}
            {u.ability ? ` · ${u.ability.name}` : ''}
          </span>
          <span className="flex-1" />
          <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'arsenalGenerateUnique', stagedId: newEntryId('itm'), uniqueId: u.id })}>
            Preview in tray
          </button>
          <select className={input} aria-label={`Give ${u.name} to`} value={to} onChange={(e) => setTo(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-gold px-2 py-0.5" onClick={() => void run({ type: 'arsenalGenerateUnique', stagedId: newEntryId('itm'), uniqueId: u.id, giveTo: to })}>
            Create &amp; give
          </button>
        </div>
      ))}
      {pending.length > 0 && (
        <div className="space-y-1" aria-label="Pending postponed turns">
          <h4 className="text-[11px] uppercase tracking-wider text-arcane-300">Postponed turns waiting for you</h4>
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-arcane-400/50 p-2 text-xs" data-twist={p.id}>
              <span className="flex-1">
                ⏳ <b>{p.name}</b> skipped a turn with {p.timeTwist!.itemName} (day {p.timeTwist!.day}) – give two consecutive turns at their next turn.
              </span>
              <button className="btn btn-gold px-2 py-0.5" onClick={() => void run({ type: 'gmTimeTwist', tokenId: p.id, action: 'resolve' })}>
                Double turn taken
              </button>
              <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'gmTimeTwist', tokenId: p.id, action: 'cancel' })} title="Encounter ended or the character was incapacitated">
                Lost (cancel)
              </button>
            </div>
          ))}
        </div>
      )}
      {spent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-marble-400">Spent abilities:</span>
          {spent.map(({ p, i }) => (
            <button key={i.id} className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'gmRechargeItem', tokenId: p.id, itemId: i.id })}>
              Recharge {i.name} ({p.name})
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- tray

function Tray({ staged, players, run }: { staged: Item[]; players: Token[]; run: Run }) {
  const [to, setTo] = useState<Record<string, string>>({});
  return (
    <section className="panel space-y-2 p-3" aria-label="Arsenal tray">
      <h3 className="panel-title">
        Tray – preview &amp; give <span className="text-marble-500">({staged.length}/{MAX_STAGED})</span>
      </h3>
      {!staged.length && <p className="text-xs text-marble-500">Generated previews appear here. Players cannot see this tray.</p>}
      <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
        {[...staged].reverse().map((item) => {
          const target = to[item.id] ?? players[0]?.id ?? '';
          return (
            <li key={item.id} data-staged={item.id}>
              <ItemInspect item={item} inventory={[]} gmView />
              <div className="mt-1 flex items-center gap-2 text-xs">
                <select className={input} aria-label={`Give ${item.name} to`} value={target} onChange={(e) => setTo({ ...to, [item.id]: e.target.value })}>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn-gold px-2 py-0.5" onClick={() => void run({ type: 'arsenalGive', stagedId: item.id, tokenId: target })}>
                  Give
                </button>
                <span className="flex-1" />
                <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'arsenalDiscard', stagedId: item.id })}>
                  Discard
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- loot drafts (APEX 0.7)

const LEVEL_KEY = 'apex.loot.partyLevel';
const readLevel = () => {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return n >= 1 && n <= 20 ? Math.floor(n) : 5;
  } catch {
    return 5;
  }
};

function entryLabel(e: LootDraftEntry): string {
  if (e.currency) return `${e.quantity} × ${CURRENCIES[e.currency].plural}`;
  if (e.category === 'quest' || e.category === 'custom') return `${e.quantity > 1 ? `${e.quantity} × ` : ''}${e.name}`;
  const b = baseItem(e.baseId);
  return `${e.quantity > 1 ? `${e.quantity} × ` : ''}${b?.name ?? e.baseId}`;
}

function LootDraftPanel({ draft, run, trayFree }: { draft?: LootDraft; run: Run; trayFree: number }) {
  const [encounter, setEncounter] = useState<Encounter>('standard');
  const [level, setLevel] = useState(readLevel);
  const [useMedian, setUseMedian] = useState(true);
  const [cats, setCats] = useState<LootCategory[]>(ROLLED_CATEGORIES.filter((c) => c !== 'currency' && c !== 'orb'));
  const [busy, setBusy] = useState(false);
  const act = async (cmd: Command) => {
    setBusy(true);
    try {
      return await run(cmd);
    } finally {
      setBusy(false);
    }
  };
  const roll = () => {
    try {
      localStorage.setItem(LEVEL_KEY, String(level));
    } catch {
      /* private mode */
    }
    void act({ type: 'lootDraftCreate', draftId: newEntryId('drop'), encounter, ...(useMedian ? {} : { referenceLevel: level }), categories: cats });
  };
  return (
    <section className="panel space-y-2 p-3" aria-label="Loot drop">
      <h3 className="panel-title">Loot drop · draft &amp; approve</h3>
      {!draft && (
        <div className="space-y-2 text-xs text-marble-300">
          <p className="text-marble-500">Roll a drop on the server, check and edit it, then approve it into the Arsenal tray. Nothing is given automatically; players see nothing until you give an item.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              Encounter
              <select className={input} aria-label="Encounter type" value={encounter} onChange={(e) => setEncounter(e.target.value as Encounter)}>
                {ENCOUNTERS.map((x) => (
                  <option key={x} value={x}>
                    {ENCOUNTER_TABLE[x].label} – {ENCOUNTER_TABLE[x].rolls} roll{ENCOUNTER_TABLE[x].rolls > 1 ? 's' : ''}, item level +{ENCOUNTER_TABLE[x].ilvlBonus}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1 pb-1">
              <input type="checkbox" checked={useMedian} onChange={(e) => setUseMedian(e.target.checked)} />
              Party median level (from the character sheets)
            </label>
            {!useMedian && (
              <label className="flex flex-col gap-0.5">
                Party level
                <input className={`${input} w-20`} type="number" min={1} max={20} aria-label="Reference character level" value={level} onChange={(e) => setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
              </label>
            )}
          </div>
          <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
            <legend className="mb-1">Categories that can drop</legend>
            {ROLLED_CATEGORIES.map((c) => (
              <label key={c} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={cats.includes(c)} onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} />
                {LOOT_CATEGORY_LABEL[c]}
              </label>
            ))}
          </fieldset>
          <p className="text-[11px] text-marble-500">Rarity weights (normal / magic / rare): {ENCOUNTER_TABLE[encounter].rarity.join(' / ')}{encounter === 'boss' ? ' · boss item level +0 (85 %), +1 (12 %), +2 (3 %)' : ''}. Quest and custom items are added by hand.</p>
          <button className="btn btn-gold" disabled={busy || !cats.length} onClick={roll}>
            Roll loot draft
          </button>
        </div>
      )}
      {draft && <DraftEditor draft={draft} act={act} busy={busy} trayFree={trayFree} />}
    </section>
  );
}

function DraftEditor({ draft, act, busy, trayFree }: { draft: LootDraft; act: (c: Command) => Promise<DispatchResult>; busy: boolean; trayFree: number }) {
  const edit = (op: Extract<Command, { type: 'lootDraftEdit' }>['op']) => act({ type: 'lootDraftEdit', rev: draft.rev, op });
  return (
    <div className="space-y-2 text-xs" data-draft={draft.id}>
      <p className="text-marble-400">
        {ENCOUNTER_TABLE[draft.encounter].label} drop · party level {draft.referenceLevel} · {draft.entries.length} entr{draft.entries.length === 1 ? 'y' : 'ies'} · not yet created
      </p>
      <ul className="space-y-1" aria-label="Draft entries">
        {draft.entries.map((e) => {
          const equipment = e.category === 'weapon' || e.category === 'armor' || e.category === 'accessory';
          return (
            <li key={e.key} data-entry={e.key} className="flex flex-wrap items-center gap-2 rounded border border-ink-700 bg-ink-900/50 px-2 py-1">
              <span className="min-w-[10rem] flex-1">
                <span className="text-[10px] uppercase tracking-wider text-marble-500">{LOOT_CATEGORY_LABEL[e.category]} · </span>
                <span style={e.rarity ? { color: RARITY_STYLE[e.rarity].color } : undefined}>{entryLabel(e)}</span>
                {e.category === 'quest' && <span className="ml-1 text-[10px] text-gold-300">{e.salvageable ? '' : 'no salvage'}{e.noTransfer ? ' · no transfer' : ''}</span>}
              </span>
              {equipment ? (
                <>
                  <select className={input} aria-label={`Rarity of ${entryLabel(e)}`} value={e.rarity} disabled={busy} onChange={(ev) => void edit({ kind: 'set', key: e.key, rarity: ev.target.value as GenRarity })}>
                    {(['normal', 'magic', 'rare'] as GenRarity[]).map((r) => (
                      <option key={r} value={r}>
                        {RARITY_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1">
                    ilvl
                    <input className={`${input} w-14`} type="number" min={1} max={MAX_ITEM_LEVEL} aria-label={`Item level of ${entryLabel(e)}`} defaultValue={e.itemLevel} key={`${e.key}-${draft.rev}`} disabled={busy} onBlur={(ev) => Number(ev.target.value) !== e.itemLevel && void edit({ kind: 'set', key: e.key, itemLevel: Math.max(1, Math.min(MAX_ITEM_LEVEL, Number(ev.target.value) || 1)) })} />
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" aria-label={`${entryLabel(e)} identified`} checked={e.identified !== false} disabled={busy || e.rarity === 'normal'} onChange={(ev) => void edit({ kind: 'set', key: e.key, identified: ev.target.checked })} />
                    identified
                  </label>
                </>
              ) : (
                <label className="inline-flex items-center gap-1">
                  qty
                  <input className={`${input} w-16`} type="number" min={1} max={DRAFT_LIMITS.quantity} aria-label={`Quantity of ${entryLabel(e)}`} defaultValue={e.quantity} key={`${e.key}-${draft.rev}`} disabled={busy} onBlur={(ev) => Number(ev.target.value) !== e.quantity && void edit({ kind: 'set', key: e.key, quantity: Math.max(1, Math.min(DRAFT_LIMITS.quantity, Number(ev.target.value) || 1)) })} />
                </label>
              )}
              <button className="btn btn-ghost px-2 py-0.5" aria-label={`Remove ${entryLabel(e)}`} disabled={busy} onClick={() => void edit({ kind: 'remove', key: e.key })}>
                Remove
              </button>
            </li>
          );
        })}
        {!draft.entries.length && <li className="text-marble-500">The draft is empty.</li>}
      </ul>
      <AddEntry onAdd={(entry) => edit({ kind: 'add', entry })} busy={busy || draft.entries.length >= DRAFT_LIMITS.entries} />
      <div className="flex items-center gap-2 border-t border-ink-700 pt-2">
        <button className="btn btn-gold" disabled={busy || !draft.entries.length || draft.entries.length > trayFree} onClick={() => void act({ type: 'lootDraftApprove', rev: draft.rev })}>
          Approve final pool → Arsenal tray
        </button>
        {draft.entries.length > trayFree && <span className="text-amber-300">The tray has room for {trayFree} more item(s).</span>}
        <span className="flex-1" />
        <button className="btn btn-ghost" disabled={busy} onClick={() => void act({ type: 'lootDraftDiscard' })}>
          Discard draft
        </button>
      </div>
    </div>
  );
}

type AddKind = 'quest' | 'custom' | 'potion' | 'consumable' | 'seal' | 'orb' | 'fragment' | 'currency' | 'weapon' | 'armor' | 'accessory';
const ADDABLE: AddKind[] = ['quest', 'custom', 'potion', 'consumable', 'seal', 'orb', 'fragment', 'currency', 'weapon', 'armor', 'accessory'];
const EQUIP_BASES: Record<'weapon' | 'armor' | 'accessory', (b: BaseItem) => boolean> = {
  weapon: (b) => b.category === 'weapon',
  armor: (b) => b.category === 'armor' || b.category === 'shield',
  accessory: (b) => ['ring', 'amulet', 'cloak', 'head', 'gloves', 'boots', 'belt'].includes(b.category) && canRollMods(b),
};

function AddEntry({ onAdd, busy }: { onAdd: (e: LootDraftEntry) => Promise<DispatchResult>; busy: boolean }) {
  const [kind, setKind] = useState<AddKind>('quest');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [gmNotes, setGmNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [noTransfer, setNoTransfer] = useState(false);
  const [salvageable, setSalvageable] = useState(false);
  const [baseId, setBaseId] = useState('');
  const [currency, setCurrency] = useState<CurrencyId>('augment');
  const [rarity, setRarity] = useState<GenRarity>('magic');
  const [ilvl, setIlvl] = useState(5);
  const named = kind === 'quest' || kind === 'custom';
  const equipment = kind === 'weapon' || kind === 'armor' || kind === 'accessory';
  const bases = equipment ? BASE_ITEMS.filter(EQUIP_BASES[kind]) : kind === 'consumable' ? CONSUMABLE_BASES.map((id) => baseItem(id)!).filter(Boolean) : [];
  const chosenBase = bases.some((b) => b.id === baseId) ? baseId : bases[0]?.id;
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const entry: LootDraftEntry = {
      key: newEntryId('e'),
      category: kind,
      quantity: equipment ? 1 : quantity,
      ...(named ? { name, ...(description.trim() ? { description } : {}) } : {}),
      ...(kind === 'quest' ? { ...(image.trim() ? { image: image.trim() } : {}), ...(gmNotes.trim() ? { gmNotes } : {}), noTransfer, salvageable } : {}),
      ...(kind === 'potion' ? { baseId: POTION_BASE } : {}),
      ...(kind === 'consumable' || equipment ? { baseId: chosenBase } : {}),
      ...(kind === 'currency' ? { currency } : {}),
      ...(equipment ? { rarity, itemLevel: ilvl, identified: rarity === 'normal' } : {}),
    };
    const r = await onAdd(entry);
    if (r.ok) {
      setName('');
      setDescription('');
      setImage('');
      setGmNotes('');
      setQuantity(1);
    }
  };
  return (
    <form className="space-y-1.5 rounded border border-dashed border-ink-600 p-2 text-xs text-marble-300" aria-label="Add to draft" onSubmit={(e) => void submit(e)}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          Add
          <select className={input} aria-label="Entry type" value={kind} onChange={(e) => setKind(e.target.value as AddKind)}>
            {ADDABLE.map((k) => (
              <option key={k} value={k}>
                {LOOT_CATEGORY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {(equipment || kind === 'consumable') && (
          <select className={input} aria-label="Base item for the entry" value={chosenBase} onChange={(e) => setBaseId(e.target.value)}>
            {bases.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {kind === 'currency' && (
          <select className={input} aria-label="Currency for the entry" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyId)}>
            {CURRENCY_IDS.map((c) => (
              <option key={c} value={c}>
                {CURRENCIES[c].plural}
              </option>
            ))}
          </select>
        )}
        {equipment && (
          <>
            <select className={input} aria-label="Rarity for the entry" value={rarity} onChange={(e) => setRarity(e.target.value as GenRarity)}>
              {(['normal', 'magic', 'rare'] as GenRarity[]).map((r) => (
                <option key={r} value={r}>
                  {RARITY_LABEL[r]}
                </option>
              ))}
            </select>
            <input className={`${input} w-14`} type="number" min={1} max={MAX_ITEM_LEVEL} aria-label="Item level for the entry" value={ilvl} onChange={(e) => setIlvl(Math.max(1, Math.min(MAX_ITEM_LEVEL, Number(e.target.value) || 1)))} />
          </>
        )}
        {!equipment && (
          <label className="flex flex-col gap-0.5">
            Quantity
            <input className={`${input} w-16`} type="number" min={1} max={DRAFT_LIMITS.quantity} aria-label="Quantity for the entry" value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(DRAFT_LIMITS.quantity, Number(e.target.value) || 1)))} />
          </label>
        )}
      </div>
      {named && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input className={input} placeholder="Name" aria-label="Item name" maxLength={DRAFT_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} required />
          {kind === 'quest' && <input className={input} placeholder="Image URL (https://…, optional)" aria-label="Image URL" maxLength={DRAFT_LIMITS.image} value={image} onChange={(e) => setImage(e.target.value)} />}
          <textarea className={`${input} sm:col-span-2`} rows={2} placeholder="Description (players see this)" aria-label="Item description" maxLength={DRAFT_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
          {kind === 'quest' && (
            <>
              <textarea className={`${input} sm:col-span-2`} rows={2} placeholder="GM notes (never shown to players)" aria-label="GM notes" maxLength={DRAFT_LIMITS.gmNotes} value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} />
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={noTransfer} onChange={(e) => setNoTransfer(e.target.checked)} /> Cannot be transferred
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={salvageable} onChange={(e) => setSalvageable(e.target.checked)} /> Salvageable (off by default)
              </label>
            </>
          )}
        </div>
      )}
      <button className="btn btn-ghost" type="submit" disabled={busy || (named && !name.trim())}>
        Add to draft
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- currency

function CurrencyGrants({ players, run }: { players: Token[]; run: Run }) {
  const [amount, setAmount] = useState<Record<string, number>>({});
  const key = (t: string, c: CurrencyId) => `${t}:${c}`;
  return (
    <section className="panel p-3" aria-label="Grant currency">
      <h3 className="panel-title mb-2">Purse &amp; currency</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-marble-500">
            <tr>
              <th className="text-left font-normal">Character</th>
              {CURRENCY_IDS.map((c) => (
                <th key={c} className="font-normal">
                  <span className="inline-flex items-center gap-1">
                    <CurrencyIcon id={c} size={16} /> {CURRENCIES[c].plural}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-t border-ink-700" data-currency-row={p.id}>
                <td className="py-1.5 font-semibold text-marble-50">{p.name}</td>
                {CURRENCY_IDS.map((c) => {
                  const k = key(p.id, c);
                  const n = amount[k] ?? (c === 'fragment' ? 10 : 1);
                  return (
                    <td key={c} className="px-1 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="w-8 text-right font-display text-base font-black tabular-nums" style={{ color: CURRENCIES[c].color }} data-balance={`${p.id}:${c}`}>
                          {balanceOf(p, c)}
                        </span>
                        <input className={`${input} w-14 py-0.5 text-xs`} type="number" min={1} max={999} value={n} aria-label={`${CURRENCIES[c].plural} amount for ${p.name}`} onChange={(e) => setAmount({ ...amount, [k]: Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))) })} />
                        <button className="btn btn-gold px-1.5 py-0.5" aria-label={`Give ${n} ${CURRENCIES[c].plural} to ${p.name}`} onClick={() => void run({ type: 'gmGrantCurrency', tokenId: p.id, currency: c, amount: n })}>
                          +
                        </button>
                        <button className="btn btn-ghost px-1.5 py-0.5" aria-label={`Remove ${n} ${CURRENCIES[c].plural} from ${p.name}`} disabled={balanceOf(p, c) < n} onClick={() => void run({ type: 'gmGrantCurrency', tokenId: p.id, currency: c, amount: -n })}>
                          −
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 border-t border-ink-700 pt-2 text-xs" aria-label="Transmutation access">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-marble-500">Arcane Transmutation access (Imperial Transmutation Cube)</div>
        <ul className="flex flex-wrap gap-2">
          {players.map((p) => {
            const carries = p.inventory.some((i) => i.baseId === CUBE_BASE);
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-md border border-ink-600 px-2 py-1" data-cube-row={p.id}>
                <b className="text-marble-100">{p.name}</b>
                <span className={carries || p.cubeAccess ? 'text-gold-200' : 'text-marble-500'}>{carries ? 'carries a cube' : p.cubeAccess ? 'permanent access' : 'locked'}</span>
                <label className="flex items-center gap-1 text-marble-300">
                  <input type="checkbox" checked={!!p.cubeAccess} onChange={(e) => void run({ type: 'gmSetCubeAccess', tokenId: p.id, permanent: e.target.checked })} aria-label={`Permanent transmutation access for ${p.name}`} />
                  permanent
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-[11px] text-marble-500">Grant the cube itself via “Generate” (base item “Imperial Transmutation Cube”). By default access needs the cube in the inventory; “permanent” keeps it unlocked without the cube.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- inventories

function Inventories({ players, run, rules }: { players: Token[]; run: Run; rules: ReturnType<typeof itemRulesOf> }) {
  const [who, setWho] = useState(players[0]?.id ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const t = players.find((p) => p.id === who);
  const items = (t?.inventory ?? []).filter((i) => i.baseId);
  return (
    <section className="panel space-y-2 p-3" aria-label="Inspect inventories">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="panel-title flex-1">Inventories</h3>
        <select className={input} aria-label="Inventory of" value={who} onChange={(e) => setWho(e.target.value)}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {t && (
        <p className="text-[11px] text-marble-500">
          {t.inventory.length} entries, {items.length} generated · full inventory with every action: “🎒 Inventory” tab.
        </p>
      )}
      {!items.length && <p className="text-xs text-marble-500">No generated items.</p>}
      <ul className="grid gap-2 md:grid-cols-2">
        {items.map((i) => (
          <li key={i.id} className="rounded-lg border border-ink-600 bg-ink-800/50 p-2 text-sm" data-gm-item={i.id}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <ItemBadges item={i} />
              </span>
              <button className="text-[11px] text-marble-400 hover:text-gold-200" onClick={() => setOpen(open === i.id ? null : i.id)}>
                {open === i.id ? 'Close' : 'Inspect'}
              </button>
            </div>
            {open === i.id && t && (
              <div className="mt-1.5 space-y-1.5">
                <ItemInspect item={i} inventory={t.inventory} equipment={t.equipment} containers={t.containers} rules={rules} gmView />
                <div className="flex items-center gap-2 text-xs">
                  <input className={`${input} flex-1 py-0.5 text-xs`} placeholder="Reason (optional)" aria-label="Revoke reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
                  <button
                    className="btn btn-ghost px-2 py-0.5 hover:border-blood-400/70 hover:text-blood-400"
                    onClick={async () => {
                      if ((await run({ type: 'gmRevokeItem', tokenId: t.id, itemId: i.id, ...(reason.trim() ? { reason: reason.trim() } : {}) })).ok) (setOpen(null), setReason(''));
                    }}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- audit + balance

const ACTION_LABEL: Record<string, string> = {
  generate: 'Generated',
  give: 'Given',
  discard: 'Discarded',
  revoke: 'Revoked',
  currency: 'Currency',
  lock: 'Restriction',
  identify: 'Identified',
  reroll: 'Rerolled',
  salvage: 'Salvaged',
  combine: 'Combined',
  augment: 'Augmented',
  ascend: 'Ascended',
  transmute: 'Transmuted',
  activate: 'Ability',
};

function AuditLog({ state }: { state: GameState }) {
  const list = [...(state.itemAudit ?? [])].reverse().slice(0, 60);
  return (
    <section className="panel p-3" aria-label="Item audit log">
      <h3 className="panel-title mb-1">Item audit log</h3>
      {!list.length && <p className="text-xs text-marble-500">Nothing recorded yet.</p>}
      <ul className="max-h-72 space-y-0.5 overflow-y-auto text-[11px]">
        {list.map((e) => (
          <li key={e.id} className="flex gap-2 border-b border-ink-800 py-0.5" data-audit={e.action}>
            <span className="w-14 shrink-0 text-marble-600">Day {e.day}</span>
            <span className="w-20 shrink-0 text-gold-300">{ACTION_LABEL[e.action] ?? e.action}</span>
            <span className="min-w-0 flex-1 text-marble-200">
              {e.itemName && <strong className="text-marble-50">{e.itemName} </strong>}
              {e.tokenId && <span className="text-marble-400">· {state.tokens[e.tokenId]?.name ?? e.tokenId} </span>}
              <span className="text-marble-400">· {e.detail}</span>
              <span className="text-marble-600"> · by {e.by}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Balance({ state, run }: { state: GameState; run: Run }) {
  const rules = itemRulesOf(state);
  const [draft, setDraft] = useState(rules);
  const fields: Array<[keyof typeof rules, string]> = [
    ['fragmentsPerOrb', 'Arcane Fragments per Orb of Renewal'],
    ['fragmentsPerRandomOrb', 'Fragments per random Orb (Transmutation)'],
    ['transmuteWeightRenewal', 'Transmutation weight: Renewal'],
    ['transmuteWeightAugment', 'Transmutation weight: Augmentation'],
    ['transmuteWeightAscension', 'Transmutation weight: Ascension'],
    ['encumbranceVariant', 'Variant encumbrance (0 = SRD standard, 1 = variant)'],
    ['resistanceCap', 'Resistance cap (points)'],
    ['toHitCap', 'To-hit cap per weapon'],
    ['acCap', 'AC cap'],
    ['saveCap', 'Save cap per ability'],
    ['maxHpCap', 'Max HP cap'],
    ['flatDamageCap', 'Flat damage cap per weapon'],
  ];
  return (
    <section className="panel space-y-1.5 p-3 text-xs" aria-label="Item balance">
      <h3 className="panel-title">Balance</h3>
      {fields.map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-marble-300">
          <span className="flex-1">{label}</span>
          <input className={`${input} w-16 py-0.5 text-xs`} type="number" min={ITEM_RULE_LIMITS[k][0]} max={ITEM_RULE_LIMITS[k][1]} value={draft[k]} aria-label={label} onChange={(e) => setDraft({ ...draft, [k]: Math.round(Number(e.target.value) || 0) })} />
          <span className="w-14 text-marble-600">
            {ITEM_RULE_LIMITS[k][0]}–{ITEM_RULE_LIMITS[k][1]}
          </span>
        </label>
      ))}
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'setItemRules', rules: null }).then((r) => r.ok && setDraft(itemRulesOf({})))}>
          Defaults
        </button>
        <button className="btn btn-gold px-2 py-0.5" onClick={() => void run({ type: 'setItemRules', rules: draft })}>
          Save balance
        </button>
      </div>
    </section>
  );
}

