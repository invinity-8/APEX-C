/**
 * LOCAL multi-browser end-to-end check of the online mode against the mock Supabase harness.
 *   1) npm run dev:mock        (serves http://localhost:5174)
 *   2) node dev/e2e-online.cjs [screenshot-dir]
 * Requires Playwright with Chromium (npx playwright install chromium).
 */
const { chromium } = require('playwright');
const URL = process.env.APEX_URL || 'http://localhost:5174/';
const PW = 'apex-test-123';
const out = process.argv[2] || '.';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra && !ok ? ' – ' + extra : ''}`);

async function login(browser, email, password = PW) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR ${email}: ${e.message}`));
  await page.goto(URL);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

/** Calls the API from inside the page with the page's own session token (like a malicious client would). */
const apiFetch = (page, op, body) =>
  page.evaluate(
    async ([op, body]) => {
      const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
      const token = JSON.parse(localStorage.getItem(key)).access_token;
      const r = await fetch(`/api/apex?op=${op}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    },
    [op, body],
  );

(async () => {
  const b = await chromium.launch();

  const anon = await (await b.newContext()).newPage();
  await anon.goto(URL);
  await anon.getByRole('heading', { name: 'Enter the Arena' }).waitFor();
  await anon.screenshot({ path: out + '/e2e-login.png' });
  check('unauthenticated visitor sees only the login page', !(await anon.locator('body').innerText()).includes('Livia'));
  const anonApi = await anon.evaluate(async () => (await fetch('/api/apex?op=state')).status);
  check('API rejects requests without a token', anonApi === 401, String(anonApi));

  const wrong = await login(b, 'player1@apex.test', 'nope');
  await wrong.getByRole('alert').waitFor();
  check('wrong password shows a friendly error', (await wrong.getByRole('alert').innerText()).includes('incorrect'));
  await wrong.context().close();

  const stranger = await login(b, 'stranger@apex.test');
  await stranger.getByText('No access yet').waitFor();
  check('signed-in but uninvited account is denied', true);
  await stranger.context().close();

  const gm = await login(b, 'gm@apex.test');
  await gm.getByRole('button', { name: /Generate arena/ }).click();
  await gm.getByRole('button', { name: /Begin Night 1/ }).waitFor({ timeout: 20000 });
  check('GM opens the shared arena', true);

  const p1 = await login(b, 'player1@apex.test');
  await p1.getByText('Playing as Livia Aurelia').waitFor({ timeout: 20000 });
  const p2 = await login(b, 'player2@apex.test');
  await p2.getByText('Playing as Marcus Varro').waitFor({ timeout: 20000 });
  check('players receive their assigned characters', true);
  await p1.waitForTimeout(1500);
  await gm.screenshot({ path: out + '/e2e-gm.png' });
  await p1.screenshot({ path: out + '/e2e-p1.png' });

  const p1State = await apiFetch(p1, 'state');
  const json = JSON.stringify(p1State.body);
  check('player payload never contains the full state', !('state' in p1State.body) && p1State.body.role === 'player');
  check('player view hides map radius and seed', p1State.body.view.mapRadius === null && !json.includes('"seed"'));
  check('player view hides hidden sites and GM notes', !json.includes('Templum Oblitum') && !json.includes('gmNotes'));
  check('player view contains only known hexes', p1State.body.view.hexes.length < 100, String(p1State.body.view.hexes.length));
  const cid = p1State.body.campaignId;
  check('realtime connected', await gm.getByRole('button', { name: /^Live/ }).isVisible());

  const mv = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'livia', to: { q: 1, r: 0 } } });
  check('player moves own character (validated on the server)', mv.status === 200, `${mv.status} ${mv.body.error ?? ''}`);
  await gm
    .waitForFunction(() => /Livia Aurelia[\s\S]{0,40}7\/8/.test(document.body.innerText), null, { timeout: 6000 })
    .then(
      () => check('GM sees the move live without reloading', true),
      () => check('GM sees the move live without reloading', false),
    );

  const other = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'move', tokenId: 'marcus', to: { q: 1, r: 1 } } });
  check('player cannot move another player’s character', other.status === 403, String(other.status));
  const gmCmd = await apiFetch(p1, 'command', { campaignId: cid, command: { type: 'advancePhase' } });
  check('player cannot run GM commands', gmCmd.status === 403, String(gmCmd.status));
  const adm = await apiFetch(p1, 'admin', { campaignId: cid, action: 'invite', email: 'evil@x.de', role: 'gm' });
  check('player cannot use admin actions', adm.status === 403, String(adm.status));
  const imp = await apiFetch(p1, 'command', {
    campaignId: cid,
    command: { type: 'place', tokenId: 'marcus', to: { q: 3, r: 0 } },
    actor: { role: 'gm' },
    userId: '00000000-0000-4000-8000-000000000001',
  });
  check('forged actor/userId fields are ignored', imp.status === 403, String(imp.status));

  await gm.getByRole('button', { name: /Begin Night 1/ }).click();
  await p2
    .getByText('Night 1')
    .first()
    .waitFor({ timeout: 6000 })
    .then(
      () => check('players receive the phase change live', true),
      () => check('players receive the phase change live', false),
    );
  await p2.waitForTimeout(2000);
  await p2.screenshot({ path: out + '/e2e-p2-night.png' });

  await p1.reload();
  await p1.getByText('Playing as Livia Aurelia').waitFor({ timeout: 20000 });
  const txt = await p1.locator('body').innerText();
  check('a page refresh restores the shared state', txt.includes('Night 1') && /7\/8/.test(txt));

  await p1.getByRole('button', { name: 'Sign out' }).click();
  await p1.getByRole('heading', { name: 'Enter the Arena' }).waitFor();
  check('sign out returns to the login page', true);

  await gm.getByRole('button', { name: 'Characters' }).click();
  await gm.waitForTimeout(500);
  await gm.locator('aside').screenshot({ path: out + '/e2e-gm-panel.png' });
  check('GM character assignment lists the accounts', (await gm.locator('aside').innerText()).includes('player1@apex.test'));

  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('E2E ERROR', e.message);
  process.exit(1);
});
