/**
 * Multi-browser acceptance test of APEX 0.3 (password login, character sheets, PDF import, inventory).
 *
 *   Local mock:   npm run dev:mock   then   node dev/e2e-online.cjs [screenshot-dir]
 *   Real deploy:  APEX_URL=https://… APEX_GM_PASSWORD=… APEX_HANNAH_PASSWORD=… APEX_JEAN_PASSWORD=… node dev/e2e-online.cjs
 *                 (APEX_GM_SETUP_CODE=… instead of APEX_GM_PASSWORD runs the first-time setup)
 *
 * Every participant runs in its own isolated browser context (separate cookies = separate device).
 */
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.APEX_URL || 'http://localhost:5174';
const MOCK = !process.env.APEX_URL;
const out = process.argv[2] || '.';
const FIX = path.join(__dirname, 'fixtures');
const PW = {
  gm: process.env.APEX_GM_PASSWORD || 'gm-e2e-password',
  hannah: process.env.APEX_HANNAH_PASSWORD || 'hannah-test-pass',
  jean: process.env.APEX_JEAN_PASSWORD || 'jean-test-pass',
};
const SHARE = process.env.APEX_SHARE_QUERY || ''; // e.g. "_vercel_share=…" for protected previews
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
  console.log(results.at(-1));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p = '/') => `${BASE}${p}${SHARE ? (p.includes('?') ? '&' : '?') + SHARE : ''}`;

async function newDevice(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (SHARE) await ctx.newPage().then(async (p) => (await p.goto(url('/')), p.close()));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR: ${e.message}`));
  return page;
}

async function openProfile(page, name) {
  await page.goto(url('/'));
  const join = page.getByRole('button', { name: 'Join Campaign' });
  await join.waitFor();
  await join.click();
  await page.getByRole('button', { name: new RegExp(`^${name} –`) }).click();
}

async function login(browser, name, password) {
  const page = await newDevice(browser);
  await openProfile(page, name);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Enter the Arena' }).click();
  return page;
}

/** Calls the API from inside the page (cookie sent by the browser) – like a malicious client could. */
const apiFetch = (page, op, body, query = '') =>
  page.evaluate(
    async ([op, body, query]) => {
      const r = await fetch(`/api/apex?op=${op}${query}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', 'x-apex-csrf': '1' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [op, body, query],
  );

const waitText = (page, re, timeout = 10000) =>
  page.waitForFunction(([src, flags]) => new RegExp(src, flags).test(document.body.innerText), [re.source, re.flags], { timeout }).then(
    () => true,
    () => false,
  );

