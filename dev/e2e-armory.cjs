/**
 * Browser acceptance test of APEX 0.7 PR3 (mock only, fresh server): equipment location, body type,
 * Orb of Augmentation / Ascension, Arcane Transmutation, Niri's Timetwister.
 *   npm run dev:mock   then   node dev/e2e-armory.cjs [screenshot-dir]
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
const apiFetch = (page, op, body, query = '') =>
  page.evaluate(
    async ([op, body, query]) => {
      const r = await fetch(`/api/apex?op=${op}${query}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-apex-csrf': '1' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [op, body, query],
  );
const waitText = (page, re, timeout = 10000) =>
  page.waitForFunction(([s, f]) => new RegExp(s, f).test(document.body.innerText), [re.source, re.flags], { timeout }).then(() => true, () => false);
const waitBalance = (page, id, n) =>
  page.waitForFunction(([id, n]) => document.querySelector(`[data-testid="balance-${id}"]`)?.textContent === String(n), [id, n], { timeout: 10000 }).then(() => true, () => false);

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

  // GM: a normal longsword, a magic ring, Niri's Timetwister, and currency – through the Arsenal UI
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Create items');
  await gm.getByLabel('Search base items').fill('longsword');
  await gm.getByRole('option', { name: /Longsword/ }).click();
  await gm.getByRole('radio', { name: 'Normal' }).click();
  await gm.getByLabel('Give to character').selectOption('sinna');
  await gm.getByRole('button', { name: 'Generate & give' }).click();
  await gm.getByLabel('Search base items').fill('silver ring');
  await gm.getByRole('option', { name: /Silver Ring/ }).click();
  await gm.getByRole('radio', { name: 'Magic' }).click();
  await gm.getByLabel(/Unidentified \(needs a Seal/).uncheck();
  await gm.getByRole('button', { name: 'Generate & give' }).click();
  const uniq = gm.getByRole('region', { name: 'Unique items' });
  await uniq.getByLabel(/^Give Niri.s Timetwister to$/).selectOption('sinna');
  await uniq.getByRole('button', { name: 'Create & give' }).click();
  for (const [c, n] of [['augment', 2], ['ascend', 1], ['fragment', 20]]) check(`GM grants ${c}`, (await cmd(gm, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: c, amount: n })).status === 200);
  const inv = async () => (await apiFetch(gm, 'state')).body.state.tokens.sinna.inventory;
  await gm.waitForFunction(async () => (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.tokens.sinna.inventory.some((i) => i.uniqueId), null, { timeout: 10000 });
  const items = await inv();
  const sword = items.find((i) => i.baseId === 'srd-longsword');
  const ring = items.find((i) => i.baseId === 'apex-silver-ring');
  const niri = items.find((i) => i.uniqueId === 'niris-timetwister');
  check('Niri’s Timetwister is created as a Unique', niri?.rarity === 'unique' && niri.charge?.spent === false);

  // Sinna
  const hannah = await newDevice(b);
  await openProfile(hannah, 'Hannah');
  await hannah.getByLabel('Password', { exact: true }).fill('hannah-test-pass');
  await hannah.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(hannah, /Playing as Sinna/, 20000);
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();
  const row = (id) => hannah.locator(`[data-item="${id}"]`);
  const act = async (id, name) => {
    await row(id).getByRole('button', { name: /^Actions for/ }).click();
    await row(id).getByRole('menuitem', { name }).click();
  };

  // equipment location
  await act(sword.id, /^Equip/);
  check('an equipped item moves into “Equipped / Worn”', await hannah.locator(`[data-container="equipped"] [data-item="${sword.id}"]`).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await act(sword.id, /^Unequip/);
  check('unequipping returns it to its previous container', await hannah.locator(`[data-container="backpack"] [data-item="${sword.id}"]`).waitFor({ timeout: 10000 }).then(() => true, () => false));

  // ascension: normal sword → magic
  await act(sword.id, /^Ascend/);
  check('ascension shows the operation and possible outcomes (not the roll)', (await row(sword.id).getByTestId('orb-outcomes').innerText()).includes('Possible outcomes'));
  await row(sword.id).getByRole('button', { name: 'Spend 1 Orb of Ascension' }).click();
  check('Ascension spends one orb', await waitBalance(hannah, 'ascend', 0));
  const sw2 = (await inv()).find((i) => i.id === sword.id);
  check('Normal → Magic with one modifier, same base and item level', sw2.rarity === 'magic' && sw2.mods.length === 1 && sw2.itemLevel === sword.itemLevel);

  // augmentation on the magic ring (if it has a free slot) – else on the sword
  const target = (ring.mods.length < 2 ? ring : sw2).id;
  const before = (await inv()).find((i) => i.id === target).mods.length;
  await act(target, /^Augment/);
  await row(target).getByRole('button', { name: 'Spend 1 Orb of Augmentation' }).click();
  check('Augmentation adds exactly one modifier', (await waitBalance(hannah, 'augment', 1)) && (await inv()).find((i) => i.id === target).mods.length === before + 1);
  await hannah.screenshot({ path: out + '/armory-orbs.png', fullPage: true });

  // Arcane Transmutation – locked until the Imperial Transmutation Cube is acquired (APEX 0.7)
  check('advanced crafting is locked before the cube is acquired', await hannah.getByRole('button', { name: /Arcane Transmutation/ }).isDisabled());
  check('the server refuses transmutation without the cube', (await cmd(hannah, { type: 'transmuteFragments', tokenId: 'sinna', sets: 1, currencyRev: 99 })).status === 422);
  check('GM grants the cube', (await cmd(gm, { type: 'arsenalGenerate', stagedId: 'cube1', baseId: 'apex-imperial-transmutation-cube', rarity: 'normal', itemLevel: 1, identified: true, giveTo: 'sinna' })).status === 200);
  check('the player sees the unlock', await hannah.getByTestId('cube-status').filter({ hasText: 'Cube unlocked' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await hannah.getByRole('button', { name: /Arcane Transmutation/ }).click();
  await hannah.getByLabel('Random orbs to create').fill('2');
  await hannah.getByRole('form', { name: 'Arcane transmutation' }).getByRole('button', { name: 'Transmute' }).click();
  check('Transmutation consumes fragments and shows the server result', (await waitBalance(hannah, 'fragment', 0)) && /Arcane Transmutation:/.test(await hannah.getByTestId('transmute-result').innerText({ timeout: 10000 })));

  // Niri's Timetwister
  await row(niri.id).getByRole('button', { name: /^Actions for/ }).click();
  check('the ability needs the amulet to be worn', await row(niri.id).getByText(/Wear it \(amulet slot/).isVisible().catch(() => false));
  await row(niri.id).getByRole('menuitem', { name: /^Equip/ }).click();
  await act(niri.id, /^Activate: Twist of Time/);
  await row(niri.id).getByRole('button', { name: /Twist time/ }).click();
  check('activation records a pending postponed turn for Sinna', await hannah.getByTestId('time-twist').waitFor({ timeout: 10000 }).then(() => true, () => false));
  check('a second activation is refused (no duplicated turns)', (await cmd(hannah, { type: 'itemActivate', tokenId: 'sinna', itemId: niri.id, rev: 2 })).status === 422);
  await gm.reload();
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Create items');
  await gm.locator('[data-twist="sinna"]').getByRole('button', { name: 'Double turn taken' }).click();
  check('the GM resolves the double turn', await hannah.getByTestId('time-twist').waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false));
  check('players cannot resolve or recharge', (await cmd(hannah, { type: 'gmRechargeItem', tokenId: 'sinna', itemId: niri.id })).status === 403);

  // body type
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click(); // equipment lives on the Inventory page (APEX 0.7)
  await hannah.getByLabel('Body type').selectOption('feminine');
  check('body type changes only the silhouette', await hannah.locator('[data-body="feminine"]').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await hannah.screenshot({ path: out + '/armory-feminine.png', fullPage: true });

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
