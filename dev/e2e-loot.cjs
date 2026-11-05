/**
 * Browser acceptance test of the APEX 0.6 loot loop (GM Arsenal → Sinna: identify, equip, reroll, salvage, combine).
 *
 *   Local mock:   npm run dev:mock   then   node dev/e2e-loot.cjs [screenshot-dir]          (fresh mock server)
 *   Isolated real campaign (NEVER the production campaign):
 *                 APEX_URL=https://<preview> APEX_GM_PASSWORD=… APEX_HANNAH_PASSWORD=… APEX_JEAN_PASSWORD=… node dev/e2e-loot.cjs
 *
 * GM and players run in separate browser contexts (separate cookies = separate devices). Everything is done
 * through the real UI; direct API calls are only used to prove that forged requests are refused.
 */
const { chromium } = require('playwright');
const BASE = process.env.APEX_URL || 'http://localhost:5174';
const MOCK = !process.env.APEX_URL;
const out = process.argv[2] || '.';
const PW = {
  gm: process.env.APEX_GM_PASSWORD || 'gm-e2e-password',
  hannah: process.env.APEX_HANNAH_PASSWORD || 'hannah-test-pass',
  jean: process.env.APEX_JEAN_PASSWORD || 'jean-test-pass',
};
const SHARE = process.env.APEX_SHARE_QUERY || '';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
  console.log(results.at(-1));
};
const url = (p = '/') => `${BASE}${p}${SHARE ? (p.includes('?') ? '&' : '?') + SHARE : ''}`;

