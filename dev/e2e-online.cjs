/**
 * LOCAL multi-browser acceptance test of the online mode against the mock Supabase harness.
 *   1) npm run dev:mock        (serves http://localhost:5174, fresh in-memory campaign)
 *   2) node dev/e2e-online.cjs [screenshot-dir]
 * Requires Playwright with Chromium. Each participant runs in its own isolated browser context
 * (separate storage = separate "device").
 *
 * IMPORTANT: this proves the client + server logic. It does NOT prove the real Supabase/Vercel
 * configuration – run the checklist in docs/SETUP_DE.md on the Vercel preview for that.
 */
const { chromium } = require('playwright');
const BASE = process.env.APEX_URL || 'http://localhost:5174';
const URL = BASE + '/';
const out = process.argv[2] || '.';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = (path) => fetch(BASE + path).then((r) => r.json());

async function newDevice(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR: ${e.message}`));
  return page;
}

/** Welcome → Join → profile card → email. Returns the code the mock "emailed" (or null). */
async function startLogin(page, profileName, email) {
  await page.goto(URL);
  await page.getByRole('button', { name: 'Join Campaign' }).click();
  await page.getByRole('button', { name: new RegExp(`^${profileName} –`) }).click();
  await page.getByRole('heading', { name: `Continue as ${profileName}` }).waitFor();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: /Send me a code/ }).click();
  await page.getByLabel('Code from the email').waitFor();
  return (await mock(`/__mock/code?email=${encodeURIComponent(email)}`)).code;
}

async function login(browser, profileName, email) {
  const page = await newDevice(browser);
  const code = await startLogin(page, profileName, email);
  await page.getByLabel('Code from the email').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

/** Calls the API from inside the page with the page's own session token (like a malicious client would). */
const apiFetch = (page, op, body, query = '') =>
  page.evaluate(
    async ([op, body, query]) => {
      const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
      const token = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
      const r = await fetch(`/api/apex?op=${op}${query}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    },
    [op, body, query],
  );

const waitText = (page, re, timeout = 8000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), re.source, { timeout }).then(
    () => true,
    () => false,
  );

