/**
 * Browser acceptance test of APEX 0.7 PR B (mock only, fresh server): portrait zoom, GM cosmetic unlocks,
 * resizable feedback panel, navigation areas as movable widgets.
 *   npm run dev:mock   then   node dev/e2e-cosmetics.cjs [screenshot-dir]
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:5174';
const out = process.argv[2] || '.';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
  console.log(results.at(-1));
};
async function newDevice(b, viewport = { width: 1400, height: 950 }) {
  const page = await (await b.newContext({ viewport })).newPage();
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

  const hannah = await newDevice(b);
  await openProfile(hannah, 'Hannah');
  await hannah.getByLabel('Password', { exact: true }).fill('hannah-test-pass');
  await hannah.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(hannah, /Playing as Sinna/, 20000);
  // portrait (a real 1×1 PNG, uploaded through the API like the cropper does)
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cf0000000301010018dd8db40000000049454e44ae426082', 'hex').toString('base64');
  check('portrait uploaded', (await apiFetch(hannah, 'portrait', { tokenId: 'sinna', image: png })).status === 200);

  // GM grants cosmetics in the Arsenal
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Characters');
  const grants = gm.getByRole('region', { name: 'Cosmetic rewards (GM)' });
  for (const n of ['Golden Laurels for Sinna', 'Gilded Frame for Sinna', 'Champion of the Arena for Sinna', 'Crimson Banner for Sinna']) {
    await grants.getByLabel(n).click(); // server-confirmed checkbox: wait for the synced state
    await gm.waitForFunction((label) => document.querySelector(`input[aria-label="${label}"]`)?.checked === true, n, { timeout: 10000 });
  }
  await gm.waitForFunction(async () => ((await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.tokens.sinna.cosmetics?.unlocked ?? []).length === 4, null, { timeout: 10000 });
  check('GM sees which cosmetics Sinna owns', (await grants.getByLabel('Golden Laurels for Sinna').isChecked()) && !(await grants.getByLabel('Golden Laurels for Aster').isChecked()));

  // player chooses among owned cosmetics
  await hannah.reload();
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  check('the default appearance is plain', (await hannah.getByTestId('cosmetic-title').count()) === 0);
  await hannah.getByRole('tab', { name: 'Appearance' }).click();
  const picker = hannah.getByRole('region', { name: 'Cosmetic rewards' });
  await picker.getByLabel('Laurel wreath').selectOption('wreath-gold');
  await picker.getByLabel('Honorary title').selectOption('title-champion');
  await picker.getByLabel('Card background').selectOption('bg-crimson');
  await hannah.getByTestId('cosmetic-title').waitFor({ timeout: 10000 });
  check('a player cannot choose a cosmetic they do not own', (await apiFetch(hannah, 'command', { campaignId: (await apiFetch(hannah, 'state')).body.campaignId, command: { type: 'setCosmetics', tokenId: 'sinna', selected: { ornament: 'orn-crown' } } })).status === 422);
  await hannah.reload();
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  check('cosmetic unlocks and choices persist after refresh', (await hannah.getByTestId('cosmetic-title').textContent({ timeout: 10000 })) === 'Champion of the Arena' && (await hannah.locator('[data-cosmetic-wreath="wreath-gold"]').count()) === 1);
  await hannah.screenshot({ path: out + '/cosmetics-card.png' });

  // portrait zoom
  await hannah.getByTestId('portrait-zoom').first().click();
  const viewer = hannah.getByTestId('portrait-viewer');
  check('clicking the portrait opens the large viewer', await viewer.isVisible());
  const fit = await viewer.locator('img').evaluate((i) => getComputedStyle(i).objectFit);
  check('the full image is shown (object-fit: contain)', fit === 'contain');
  await hannah.keyboard.press('Escape');
  check('Escape closes the viewer', (await viewer.count()) === 0);
  await hannah.getByTestId('portrait-zoom').first().click();
  await hannah.getByTestId('portrait-viewer').waitFor();
  await hannah.mouse.click(10, 10);
  check('a click outside closes the viewer', (await hannah.getByTestId('portrait-viewer').count()) === 0);

  // resizable feedback dialog (size remembered)
  await hannah.getByRole('button', { name: 'Feedback' }).click();
  const panel = hannah.getByTestId('feedback-panel');
  check('the feedback dialog is user-resizable', (await panel.evaluate((el) => getComputedStyle(el).resize)) === 'both');
  await panel.evaluate((el) => ((el.style.width = '700px'), (el.style.height = '560px')));
  await hannah.waitForTimeout(700);
  await hannah.getByRole('button', { name: 'Close feedback' }).click();
  await hannah.getByRole('button', { name: 'Feedback' }).click();
  const w = await hannah.getByTestId('feedback-panel').evaluate((el) => el.offsetWidth);
  check('its size is remembered; inputs and buttons stay reachable', Math.abs(w - 700) < 4 && (await hannah.getByRole('button', { name: 'Send report' }).isVisible()), String(w));
  await hannah.getByRole('button', { name: 'Close feedback' }).click();

  // APEX 0.7 consolidation: pages that have a navigation tab are not duplicated as widgets; related panels share one
  const menuItems = async (p) => {
    await p.getByRole('button', { name: /Map/ }).first().click();
    await p.getByRole('button', { name: /☰ Widgets/ }).click();
    const names = await p.getByRole('menuitem').allInnerTexts();
    await p.getByRole('button', { name: /☰ Widgets/ }).click(); // close
    const shown = await p.locator('[data-widget]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    return [...names, ...shown].join(' | ');
  };
  const pMenu = await menuItems(hannah);
  check('player widgets are consolidated (My Character, Party & Intel, Selection, Chronicle, Legend)', ['My Character', 'Party & Intel', 'Selection', 'Arena Chronicle', 'Legend'].every((n) => pMenu.includes(n)) && !/Character Sheet|Currency Vault|Inventory|Feedback|Notifications|Intelligence|Equipment/.test(pMenu), pMenu);
  const gMenu = await menuItems(gm);
  check('GM widgets are consolidated (no page duplicates)', ['Arena & Rules', 'Party', 'Selection', 'Events & Announcements', 'Rivals & Sites', 'Campaign', 'Arena Chronicle'].every((n) => gMenu.includes(n)) && !/Arsenal|Feedback|Character Sheet|Inventory|Currency Vault|GM Tools|Party Health/.test(gMenu), gMenu);

  // mobile: viewer fits the screen
  const mobile = await newDevice(b, { width: 390, height: 780 });
  await openProfile(mobile, 'Hannah');
  await mobile.getByLabel('Password', { exact: true }).fill('hannah-test-pass');
  await mobile.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(mobile, /Playing as Sinna/, 20000);
  await mobile.getByRole('button', { name: '📜 Character', exact: true }).click();
  await mobile.getByTestId('portrait-zoom').first().click();
  const box = await mobile.getByTestId('portrait-viewer').locator('img').boundingBox();
  check('the viewer is responsive on mobile', !!box && box.width <= 390);

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
