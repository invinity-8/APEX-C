/**
 * GM Merchant UI (APEX 0.7). Rules and every check live on the server (src/game/items/merchant.ts); offers shown
 * here are previews of the same pure functions.
 */
import { useState } from 'react';
import type { Command } from '../game/commands';
import { balanceOf, CURRENCIES, CURRENCY_IDS, currencyLabel, type CurrencyId } from '../game/items/currency';
import { itemValue, MERCHANT_LIMITS, sellOffer, type Merchant } from '../game/items/merchant';
import type { Item, Token } from '../game/types';
import type { TokenView } from '../game/visibility';
import type { DispatchResult } from '../state/gameApi';
import { ItemBadges } from './itemPresentation';
import { CurrencyIcon, ItemInspect } from './items/ItemUi';

type Run = (cmd: Command) => Promise<DispatchResult>;
const input = 'rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-marble-50 focus:border-gold-400 focus:outline-none';
const clampInt = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || lo)));

function Price({ amount, currency }: { amount: number; currency: CurrencyId }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-gold-100">
      <CurrencyIcon id={currency} size={14} />
      {currencyLabel(currency, amount)}
    </span>
  );
}

// ---------------------------------------------------------------- player shop

export function MerchantShop({ merchant, me, run, busy }: { merchant: Merchant; me: TokenView; run: Run; busy?: boolean }) {
  const d = me.details;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [inspect, setInspect] = useState<string | null>(null);
  if (!d) return <p className="p-6 text-sm text-marble-500">Your character is not available.</p>;
  const purse = { currency: d.currency };
  const own = d.inventory.filter((i) => !i.grant);
  const go = (cmd: Command) => void run(cmd);
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3" aria-label="Merchant">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-2xl font-black text-gold-200">🏛 {merchant.name}</h2>
        <span className="text-xs text-marble-400">
          Your purse: <Price amount={balanceOf(purse, 'gold')} currency="gold" /> · Merchant’s coffers: {merchant.gold} gold · pays {merchant.buyRate} % of an item’s value
        </span>
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel space-y-1.5 p-3" aria-label="Merchant offers">
          <h3 className="panel-title">Buy</h3>
          {!merchant.stock.length && <p className="text-xs text-marble-500">The merchant has nothing for sale right now.</p>}
          <ul className="space-y-1.5">
            {merchant.stock.map((s) => {
              const n = Math.min(qty[s.id] ?? 1, s.item.quantity);
              const total = s.price * n;
              const afford = balanceOf(purse, s.currency) >= total;
              return (
                <li key={s.id} data-offer={s.id} className="rounded border border-ink-700 bg-ink-900/50 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setInspect(inspect === s.id ? null : s.id)} aria-expanded={inspect === s.id}>
                      <ItemBadges item={s.item} />
                      {s.item.quantity > 1 && <span className="ml-1 text-marble-500">({s.item.quantity} available)</span>}
                    </button>
                    <Price amount={s.price} currency={s.currency} />
                    {s.item.quantity > 1 && <input className={`${input} w-14`} type="number" min={1} max={s.item.quantity} aria-label={`Quantity of ${s.item.name}`} value={n} onChange={(e) => setQty({ ...qty, [s.id]: clampInt(e.target.value, 1, s.item.quantity) })} />}
                    <button className="btn btn-gold px-2 py-0.5" disabled={busy || !afford} title={afford ? undefined : `You need ${currencyLabel(s.currency, total)}.`} onClick={() => go({ type: 'merchantBuy', tokenId: me.id, stockId: s.id, quantity: n, merchantRev: merchant.rev, currencyRev: d.currencyRev ?? 0 })}>
                      Buy{n > 1 ? ` ${n}` : ''}
                    </button>
                  </div>
                  {inspect === s.id && (
                    <div className="mt-1.5">
                      <ItemInspect item={s.item} inventory={[]} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="panel space-y-1.5 p-3" aria-label="Sell to the merchant">
          <h3 className="panel-title">Sell</h3>
          {!own.length && <p className="text-xs text-marble-500">Your inventory is empty.</p>}
          <ul className="space-y-1">
            {own.map((i) => {
              const n = Math.min(qty[`sell-${i.id}`] ?? i.quantity, i.quantity);
              const offer = sellOffer(merchant, { inventory: d.inventory, equipment: d.equipment }, i, n);
              const gold = 'gold' in offer ? offer.gold : null;
              const short = gold !== null && gold > merchant.gold;
              return (
                <li key={i.id} data-sell={i.id} className="flex flex-wrap items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-ink-800/60">
                  <span className="min-w-0 flex-1">
                    <ItemBadges item={i} />
                    {i.quantity > 1 && <span className="ml-1 text-marble-500">× {i.quantity}</span>}
                  </span>
                  {gold === null ? (
                    <span className="text-marble-500">{'refused' in offer ? offer.refused : ''}</span>
                  ) : (
                    <>
                      {i.quantity > 1 && <input className={`${input} w-14`} type="number" min={1} max={i.quantity} aria-label={`Sell how many ${i.name}`} value={n} onChange={(e) => setQty({ ...qty, [`sell-${i.id}`]: clampInt(e.target.value, 1, i.quantity) })} />}
                      <Price amount={gold} currency="gold" />
                      <button className="btn btn-ghost px-2 py-0.5" disabled={busy || short} title={short ? `${merchant.name} cannot pay that much.` : undefined} onClick={() => go({ type: 'merchantSell', tokenId: me.id, itemId: i.id, quantity: n, rev: i.rev ?? 0, merchantRev: merchant.rev })}>
                        Sell
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-marble-500">Quest items, bound or restricted items, uniques and equipped items cannot be sold.</p>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- GM controls (Arsenal)

export function MerchantAdmin({ merchant, staged, run }: { merchant: Merchant; staged: Item[]; run: Run }) {
  const [name, setName] = useState(merchant.name);
  const [gold, setGold] = useState(String(merchant.gold));
  const [rate, setRate] = useState(String(merchant.buyRate));
  const [pick, setPick] = useState('');
  const [price, setPrice] = useState<Record<string, string>>({});
  const [cur, setCur] = useState<Record<string, CurrencyId>>({});
  const sellable = staged.filter((i) => !i.grant);
  const chosen = sellable.find((i) => i.id === pick) ?? sellable[0];
  const suggested = chosen ? (itemValue(chosen) ?? 1) : 1;
  return (
    <section className="panel space-y-2 p-3" aria-label="Merchant settings">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="panel-title flex-1">Merchant</h3>
        <label className="inline-flex items-center gap-1.5 text-xs text-marble-300">
          <input type="checkbox" checked={merchant.active} onChange={(e) => void run({ type: 'merchantSetup', active: e.target.checked })} />
          Open for players
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2 text-xs text-marble-300">
        <label className="flex flex-col gap-0.5">
          Name
          <input className={input} aria-label="Merchant name" maxLength={MERCHANT_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          Gold
          <input className={`${input} w-24`} type="number" min={0} max={MERCHANT_LIMITS.gold} aria-label="Merchant gold" value={gold} onChange={(e) => setGold(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          Pays % of value
          <input className={`${input} w-20`} type="number" min={0} max={100} aria-label="Buy rate in percent" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <button className="btn btn-ghost" onClick={() => void run({ type: 'merchantSetup', name, gold: clampInt(gold, 0, MERCHANT_LIMITS.gold), buyRate: clampInt(rate, 0, 100) })}>
          Save
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-ink-700 pt-2 text-xs text-marble-300">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
          Offer an item from the Arsenal tray
          <select className={input} aria-label="Tray item to offer" value={chosen?.id ?? ''} onChange={(e) => setPick(e.target.value)} disabled={!sellable.length}>
            {!sellable.length && <option value="">The tray is empty</option>}
            {sellable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.quantity > 1 ? ` × ${i.quantity}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          Price each
          <input className={`${input} w-24`} type="number" min={1} aria-label="Price for the new offer" placeholder={String(suggested)} value={price.new ?? ''} onChange={(e) => setPrice({ ...price, new: e.target.value })} />
        </label>
        <CurrencySelect value={cur.new ?? 'gold'} onChange={(c) => setCur({ ...cur, new: c })} label="Currency for the new offer" />
        <button
          className="btn btn-gold"
          disabled={!chosen}
          onClick={async () => {
            const r = await run({ type: 'merchantStockAdd', stagedId: chosen!.id, price: clampInt(price.new ?? String(suggested), 1, MERCHANT_LIMITS.price), currency: cur.new ?? 'gold' });
            if (r.ok) setPrice({ ...price, new: '' });
          }}
        >
          Offer
        </button>
      </div>
      {merchant.stock.length > 0 && (
        <ul className="space-y-1" aria-label="Merchant stock">
          {merchant.stock.map((s) => (
            <li key={s.id} data-stock={s.id} className="flex flex-wrap items-center gap-2 rounded border border-ink-700 bg-ink-900/50 px-2 py-1 text-xs">
              <span className="min-w-0 flex-1">
                <ItemBadges item={s.item} />
                {s.item.quantity > 1 && <span className="ml-1 text-marble-500">× {s.item.quantity}</span>}
              </span>
              <input className={`${input} w-20`} type="number" min={1} aria-label={`Price of ${s.item.name}`} value={price[s.id] ?? String(s.price)} onChange={(e) => setPrice({ ...price, [s.id]: e.target.value })} />
              <CurrencySelect value={cur[s.id] ?? s.currency} onChange={(c) => setCur({ ...cur, [s.id]: c })} label={`Currency of ${s.item.name}`} />
              <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'merchantStockUpdate', stockId: s.id, price: clampInt(price[s.id] ?? String(s.price), 1, MERCHANT_LIMITS.price), currency: cur[s.id] ?? s.currency })}>
                Set price
              </button>
              <button className="btn btn-ghost px-2 py-0.5" onClick={() => void run({ type: 'merchantStockRemove', stockId: s.id })}>
                Back to tray
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-marble-500">Stock is moved from and to the Arsenal tray – nothing is duplicated. Players sell for the reference value (SRD price × 1 / 3 / 8 for normal / magic / rare) × the rate above; sold items appear in the stock.</p>
    </section>
  );
}

function CurrencySelect({ value, onChange, label }: { value: CurrencyId; onChange: (c: CurrencyId) => void; label: string }) {
  return (
    <select className={input} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as CurrencyId)}>
      {CURRENCY_IDS.map((c) => (
        <option key={c} value={c}>
          {CURRENCIES[c].plural}
        </option>
      ))}
    </select>
  );
}

export type { Token };
