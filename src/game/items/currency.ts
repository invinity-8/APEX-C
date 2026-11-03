/**
 * APEX magical currency (APEX 0.6) – original names. Balances live on the character token
 * (`token.currency`) and only ever change through server-validated commands.
 */
export type CurrencyId = 'seal' | 'orb' | 'fragment';
export const CURRENCY_IDS: CurrencyId[] = ['seal', 'orb', 'fragment'];
export const MAX_CURRENCY = 9999;

export const CURRENCIES: Record<CurrencyId, { name: string; plural: string; purpose: string; color: string }> = {
  seal: { name: 'Seal of Revelation', plural: 'Seals of Revelation', purpose: 'Identifies one unidentified item.', color: '#e3c25b' },
  orb: { name: 'Orb of Renewal', plural: 'Orbs of Renewal', purpose: 'Rerolls every modifier of one identified Magic or Rare item.', color: '#7da2ff' },
  fragment: { name: 'Arcane Fragment', plural: 'Arcane Fragments', purpose: 'Salvaged from equipment; combine them into Orbs of Renewal.', color: '#b48ce6' },
};

export const currencyLabel = (id: CurrencyId, n: number) => `${n} ${n === 1 ? CURRENCIES[id].name : CURRENCIES[id].plural}`;
export const balanceOf = (t: { currency?: Partial<Record<CurrencyId, number>> }, id: CurrencyId) => Math.max(0, Math.floor(t.currency?.[id] ?? 0));