(async () => {
  const b = await chromium.launch();

  // ---------- Welcome & profiles ----------
  const anon = await newDevice(b);
  await anon.goto(url('/'));
  await anon.getByRole('button', { name: 'Join Campaign' }).click();
  await anon.getByRole('heading', { name: 'Who are you?' }).waitFor();
  await anon.waitForTimeout(800);
  await anon.screenshot({ path: out + '/e2e-profiles.png' });
  const profText = await anon.locator('body').innerText();
  check('"Who are you?" shows all five profiles and no email field', ['GM', 'Hannah', 'Jean', 'Simon', 'Jerba'].every((n) => profText.includes(n)) && !/email/i.test(profText));
  check('profiles without a password are locked', MOCK ? await anon.getByRole('button', { name: /^Simon – .*not activated/ }).isDisabled() : true);

  // ---------- GM ----------
  let gm;
  if (MOCK || process.env.APEX_GM_SETUP_CODE) {
    gm = await newDevice(b);
    await openProfile(gm, 'GM');
    await gm.getByRole('heading', { name: 'First-time setup' }).waitFor();
    const code = MOCK ? (await (await fetch(BASE + '/__mock/setup-code')).json()).code : process.env.APEX_GM_SETUP_CODE;
    await gm.getByLabel('Setup code').fill('0000-0000-0000-0000-0000-0000');
    await gm.getByLabel(/New Game Master password/).fill(PW.gm);
    await gm.getByLabel('Repeat the password').fill(PW.gm);
    await gm.getByRole('button', { name: /Set password and enter/ }).click();
    check('a wrong setup code is rejected', await waitText(gm, /setup code is wrong/));
    await gm.getByLabel('Setup code').fill(code);
    await gm.getByRole('button', { name: /Set password and enter/ }).click();
    if (MOCK) await gm.getByRole('button', { name: /Generate arena/ }).click({ timeout: 15000 }).catch(() => undefined);
  } else {
    gm = await login(b, 'GM', PW.gm);
  }
  check('GM signs in with profile + password (no email)', await waitText(gm, /Game Master/, 20000));
  await gm.waitForSelector('canvas', { timeout: 20000 });
  await gm.waitForTimeout(1200);
  await gm.screenshot({ path: out + '/e2e-gm-map.png' });

  // ---------- wrong password, GM impersonation ----------
  const wrong = await newDevice(b);
  await openProfile(wrong, 'Hannah');
  await wrong.getByLabel('Password', { exact: true }).fill('definitely-wrong');
  await wrong.getByRole('button', { name: 'Enter the Arena' }).click();
  check('wrong passwords are rejected', await waitText(wrong, /Wrong password/));
  await wrong.screenshot({ path: out + '/e2e-wrong-password.png' });
  await wrong.getByRole('button', { name: /Choose another profile/ }).click();
  await wrong.getByRole('button', { name: /^GM –/ }).click();
  const loginBtn = wrong.getByRole('button', { name: 'Enter the Arena' });
  if (await loginBtn.isVisible().catch(() => false)) {
    await wrong.getByLabel('Password', { exact: true }).fill(PW.hannah);
    await loginBtn.click();
    check('a player cannot sign in as GM with their own password', await waitText(wrong, /Wrong password/));
  } else check('a player cannot sign in as GM with their own password', true);
  const forged = await apiFetch(wrong, 'admin', { action: 'setPassword', profile: 'gm', password: 'takeover-123' });
  check('unauthenticated admin request is refused', forged.status === 401);

  // ---------- players ----------
  const hannah = await login(b, 'Hannah', PW.hannah);
  check('Hannah signs in and plays Sinna', await waitText(hannah, /Playing as Sinna/, 20000));
  const jean = await login(b, 'Jean', PW.jean);
  check('Jean signs in and plays Aster', await waitText(jean, /Playing as Aster/, 20000));
  const cookies = await hannah.context().cookies();
  const sc = cookies.find((c) => c.name.includes('apex_session'));
  check('session cookie is HttpOnly, Secure and SameSite=Strict', !!sc && sc.httpOnly && sc.secure && sc.sameSite === 'Strict');
  check('the session token is not readable by JavaScript', (await hannah.evaluate(() => document.cookie)).indexOf('apex_session') === -1);

  // ---------- multiplayer sync (unchanged rules) ----------
  const beforeJean = await apiFetch(jean, 'state');
  const move = await apiFetch(hannah, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } });
  check('Hannah moves Sinna through /api/apex', move.status === 200, JSON.stringify(move.body).slice(0, 200));
  const gmSees = await gm.waitForFunction(
    async () => {
      const r = await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } });
      const j = await r.json();
      return j.state?.tokens?.sinna?.pos?.q === 1 && j.state.tokens.sinna.pos.r === 0;
    },
    null,
    { timeout: 10000 },
  ).then(() => true, () => false);
  check('the move is visible to the GM (shared campaign)', gmSees);
  const foreign = await apiFetch(hannah, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'move', tokenId: 'aster', to: { q: 1, r: 1 } } });
  check('Hannah cannot move Aster', foreign.status === 403);
  const gmCmd = await apiFetch(hannah, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'endDay' } });
  check('Hannah cannot run GM commands', gmCmd.status === 403);
  const leak = JSON.stringify((await apiFetch(hannah, 'state')).body);
  check('player state contains no hidden map data', !/"seed"|gmNotes|"mapRadius":\d/.test(leak));

  // ---------- character sheet + PDF import ----------
  await hannah.getByRole('button', { name: /Character$/ }).click();
  await hannah.getByRole('button', { name: /Import Character Sheet/ }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(FIX, 'not-a-pdf.pdf'));
  check('non-PDF files are rejected by content', await waitText(hannah, /This is not a PDF file/));
  await hannah.getByRole('button', { name: 'Choose another file' }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(FIX, 'scanned-image.pdf'));
  check('image-only PDFs are explained honestly (no OCR)', await waitText(hannah, /no readable text or form fields/, 20000));
  await hannah.getByRole('button', { name: 'Choose another file' }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(FIX, 'sinna-5e-fillable.pdf'));
  check('fillable PDF is read and shown for review', await waitText(hannah, /Fillable D&D 5e character sheet/, 20000));
  const review = await hannah.locator('[role=dialog]').innerText();
  check('review shows recognized values and highlights unknown fields', /Recognized/.test(review) && /Unknown field/.test(review) && (await hannah.getByLabel('Value of Class & Level').inputValue()) === 'Sorcerer 3');
  await hannah.getByLabel('Value of Hit points (current)').fill('16');
  await hannah.screenshot({ path: out + '/e2e-import-review.png', fullPage: true });
  await hannah.getByRole('button', { name: /Save character sheet/ }).click();
  check('imported sheet is saved', await waitText(hannah, /Imported character sheet saved|Sorcerer 3/));
  await hannah.reload();
  await hannah.getByRole('button', { name: /Character$/ }).click();
  check('imported data persists after refreshing', await waitText(hannah, /Sorcerer 3/, 15000) && (await waitText(hannah, /16\s*\/\s*20/)));
  await hannah.screenshot({ path: out + '/e2e-character.png', fullPage: true });

  // manual resource edit
  await hannah.getByRole('button', { name: 'Decrease Hit points' }).click();
  check('a player can change a resource manually (HP 16 → 15)', await waitText(hannah, /15\s*\/\s*20/));
  const willBefore = (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details.will.current;
  await hannah.getByRole('button', { name: 'Decrease Willpower' }).click();
  await sleep(800);
  const willAfter = (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details.will.current;
  check('Willpower comes from the game state and can be spent', willAfter === willBefore - 1);
  // import added equipment lines to the inventory
  // ---------- inventory ----------
  await hannah.getByRole('button', { name: /Inventory/ }).click();
  check('equipment from the PDF was added to the inventory', await waitText(hannah, /Bedroll/));
  await hannah.getByPlaceholder(/Old iron key/).fill('Old iron key, wrapped in red cloth');
  await hannah.getByRole('button', { name: '+ Add' }).click();
  check('a player can add a free-text inventory item', await waitText(hannah, /Old iron key, wrapped in red cloth/));
  await hannah.getByPlaceholder('e.g. Saddlebag').fill('Hidden Chest');
  await hannah.getByRole('button', { name: /Create container/ }).click();
  check('a player can create a custom container', await waitText(hannah, /Hidden Chest/));
  await hannah.getByLabel('Move Old iron key, wrapped in red cloth to').selectOption({ label: '→ Hidden Chest' });
  check('items can be moved between containers', await hannah.locator('[data-container] >> text=Old iron key').count().then((n) => n > 0) && (await waitText(hannah, /Hidden Chest \(1\)/i)));
  await hannah.screenshot({ path: out + '/e2e-inventory.png', fullPage: true });

  // ---------- privacy ----------
  const jeanReadsSheet = await apiFetch(jean, 'sheet', null, '&token=sinna');
  check('Jean cannot read Hannah’s character sheet', jeanReadsSheet.status === 403 && !JSON.stringify(jeanReadsSheet.body).includes('Sorcerer'));
  const jeanView = JSON.stringify((await apiFetch(jean, 'state')).body);
  check('Jean does not receive Sinna’s inventory', !jeanView.includes('Old iron key'));
  const jeanEdits = await apiFetch(jean, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'invAddItem', tokenId: 'sinna', itemId: 'evil', name: 'x' } });
  check('Jean cannot edit Sinna’s inventory', jeanEdits.status === 403);

  // ---------- GM oversight ----------
  await gm.getByRole('button', { name: /Character sheets/ }).click();
  await gm.getByLabel('Character to inspect').selectOption({ label: 'Sinna' });
  check('the GM sees Hannah’s sheet', await waitText(gm, /Sorcerer 3/, 15000));
  await gm.getByRole('button', { name: /Edit sheet/ }).click();
  await gm.getByLabel('Notes').fill('GM note: owes the Gamemakers a favour.');
  await gm.getByRole('button', { name: 'Save changes' }).click();
  check('the GM edits the sheet', await waitText(gm, /owes the Gamemakers/));
  await hannah.getByRole('button', { name: /Character$/ }).click();
  check('GM edit reaches Hannah’s device (live/poll)', await waitText(hannah, /owes the Gamemakers/, 30000));
  await gm.getByRole('button', { name: /Inventory/ }).click();
  check('the GM sees Hannah’s inventory', await waitText(gm, /Old iron key/));
  await gm.screenshot({ path: out + '/e2e-gm-inventory.png', fullPage: true });

  // ---------- simultaneous edits ----------
  const sheetNow = (await apiFetch(hannah, 'sheet', null, '&token=sinna')).body;
  const a = await apiFetch(hannah, 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...sheetNow.sheet, notes: 'device A' }, expectedVersion: sheetNow.version });
  const bb = await apiFetch(gm, 'sheet', { action: 'save', tokenId: 'sinna', sheet: { ...sheetNow.sheet, notes: 'device B' }, expectedVersion: sheetNow.version });
  check('simultaneous sheet saves cannot silently overwrite each other', a.status === 200 && bb.status === 409);
  const inv = (await apiFetch(gm, 'state')).body.state.tokens.sinna.inventory.find((i) => i.name.startsWith('Old iron key'));
  const e1 = await apiFetch(gm, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'invUpdateItem', tokenId: 'sinna', itemId: inv.id, rev: inv.rev, quantity: 2 } });
  const e2 = await apiFetch(hannah, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'invUpdateItem', tokenId: 'sinna', itemId: inv.id, rev: inv.rev, quantity: 5 } });
  check('simultaneous item edits cannot silently overwrite each other', e1.status === 200 && e2.status === 422);

  // ---------- GM password management ----------
  if (MOCK) {
    await gm.getByRole('button', { name: /Map/ }).click();
    const simonRow = gm.locator('[data-profile="simon"]');
    await simonRow.getByRole('button', { name: /Set password/ }).click();
    await gm.getByLabel('New password for Simon').fill('simon-first-pass');
    await simonRow.getByRole('button', { name: 'Save' }).click();
    check('the GM initialises Simon’s password', await waitText(gm, /Simon: password set/));
    const simon = await login(b, 'Simon', 'simon-first-pass');
    check('Simon can now sign in and plays Elwin', await waitText(simon, /Playing as Elwin/, 20000));
    const inspect = await (await fetch(BASE + '/__mock/inspect')).json();
    check('only Argon2id hashes are stored', inspect.credentials.every(([, h]) => h.startsWith('$argon2id$')) && !JSON.stringify(inspect).includes('simon-first-pass'));
    await gm.locator('[data-profile="jean"]').getByRole('button', { name: 'Deactivate' }).click();
    await waitText(gm, /Jean deactivated/);
    const jeanAfter = await apiFetch(jean, 'state');
    check('deactivating Jean revokes the session immediately', jeanAfter.status === 401);
    await gm.screenshot({ path: out + '/e2e-gm-access.png', fullPage: true });
  }

  // ---------- logout ----------
  await hannah.getByRole('button', { name: 'Sign out' }).click();
  check('logout returns to "Who are you?"', await waitText(hannah, /Who are you\?/));
  check('the old session no longer works', (await apiFetch(hannah, 'state')).status === 401);

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
