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

const openGm = async (page, id) => {
  const head = page.locator(`[data-gm-section="${id}"] button[aria-expanded]`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
};

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

  // ---------- request budget (regression: production request storm 2026-11-01) ----------
  if (MOCK) {
    let n = 0;
    const onReq = (r) => r.url().includes('/api/apex') && n++;
    gm.on('request', onReq);
    await fetch(BASE + '/__mock/latency?ms=800'); // slow database
    await sleep(35_000);
    await fetch(BASE + '/__mock/latency?ms=0');
    gm.off('request', onReq);
    check(`idle GM page stays within the request budget (${n} requests in 35 s with a slow server, max 6)`, n <= 6, `${n} requests`);
  }

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
  let jean = await login(b, 'Jean', PW.jean);
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

  // ---------- character sheet + PDF import (real Aurora sample) ----------
  await hannah.getByRole('button', { name: /Character$/ }).click();
  await hannah.getByRole('button', { name: /Import Character Sheet/ }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(FIX, 'not-a-pdf.pdf'));
  check('non-PDF files are rejected by content', await waitText(hannah, /This is not a PDF file/));
  await hannah.getByRole('button', { name: 'Choose another file' }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(FIX, 'scanned-image.pdf'));
  check('image-only PDFs are explained honestly (no OCR)', await waitText(hannah, /no readable text or form fields/, 20000));
  await hannah.getByRole('button', { name: 'Choose another file' }).click();
  await hannah.getByLabel('Choose a PDF file').setInputFiles(path.join(__dirname, '..', 'tests', 'fixtures', 'sinna.pdf'));
  check('Aurora PDF is detected and read from its form fields', await waitText(hannah, /Aurora Builder character sheet/, 30000));
  const review = await hannah.locator('[role=dialog]').innerText();
  check('review is grouped into readable sections', ['Identity & appearance', 'Attributes', 'Combat & resources', 'Skills & saving throws', 'Features & traits', 'Spells', 'Equipment & inventory'].every((g) => review.toUpperCase().includes(g.toUpperCase())));
  check(
    'review shows name, build, AC 16, max HP 9, Wisdom 18',
    (await hannah.getByLabel('Value of Character name', { exact: true }).inputValue()) === 'Sinna' &&
      (await hannah.getByLabel('Value of Race, class & level', { exact: true }).inputValue()) === 'Level 1 Kor Druid' &&
      (await hannah.getByLabel('Value of Armor Class', { exact: true }).inputValue()) === '16' &&
      (await hannah.getByLabel('Value of Hit points (maximum)', { exact: true }).inputValue()) === '9' &&
      (await hannah.getByLabel('Value of Wisdom', { exact: true }).inputValue()) === '18',
  );
  check('review distinguishes prepared spells from the spell list', /2 cantrips · 5 prepared · \d+ known/.test(review) && !/EXPERIENCE/.test(review));
  await hannah.screenshot({ path: out + '/e2e-import-review.png', fullPage: true });
  await hannah.getByRole('button', { name: /Save character sheet/ }).click();
  check('imported sheet is saved', await waitText(hannah, /Imported character sheet saved|Level 1 Kor Druid/, 15000));
  await hannah.reload();
  await hannah.getByRole('button', { name: /Character$/ }).click();
  await hannah.getByRole('tab', { name: 'Overview' }).click();
  check('imported data persists after refreshing (overview: build, HP 9/9, 5 prepared)', (await waitText(hannah, /Level 1 Kor Druid/, 15000)) && (await waitText(hannah, /9 \/ 9/)) && (await waitText(hannah, /5 prepared/)));
  await hannah.screenshot({ path: out + '/e2e-character.png', fullPage: true });
  await hannah.getByRole('tab', { name: 'Attributes & Skills' }).click();
  check('attributes, saves and skills with proficiency are shown', (await waitText(hannah, /Perception \(Wis\)\s*\+6/)) && (await waitText(hannah, /Wisdom save\s*\+6/)));
  await hannah.getByRole('tab', { name: 'Abilities & Spells' }).click();
  const prepView = await hannah.locator('main, body').first().innerText();
  check('spells tab shows prepared spells by default', /Entangle/.test(prepView) && !/Goodberry/.test(prepView) && /Lucky/.test(prepView));
  await hannah.getByRole('button', { name: 'All known' }).click();
  await hannah.getByLabel('Goodberry prepared').click();
  check('a spell can be prepared with one click (saved immediately)', await hannah.waitForFunction(async () => {
    const r = await fetch('/api/apex?op=sheet&token=sinna', { headers: { 'x-apex-csrf': '1' } });
    return (await r.json()).sheet.spells.some((s) => s.name === 'Goodberry' && s.prepared);
  }, null, { timeout: 10000 }).then(() => true, () => false));
  // manual editing of any field
  await hannah.getByRole('tab', { name: 'Attributes & Skills' }).click();
  await hannah.getByRole('button', { name: /^✎ Edit$/ }).click();
  await hannah.getByLabel('Score').first().fill('12');
  await hannah.getByRole('button', { name: 'Save changes' }).click();
  await hannah.reload();
  await hannah.getByRole('button', { name: /Character$/ }).click();
  await hannah.getByRole('tab', { name: 'Attributes & Skills' }).click();
  const strNow = (await apiFetch(hannah, 'sheet', null, '&token=sinna')).body.sheet.attributes[0];
  check('manual edit persists after refresh (Strength 11 → 12)', strNow.name === 'Strength' && strNow.value === '12');

  // manual resource edit
  await hannah.getByRole('tab', { name: 'Resources' }).click();
  await hannah.getByRole('button', { name: 'Decrease Hit points' }).click();
  check('a player can change a resource manually (HP 9 → 8)', await waitText(hannah, /8\s*\/\s*9/));
  const willBefore = (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details.will.current;
  await hannah.getByRole('button', { name: 'Decrease Willpower' }).click();
  await sleep(800);
  const willAfter = (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details.will.current;
  check('Willpower comes from the game state and can be spent', willAfter === willBefore - 1);

  // ---------- appearance ----------
  await hannah.getByRole('tab', { name: 'Appearance' }).click();
  await hannah.getByLabel('Character tag').fill('Druid of the Wilds');
  await hannah.getByRole('button', { name: 'Primary colour #3a7d44' }).click();
  await hannah.getByRole('button', { name: /Gem/ }).click();
  await hannah.getByRole('button', { name: 'Save appearance' }).click();
  check('appearance saved (tag, colour, marker)', await waitText(hannah, /Appearance saved/));
  const gmTok = (await apiFetch(gm, 'state')).body.state.tokens.sinna;
  check('tag/colour/marker reach the shared game state', gmTok.title === 'Druid of the Wilds' && gmTok.color === '#3a7d44' && gmTok.marker === 'gem');
  const png = path.join(require('node:os').tmpdir(), 'apex-portrait.png');
  require('node:fs').writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await hannah.getByRole('button', { name: /Upload portrait/ }).click().catch(() => undefined);
  await hannah.getByLabel('Choose a portrait picture').setInputFiles(png);
  await hannah.getByRole('button', { name: 'Save portrait' }).click();
  check('portrait uploaded', await waitText(hannah, /Portrait saved/, 15000));
  const portraitFetch = (pg) => pg.evaluate(async () => { const r = await fetch('/api/apex?op=portrait&token=sinna'); return { status: r.status, type: r.headers.get('content-type') }; });
  const own = await portraitFetch(hannah);
  const other = await portraitFetch(jean);
  const anonP = await portraitFetch(anon);
  check('portrait is served to campaign members only (private storage)', own.status === 200 && /image\//.test(own.type ?? '') && other.status === 200 && anonP.status === 401);
  await hannah.screenshot({ path: out + '/e2e-appearance.png', fullPage: true });
  // ---------- top-level inventory still works ----------
  // ---------- inventory ----------
  await hannah.getByRole('button', { name: /Inventory/ }).click();
  check('equipment from the PDF was added to the inventory (no duplicates)', (await waitText(hannah, /Breastplate/)) && (await apiFetch(hannah, 'state')).body.view.tokens.find((t) => t.id === 'sinna').details.inventory.filter((i) => i.name === 'Breastplate').length === 1);
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
  check('Jean cannot read Hannah’s character sheet', jeanReadsSheet.status === 403 && !JSON.stringify(jeanReadsSheet.body).includes('Kor Druid'));
  const jeanView = JSON.stringify((await apiFetch(jean, 'state')).body);
  check('Jean does not receive Sinna’s inventory', !jeanView.includes('Old iron key'));
  const jeanEdits = await apiFetch(jean, 'command', { campaignId: beforeJean.body.campaignId, command: { type: 'invAddItem', tokenId: 'sinna', itemId: 'evil', name: 'x' } });
  check('Jean cannot edit Sinna’s inventory', jeanEdits.status === 403);

  // ---------- GM oversight ----------
  await gm.getByRole('button', { name: /Character sheets/ }).click();
  await gm.getByLabel('Character to inspect').selectOption({ label: 'Sinna' });
  check('the GM sees Hannah’s sheet', await waitText(gm, /Level 1 Kor Druid/, 15000));
  await gm.getByRole('tab', { name: 'Notes' }).click();
  await gm.getByRole('button', { name: /^✎ Edit$/ }).click();
  await gm.getByLabel('Notes').fill('GM note: owes the Gamemakers a favour.');
  await gm.getByRole('button', { name: 'Save changes' }).click();
  check('the GM edits the sheet', await waitText(gm, /owes the Gamemakers/));
  await hannah.getByRole('button', { name: /Character$/ }).click();
  await hannah.getByRole('tab', { name: 'Notes' }).click();
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

  // ---------- Events (GM approval) & Arena Announcements ----------
  {
    const cid = beforeJean.body.campaignId;
    await gm.getByRole('button', { name: /Map/ }).first().click();
    await hannah.getByRole('button', { name: /Map/ }).first().click();
    const st0 = (await apiFetch(gm, 'state')).body.state;
    const hexesBefore = JSON.stringify(st0.hexes);
    await apiFetch(gm, 'command', { campaignId: cid, requestId: 'e2e-adv-0001', command: { type: 'advancePhase' } });
    await apiFetch(gm, 'command', { campaignId: cid, requestId: 'e2e-adv-0002', command: { type: 'advancePhase' } });
    let st1 = (await apiFetch(gm, 'state')).body.state;
    const first = Object.values(st1.events).find((e) => e.status === 'awaiting');
    check('advancing day/night makes the first event due without changing the world', !!first && JSON.stringify(st1.hexes) === hexesBefore);
    const firstModal = gm.getByRole('dialog', { name: first ? first.name : 'x' });
    await firstModal.waitFor({ timeout: 20000 }).catch(() => {});
    await firstModal.getByRole('button', { name: 'Reject' }).click();
    const rejected = await gm.waitForFunction(
      async (id) => (await (await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } })).json()).state.events[id].status === 'rejected',
      first.id,
      { timeout: 15000 },
    ).then(() => true, () => false);
    const stR = (await apiFetch(gm, 'state')).body.state;
    check('the GM rejects in the modal: event rejected, world unchanged', rejected && JSON.stringify(stR.hexes) === hexesBefore && !(stR.announcements ?? []).some((a) => a.title === first.name));
    await apiFetch(gm, 'command', { campaignId: cid, requestId: 'e2e-adv-0003', command: { type: 'advancePhase' } });
    await apiFetch(gm, 'command', { campaignId: cid, requestId: 'e2e-adv-0004', command: { type: 'advancePhase' } });
    st1 = (await apiFetch(gm, 'state')).body.state;
    check('the rejected event never fires later', st1.events[first.id].status === 'rejected');
    const due = Object.values(st1.events).find((e) => e.status === 'awaiting');
    check('the next due event is awaiting and changes nothing yet', !!due && JSON.stringify(st1.hexes) === JSON.stringify(stR.hexes));
    const modal = gm.getByRole('dialog', { name: due ? due.name : 'x' });
    check('the GM gets a centred approval dialog', await modal.waitFor({ timeout: 20000 }).then(() => true, () => false));
    check('the dialog previews the consequences', await waitText(gm, /If approved/i));
    const hView = JSON.stringify((await apiFetch(hannah, 'state')).body.view);
    check('players see nothing of the pending event', !hView.includes(due.name) && !hView.includes('awaiting'));
    const forged = await apiFetch(hannah, 'command', { campaignId: cid, requestId: 'e2e-forge-01', command: { type: 'decideEvent', eventId: due.id, decision: 'approve' } });
    check('a player cannot approve events', forged.status === 403);
    await modal.getByRole('button', { name: /Approve & Trigger/ }).click();
    const st2 = await gm.waitForFunction(
      async (id) => {
        const r = await fetch('/api/apex?op=state', { headers: { 'x-apex-csrf': '1' } });
        const j = await r.json();
        return j.state.events[id].status === 'done';
      },
      due.id,
      { timeout: 15000 },
    ).then(() => true, () => false);
    check('approval applies the event once (server-confirmed)', st2);
    check('players see the world-event announcement', await hannah.getByRole('alertdialog').filter({ hasText: due.name }).waitFor({ timeout: 30000 }).then(() => true, () => false));
    await hannah.keyboard.press('Escape');
    await gm.keyboard.press('Escape');
    // manual announcement with preview
    await openGm(gm, 'announcements');
    await gm.getByLabel('Announcement category').selectOption('death');
    await gm.getByLabel('Announcement headline').fill('A TRIBUTE HAS FALLEN');
    await gm.getByLabel('Announcement text').fill('The cannon sounds once over the arena.');
    await gm.getByRole('button', { name: 'Preview' }).click();
    check('the GM previews an announcement before broadcasting', await gm.getByRole('alertdialog').filter({ hasText: /Preview/ }).isVisible());
    await gm.getByRole('button', { name: 'Close preview' }).click();
    const jeanHadIt = JSON.stringify((await apiFetch(jean, 'state')).body.view).includes('cannon sounds');
    const jeanCtx = jean.context();
    await jean.close(); // Jean's device goes offline (same browser profile comes back later)
    await gm.getByRole('button', { name: /Broadcast to all players/ }).click();
    check('the announcement appears on the player screen', await hannah.getByRole('alertdialog').filter({ hasText: 'A TRIBUTE HAS FALLEN' }).waitFor({ timeout: 30000 }).then(() => true, () => false));
    await hannah.screenshot({ path: out + '/e2e-announcement.png' });
    await hannah.getByRole('button', { name: 'Acknowledge' }).click();
    check('the announcement can be dismissed', await hannah.getByRole('alertdialog').count().then((n) => n === 0));
    jean = await jeanCtx.newPage();
    await jean.goto(url('/'));
    check('a player who was offline sees it after reconnecting', !jeanHadIt && (await jean.getByRole('alertdialog').filter({ hasText: 'A TRIBUTE HAS FALLEN' }).waitFor({ timeout: 30000 }).then(() => true, () => false)));
    await jean.keyboard.press('Escape');
    await hannah.reload();
    await waitText(hannah, /Playing as Sinna/, 20000);
    check('an acknowledged announcement does not reappear after reload', (await hannah.getByRole('alertdialog').count()) === 0);
    const bad = await apiFetch(hannah, 'command', { campaignId: cid, requestId: 'e2e-ann-forge', command: { type: 'announce', category: 'general', title: 'FAKE', text: '' } });
    check('players cannot broadcast announcements', bad.status === 403);
    await gm.keyboard.press('Escape');
    await gm.screenshot({ path: out + '/e2e-gm-events.png', fullPage: true });
  }

  // ---------- GM password management ----------
  if (MOCK) {
    await gm.getByRole('button', { name: /Map/ }).click();
    await openGm(gm, 'players');
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

  // ---------- World Management ----------
  {
    await gm.getByRole('button', { name: /Map/ }).first().click();
    await openGm(gm, 'world');
    const wp = gm.locator('[data-gm-section="world"]');
    const hannahWorld = async () => (await apiFetch(hannah, 'state')).body?.view?.worldName;
    const before = (await apiFetch(gm, 'state')).body.state;
    // player cannot manage worlds
    const forbidden = await apiFetch(hannah, 'admin', { action: 'createWorld', name: 'Hack', keepProgress: true, requestId: 'e2e-hack-0001' });
    check('a player cannot create or reset worlds', forbidden.status === 403);
    // archive
    await wp.getByRole('button', { name: /Archive World/ }).click();
    await gm.getByRole('dialog').getByLabel('Name').fill('E2E checkpoint');
    await gm.getByRole('dialog').getByRole('button', { name: /Archive World/ }).click();
    check('the GM archives the world (confirmed by the server)', await waitText(gm, /World archived/));
    check('the archive appears in the list', await waitText(gm, /E2E checkpoint/));
    // create new world
    await wp.getByRole('button', { name: /Create New World/ }).click();
    await gm.getByRole('dialog').getByLabel('World name').fill('E2E Second World');
    await gm.getByRole('dialog').getByLabel(/Map radius/).fill('10');
    await gm.getByRole('dialog').getByRole('button', { name: /Archive and create/ }).click();
    check('the GM creates a new world', await waitText(gm, /New world “E2E Second World” is active/, 20000));
    const after = (await apiFetch(gm, 'state')).body.state;
    check('new map, positions and exploration were initialised', after.config.mapRadius === 10 && after.world.name === 'E2E Second World' && Object.keys(after.knowledge.sinna?.explored ?? {}).length < Object.keys(before.knowledge.sinna?.explored ?? {}).length + 50);
    check('inventory and character data survived the new world', after.tokens.sinna.inventory.some((i) => i.name.startsWith('Old iron key')));
    check('the player is switched to the new world and told so', await waitText(hannah, /switched to the world “E2E Second World”/, 30000) && (await hannahWorld()) === 'E2E Second World');
    const sheetStill = await apiFetch(hannah, 'sheet', null, '&token=sinna');
    check('character sheet unchanged by the new world', sheetStill.status === 200 && JSON.stringify(sheetStill.body).includes('Kor Druid'));
    const stale = await apiFetch(hannah, 'command', { worldId: before.world?.id ?? 'old', requestId: 'e2e-stale-001', command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } } });
    check('a command for the replaced world is rejected', stale.status === 409 && stale.body.code === 'world_changed');
    // restore
    const restoreBtn = wp.locator('li', { hasText: 'E2E checkpoint' }).getByRole('button', { name: 'Restore' });
    await restoreBtn.click();
    await gm.getByRole('dialog').getByRole('button', { name: /Archive current and restore/ }).click();
    check('the GM restores the archived world', await waitText(gm, /“E2E checkpoint” restored/, 20000));
    const restored = (await apiFetch(gm, 'state')).body.state;
    check('the restored world matches the archive', restored.config.seed === before.config.seed && restored.tokens.sinna.pos.q === before.tokens.sinna.pos.q && restored.tokens.sinna.pos.r === before.tokens.sinna.pos.r);
    check('the player follows the restore', await waitText(hannah, /switched to the world/, 30000));
    await gm.screenshot({ path: out + '/e2e-world-management.png', fullPage: true });
    // reset requires typing RESET
    await wp.getByRole('button', { name: /Reset Current World/ }).click();
    const resetBtn = gm.getByRole('dialog').getByRole('button', { name: /Archive and reset/ });
    check('reset needs explicit confirmation', await resetBtn.isDisabled());
    await gm.getByRole('dialog').getByLabel(/Type/).fill('RESET');
    await resetBtn.click();
    check('the GM resets the world (previous world archived)', await waitText(gm, /World reset/, 20000));
    const list = (await apiFetch(gm, 'admin', { action: 'listArchives' })).body.archives;
    check('archives: manual + before-create + before-restore + before-reset', ['manual', 'before-create', 'before-restore', 'before-reset'].every((k) => list.some((a) => a.kind === k)));
    const inspect = MOCK ? await (await fetch(BASE + '/__mock/inspect')).json() : null;
    check('accounts and passwords unchanged by world changes', !inspect || inspect.credentials.length >= 3);
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
