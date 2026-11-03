/**
 * Browser acceptance test of APEX 0.7 PR2: identity & tagline, incremental (level-up) PDF import, character
 * snapshots (GM), feedback reports and the GM inbox.
 *
 *   Local mock only (fresh server):  npm run dev:mock   then   node dev/e2e-07.cjs [screenshot-dir]
 * It never runs against a real deployment: it edits character sheets.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = 'http://localhost:5174';
const out = process.argv[2] || '.';
const PW = { gm: 'gm-e2e-password', hannah: 'hannah-test-pass', jean: 'jean-test-pass' };
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
  console.log(results.at(-1));
};
async function newDevice(b) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true })).newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR: ${e.message}`));
  return page;
}
async function openProfile(page, name) {
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'Join Campaign' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name} –`) }).click();
}
async function login(b, name, pw) {
  const p = await newDevice(b);
  await openProfile(p, name);
  await p.getByLabel('Password', { exact: true }).fill(pw);
  await p.getByRole('button', { name: 'Enter the Arena' }).click();
  return p;
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

(async () => {
  const b = await chromium.launch();
  const gm = await newDevice(b);
  await openProfile(gm, 'GM');
  await gm.getByRole('heading', { name: 'First-time setup' }).waitFor();
  const code = (await (await fetch(BASE + '/__mock/setup-code')).json()).code;
  await gm.getByLabel('Setup code').fill(code);
  await gm.getByLabel(/New Game Master password/).fill(PW.gm);
  await gm.getByLabel('Repeat the password').fill(PW.gm);
  await gm.getByRole('button', { name: /Set password and enter/ }).click();
  await gm.getByRole('button', { name: /Generate arena/ }).click({ timeout: 15000 }).catch(() => undefined);
  check('GM signs in', await waitText(gm, /Game Master/, 20000));

  // ---------- identity & tagline ----------
  const hannah = await login(b, 'Hannah', PW.hannah);
  await waitText(hannah, /Playing as Sinna/, 20000);
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  // first import (no sheet yet) – the normal full review
  await hannah.getByRole('button', { name: /Import Character Sheet/ }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(__dirname, '..', 'tests', 'fixtures', 'sinna.pdf'));
  await waitText(hannah, /Aurora Builder character sheet/, 30000);
  await hannah.getByRole('button', { name: /Save character sheet/ }).click();
  await hannah.getByRole('dialog').filter({ hasText: /Import character sheet/ }).waitFor({ state: 'detached', timeout: 20000 });
  await hannah.getByRole('tab', { name: 'Overview' }).click();
  await hannah.getByRole('button', { name: '✎ Edit identity' }).click();
  check('the imported class is only offered as a tagline suggestion', await hannah.getByRole('button', { name: /Use suggestion from the imported sheet: “Kor Druid”/ }).isVisible());
  await hannah.getByLabel('Character title / tagline').fill('Will-Weaver of the North');
  check('tagline preview', (await hannah.getByTestId('tagline-preview').innerText()) === 'Will-Weaver of the North');
  await hannah.getByLabel('Subclass', { exact: true }).fill('Circle of the Land');
  await hannah.getByLabel('Biography').fill('Raised among the aqueduct keepers.');
  await hannah.getByRole('button', { name: 'Save identity' }).click();
  check('identity saved', await waitText(hannah, /Identity saved/));
  await hannah.reload();
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  await hannah.getByRole('tab', { name: 'Overview' }).click();
  check('custom tagline persists after refresh (header)', (await hannah.getByTestId('header-tagline').innerText({ timeout: 10000 })) === 'Will-Weaver of the North');
  check('background/identity edits persist', (await waitText(hannah, /Circle of the Land/)) && (await waitText(hannah, /aqueduct keepers/)));
  await hannah.screenshot({ path: out + '/v07-identity.png', fullPage: true });

  // ---------- incremental (level-up) import ----------
  const cur = (await apiFetch(hannah, 'sheet', null, '&token=sinna')).body;
  const edited = structuredClone(cur.sheet);
  edited.attributes.find((a) => a.name === 'Strength').value = '9';
  edited.hitPoints.max = 7;
  edited.hitPoints.current = 4;
  await apiFetch(hannah, 'sheet', { action: 'save', tokenId: 'sinna', sheet: edited, expectedVersion: cur.version });
  await hannah.reload();
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  await hannah.getByRole('button', { name: /Import Character Sheet/ }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(__dirname, '..', 'tests', 'fixtures', 'sinna.pdf'));
  const lv = hannah.getByLabel('Level-up changes');
  check('re-import opens the incremental update with only the changes', await lv.waitFor({ timeout: 30000 }).then(() => true, () => false));
  const text = await lv.innerText();
  check('readable diff: Strength 9 → 11, Maximum HP 7 → 9', /Strength: 9.*→ 11/.test(text) && /Maximum HP: 7 → 9/.test(text), text.slice(0, 400));
  check('unchanged values are not listed', !/Wisdom:/.test(text));
  await hannah.screenshot({ path: out + '/v07-levelup.png', fullPage: true });
  await lv.getByLabel('Apply Maximum HP').uncheck();
  await lv.getByLabel('Level-up note').fill('Back to the PDF values');
  await lv.getByRole('button', { name: /Apply \d+ selected changes/ }).click();
  await hannah.getByRole('dialog').filter({ hasText: /Import character sheet/ }).waitFor({ state: 'detached', timeout: 20000 });
  const after = (await apiFetch(hannah, 'sheet', null, '&token=sinna')).body.sheet;
  check('only the approved change was applied (Strength 11, max HP still 7, current HP kept)', after.attributes.find((a) => a.name === 'Strength').value === '11' && after.hitPoints.max === 7 && after.hitPoints.current === 4);
  check('manual identity edits and the custom tagline survive the import', after.details.some((d) => d.label === 'Subclass') && (await hannah.getByTestId('header-tagline').innerText()) === 'Will-Weaver of the North');
  check('progression history entry recorded', after.progression?.length === 1 && after.progression[0].approved.includes('Strength') && after.progression[0].note === 'Back to the PDF values');
  await hannah.getByRole('tab', { name: 'History' }).click();
  check('players see the progression history, not the GM archive', (await waitText(hannah, /Sheet update/)) && (await waitText(hannah, /created and restored by the Game Master/)));

  // ---------- GM snapshots ----------
  await gm.getByRole('button', { name: '📜 Character sheets' }).click();
  await gm.getByLabel('Character to inspect').selectOption('sinna');
  await gm.getByRole('tab', { name: 'History' }).click();
  const arch = gm.getByRole('region', { name: 'Character archive' });
  check('automatic snapshot before the PDF update', await arch.getByText('Before sheet update (PDF)').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await arch.getByLabel('Snapshot name').fill('GM Manual Backup');
  await arch.getByLabel('Snapshot note').fill('before the boss');
  await arch.getByRole('button', { name: 'Create snapshot' }).click();
  check('GM creates a named snapshot', await arch.getByText('GM Manual Backup').waitFor({ timeout: 10000 }).then(() => true, () => false));
  const autoRow = arch.locator('[data-snapshot]').filter({ hasText: 'Before sheet update (PDF)' });
  await autoRow.getByRole('button', { name: 'Select' }).click();
  check('compare with the current character shows Strength 9 → 11', await arch.locator('[data-diff="Strength"]').innerText({ timeout: 10000 }).then((t) => /9.*11/.test(t), () => false));
  await arch.getByLabel('Attributes, saving throws & skills').check();
  await arch.getByRole('button', { name: 'Restore selected' }).click();
  check('restore applies only the selected part', await gm.waitForFunction(async () => {
    const r = await (await fetch('/api/apex?op=sheet&token=sinna', { headers: { 'x-apex-csrf': '1' } })).json();
    return r.sheet.attributes.find((a) => a.name === 'Strength').value === '9' && r.sheet.hitPoints.max === 7;
  }, null, { timeout: 10000 }).then(() => true, () => false));
  check('restore never touches items or currency', (await apiFetch(gm, 'state')).body.state.tokens.sinna.inventory.length > 0);
  await gm.screenshot({ path: out + '/v07-archive.png', fullPage: true });
  const forged = await apiFetch(hannah, 'character-archive', { action: 'list', tokenId: 'sinna' });
  check('players cannot use the character archive', forged.status === 403);

  // ---------- feedback ----------
  await hannah.getByRole('button', { name: 'Feedback' }).click();
  const fd = hannah.getByRole('dialog', { name: 'Feedback' });
  await fd.getByLabel('Feedback title').fill('Chronicle jumps while reading');
  await fd.getByLabel('Description').fill('When a new event arrives the list moves.');
  await fd.getByLabel('Steps to reproduce').fill('1. Scroll up\n2. Wait for dawn');
  await fd.getByRole('button', { name: 'Send report' }).click();
  check('report sent; “My reports” shows it as New', await fd.locator('[data-status="new"]').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await fd.getByRole('button', { name: 'Close feedback' }).click();
  const jean = await login(b, 'Jean', PW.jean);
  await waitText(jean, /Playing as Aster/, 20000);
  check('other players do not see the report', ((await apiFetch(jean, 'feedback')).body.feedback ?? []).length === 0);
  await gm.getByRole('button', { name: '📮 Feedback' }).click();
  const inbox = gm.getByLabel('Feedback inbox');
  await inbox.getByText('Chronicle jumps while reading').click();
  await inbox.getByRole('button', { name: 'Acknowledge' }).click();
  await inbox.getByLabel('GM notes').fill('Reproduced – fixed in 0.7');
  await inbox.getByRole('button', { name: 'Save notes' }).click();
  check('GM acknowledges the report', await inbox.locator('[data-status="acknowledged"]').waitFor({ timeout: 10000 }).then(() => true, () => false));
  const [dl] = await Promise.all([gm.waitForEvent('download'), inbox.getByRole('button', { name: '⤓ CSV' }).click()]);
  const csv = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  check('CSV export contains the report', /Chronicle jumps while reading/.test(csv) && /acknowledged/.test(csv));
  await gm.screenshot({ path: out + '/v07-feedback-inbox.png', fullPage: true });
  await hannah.getByRole('button', { name: 'Feedback' }).click();
  await hannah.getByRole('tab', { name: 'My reports' }).click();
  check('the reporter sees the new status, not the GM notes', (await hannah.locator('[data-status="acknowledged"]').waitFor({ timeout: 10000 }).then(() => true, () => false)) && !(await waitText(hannah, /Reproduced – fixed/, 1500)));

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
