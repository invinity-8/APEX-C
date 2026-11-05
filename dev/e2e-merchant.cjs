/**
 * Browser acceptance test of the APEX 0.7 GM Merchant (mock only, fresh server): GM opens the shop and offers tray
 * items, players buy and sell, double clicks and races never duplicate items or spend twice.
 *   npm run dev:mock   then   node dev/e2e-merchant.cjs [screenshot-dir]
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:5174';
const out = process.argv[2] || '.';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
  console.log(results.at(-1));
};
async function newDevice(b) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR: ${e.message}`));
  return page;
}
async function openProfile(page, name) {
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'Join Campaign' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name} –`) }).click();
}
const apiFetch = (page, op, body) =>
  page.evaluate(
    async ([op, body]) => {
      const r = await fetch(`/api/apex?op=${op}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-apex-csrf': '1' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [op, body],
  );
const waitText = (page, re, timeout = 10000) =>
  page.waitForFunction(([s, f]) => new RegExp(s, f).test(document.body.innerText), [re.source, re.flags], { timeout }).then(() => true, () => false);

async function player(b, profile, pw, name) {
  const p = await newDevice(b);
  await openProfile(p, profile);
  await p.getByLabel('Password', { exact: true }).fill(pw);
  await p.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(p, new RegExp(`Playing as ${name}`), 20000);
  return p;
}

(async () => {
  const b = await chromium.launch();
  const gm = await newDevice(b);
  await openProfile(gm, 'GM');
  await gm.getByRole('heading', { name: 'First-time setup' }).waitFor();
  const code = (await (await fetch(BASE + '/__mock/setup-code')).json()).code;
  await gm.getByLabel('Setup code').fill(code);
  await gm.getByLabel(/New Game Master password/).fill('gm-e2e-password');
  await gm.getByLabel('Repeat the password').fill('gm-e2e-password');
  await gm.getByRole('button', { name: /Set password and enter/ }).click();
  await gm.getByRole('button', { name: /Generate arena/ }).click({ timeout: 15000 }).catch(() => undefined);
  await waitText(gm, /Game Master/, 20000);
  const campaignId = (await apiFetch(gm, 'state')).body.campaignId;
  const cmd = (page, command) => apiFetch(page, 'command', { campaignId, command });
  const gmState = async () => (await apiFetch(gm, 'state')).body.state;

  // stock in the tray, gold for Sinna and Aster
  await cmd(gm, { type: 'arsenalGenerate', stagedId: 'm-pot', baseId: 'srd-potion-of-healing', rarity: 'normal', itemLevel: 1, identified: true, quantity: 4 });
  await cmd(gm, { type: 'arsenalGenerate', stagedId: 'm-sword', baseId: 'srd-longsword', rarity: 'normal', itemLevel: 1, identified: true });
  await cmd(gm, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'gold', amount: 150 });
  await cmd(gm, { type: 'gmGrantCurrency', tokenId: 'aster', currency: 'gold', amount: 150 });

  const hannah = await player(b, 'Hannah', 'hannah-test-pass', 'Sinna');
  check('no merchant tab while the shop is closed', !(await hannah.getByRole('button', { name: '🏛 Merchant' }).isVisible()));

  // GM: open the shop and offer both items through the UI
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  const admin = gm.getByRole('region', { name: 'Merchant settings' });
  await admin.getByLabel('Merchant name').fill('Marcus the Sutler');
  await admin.getByLabel('Merchant gold').fill('40');
  await admin.getByRole('button', { name: 'Save' }).click();
  await admin.getByLabel('Open for players').click();
  await gm.waitForFunction(() => document.querySelector('[aria-label="Merchant settings"] input[type=checkbox]')?.checked, null, { timeout: 10000 });
  for (const [id, price] of [['m-pot', '50'], ['m-sword', '20']]) {
    await admin.getByLabel('Tray item to offer').selectOption(id);
    await admin.getByLabel('Price for the new offer').fill(price);
    await admin.getByRole('button', { name: 'Offer' }).click();
    await admin.locator(`[data-stock="${id}"]`).waitFor({ timeout: 10000 });
  }
  let st = await gmState();
  check('stock is moved from the tray (no copies)', st.arsenal.staged.length === 0 && st.merchant.stock.length === 2 && st.merchant.name === 'Marcus the Sutler');

  // player shop
  const tab = hannah.getByRole('button', { name: '🏛 Merchant' });
  check('players get the merchant tab when the shop opens', await tab.waitFor({ timeout: 15000 }).then(() => true, () => false));
  await tab.click();
  const offers = hannah.getByRole('region', { name: 'Merchant offers' });
  check('offers and purse are shown', await offers.locator('[data-offer="m-pot"]').waitFor({ timeout: 10000 }).then(() => true, () => false) && /Your purse:\s*150 Gold Pieces/.test((await hannah.getByLabel('Merchant', { exact: true }).innerText()).replace(/\s+/g, ' ')));
  await offers.getByLabel(/Quantity of Potion of Healing/).fill('2');
  // double click: the second request must be refused, only 2 potions bought, 100 gold paid
  const buy = offers.locator('[data-offer="m-pot"]').getByRole('button', { name: /^Buy/ });
  await buy.dblclick();
  await hannah.waitForTimeout(1500);
  st = await gmState();
  const pots = st.tokens.sinna.inventory.filter((i) => i.name === 'Potion of Healing');
  check('buying part of a stack: 2 potions, 100 gold, 2 left in stock', pots.reduce((n, i) => n + i.quantity, 0) === 2 && st.tokens.sinna.currency.gold === 50 && st.merchant.stock.find((s) => s.id === 'm-pot').item.quantity === 2);
  check('a double click never buys twice', pots.length === 1);
  await offers.getByLabel(/Quantity of Potion of Healing/).fill('2');
  check('unaffordable offers are disabled (2 × 50 gold, 50 left)', await offers.locator('[data-offer="m-pot"]').getByRole('button', { name: /^Buy/ }).isDisabled());

  // race for the single sword: Sinna and Aster at the same time
  const jean = await player(b, 'Jean', 'jean-test-pass', 'Aster');
  const m = (await gmState()).merchant.rev;
  const sRev = (await gmState()).tokens.sinna.currencyRev ?? 0;
  const aRev = (await gmState()).tokens.aster.currencyRev ?? 0;
  const [r1, r2] = await Promise.all([cmd(hannah, { type: 'merchantBuy', tokenId: 'sinna', stockId: 'm-sword', quantity: 1, merchantRev: m, currencyRev: sRev }), cmd(jean, { type: 'merchantBuy', tokenId: 'aster', stockId: 'm-sword', quantity: 1, merchantRev: m, currencyRev: aRev })]);
  st = await gmState();
  const owners = ['sinna', 'aster'].filter((id) => st.tokens[id].inventory.some((i) => i.id === 'm-sword'));
  check('two buyers race for one sword: exactly one gets it', [r1.status, r2.status].sort().join() === '200,422' && owners.length === 1);
  check('only the winner paid', st.tokens.sinna.currency.gold + st.tokens.aster.currency.gold === 50 + 150 - 20);

  // selling: one potion back (50 × 50 % = 25 gold); the merchant only has 40 + 100 + 20 gold
  await hannah.reload();
  await hannah.getByRole('button', { name: '🏛 Merchant' }).click();
  const sell = hannah.getByRole('region', { name: 'Sell to the merchant' });
  const potId = pots[0].id;
  await sell.getByLabel(/Sell how many Potion of Healing/).fill('1');
  const before = (await gmState()).tokens.sinna.currency.gold;
  await sell.locator(`[data-sell="${potId}"]`).getByRole('button', { name: 'Sell' }).click();
  check('selling pays the shown offer and moves the item to the stock', await gm.waitForFunction(async ([b]) => (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.tokens.sinna.currency.gold === b + 25, [before], { timeout: 10000 }).then(() => true, () => false));
  st = await gmState();
  check('stack split on sale: 1 potion left with Sinna, one more in stock', st.tokens.sinna.inventory.find((i) => i.id === potId).quantity === 1 && st.merchant.stock.some((s) => s.item.name === 'Potion of Healing' && s.id !== 'm-pot'));
  check('a stale sell request is refused', (await cmd(hannah, { type: 'merchantSell', tokenId: 'sinna', itemId: potId, quantity: 1, rev: 0, merchantRev: 0 })).status === 422);
  check('players cannot change prices', (await cmd(hannah, { type: 'merchantStockUpdate', stockId: 'm-pot', price: 1, currency: 'gold' })).status === 403);
  await hannah.screenshot({ path: out + '/merchant-player.png', fullPage: true });

  // GM closes the shop → tab disappears
  await admin.getByLabel('Open for players').click();
  check('closing the shop removes the tab', await hannah.getByRole('button', { name: '🏛 Merchant' }).waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false));
  await gm.screenshot({ path: out + '/merchant-gm.png', fullPage: true });

  console.log('\n' + results.join('\n'));
  const fails = results.filter((r) => !r.startsWith('PASS'));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('\n' + results.join('\n'));
  process.exit(1);
});
