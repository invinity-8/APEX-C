/** Local-only browser acceptance against the real API with the memory repository. Never targets production. */
const { chromium } = require(process.env.APEX_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5174';
const results = [];
function check(name, condition, detail = '') { assert.ok(condition, detail ? `${name}\n${detail}` : name); results.push(name); console.log('PASS', name); }
async function call(page, op, body, query = '') {
  const result = await page.evaluate(async ([op, body, query]) => {
    const response = await fetch(`/api/apex?op=${op}${query}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-apex-csrf': '1' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, [op, body, query]);
  return result;
}
async function expand(page, id) {
  const button = page.locator(`[data-widget="${id}"] .ws-handle > button[aria-expanded]`);
  await button.waitFor(); if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
(async () => {
  assert.equal((await fetch(base+'/__mock/reset',{method:'POST'})).status,200,'local test harness reset');
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'], ...(process.env.APEX_BROWSER_PATH ? { executablePath: process.env.APEX_BROWSER_PATH } : {}) });
  try {
    const errors = [];
    async function device(profile) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', async message => { if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of \d+/.test(message.text())) { const args = await Promise.all(message.args().map(arg => arg.jsonValue().catch(() => '[unavailable]'))); errors.push(JSON.stringify({ message: message.text(), args, location: message.location() })); } }); await page.goto(base);
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
    const png = await gm.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 200, 300); x.fillStyle = '#0000ff'; x.fillRect(200, 0, 200, 300); return c.toDataURL('image/png'); });
    await editor.getByLabel('Upload private map image').setInputFiles({ name: 'isolated-map.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await editor.getByRole('status').filter({ hasText: 'Private map uploaded.' }).waitFor();
    check('map upload creates a private processed asset', true);
    await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
    await editor.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor();
    const prepared = (await call(gm, 'scenes', null, '&id=' + scene.id)).body.scene;
    const map = { ...prepared.metadata, gmNotes: 'GM ONLY SECRET', nodes: [...prepared.metadata.nodes,
      { id: 'secret-enemy', x: 500, y: 500, label: 'Hidden dragon', description: 'Private enemy', kind: 'location', visible: false, width: 60, height: 60, targetScene: null },
      { id: 'revealed-area', x: 0, y: 0, label: 'Explored half', description: '', kind: 'area', visible: true, width: 600, height: 800, targetScene: null },
      { id: 'visible-poi', x: 200, y: 200, label: 'Old tower', description: 'Public landmark', kind: 'location', visible: true, width: 60, height: 60, targetScene: null }] };
    check('map definition saves', (await call(gm, 'scenes', { action: 'save', id: scene.id, revision: prepared.revision, map })).status === 200);
    await director.getByRole('button', { name: 'Close preview', exact: true }).click();
    await director.locator('li').filter({ hasText: title }).getByRole('button', { name: 'Private preview', exact: true }).click();
    await director.getByRole('region', { name: 'Map editor', exact: true }).getByRole('button', { name: 'Publish definition', exact: true }).click();
    await director.getByRole('region', { name: 'Map editor', exact: true }).getByRole('status').filter({ hasText: 'Scene published.' }).waitFor();
    check('publishing bakes a player-safe background image', true);
    const published = (await call(gm, 'scenes', null, '&id=' + scene.id)).body.scene;
    const hannah = await device('hannah'); const jean = await device('jean');
    check('player library access denied', (await call(hannah, 'scenes')).status === 403);
    check('direct private preview URL denied', (await call(hannah, 'scenes', null, '&id=' + scene.id)).status === 403);
    await hannah.reload(); await hannah.waitForSelector('canvas'); await jean.reload(); await jean.waitForSelector('canvas');
    const players = (await call(gm, 'scene-runtime')).body.players;
    check('private preparation did not move players', players.every(p => p.revision === 0));
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
    check('player cannot obtain GM source-image URL', (await call(hannah, 'scene-assets', null, '&id=' + published.metadata.backgroundAsset)).status === 404);
    const safeAsset = await call(hannah, 'scene-assets', null, '&id=' + published.metadata.playerBackgroundAsset);
    check('assigned player can load only the approved derived map', safeAsset.status === 200);
    const pixels = await hannah.evaluate(async url => { const image = await createImageBitmap(await (await fetch(url)).blob()); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const x = c.getContext('2d'); x.drawImage(image, 0, 0); const pixel = [...x.getImageData(300, 150, 1, 1).data]; image.close(); return pixel; }, safeAsset.body.url);
    check('hidden image pixels are physically removed from player raster', pixels[2] < 80 && pixels[0] < 80);
    const canvas = hannah.getByRole('region', { name: 'Assigned campaign scene', exact: true }).getByRole('img', { name: title, exact: true });
    await hannah.getByRole('button', { name: 'Move your character', exact: true }).click();
    await canvas.click({ position: { x: 150, y: 100 } });
    await hannah.getByRole('status').filter({ hasText: 'Movement saved.' }).waitFor();
    const moved = (await call(hannah, 'state')).body;
    check('owned tactical token moves and spends a separate budget', moved.scene.motion.tokens.some(t => t.tokenId === 'sinna' && t.x === 175) && moved.scene.motion.budgets.sinna.tacticalSpent > 0);
    check('foreign scene token movement is rejected', (await call(jean, 'scene-motion', { action: 'move', sceneId: scene.id, sceneRevision: published.revision, assignmentRevision: 1, tokenId: 'sinna', tokenVersion: 1, epoch: 0, x: 200, y: 100, requestId: crypto.randomUUID() })).status === 403);
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
    await journal.getByLabel('Image attachment').setInputFiles({ name:'private-journal.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64') });
    await journal.getByRole('status').filter({hasText:'Image uploaded privately.'}).waitFor();
    await journal.getByRole('button',{name:'Save entry',exact:true}).click();
    await journal.getByRole('status').filter({hasText:'Saved.'}).waitFor();
    const own = await call(hannah, 'journal'); const note = own.body.entries.find(e => e.title === noteTitle);
    check('journal saved privately', !!note && note.sharing === 'private');
    check('private journal hidden from another player', !(await call(jean, 'journal')).body.entries.some(e => e.id === note.id));
    check('private journal hidden from GM', !(await call(gm, 'journal')).body.entries.some(e => e.id === note.id));
    check('private journal image hidden from GM and other players', (await call(gm,'journal-images',null,'&id='+note.image_id)).status===404 && (await call(jean,'journal-images',null,'&id='+note.image_id)).status===404);
    check('foreign owner cannot overwrite', [400,403,409].includes((await call(jean, 'journal', { action: 'save', id: note.id, version: note.version, entry: { ...note, title: 'stolen' } })).status) && (await call(hannah,'journal')).body.entries.find(e=>e.id===note.id).title===noteTitle);
    await hannah.reload(); await expand(hannah, 'journal');
    const restored = hannah.getByRole('region', { name: 'Campaign journal', exact: true });
    await restored.getByRole('button', { name: noteTitle, exact: true }).click();
    check('journal survives refresh', await restored.getByLabel('Notes (Markdown)', { exact: true }).inputValue() === note.body);
    const downloaded = hannah.waitForEvent('download');
    await restored.getByRole('button', { name: /Export personal journal/ }).click();
    check('portable Markdown and image ZIP downloads', (await downloaded).suggestedFilename() === 'apex-journal.zip');
    await restored.getByLabel('Visibility').selectOption('gm'); await restored.getByRole('button', { name: 'Save entry', exact: true }).click();
    await restored.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
    check('GM sharing grants GM access', (await call(gm, 'journal')).body.entries.some(e => e.id === note.id));
    check('GM sharing still hides notes from party', !(await call(jean, 'journal')).body.entries.some(e => e.id === note.id));
    check('explicit sharing authorizes the attached image for GM only', (await call(gm,'journal-images',null,'&id='+note.image_id)).status===200 && (await call(jean,'journal-images',null,'&id='+note.image_id)).status===404);
    const cosmos=(await call(gm,'scenes',{name:'Isolated cosmos',category:'celestial',template:'planetary-system'})).body.scene;
    check('celestial template publishes', (await call(gm,'scenes',{action:'publish',id:cosmos.id,revision:cosmos.revision,map:cosmos.metadata})).status===200);
    let world=(await call(gm,'scenes',{name:'Isolated world',category:'world',template:'connected-world'})).body.scene;
    world=(await call(gm,'scenes',{action:'parent',id:world.id,revision:world.revision,parentId:cosmos.id})).body.scene;
    world=(await call(gm,'scenes',{action:'publish',id:world.id,revision:world.revision,map:world.metadata})).body.scene;
    check('world template preserves routes and celestial parent', world.parent_scene_id===cosmos.id && world.metadata.routes.length===1);
    let region=(await call(gm,'scenes',{name:'Isolated region',category:'region',template:'hex-region'})).body.scene;
    region=(await call(gm,'scenes',{action:'parent',id:region.id,revision:region.revision,parentId:world.id})).body.scene;
    region=(await call(gm,'scenes',{action:'publish',id:region.id,revision:region.revision,map:region.metadata})).body.scene;
    check('region template preserves hourly scale and world parent', region.parent_scene_id===world.id && region.metadata.interval==='hour');
    const latestBattle=(await call(gm,'scenes',null,'&id='+scene.id)).body.scene;
    check('battle links to a region without rebuilding it', (await call(gm,'scenes',{action:'parent',id:scene.id,revision:latestBattle.revision,parentId:region.id})).status===200);
    async function transferHannah(destination) { const p=(await call(gm,'scene-runtime')).body.players.find(p=>p.name==='Hannah'); const r=await call(gm,'scene-runtime',{sceneId:destination,targets:[{userId:p.userId,revision:p.revision}],requestId:crypto.randomUUID()}); check('selected-player transfer succeeds',r.status===200); }
    await transferHannah(world.id);
    await hannah.getByRole('region',{name:'Assigned campaign scene',exact:true}).getByRole('heading',{name:'Isolated world',exact:true}).waitFor();
    await director.getByRole('button',{name:'World Maps',exact:true}).click();
    await director.locator('li').filter({hasText:'Isolated world'}).getByRole('button',{name:'Private preview',exact:true}).click();
    const gmTravel=director.getByRole('region',{name:'World travel',exact:true});
    await gmTravel.getByLabel('Party location',{exact:true}).selectOption('town');
    await gmTravel.getByRole('button',{name:'Set party location',exact:true}).click();
    await gmTravel.getByRole('status').filter({hasText:'Travel update saved.'}).waitFor();
    const playerTravel=hannah.getByRole('region',{name:'World travel',exact:true});
    await playerTravel.getByLabel('Travel destination',{exact:true}).selectOption('road');
    await playerTravel.getByRole('button',{name:'Propose destination to GM',exact:true}).click();
    await playerTravel.getByRole('status').filter({hasText:'Travel update saved.'}).waitFor();
    check('travel proposal keeps party at origin', (await call(hannah,'scene-travel',null,'&sceneId='+world.id)).body.partyNode==='town');
    check('other-scene player cannot inspect world travel', (await call(jean,'scene-travel',null,'&sceneId='+world.id)).status===404);
    await gmTravel.getByRole('button',{name:'Confirm travel',exact:true}).click();
    await gmTravel.getByRole('button',{name:'Progress journey',exact:true}).waitFor();
    await gmTravel.getByRole('button',{name:'Progress journey',exact:true}).click();
    await gmTravel.locator('li').filter({hasText:'1/4h'}).waitFor();
    await gmTravel.getByLabel('Hours to progress',{exact:true}).fill('3');
    await gmTravel.getByRole('button',{name:'Progress journey',exact:true}).click();
    await gmTravel.locator('li').filter({hasText:'complete'}).waitFor();
    check('GM confirmation and progress arrive at destination', (await call(hannah,'scene-travel',null,'&sceneId='+world.id)).body.partyNode==='landmark');
    await transferHannah(region.id);
    await hannah.getByRole('region',{name:'Assigned campaign scene',exact:true}).getByRole('heading',{name:'Isolated region',exact:true}).waitFor();
    await hannah.getByRole('button',{name:'Move your character',exact:true}).click();
    await hannah.getByRole('img',{name:'Isolated region',exact:true}).click({position:{x:150,y:100}});
    await hannah.getByRole('status').filter({hasText:'Movement saved.'}).waitFor();
    const regional=(await call(hannah,'state')).body.scene.motion.budgets.sinna;
    check('hourly movement and tactical movement use separate persistent budgets',regional.regionSpent>0 && regional.tacticalSpent>0);
    await director.getByRole('button',{name:'Battle Maps',exact:true}).click();
    await director.locator('li').filter({hasText:title}).getByRole('button',{name:'Private preview',exact:true}).click();
    const sanctuarySettings=director.getByRole('group',{name:'Campaign Sanctuary',exact:true});
    await sanctuarySettings.getByRole('button',{name:"Approve this scene's published player image",exact:true}).click();
    await sanctuarySettings.getByLabel('Default background',{exact:true}).selectOption(published.metadata.playerBackgroundAsset);
    await sanctuarySettings.getByRole('button',{name:'Save Sanctuary defaults',exact:true}).click();
    await sanctuarySettings.getByRole('status').filter({hasText:'Sanctuary defaults saved.'}).waitFor();
    check('players cannot change campaign Sanctuary approvals',(await call(hannah,'sanctuary',{revision:0,atmosphere:'hall',defaultAsset:null,backgrounds:[]})).status===403);
    await transferHannah(null);
    await hannah.getByRole('region',{name:'Character Sanctuary',exact:true}).locator('img.sanctuary-art').waitFor();
    check('GM-approved background appears in Sanctuary',true);
    await hannah.getByLabel('Sanctuary atmosphere',{exact:true}).selectOption('campfire');
    await hannah.reload();
    await hannah.getByRole('region',{name:'Character Sanctuary',exact:true}).waitFor();
    check('approved personal atmosphere persists after reconnect',await hannah.getByLabel('Sanctuary atmosphere',{exact:true}).inputValue()==='campfire');
    check('no browser runtime errors', errors.length === 0, errors.slice(0, 3).join('\n'));
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
