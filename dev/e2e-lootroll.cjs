/**
 * Browser acceptance test of APEX 0.7 party loot (mock only, fresh server): Need / Distribute / Pass rolls,
 * public results in the Chronicle, deadline handling, item ownership after the roll.
 *   npm run dev:mock   then   node dev/e2e-lootroll.cjs [screenshot-dir]
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

  const hannah = await player(b, 'Hannah', 'hannah-test-pass', 'Sinna');
  const jean = await player(b, 'Jean', 'jean-test-pass', 'Aster');

  // two items in the tray
  for (const [id, base] of [['roll-sword', 'srd-longsword'], ['roll-helm', 'apex-iron-helm']]) await cmd(gm, { type: 'arsenalGenerate', stagedId: id, baseId: base, rarity: 'magic', itemLevel: 4, identified: true });
  await gm.getByRole('button', { name: '⚔ Arsenal' }).click();
  await tab(gm, 'Loot');
  const panel = gm.getByRole('region', { name: 'Party loot rolls' });
  const st0 = await gmState();
  const sword = st0.arsenal.staged.find((i) => i.id === 'roll-sword');
  const helm = st0.arsenal.staged.find((i) => i.id === 'roll-helm');
  await panel.getByLabel(`Roll for ${sword.name}`).check();
  await panel.getByLabel(`Roll for ${helm.name}`).check();
  for (const n of ['Elwin', 'Javi']) await panel.getByLabel(n, { exact: true }).uncheck();
  await panel.getByRole('button', { name: /Start loot roll \(2\)/ }).click();
  check('GM starts rolls; items leave the tray', await gm.waitForFunction(async () => (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.arsenal.staged.length === 0, null, { timeout: 10000 }).then(() => true, () => false));
  const rolls = (await gmState()).lootRolls;
  const rSword = rolls.find((r) => r.itemName === sword.name).id;
  const rHelm = rolls.find((r) => r.itemName === helm.name).id;

  // players see the dock with the item and a countdown
  const dockH = hannah.getByRole('complementary', { name: 'Loot rolls' });
  const dockJ = jean.getByRole('complementary', { name: 'Loot rolls' });
  check('players get the Need / Distribute / Pass dock', await dockH.locator(`[data-roll="${rSword}"]`).waitFor({ timeout: 15000 }).then(() => true, () => false) && await dockJ.locator(`[data-roll="${rSword}"]`).waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('a countdown is shown', /⏳ \d:\d\d/.test(await dockH.locator(`[data-roll="${rSword}"]`).getByLabel('Time left').innerText()));
  check('the Chronicle announces the roll', await waitText(hannah, /Loot roll: .* may choose Need, Distribute or Pass/));
  await hannah.screenshot({ path: out + '/lootroll-dock.png' });

  // sword: Sinna Distribute, Aster Need → Aster wins (Need priority)
  await dockH.locator(`[data-roll="${rSword}"]`).getByRole('button', { name: 'Distribute' }).click();
  check('own choice is highlighted', await dockH.locator(`[data-roll="${rSword}"]`).getByRole('button', { name: 'Distribute', pressed: true }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  check('others only see that someone has decided', await dockJ.locator(`[data-roll="${rSword}"]`).getByText('Decided: 1/2').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await dockJ.locator(`[data-roll="${rSword}"]`).getByRole('button', { name: 'Need' }).click();
  const swordRes = dockH.locator(`[data-roll="${rSword}"]`).getByTestId('roll-results');
  check('the result appears for everyone with public rolls', await swordRes.waitFor({ timeout: 15000 }).then(() => true, () => false) && /Aster receives/.test(await swordRes.innerText()) && /Aster: Need · d100 \d+/.test(await swordRes.innerText()));
  check('Need beats Distribute (Sinna does not roll)', /Sinna: Distribute\n|Sinna: Distribute$/.test(await swordRes.innerText()));
  let st = await gmState();
  check('the item belongs to Aster exactly once', st.tokens.aster.inventory.filter((i) => i.id === 'roll-sword').length === 1 && !st.tokens.sinna.inventory.some((i) => i.id === 'roll-sword') && !st.arsenal.staged.some((i) => i.id === 'roll-sword'));
  check('the winner is announced in the Chronicle', await waitText(jean, /Loot roll – .*: Aster wins \(Need/));
  check('Aster sees the item in the inventory', await (async () => { await jean.getByRole('button', { name: '🎒 Inventory' }).click(); return jean.locator('[data-item="roll-sword"]').waitFor({ timeout: 10000 }).then(() => true, () => false); })());

  // helm: only Sinna answers ("Jean disconnected"); the GM resolves → Sinna wins
  await dockH.locator(`[data-roll="${rHelm}"]`).getByRole('button', { name: 'Need' }).click();
  await jean.close();
  check('a retry of the same choice is harmless', (await cmd(hannah, { type: 'lootRollChoose', rollId: rHelm, tokenId: 'sinna', choice: 'need' })).status === 200);
  check('Jean cannot close the roll before the deadline (server)', (await cmd(hannah, { type: 'lootRollClaimExpired', rollId: rHelm, tokenId: 'sinna' })).status === 422);
  await panel.locator(`[data-roll="${rHelm}"]`).getByRole('button', { name: 'Resolve now' }).click();
  const helmRes = dockH.locator(`[data-roll="${rHelm}"]`).getByTestId('roll-results');
  check('GM resolves with the missing answer counted as Pass', await helmRes.waitFor({ timeout: 15000 }).then(() => true, () => false) && /Sinna receives/.test(await helmRes.innerText()) && /Aster: Pass/.test(await helmRes.innerText()));
  check('a resolved roll cannot be resolved again', (await cmd(gm, { type: 'lootRollResolve', rollId: rHelm })).status === 422);
  st = await gmState();
  check('Sinna owns the helm', st.tokens.sinna.inventory.some((i) => i.id === 'roll-helm'));
  await gm.screenshot({ path: out + '/lootroll-gm.png', fullPage: true });

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
