/** Local-only browser acceptance against the real API with the memory repository. Never targets production. */
const { chromium } = require(process.env.APEX_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5174';
const results = [];
function check(name, condition) { assert.ok(condition, name); results.push(name); console.log('PASS', name); }
async function call(page, op, body, query = '') {
  return page.evaluate(async ([op, body, query]) => {
    const response = await fetch(`/api/apex?op=${op}${query}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-apex-csrf': '1' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, [op, body, query]);
}
async function expand(page, id) {
  const button = page.locator(`[data-widget="${id}"] .ws-handle > button[aria-expanded]`);
  await button.waitFor(); if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'], ...(process.env.APEX_BROWSER_PATH ? { executablePath: process.env.APEX_BROWSER_PATH } : {}) });
  try {
    const errors = [];
    async function device(profile) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(base);
      if (profile !== 'gm') {
        check(`${profile} authenticates`, (await call(page, 'login', { profile, password: `${profile}-test-pass` })).status === 200);
      }
      return page;
    }
    const gm = await device('gm');
    const code = (await (await fetch(base + '/__mock/setup-code')).json()).code;
    let setup = await call(gm, 'setup', { code, password: 'gm-e2e-password' });
    if (setup.status !== 200) setup = await call(gm, 'login', { profile: 'gm', password: 'gm-e2e-password' });
    check('GM authenticates', setup.status === 200);
    const session = await call(gm, 'session');
    const campaignId = session.body.campaigns[0].id;
    const state = await call(gm, 'state');
    if (!state.body.state) check('isolated Arena initialized', (await call(gm, 'admin', { campaignId, action: 'initCampaign', radius: 12, seed: 123, requestId: crypto.randomUUID().replaceAll('-', '') })).status === 200);
    await gm.reload(); await gm.waitForSelector('canvas');
    await expand(gm, 'campaign');
    await gm.locator('[data-widget="campaign"]').getByRole('tab', { name: 'Scene Director' }).click();
    const director = gm.getByRole('region', { name: 'Scene Director', exact: true });
    await director.getByRole('button', { name: 'Battle Maps', exact: true }).click();
    const title = `Secret encounter ${Date.now()}`;
    await director.getByLabel('Scene name').fill(title);
    await director.getByRole('button', { name: 'Create draft', exact: true }).click();
    await director.getByRole('heading', { name: title }).waitFor();
    check('GM creates a battle draft through the UI', true);
    const library = await call(gm, 'scenes'); const scene = library.body.scenes.find(s => s.name === title);
    check('draft exists and is unpublished', !!scene && scene.is_draft && !scene.is_legacy_arena);
    const editor = director.getByRole('region', { name: 'Map editor', exact: true });
    await editor.getByRole('button', { name: 'spawn', exact: true }).click();
    await editor.getByRole('img', { name: 'Editable scene map' }).click({ position: { x: 100, y: 100 } });
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await editor.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor();
    const prepared = (await call(gm, 'scenes', null, '&id=' + scene.id)).body.scene;
    const map = { ...prepared.metadata, gmNotes: 'GM ONLY SECRET', nodes: [...prepared.metadata.nodes,
      { id: 'secret-enemy', x: 500, y: 500, label: 'Hidden dragon', description: 'Private enemy', kind: 'location', visible: false, width: 60, height: 60, targetScene: null },
      { id: 'visible-poi', x: 200, y: 200, label: 'Old tower', description: 'Public landmark', kind: 'location', visible: true, width: 60, height: 60, targetScene: null }] };
    check('map with spawn and visibility publishes', (await call(gm, 'scenes', { action: 'publish', id: scene.id, revision: prepared.revision, map })).status === 200);
    const hannah = await device('hannah'); const jean = await device('jean');
    check('player library access denied', (await call(hannah, 'scenes')).status === 403);
    check('direct private preview URL denied', (await call(hannah, 'scenes', null, '&id=' + scene.id)).status === 403);
    await hannah.reload(); await hannah.waitForSelector('canvas'); await jean.reload(); await jean.waitForSelector('canvas');
    const players = (await call(gm, 'scene-runtime')).body.players;
    check('private preparation did not move players', players.every(p => p.inheritedArena));
    const preserved = JSON.stringify((await call(gm, 'state')).body.state);
    const targets = players.filter(p => ['Hannah', 'Jean'].includes(p.name)).map(p => ({ userId: p.userId, revision: p.revision }));
    const transfer = { sceneId: scene.id, targets, requestId: crypto.randomUUID() };
    check('GM atomically assigns connected players', (await call(gm, 'scene-runtime', transfer)).status === 200);
    await hannah.getByRole('region', { name: 'Assigned campaign scene', exact: true }).waitFor();
    await jean.getByRole('region', { name: 'Assigned campaign scene', exact: true }).waitFor();
    check('both browsers transition through live synchronization', true);
    const payload = await call(hannah, 'state');
    check('scene response strips GM notes and hidden nodes', !JSON.stringify(payload.body).includes('GM ONLY SECRET') && !JSON.stringify(payload.body).includes('Hidden dragon') && JSON.stringify(payload.body).includes('Old tower'));
    check('legacy map data absent outside Arena', payload.body.view.hexes.length === 0 && payload.body.view.sites.length === 0);
    check('repeated transition request is safely acknowledged', (await call(gm, 'scene-runtime', transfer)).status === 200);
    const after = (await call(gm, 'scene-runtime')).body.players;
    const hannahTarget = after.find(p => p.name === 'Hannah');
    check('split-party transfer to Sanctuary succeeds', (await call(gm, 'scene-runtime', { sceneId: null, targets: [{ userId: hannahTarget.userId, revision: hannahTarget.revision }], requestId: crypto.randomUUID() })).status === 200);
    await hannah.getByRole('region', { name: 'Character Sanctuary', exact: true }).waitFor();
    check('other player remains in original scene', (await call(jean, 'state')).body.scene.scene.id === scene.id);
    check('scene transfers preserve complete legacy world and character JSON', JSON.stringify((await call(gm, 'state')).body.state) === preserved);
    check('stale Arena action cannot affect prior scene', (await call(hannah, 'command', { campaignId, command: { type: 'move', tokenId: 'sinna', to: { q: 1, r: 0 } }, sceneRevision: 0 })).status === 409);
    await jean.reload(); await jean.getByRole('region', { name: 'Assigned campaign scene', exact: true }).waitFor();
    check('reconnecting browser loads authoritative assignment', true);
    await expand(hannah, 'journal');
    const journal = hannah.getByRole('region', { name: 'Campaign journal', exact: true });
    const noteTitle = `Private memory ${Date.now()}`;
    await journal.getByLabel('Title', { exact: true }).fill(noteTitle);
    await journal.getByLabel('Notes (Markdown)', { exact: true }).fill('# The secret\n\nOnly Hannah knows.');
    await journal.getByRole('button', { name: 'Save entry', exact: true }).click();
    await journal.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
    const own = await call(hannah, 'journal'); const note = own.body.entries.find(e => e.title === noteTitle);
    check('journal saved privately', !!note && note.sharing === 'private');
    check('private journal hidden from another player', !(await call(jean, 'journal')).body.entries.some(e => e.id === note.id));
    check('private journal hidden from GM', !(await call(gm, 'journal')).body.entries.some(e => e.id === note.id));
    check('foreign owner cannot overwrite', (await call(jean, 'journal', { action: 'save', id: note.id, version: note.version, entry: { ...note, title: 'stolen' } })).status === 409);
    await hannah.reload(); await expand(hannah, 'journal');
    const restored = hannah.getByRole('region', { name: 'Campaign journal', exact: true });
    await restored.getByRole('button', { name: noteTitle, exact: true }).click();
    check('journal survives refresh', await restored.getByLabel('Notes (Markdown)', { exact: true }).inputValue() === note.body);
    const downloaded = hannah.waitForEvent('download');
    await restored.getByRole('button', { name: /Export loaded personal/ }).click();
    check('Markdown export downloads', (await downloaded).suggestedFilename() === 'apex-journal.md');
    await restored.getByLabel('Visibility').selectOption('gm'); await restored.getByRole('button', { name: 'Save entry', exact: true }).click();
    await restored.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
    check('GM sharing grants GM access', (await call(gm, 'journal')).body.entries.some(e => e.id === note.id));
    check('GM sharing still hides notes from party', !(await call(jean, 'journal')).body.entries.some(e => e.id === note.id));
    check('no browser runtime errors', errors.length === 0);
    console.log(`\n${results.length} browser checks passed (isolated memory storage; no live Supabase verification).`);
  } catch (error) {
    const fs = require('node:fs'); fs.mkdirSync('.test-output', { recursive: true });
    for (const [i, context] of browser.contexts().entries()) for (const page of context.pages()) {
      fs.writeFileSync(`.test-output/campaign08-${i}.html`, await page.content());
      await page.screenshot({ path: `.test-output/campaign08-${i}.png`, fullPage: true });
    }
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
