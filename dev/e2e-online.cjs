/**
 * LOCAL multi-browser acceptance test of the online mode against the mock Supabase harness.
 *   1) npm run dev:mock        (serves http://localhost:5174)
 *   2) node dev/e2e-online.cjs [screenshot-dir]
 * Requires Playwright with Chromium. Each participant runs in its own isolated browser context
 * (separate storage = separate "device").
 *
 * IMPORTANT: this proves the client + server logic. It does NOT prove the real Supabase/Vercel
 * configuration – run the same checklist on the Vercel preview (docs/SETUP_DE.md).
 */
const { chromium } = require('playwright');
const BASE = process.env.APEX_URL || 'http://localhost:5174';
const URL = BASE + '/';
const out = process.argv[2] || '.';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mock(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

async function login(browser, email, { expectCode = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR ${email}: ${e.message}`));
  await page.goto(URL);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: /Send me a code/ }).click();
  await page.getByLabel('Code from the email').waitFor();
  const { code } = await mock(`/__mock/code?email=${encodeURIComponent(email)}`);
  if (!expectCode) return { page, code };
  await page.getByLabel('Code from the email').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return { page, code };
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

  // 1. Unauthenticated visitors
  const anon = await (await b.newContext()).newPage();
  await anon.goto(URL);
  await anon.getByRole('heading', { name: 'Enter the Arena' }).waitFor();
  await anon.screenshot({ path: out + '/e2e-login.png' });
  const anonApi = await anon.evaluate(async () => (await fetch('/api/apex?op=state')).status);
  check('1 unauthenticated visitor sees only the login page and the API answers 401', anonApi === 401 && !(await anon.locator('body').innerText()).includes('Livia'));

  // 2. Uninvited users
  const s = await login(b, 'stranger@apex.test', { expectCode: false });
  const msg = await s.page.locator('[role=status]').first().innerText();
  check('2 uninvited address gets the same neutral answer but NO code', s.code === null && msg.includes('If stranger@apex.test is invited'), String(s.code));
  await s.page.context().close();

  // 3. Login with email codes (wrong code first)
  const wrongCtx = await b.newContext();
  const wrong = await wrongCtx.newPage();
  await wrong.goto(URL);
  await wrong.getByLabel('Email address').fill('player2@apex.test');
  await wrong.getByRole('button', { name: /Send me a code/ }).click();
  await wrong.getByLabel('Code from the email').fill('000000');
  await wrong.getByRole('button', { name: 'Sign in' }).click();
  await wrong.getByRole('alert').waitFor();
  check('3a a wrong code is rejected with a clear message', (await wrong.getByRole('alert').innerText()).includes('wrong or has expired'));
  const reuse = await mock('/__mock/code?email=player2%40apex.test');
  await wrongCtx.close();

  const { page: gm } = await login(b, 'gm@apex.test');
  await gm.getByRole('button', { name: /Generate arena/ }).click();
  await gm.getByRole('button', { name: /Begin Night 1/ }).waitFor({ timeout: 20000 });
  const { page: p1 } = await login(b, 'player1@apex.test');
  await p1.getByText('Playing as Livia Aurelia').waitFor({ timeout: 20000 });
  // Requesting another code within the cooldown is refused visibly.
  const rl = await (await b.newContext()).newPage();
  await rl.goto(URL);
  await rl.getByLabel('Email address').fill('player2@apex.test');
  await rl.getByRole('button', { name: /Send me a code/ }).click();
  const rateLimited = await rl.getByRole('alert').waitFor({ timeout: 5000 }).then(
    async () => (await rl.getByRole('alert').innerText()).includes('wait a minute'),
    () => false,
  );
  check('3b requesting codes too quickly is rate-limited visibly', rateLimited);
  await rl.context().close();
  await sleep(5500); // mock cooldown

  const { page: p2b, code: p2code } = await login(b, 'player2@apex.test');
  await p2b.getByText('Playing as Marcus Varro').waitFor({ timeout: 20000 });
  check('3c GM, Player 1 and Player 2 signed in with email codes', true);
  const verifyStatus = (code) =>
    fetch(BASE + '/auth/v1/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'player2@apex.test', token: code, type: 'email' }) }).then((r) => r.status);
  const [oldStatus, reuseStatus] = [await verifyStatus(reuse.code), await verifyStatus(p2code)];
  check('3d codes are single-use and an older code is no longer valid', oldStatus !== 200 && reuseStatus !== 200, `${oldStatus}/${reuseStatus}`);

  // 4. Same campaign
  const [sg, s1, s2] = await Promise.all([apiFetch(gm, 'state'), apiFetch(p1, 'state'), apiFetch(p2b, 'state')]);
  check('4 all three sessions load the same campaign and version', sg.body.campaignId === s1.body.campaignId && s1.body.campaignId === s2.body.campaignId && sg.body.version === s2.body.version);
  const cid = s1.body.campaignId;
  check('4b realtime connected on all devices', (await gm.getByRole('button', { name: /^Live/ }).isVisible()) && (await p2b.getByRole('button', { name: /^Live/ }).isVisible()));

  // 5. Move on device B appears on A and C
  const mv = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'livia', to: { q: 1, r: 0 } } });
  check('5a Player 1 moves Livia (saved centrally)', mv.status === 200, `${mv.status} ${mv.body.error ?? ''}`);
  check('5b the move appears on the GM device without reload', await waitText(gm, /Livia Aurelia[\s\S]{0,40}7\/8/));
  check('5c the move appears on Player 2’s device without reload', await waitText(p2b, /Livia Aurelia[\s\S]{0,40}7\/8/));

  // 6. Day / night
  await gm.getByRole('button', { name: /Begin Night 1/ }).click();
  check('6 the phase change reaches both players automatically', (await waitText(p1, /Night 1/)) && (await waitText(p2b, /Night 1/)));

  // 7. Reload restores
  await p2b.reload();
  await p2b.getByText('Playing as Marcus Varro').waitFor({ timeout: 20000 });
  const t7 = await p2b.locator('body').innerText();
  check('7 reloading restores the same current shared state', t7.includes('Night 1') && /7\/8/.test(t7));

  // 8. Foreign characters
  const other = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'marcus', to: { q: 1, r: 1 } } });
  const gmCmd = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'advancePhase' } });
  const forged = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'place', tokenId: 'marcus', to: { q: 3, r: 0 } }, actor: { role: 'gm' }, userId: '00000000-0000-4000-8000-000000000001' });
  const adm = await apiFetch(p1, 'admin', { campaignId: cid, action: 'setRole', userId: '00000000-0000-4000-8000-000000000002', role: 'gm' });
  check('8 a player cannot move another character, run GM commands, forge identity or promote themselves', [other, gmCmd, forged, adm].every((r) => r.status === 403), [other, gmCmd, forged, adm].map((r) => r.status).join(','));

  // 9. Undiscovered map
  const v9 = await apiFetch(p1, 'state', null, '&as=marcus');
  const j9 = JSON.stringify(v9.body);
  check(
    '9 a player receives no undiscovered map data (no radius, seed, hidden sites, unknown hexes, other perspective)',
    v9.body.activeCharacter === 'livia' && v9.body.view.mapRadius === null && !j9.includes('"seed"') && !j9.includes('Templum Oblitum') && v9.body.view.hexes.length < 100,
  );

  // 10. Simultaneous actions
  const before = (await apiFetch(gm, 'state')).body.version;
  const [a, c] = await Promise.all([
    apiFetch(p1, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'livia', to: { q: 1, r: 1 } } }),
    apiFetch(p2b, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'marcus', to: { q: -1, r: 1 } } }),
  ]);
  const after = (await apiFetch(gm, 'state')).body;
  check(
    '10 two simultaneous moves are both kept (no silent overwrite)',
    a.status === 200 && c.status === 200 && after.version === before + 2 && after.state.tokens.livia.pos.r === 1 && after.state.tokens.marcus.pos.q === -1,
    `${a.status}/${c.status} v${before}->${after.version}`,
  );

  // 11. Disconnected player reconnects
  await p2b.context().setOffline(true);
  await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'livia', to: { q: 2, r: 0 } } });
  const offlineShown = await waitText(p2b, /Connection to the APEX server lost/, 15000);
  await p2b.context().setOffline(false);
  const backOnline = await waitText(p2b, /Livia Aurelia[\s\S]{0,40}[0-5](\.\d)?\/8/, 20000);
  check('11 a disconnected player sees the offline notice and gets the current state after reconnecting', offlineShown && backOnline, `${offlineShown}/${backOnline}`);

  // 12. Server / database failure
  await mock('/__mock/api-down?on=1');
  const banner = await waitText(gm, /Connection to the APEX server lost[\s\S]*Database unavailable/, 15000);
  await gm.getByRole('button', { name: /Begin Day 2/ }).click();
  const notSaved = await waitText(gm, /NOT saved/, 5000);
  await gm.screenshot({ path: out + '/e2e-outage.png' });
  const noDemo = !(await gm.locator('body').innerText()).includes('DEMO');
  await mock('/__mock/api-down?on=0');
  const recovered = await waitText(gm, /^(?![\s\S]*Connection to the APEX server lost)/, 20000);
  check('12 an outage is reported clearly, actions say they were NOT saved, no demo fallback, recovery is automatic', banner && notSaved && noDemo && recovered, `${banner}/${notSaved}/${noDemo}/${recovered}`);

  // GM presence + sign out
  await gm.getByRole('button', { name: 'Accounts' }).click();
  const presence = await waitText(gm, /player1@apex\.test[\s\S]{0,80}online/, 25000);
  await gm.locator('aside').screenshot({ path: out + '/e2e-gm-panel.png' });
  check('GM sees which players are online', presence);
  await p1.getByRole('button', { name: 'Sign out' }).click();
  await p1.getByRole('heading', { name: 'Enter the Arena' }).waitFor();
  const afterOut = await apiFetch(p1, 'state');
  check('sign out returns to the login page and the browser holds no session', afterOut.status === 401);

  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('E2E ERROR', e.message);
  process.exit(1);
});