(async () => {
  const b = await chromium.launch();

  // ---------- Welcome & profile selection ----------
  const anon = await newDevice(b);
  await anon.goto(URL);
  await anon.getByRole('button', { name: 'Join Campaign' }).waitFor();
  await anon.waitForTimeout(500);
  const w = await anon.locator('body').innerText();
  await anon.screenshot({ path: out + '/e2e-welcome.png' });
  check(
    'welcome screen shows title, campaign, preview and Join button',
    w.includes('Welcome to APEX') && w.includes('APEX – Arena of the Eternal Will') && (await anon.locator('canvas').count()) === 1,
  );
  const anonApi = await anon.evaluate(async () => (await fetch('/api/apex?op=state')).status);
  check('unauthenticated visitors get no campaign data (401)', anonApi === 401);
  await anon.getByRole('button', { name: 'Join Campaign' }).click();
  await anon.getByRole('heading', { name: 'Who are you?' }).waitFor();
  await anon.waitForTimeout(800);
  await anon.screenshot({ path: out + '/e2e-profiles.png' });
  const cards = (await anon.locator('li button').allInnerTexts()).join(' ');
  check(
    '"Who are you?" shows GM, Hannah, Jean, Simon, Jerba with their characters',
    ['GM', 'Hannah', 'Sinna', 'Jean', 'Aster', 'Simon', 'Elwin', 'Jerba', 'Javi'].every((t) => cards.includes(t)),
  );
  check(
    'Simon and Jerba are prepared but not activated',
    (await anon.getByRole('button', { name: /^Simon – .*not activated/ }).isDisabled()) &&
      (await anon.getByRole('button', { name: /^Jerba – .*not activated/ }).isDisabled()),
  );

  // ---------- Unauthorized profile logins ----------
  const jeanAsHannah = await newDevice(b);
  const c1 = await startLogin(jeanAsHannah, 'Hannah', 'jean@apex.test');
  const neutral = await jeanAsHannah.locator('[role=status]').first().innerText();
  check('choosing Hannah with Jean’s email sends NO code and reveals no address', c1 === null && neutral.includes('belongs to Hannah’s profile') && !neutral.includes('hannah@'));
  const strangerPage = await newDevice(b);
  check('an uninvited address gets no code', (await startLogin(strangerPage, 'Hannah', 'stranger@apex.test')) === null);
  const gmFake = await newDevice(b);
  check('a player’s email cannot open the GM profile', (await startLogin(gmFake, 'GM', 'hannah@apex.test')) === null);
  await Promise.all([jeanAsHannah.context().close(), strangerPage.context().close(), gmFake.context().close()]);

  // ---------- Rate limit UI: a second request for the same address is refused with the server's wait time ----------
  const rl = await newDevice(b);
  await rl.goto(URL);
  await rl.getByRole('button', { name: 'Join Campaign' }).click();
  await rl.getByRole('button', { name: /^Jean –/ }).click();
  await rl.getByLabel('Email address').fill('jean@apex.test');
  await rl.getByRole('button', { name: /Send me a code/ }).click();
  await rl.getByText('Please wait').waitFor({ timeout: 5000 });
  const rlText = await rl.locator('body').innerText();
  check(
    'rate limit shows the server wait time, no fake code step, and "I already have a code" stays available',
    /New request possible in \d+ s/.test(rlText) && (await rl.getByRole('button', { name: 'I already have a code' }).isEnabled()),
  );
  await rl.screenshot({ path: out + '/e2e-ratelimit.png' });
  await rl.context().close();
  await sleep(5500); // mock interval (APEX_LOGIN_INTERVAL_SEC=5)

  // ---------- Authorized logins ----------
  const wrong = await newDevice(b);
  await startLogin(wrong, 'Jean', 'jean@apex.test');
  await wrong.getByLabel('Code from the email').fill('000000');
  await wrong.getByRole('button', { name: 'Sign in' }).click();
  await wrong.getByRole('alert').waitFor();
  check('a wrong code is rejected', (await wrong.getByRole('alert').innerText()).includes('wrong or has expired'));
  await wrong.context().close();
  await sleep(5500); // mock resend cooldown

  const gm = await login(b, 'GM', 'gm@apex.test');
  await gm.getByRole('button', { name: /Generate arena/ }).click();
  await gm.getByRole('button', { name: /Begin Night 1/ }).waitFor({ timeout: 20000 });
  const hannah = await login(b, 'Hannah', 'hannah@apex.test');
  await hannah.getByText('Playing as Sinna').waitFor({ timeout: 20000 });
  const jean = await login(b, 'Jean', 'jean@apex.test');
  await jean.getByText('Playing as Aster').waitFor({ timeout: 20000 });
  check('GM, Hannah (Sinna) and Jean (Aster) sign in with codes and get the right character', true);
  await hannah.waitForTimeout(1200);
  await hannah.screenshot({ path: out + '/e2e-hannah.png' });

  const [sg, sh, sj] = await Promise.all([apiFetch(gm, 'state'), apiFetch(hannah, 'state', null, '&profile=hannah'), apiFetch(jean, 'state', null, '&profile=jean')]);
  const cid = sh.body.campaignId;
  check('all sessions load the same campaign and version', sg.body.campaignId === cid && sj.body.campaignId === cid && sg.body.version === sj.body.version);

  // ---------- Permissions ----------
  const mv = (page, profile, tokenId, to) => apiFetch(page, 'command', { campaignId: cid, profile, command: { type: 'move', tokenId, to } });
  check('Hannah moves Sinna', (await mv(hannah, 'hannah', 'sinna', { q: 1, r: 0 })).status === 200);
  check('the move appears on the GM device without reload', await waitText(gm, /Sinna[\s\S]{0,30}7\/8/));
  check('the move appears on Jean’s device without reload', await waitText(jean, /Sinna[\s\S]{0,30}7\/8/));
  const deny = await Promise.all([
    mv(hannah, 'hannah', 'aster', { q: 1, r: 1 }),
    apiFetch(hannah, 'command', { campaignId: cid, profile: 'hannah', command: { type: 'advancePhase' } }),
    apiFetch(jean, 'state', null, '&profile=hannah'),
    apiFetch(hannah, 'state', null, '&profile=gm'),
    apiFetch(hannah, 'admin', { campaignId: cid, action: 'linkProfile', profile: 'simon', email: 'hannah2@apex.test' }),
  ]);
  check(
    'players cannot move other characters, use GM actions, claim other profiles or change profiles',
    deny.every((r) => r.status === 403),
    deny.map((r) => r.status).join(','),
  );
  check('the GM can move any character', (await mv(gm, 'gm', 'aster', { q: -1, r: 1 })).status === 200);
  const fog = await apiFetch(hannah, 'state', null, '&profile=hannah&as=aster');
  const fj = JSON.stringify(fog.body);
  check(
    'Fog of War: no radius, seed, hidden sites, unknown hexes or other perspectives',
    fog.body.activeCharacter === 'sinna' && fog.body.view.mapRadius === null && !fj.includes('"seed"') && !fj.includes('Templum') && fog.body.view.hexes.length < 100,
  );

  // ---------- Time & persistence ----------
  await gm.getByRole('button', { name: /Begin Night 1/ }).click();
  check('day/night changes reach both players automatically', (await waitText(hannah, /Night 1/)) && (await waitText(jean, /Night 1/)));
  await jean.reload();
  await jean.getByText('Playing as Aster').waitFor({ timeout: 20000 });
  check('reloading restores the shared state and the chosen profile', /Night 1/.test(await jean.locator('body').innerText()));
  const before = (await apiFetch(gm, 'state')).body.version;
  const [a, c] = await Promise.all([mv(hannah, 'hannah', 'sinna', { q: 1, r: 1 }), mv(jean, 'jean', 'aster', { q: -1, r: 2 })]);
  const after = (await apiFetch(gm, 'state')).body;
  check('simultaneous moves are both kept', a.status === 200 && c.status === 200 && after.version === before + 2);

  // ---------- GM assignment changes (through the Players & Access panel) ----------
  await gm.getByRole('button', { name: 'Profiles' }).click();
  await gm.getByLabel('Email linked to Simon').fill('simon@apex.test');
  await gm.getByLabel('Email linked to Simon').locator('xpath=..').getByRole('button', { name: 'Save' }).click();
  await waitText(gm, /Simon linked/);
  await gm.locator('aside').screenshot({ path: out + '/e2e-gm-profiles.png' });
  const simon = await login(b, 'Simon', 'simon@apex.test');
  check(
    'after the GM links Simon, Simon signs in and plays Elwin',
    await simon
      .getByText('Playing as Elwin')
      .waitFor({ timeout: 20000 })
      .then(
        () => true,
        () => false,
      ),
  );
  gm.once('dialog', (d) => d.accept());
  await gm.getByLabel('Email linked to Jean').locator('xpath=..').getByRole('button', { name: 'Unlink' }).click();
  await waitText(gm, /Jean unlinked/);
  const jeanAfter = await apiFetch(jean, 'state', null, '&profile=jean');
  check('after the GM unlinks Jean, Jean’s session loses access to the profile', jeanAfter.status === 403, String(jeanAfter.status));

  // ---------- Resilience ----------
  await hannah.context().setOffline(true);
  await mv(simon, 'simon', 'elwin', { q: -1, r: 1 });
  const offlineShown = await waitText(hannah, /Connection to the APEX server lost/, 15000);
  await hannah.context().setOffline(false);
  const back = await waitText(hannah, /^(?![\s\S]*Connection to the APEX server lost)/, 20000);
  check('a disconnected player sees the notice and reconnects automatically', offlineShown && back, `${offlineShown}/${back}`);
  await mock('/__mock/api-down?on=1');
  const banner = await waitText(gm, /Connection to the APEX server lost[\s\S]*Database unavailable/, 15000);
  const noDemo = !(await gm.locator('body').innerText()).includes('DEMO');
  await mock('/__mock/api-down?on=0');
  check('a server/database outage is reported clearly, without a demo fallback', banner && noDemo);

  await hannah.getByRole('button', { name: 'Sign out' }).click();
  await hannah.getByRole('heading', { name: 'Continue as Hannah' }).waitFor();
  check('sign out works and returns to the profile login', (await apiFetch(hannah, 'state')).status === 401);

  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('E2E ERROR', e.message);
  process.exit(1);
});