async function newDevice(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  if (SHARE) await ctx.newPage().then(async (p) => (await p.goto(url('/')), p.close()));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR: ${e.message}`));
  return page;
}
async function openProfile(page, name) {
  await page.goto(url('/'));
  await page.getByRole('button', { name: 'Join Campaign' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name} –`) }).click();
}
async function login(browser, name, password) {
  const page = await newDevice(browser);
  await openProfile(page, name);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Enter the Arena' }).click();
  return page;
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
const balance = (page, id) => page.getByTestId(`balance-${id}`).innerText().then(Number);
const waitBalance = (page, id, n, timeout = 10000) =>
  page.waitForFunction(([id, n]) => document.querySelector(`[data-testid="balance-${id}"]`)?.textContent === String(n), [id, n], { timeout }).then(() => true, () => false);
const sinnaState = async (page) => (await apiFetch(page, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details;

const tab = (p, n) => p.getByRole('tab', { name: new RegExp(n) }).click(); // Arsenal areas (APEX 0.7 consolidation)
(async () => {
  const b = await chromium.launch();

  // ---------- GM ----------
  let gm;
  if (MOCK) {
    gm = await newDevice(b);
    await openProfile(gm, 'GM');
    await gm.getByRole('heading', { name: 'First-time setup' }).waitFor();
    const code = (await (await fetch(BASE + '/__mock/setup-code')).json()).code;
    await gm.getByLabel('Setup code').fill(code);
    await gm.getByLabel(/New Game Master password/).fill(PW.gm);
    await gm.getByLabel('Repeat the password').fill(PW.gm);
    await gm.getByRole('button', { name: /Set password and enter/ }).click();
    await gm.getByRole('button', { name: /Generate arena/ }).click({ timeout: 15000 }).catch(() => undefined);
  } else gm = await login(b, 'GM', PW.gm);
  check('GM signs in', await waitText(gm, /Game Master/, 20000));
  const campaignId = (await apiFetch(gm, 'state')).body.campaignId;
  const gmState = async () => (await apiFetch(gm, 'state')).body.state;
  const startInv = (await gmState()).tokens.sinna.inventory.length;

  // a minimal sheet so derived stats can be shown (mock only – never overwrite a real sheet)
  if (MOCK) {
    const cur = (await apiFetch(gm, 'sheet', null, '&token=sinna')).body;
    const sheet = {
      ...cur.sheet,
      attributes: [
        { id: 'a1', name: 'Strength', value: '14', modifier: '+2' },
        { id: 'a2', name: 'Dexterity', value: '12', modifier: '+1' },
      ],
      combat: [
        { id: 'c1', label: 'Armor Class', value: '13' },
        { id: 'c2', label: 'Proficiency bonus', value: '+2' },
      ],
    };
    await apiFetch(gm, 'sheet', { action: 'save', tokenId: 'sinna', sheet, expectedVersion: cur.version });
  }

  // ---------- 1–6: Arsenal ----------
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Create items');
  await gm.getByLabel('Search base items').fill('longsword');
  await gm.getByRole('option', { name: /Longsword/ }).click();
  await gm.getByRole('radio', { name: 'Rare' }).click();
  await gm.getByLabel('Item level', { exact: true }).fill('12');
  check('unidentified is the default for magic/rare', await gm.getByLabel(/Unidentified \(needs a Seal/).isChecked());
  await gm.getByLabel('Give to character').selectOption('sinna');
  await gm.screenshot({ path: out + '/loot-1-arsenal.png', fullPage: true });
  await gm.getByRole('button', { name: 'Generate & give' }).click();
  const swordGiven = await gm
    .waitForFunction(async () => {
      const s = (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state;
      return s.tokens.sinna.inventory.some((i) => i.baseId === 'srd-longsword' && i.rarity === 'rare' && i.itemLevel === 12 && i.identified === false);
    }, null, { timeout: 10000 })
    .then(() => true, () => false);
  check('GM: Rare Longsword ilvl 12 unidentified → Sinna', swordGiven);
  const sword0 = (await gmState()).tokens.sinna.inventory.find((i) => i.baseId === 'srd-longsword' && i.rarity === 'rare');
  check('the server rolled 3–4 modifiers (hidden)', sword0 && sword0.mods.length >= 3 && sword0.mods.length <= 4, JSON.stringify(sword0?.mods));

  // preview → give: a magic ring (to salvage later), and a discarded preview
  await gm.getByLabel('Search base items').fill('silver ring');
  await gm.getByRole('option', { name: /Silver Ring/ }).click();
  await gm.getByRole('radio', { name: 'Magic' }).click();
  await gm.getByLabel(/Unidentified \(needs a Seal/).uncheck();
  await gm.getByRole('button', { name: 'Generate preview' }).click();
  const tray = gm.getByRole('region', { name: 'Arsenal tray' });
  check('preview appears in the GM tray with its modifiers', await tray.locator('[data-staged] [data-mod]').first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await gm.getByRole('button', { name: 'Generate preview' }).click();
  await gm.waitForFunction(() => document.querySelectorAll('[data-staged]').length === 2, null, { timeout: 10000 });
  await tray.getByRole('button', { name: 'Discard' }).first().click();
  await gm.waitForFunction(() => document.querySelectorAll('[data-staged]').length === 1, null, { timeout: 10000 });
  await tray.getByLabel(/^Give .* to$/).first().selectOption('sinna');
  await tray.getByRole('button', { name: 'Give', exact: true }).first().click();
  check('preview is given from the tray', await gm.waitForFunction(() => document.querySelectorAll('[data-staged]').length === 0, null, { timeout: 10000 }).then(() => true, () => false));

  // currency
  const grant = async (cur, n) => {
    await gm.getByLabel(new RegExp(`^${cur} amount for Sinna$`)).fill(String(n));
    await gm.getByRole('button', { name: new RegExp(`^Give ${n} ${cur} to Sinna$`) }).click();
  };
  const s0 = (await gmState()).tokens.sinna.currency ?? {};
  await tab(gm, 'Characters');
  await grant('Seals of Revelation', 2);
  await grant('Orbs of Renewal', 2);
  await grant('Arcane Fragments', 10);
  const want = { seal: (s0.seal ?? 0) + 2, orb: (s0.orb ?? 0) + 2, fragment: (s0.fragment ?? 0) + 10 };
  const granted = await gm
    .waitForFunction((w) => ['seal', 'orb', 'fragment'].every((c) => document.querySelector(`[data-balance="sinna:${c}"]`)?.textContent === String(w[c])), want, { timeout: 10000 })
    .then(() => true, () => false);
  check('GM grants 2 Seals, 2 Orbs, 10 Fragments to Sinna', granted);

  // ---------- 7–8: Sinna ----------
  const hannah = await login(b, 'Hannah', PW.hannah);
  check('Hannah signs in as Sinna', await waitText(hannah, /Playing as Sinna/, 20000));
  const mine = (await sinnaState(hannah)).inventory.find((i) => i.id === sword0.id);
  check('player API never contains the hidden modifiers', !!mine && !('mods' in mine) && !('modVersion' in mine) && mine.name === 'Longsword', JSON.stringify(mine));
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();
  check('Sinna sees “Unidentified Longsword”', await waitText(hannah, /Unidentified Longsword/));
  check('currency balances are shown', (await balance(hannah, 'seal')) === want.seal && (await balance(hannah, 'orb')) === want.orb && (await balance(hannah, 'fragment')) === want.fragment);
  const row = () => hannah.locator(`[data-item="${sword0.id}"]`);
  await row().getByRole('button', { name: /^Actions for/ }).click();
  check('unidentified: Equip and Reroll are disabled with reasons', (await row().getByText('Identify this item before equipping it.').isVisible()) && (await row().getByText(/Cannot reroll an unidentified item/).isVisible()));
  await hannah.screenshot({ path: out + '/loot-2-unidentified.png', fullPage: true });

  // ---------- 9–10: identify ----------
  await row().getByRole('menuitem', { name: /^Identify/ }).click();
  check('identify spends exactly one seal', await waitBalance(hannah, 'seal', want.seal - 1));
  check('affixes are revealed', await row().locator('[data-mod]').first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  const swordNow = (await sinnaState(hannah)).inventory.find((i) => i.id === sword0.id);
  check('revealed affixes are the ones rolled at creation (no reroll)', JSON.stringify(swordNow.mods) === JSON.stringify(sword0.mods));
  check('the item got its rare name', swordNow.name !== 'Longsword', swordNow.name);
  await hannah.waitForTimeout(400);
  await hannah.screenshot({ path: out + '/loot-3-identified.png', fullPage: true });

  // ---------- 11–12: equip ----------
  await row().getByRole('button', { name: /^Actions for/ }).click();
  await row().getByRole('menuitem', { name: /^Equip/ }).click();
  check('Sinna equips the sword', await row().getByText(/equipped · Main hand/).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click(); // equipment + derived statistics live on the Inventory page (APEX 0.7)
  const stats = MOCK ? await waitText(hannah, new RegExp(swordNow.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 8000) : true;
  const attack = MOCK ? await hannah.locator('[aria-label="Derived statistics"] table').innerText().catch(() => '') : '';
  check('derived attack line shows the equipped sword (to-hit/damage incl. modifiers)', !MOCK || (stats && /1d8\+2 slashing/.test(attack)), attack);
  await hannah.screenshot({ path: out + '/loot-4-equipped.png', fullPage: true });
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();

  // ---------- 13–14: reroll ----------
  await row().getByRole('button', { name: /^Actions for/ }).click();
  await row().getByRole('menuitem', { name: /^Reroll/ }).click();
  check('reroll confirmation explains what changes', await row().getByText(/can be worse and cannot be undone/).isVisible());
  await hannah.screenshot({ path: out + '/loot-5-reroll-confirm.png', fullPage: true });
  await row().getByRole('button', { name: /Spend 1 Orb of Renewal and reroll/ }).click();
  check('reroll spends one orb', await waitBalance(hannah, 'orb', want.orb - 1));
  const rerolled = (await sinnaState(hannah)).inventory.find((i) => i.id === sword0.id);
  check('new affixes; base, level, rarity, slot preserved', JSON.stringify(rerolled.mods) !== JSON.stringify(sword0.mods) && rerolled.baseId === 'srd-longsword' && rerolled.itemLevel === 12 && rerolled.rarity === 'rare' && (await sinnaState(hannah)).equipment.slots.main1 === sword0.id);

  // ---------- 15–16: salvage ----------
  const ring = (await sinnaState(hannah)).inventory.find((i) => i.baseId === 'apex-silver-ring');
  const ringRow = hannah.locator(`[data-item="${ring.id}"]`);
  await ringRow.getByRole('button', { name: /^Actions for/ }).click();
  await ringRow.getByRole('menuitem', { name: 'Salvage' }).click();
  const reward = Number((await ringRow.getByTestId('salvage-reward').innerText()).match(/\d+/)[0]);
  check('salvage shows name, rarity, item level and the exact reward', reward >= 2 && reward <= 3 && (await ringRow.getByRole('alertdialog').getByText('Magic', { exact: true }).isVisible()));
  await hannah.screenshot({ path: out + '/loot-6-salvage-confirm.png', fullPage: true });
  await ringRow.getByRole('button', { name: /^Salvage for/ }).click();
  check('salvaged item disappears, fragments increase by the shown reward', (await waitBalance(hannah, 'fragment', want.fragment + reward)) && (await ringRow.count()) === 0);
  const swordRow = row();
  await swordRow.getByRole('button', { name: /^Actions for/ }).click();
  check('equipped item: “Unequip before salvaging”', await swordRow.getByText('Unequip before salvaging.').isVisible());
  await swordRow.getByRole('button', { name: /^Actions for/ }).click();

  // ---------- 17: combine ----------
  await hannah.getByRole('button', { name: 'Combine Fragments' }).click();
  await hannah.getByRole('form', { name: 'Combine fragments' }).getByRole('button', { name: 'Combine', exact: true }).click();
  check('10 fragments → 1 orb (atomic)', (await waitBalance(hannah, 'orb', want.orb)) && (await waitBalance(hannah, 'fragment', want.fragment + reward - 10)));

  // ---------- security ----------
  const forge = (page, command) => apiFetch(page, 'command', { campaignId, command });
  check('Hannah cannot generate items', (await forge(hannah, { type: 'arsenalGenerate', stagedId: 'hack1', baseId: 'srd-longsword', rarity: 'rare', itemLevel: 30, identified: true, giveTo: 'sinna' })).status === 403);
  check('Hannah cannot grant herself currency', (await forge(hannah, { type: 'gmGrantCurrency', tokenId: 'sinna', currency: 'orb', amount: 99 })).status === 403);
  const jean = await login(b, 'Jean', PW.jean);
  await waitText(jean, /Playing as Aster/, 20000);
  check('Jean cannot spend Sinna’s fragments', (await forge(jean, { type: 'combineFragments', tokenId: 'sinna', sets: 1, currencyRev: 0 })).status === 403);
  check('Jean cannot reroll Sinna’s sword', (await forge(jean, { type: 'itemReroll', tokenId: 'sinna', itemId: sword0.id, rev: rerolled.rev })).status === 403);
  check('Jean does not receive Sinna’s inventory or currency', !(await apiFetch(jean, 'state')).body.view.tokens.find((t) => t.id === 'sinna')?.details?.currency);

  // ---------- 18–20: refresh + GM inspection ----------
  const before = await sinnaState(hannah);
  await hannah.reload();
  await hannah.getByRole('button', { name: '🎒 Inventory' }).click();
  check('after refresh: balances unchanged', (await waitBalance(hannah, 'seal', want.seal - 1)) && (await balance(hannah, 'orb')) === want.orb && (await balance(hannah, 'fragment')) === want.fragment + reward - 10);
  const after = await sinnaState(hannah);
  check('after refresh: items, affixes and equipment unchanged', JSON.stringify(after.inventory) === JSON.stringify(before.inventory) && after.equipment.slots.main1 === sword0.id && after.inventory.length === startInv + 1);
  await gm.reload();
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Characters');
  const inv = gm.getByRole('region', { name: 'Inspect inventories' });
  await inv.getByLabel('Inventory of').selectOption('sinna');
  check('GM sees the resulting inventory', await inv.locator(`[data-gm-item="${sword0.id}"]`).isVisible());
  await tab(gm, 'Rules & log');
  const audit = await gm.getByRole('region', { name: 'Item audit log' }).innerText();
  check('audit log records identify, reroll, salvage and combine', ['Identified', 'Rerolled', 'Salvaged', 'Combined'].every((w) => audit.includes(w)), audit.slice(0, 300));
  await tab(gm, 'Characters');
  await inv.locator(`[data-gm-item="${sword0.id}"]`).getByRole('button', { name: 'Inspect' }).click();
  await gm.screenshot({ path: out + '/loot-7-gm-inspect.png', fullPage: true });

  // revoke test (accident) – a fresh item, then revoke it back into the tray
  await tab(gm, 'Create items');
  await gm.getByLabel('Search base items').fill('leather belt');
  await gm.getByRole('option', { name: /Leather Belt/ }).click();
  await gm.getByRole('radio', { name: 'Magic' }).click();
  await gm.getByRole('button', { name: 'Generate & give' }).click();
  await gm.waitForFunction(async () => (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.tokens.sinna.inventory.some((i) => i.baseId === 'apex-leather-belt'), null, { timeout: 10000 });
  const belt = (await gmState()).tokens.sinna.inventory.find((i) => i.baseId === 'apex-leather-belt');
  await tab(gm, 'Characters');
  await inv.locator(`[data-gm-item="${belt.id}"]`).getByRole('button', { name: 'Inspect' }).click();
  await inv.getByLabel('Revoke reason').fill('given by mistake');
  await inv.getByRole('button', { name: 'Revoke' }).click();
  const revoked = await gm.waitForFunction((id) => !!document.querySelector(`[data-staged="${id}"]`), belt.id, { timeout: 10000 }).then(() => true, () => false);
  await tab(gm, 'Rules & log');
  check('GM revokes an accidental grant (back to the tray, audited)', revoked && (await gm.getByRole('region', { name: 'Item audit log' }).innerText()).includes('given by mistake'));
  await gm.getByRole('region', { name: 'Arsenal tray' }).getByRole('button', { name: 'Discard' }).first().click();

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
