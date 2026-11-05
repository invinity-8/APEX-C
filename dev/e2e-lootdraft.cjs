/**
 * Browser acceptance test of APEX 0.7 PR D (mock only, fresh server): GM loot draft → edit → approve → give,
 * quest items (GM notes hidden from players, no salvage/delete), currency bundles.
 *   npm run dev:mock   then   node dev/e2e-lootdraft.cjs [screenshot-dir]
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

const tab = (p, n) => p.getByRole('tab', { name: new RegExp(n) }).click(); // Arsenal areas (APEX 0.7 consolidation)
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

  // player Sinna joins
  const hannah = await newDevice(b);
  await openProfile(hannah, 'Hannah');
  await hannah.getByLabel('Password', { exact: true }).fill('hannah-test-pass');
  await hannah.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(hannah, /Playing as Sinna/, 20000);

  // GM rolls a boss drop
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Loot');
  const drop = gm.getByRole('region', { name: 'Loot drop' });
  await drop.getByLabel('Encounter type').selectOption('boss');
  await drop.getByLabel(/Party median level/).uncheck();
  await drop.getByLabel('Reference character level').fill('7');
  await drop.getByRole('button', { name: 'Roll loot draft' }).click();
  const entries = drop.getByRole('list', { name: 'Draft entries' }).locator('[data-entry]');
  check('a boss draft is rolled with 5 entries', await entries.nth(4).waitFor({ timeout: 10000 }).then(() => true, () => false));
  let st = await gmState();
  check('nothing is created before approval', st.arsenal.staged.length === 0 && st.arsenal.draft.entries.length === 5);
  const eqEntry = st.arsenal.draft.entries.find((e) => e.itemLevel);
  check('equipment item level follows the party level (7 + 5, boss spread +0…+2)', !eqEntry || (eqEntry.itemLevel >= 12 && eqEntry.itemLevel <= 14));
  check('players cannot see or touch drafts', (await cmd(hannah, { type: 'lootDraftDiscard' })).status === 403 && !JSON.stringify((await apiFetch(hannah, 'state')).body).includes(st.arsenal.draft.id));

  // remove the first entry
  const firstKey = st.arsenal.draft.entries[0].key;
  await drop.locator(`[data-entry="${firstKey}"]`).getByRole('button', { name: /^Remove/ }).click();
  check('removing an entry', await drop.locator(`[data-entry="${firstKey}"]`).waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false));

  // add a quest item
  const add = drop.getByRole('form', { name: 'Add to draft' });
  await add.getByLabel('Entry type').selectOption('quest');
  await add.getByLabel('Item name').fill('Signet of the Seventh Legion');
  await add.getByLabel('Item description').fill('A heavy bronze signet. It opens the vault beneath the forum.');
  await add.getByLabel('GM notes').fill('SECRET: the prefect wears its twin.');
  await add.getByLabel('Cannot be transferred').check();
  await add.getByRole('button', { name: 'Add to draft' }).click();
  check('quest item added to the draft', await drop.getByText('Signet of the Seventh Legion').waitFor({ timeout: 10000 }).then(() => true, () => false));
  // add 9 fragments
  await add.getByLabel('Entry type').selectOption('fragment');
  await add.getByLabel('Quantity for the entry').fill('13');
  await add.getByRole('button', { name: 'Add to draft' }).click();
  check('currency added to the draft', await drop.getByText('13 × Arcane Fragments').waitFor({ timeout: 10000 }).then(() => true, () => false));
  // change the quantity of the fragments, edit via UI
  st = await gmState();
  const fragKey = st.arsenal.draft.entries.find((e) => e.quantity === 13 && e.currency === 'fragment').key;
  const q = drop.locator(`[data-entry="${fragKey}"]`).getByLabel(/^Quantity of/);
  await q.fill('11');
  await q.blur();
  check('quantity edited on the server', await gm.waitForFunction(async (k) => (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.arsenal.draft.entries.find((e) => e.key === k)?.quantity === 11, fragKey, { timeout: 10000 }).then(() => true, () => false));
  check('a stale draft edit is refused', (await cmd(gm, { type: 'lootDraftEdit', rev: 0, op: { kind: 'remove', key: fragKey } })).status === 422);
  await gm.screenshot({ path: out + '/loot-draft.png', fullPage: true });

  // approve
  await drop.getByRole('button', { name: /Approve final pool/ }).click();
  const tray = gm.getByRole('region', { name: 'Arsenal tray' });
  check('approval moves the final pool into the tray', await tray.getByText('Signet of the Seventh Legion').first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  st = await gmState();
  check('draft cleared, 6 tray items, no inventory change', !st.arsenal.draft && st.arsenal.staged.length === 6 && !st.tokens.sinna.inventory.some((i) => i.source?.label === 'Loot drop'));
  check('the GM sees the quest GM notes in the tray', await tray.getByTestId('quest-gm-notes').first().isVisible());
  const quest = st.arsenal.staged.find((i) => i.quest);
  const frag = st.arsenal.staged.find((i) => i.grant?.amount === 11);
  check('quest item is not salvageable and bound', quest.locked === true && quest.bound === true);

  // give
  await tray.locator(`[data-staged="${quest.id}"]`).getByRole('button', { name: 'Give' }).click();
  await tray.locator(`[data-staged="${frag.id}"]`).getByRole('button', { name: 'Give' }).click();
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();
  const row = hannah.locator(`[data-item="${quest.id}"]`);
  check('the player receives the quest item', await row.waitFor({ timeout: 10000 }).then(() => true, () => false));
  check('the fragments go into the purse', await hannah.waitForFunction(() => document.querySelector('[data-testid="balance-fragment"]')?.textContent === '11', null, { timeout: 10000 }).then(() => true, () => false));
  check('the player never receives the GM notes', !JSON.stringify((await apiFetch(hannah, 'state')).body).includes('SECRET'));
  check('quest badge shown', await row.getByText('Quest', { exact: true }).isVisible());
  const rev = (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details.inventory.find((i) => i.id === quest.id).rev ?? 0;
  check('the player cannot delete it', (await cmd(hannah, { type: 'invRemoveItem', tokenId: 'sinna', itemId: quest.id, rev })).status === 422);
  check('the player cannot salvage it', (await cmd(hannah, { type: 'itemSalvage', tokenId: 'sinna', itemId: quest.id, rev })).status === 422);
  check('the player cannot rename it', (await cmd(hannah, { type: 'invUpdateItem', tokenId: 'sinna', itemId: quest.id, rev, name: 'Fake' })).status === 422);
  await hannah.screenshot({ path: out + '/loot-quest-player.png', fullPage: true });

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
