/**
 * Browser acceptance test of APEX 0.7 PR A (mock only, fresh server): Wild Shape, beast picture, temporary HP,
 * Sneak, Font of Magic.   npm run dev:mock   then   node dev/e2e-abilities.cjs [screenshot-dir]
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
const sheetOf = async (page) => (await apiFetch(page, 'sheet', null, '&token=sinna')).body.sheet;

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
  const cur = (await apiFetch(gm, 'sheet', null, '&token=sinna')).body;
  await apiFetch(gm, 'sheet', {
    action: 'save', tokenId: 'sinna', expectedVersion: cur.version,
    sheet: { ...cur.sheet, hitPoints: { current: 20, max: 24, temp: 0 }, details: [{ id: 'd', label: 'Class', value: 'Druid 4 / Sorcerer 2' }],
      attributes: [{ id: 'a1', name: 'Strength', value: '10', modifier: '+0' }, { id: 'a4', name: 'Intelligence', value: '13', modifier: '+1' }, { id: 'a5', name: 'Wisdom', value: '18', modifier: '+4' }, { id: 'a6', name: 'Charisma', value: '9', modifier: '-1' }],
      resources: [{ id: 's1', name: 'Spell slots (level 1)', current: 3, max: 4 }] },
  });

  const hannah = await newDevice(b);
  await openProfile(hannah, 'Hannah');
  await hannah.getByLabel('Password', { exact: true }).fill('hannah-test-pass');
  await hannah.getByRole('button', { name: 'Enter the Arena' }).click();
  await waitText(hannah, /Playing as Sinna/, 20000);
  await hannah.getByRole('button', { name: '📜 Character', exact: true }).click();
  const actions = hannah.getByRole('region', { name: 'Class abilities' });

  // Wild Shape
  await actions.getByRole('button', { name: '🐾 Wild Shape' }).click();
  const picker = hannah.getByLabel('Wild Shape forms');
  await picker.getByLabel('Search beast forms').fill('eagle');
  await picker.getByRole('option', { name: /Giant Eagle/ }).click();
  check('ineligible forms explain why (CR / flying at druid 4)', /CR too high/.test(await picker.innerText()));
  await picker.getByLabel('Search beast forms').fill('croc');
  await picker.getByRole('option', { name: /Crocodile/ }).click();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cf0000000301010018dd8db40000000049454e44ae426082', 'hex');
  await picker.getByLabel('Beast picture').setInputFiles({ name: 'croc.png', mimeType: 'image/png', buffer: png });
  check('a picture can be uploaded for the form', await hannah.getByTestId('beast-picture').first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await picker.getByRole('button', { name: 'Transform into Crocodile' }).click();
  check('the druid transforms (beast HP separate)', await hannah.getByTestId('wild-shape-active').waitFor({ timeout: 10000 }).then(() => true, () => false));
  const s1 = await sheetOf(hannah);
  check('beast HP 19/19, own HP 20/24 kept, one use spent', s1.wildShape?.hp === 19 && s1.hitPoints.current === 20 && s1.resources.find((r) => r.name === 'Wild Shape')?.current === 1);
  const stats = hannah.getByTestId('beast-stats');
  check('mental scores stay the druid’s (INT 13, WIS 18, CHA 9), physical are the crocodile’s (STR 15)', (await stats.locator('[data-score="wis"]').innerText()).includes('18') && (await stats.locator('[data-score="int"]').innerText()).includes('13') && (await stats.locator('[data-score="str"]').innerText()).includes('15'));
  check('the beast portrait is displayed', await hannah.getByTestId('wild-shape-active').getByTestId('beast-picture').isVisible());
  await hannah.screenshot({ path: out + '/abilities-wildshape.png', fullPage: true });

  // temporary HP then damage → temp first, then beast, revert with carry-over
  await actions.getByLabel('HP amount').fill('4');
  await actions.getByRole('button', { name: 'Grant temp' }).click();
  await hannah.waitForFunction(async () => (await (await fetch('/api/apex?op=sheet&token=sinna', { headers: { 'x-apex-csrf': '1' } })).json()).sheet.hitPoints.temp === 4, null, { timeout: 10000 });
  await actions.getByLabel('HP amount').fill('30');
  await actions.getByRole('button', { name: 'Damage' }).click();
  await hannah.getByTestId('wild-shape-active').waitFor({ state: 'detached', timeout: 10000 });
  const s2 = await sheetOf(hannah);
  check('temporary HP absorb first; at 0 beast HP the druid reverts, excess carries over (20 − 7 = 13)', !s2.wildShape && s2.hitPoints.current === 13 && s2.hitPoints.temp === 0, JSON.stringify(s2.hitPoints));
  await actions.getByLabel('HP amount').fill('5');
  await actions.getByRole('button', { name: 'Grant temp' }).click();
  await hannah.getByRole('tab', { name: 'Overview' }).click();
  check('the health orb shows temporary HP separately', await hannah.getByTestId('temp-hp-ring').first().waitFor({ timeout: 10000 }).then(() => true, () => false));

  // Font of Magic
  await actions.getByRole('button', { name: '✦ Font of Magic' }).click();
  await hannah.getByRole('button', { name: 'Create a level 1 slot for 2 sorcery points' }).click();
  await hannah.waitForFunction(async () => {
    const s = (await (await fetch('/api/apex?op=sheet&token=sinna', { headers: { 'x-apex-csrf': '1' } })).json()).sheet;
    return s.resources.find((r) => r.name === 'Sorcery Points')?.current === 0;
  }, null, { timeout: 10000 });
  const s3 = await sheetOf(hannah);
  check('Font of Magic: 2 SP → one level-1 slot (sorcerer level 2, not character level 6)', s3.resources.find((r) => r.name === 'Sorcery Points').max === 2 && s3.resources.find((r) => r.id === 's1').current === 4);

  // Sneak
  await actions.getByRole('button', { name: /Sneak/ }).click();
  check('Sneak is shown on the sheet', await hannah.getByTestId('sneak-note').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await hannah.getByRole('button', { name: /Map/ }).first().click();
  check('the map shows the Sneaking indicator', await hannah.getByTestId('sneak-indicator').waitFor({ timeout: 10000 }).then(() => true, () => false));
  const view = (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details;
  check('sneaking does not refill movement', view.sneaking === true && view.movePoints <= view.maxMovePoints);
  await hannah.screenshot({ path: out + '/abilities-sneak.png' });
  await hannah.reload();
  await waitText(hannah, /Playing as Sinna/, 20000);
  check('state persists after refresh (sneaking, sheet)', (await hannah.getByTestId('sneak-indicator').waitFor({ timeout: 10000 }).then(() => true, () => false)) && (await sheetOf(hannah)).hitPoints.temp === 5);

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
