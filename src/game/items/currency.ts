/**
 * APEX magical currency (APEX 0.6) – original names. Balances live on the character token
 * (`token.currency`) and only ever change through server-validated commands.
 */
export type CurrencyId = 'gold' | 'seal' | 'orb' | 'augment' | 'ascend' | 'fragment';
/** APEX 0.7: Gold Pieces – the coin used at the GM Merchant – live in the same server-validated purse. */
export const CURRENCY_IDS: CurrencyId[] = ['gold', 'seal', 'orb', 'augment', 'ascend', 'fragment'];
export const MAX_CURRENCY = 99999;

export const CURRENCIES: Record<CurrencyId, { name: string; plural: string; purpose: string; color: string }> = {
  gold: { name: 'Gold Piece', plural: 'Gold Pieces', purpose: 'Coin of the Empire – spent and earned at the merchant.', color: '#e3b341' },
  seal: { name: 'Seal of Revelation', plural: 'Seals of Revelation', purpose: 'Identifies one unidentified item.', color: '#e3c25b' },
  orb: { name: 'Orb of Renewal', plural: 'Orbs of Renewal', purpose: 'Rerolls every modifier of one identified Magic or Rare item.', color: '#7da2ff' },
  augment: { name: 'Orb of Augmentation', plural: 'Orbs of Augmentation', purpose: 'Adds one random eligible modifier to an identified Magic or Rare item with a free affix slot.', color: '#5fc6a8' },
  ascend: { name: 'Orb of Ascension', plural: 'Orbs of Ascension', purpose: 'Raises an identified item one rarity step (Normal → Magic → Rare), keeping its modifiers.', color: '#e08a4a' },
  fragment: { name: 'Arcane Fragment', plural: 'Arcane Fragments', purpose: 'Salvaged from equipment; combine them into Orbs of Renewal.', color: '#b48ce6' },
};

export const currencyLabel = (id: CurrencyId, n: number) => `${n} ${n === 1 ? CURRENCIES[id].name : CURRENCIES[id].plural}`;
export const balanceOf = (t: { currency?: Partial<Record<CurrencyId, number>> }, id: CurrencyId) => Math.max(0, Math.floor(t.currency?.[id] ?? 0));
