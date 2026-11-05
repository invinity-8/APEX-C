/**
 * Browser acceptance test of APEX 0.7 PR C (mock only, fresh server): carry weight, Bag of Holding,
 * custom resource removal.   npm run dev:mock   then   node dev/e2e-inventory07.cjs [screenshot-dir]
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
const load = (page) => page.getByTestId('carry-load').innerText().then((t) => Number(t.split('/')[0]));

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
  // sheet with Strength 12 + a custom resource (mock only)
  const cur = (await apiFetch(gm, 'sheet', null, '&token=sinna')).body;
  await apiFetch(gm, 'sheet', { action: 'save', tokenId: 'sinna', expectedVersion: cur.version, sheet: { ...cur.sheet, attributes: [{ id: 'a1', name: 'Strength', value: '12', modifier: '+1' }], resources: [{ id: 'r1', name: 'Luck', current: 2, max: 3 }, { id: 'r2', name: 'Ki', current: 1, max: 1 }] } });
  for (const [id, baseId] of [['plate', 'srd-plate-armor'], ['mail', 'srd-chain-mail'], ['bag', 'srd-bag-of-holding']])
    check(`GM gives ${baseId}`, (await cmd(gm, { type: 'arsenalGenerate', stagedId: id, baseId, rarity: 'normal', itemLevel: 1, identified: true, giveTo: 'sinna' })).status === 200);

  const hannah = await newDevice(b);
  await openProfile(hannah, 'Hannah');
  await hannah.getByLabel('Password', { exact: true }).fill('hannah-test-pass');
  await hannah.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(hannah, /Playing as Sinna/, 20000);
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();
  await hannah.getByTestId('carry-gauge').waitFor();
  const kg = (lb) => Math.round(lb * 0.45359237 * 100) / 100;
  const cap = () => hannah.getByTestId('carry-load').innerText().then((t) => Number(/\/\s*([\d.]+)/.exec(t)?.[1]));
  await hannah.waitForFunction(() => /\/ \d/.test(document.querySelector('[data-testid="carry-load"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => undefined);
  const l0 = await load(hannah);
  check('the gauge shows load / capacity in kg (STR 12 → 180 lb = 81.65 kg; free-text staff ≈ 4 lb counts)', Math.abs((await cap()) - kg(180)) < 0.11 && Math.abs(l0 - (kg(65) + kg(55) + kg(15) + kg(4))) < 0.15, `${l0} / ${await cap()}`);
  await hannah.locator('[data-item="plate"]').getByRole('button', { name: /^Actions for/ }).click();
  await hannah.locator('[data-item="plate"]').getByRole('menuitem', { name: /^Equip/ }).click();
  await hannah.locator('[data-container="equipped"] [data-item="plate"]').waitFor({ timeout: 10000 });
  check('equipped items are counted once (load unchanged)', Math.abs((await load(hannah)) - l0) < 0.05);
  check('the Bag of Holding container appears', await hannah.getByTestId('bag-capacity').isVisible());
  await hannah.getByLabel('Move Chain Mail to').selectOption('hold-bag');
  check('items in the bag no longer count towards carry weight', await hannah.waitForFunction((l) => Number(document.querySelector('[data-testid="carry-load"]').textContent.split('/')[0]) < l - 20, l0, { timeout: 10000 }).then(() => true, () => false));
  check('bag capacity shows its contents', /24\.9 \/ 226\.8 kg/.test(await hannah.getByTestId('bag-capacity').innerText()));
  await hannah.screenshot({ path: out + '/inv07-weight.png', fullPage: true });
  check('a bag cannot go into a bag', (await cmd(hannah, { type: 'invMoveItem', tokenId: 'sinna', itemId: 'bag', rev: 0, container: 'hold-bag' })).status === 422);

  // the bag (with contents) moves to Aster
  check('GM revokes the bag', (await cmd(gm, { type: 'gmRevokeItem', tokenId: 'sinna', itemId: 'bag' })).status === 200);
  check('GM gives the bag to Aster', (await cmd(gm, { type: 'arsenalGive', stagedId: 'bag', tokenId: 'aster' })).status === 200);
  const st = (await apiFetch(gm, 'state')).body.state;
  check('bag contents moved with the bag, exactly once', st.tokens.aster.inventory.find((i) => i.id === 'mail')?.container === 'hold-bag' && !st.tokens.sinna.inventory.some((i) => i.id === 'mail'));

  // custom resource removal
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  await hannah.getByRole('tab', { name: 'Resources' }).click();
  await hannah.getByRole('button', { name: 'Remove Luck' }).click();
  await hannah.getByRole('alertdialog', { name: 'Remove Luck?' }).getByRole('button', { name: 'Remove' }).click();
  const sheet = await hannah.waitForFunction(async () => {
    const r = await (await fetch('/api/apex?op=sheet&token=sinna', { headers: { 'x-apex-csrf': '1' } })).json();
    return r.sheet.resources.length === 1 ? r.sheet : null;
  }, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => null);
  check('a custom resource is removed after confirmation; others and attributes stay', !!sheet && sheet.resources[0].name === 'Ki' && sheet.attributes[0].value === '12');
  check('no Willpower in the player state', !('will' in (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details));

  // reported bug (APEX 0.7 finalization): free-text items used to weigh 0 kg – they now get a rough estimate
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();
  await hannah.getByTestId('carry-gauge').waitFor();
  const lBefore = await load(hannah);
  check('a hand-added "Explorer\'s Pack" gets a rough weight', (await cmd(hannah, { type: 'invAddItem', tokenId: 'sinna', itemId: 'e2e-pack', name: "Explorer's Pack" })).status === 200);
  check('… and the gauge adds it (≈ 59 lb ≈ 26.8 kg)', await hannah.waitForFunction(([b]) => Number(document.querySelector('[data-testid="carry-load"]')?.textContent?.split('/')[0]) - b > 26, [lBefore], { timeout: 10000 }).then(() => true, () => false));
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
