/**
 * Real-browser check of the PDF → character sheet pipeline on a PRODUCTION build (demo mode, sheets stored in
 * the browser). Usage:
 *   VITE_APEX_ALLOW_DEMO=true npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4319
 *   node dev/import-browser-check.cjs http://localhost:4319 <file.pdf> [shotdir]
 * Imports the PDF, saves, reloads the page and reads the values back from the rendered character sheet.
 */
const { chromium } = require('playwright');
const [base, file, shots = '.'] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' – ' + extra : ''}`);
  console.log(results.at(-1));
};
const text = (page) => page.locator('body').innerText();
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('apex.demo.session.v1')) localStorage.setItem('apex.demo.session.v1', JSON.stringify({ role: 'player', viewerId: 'sinna' }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR ${e.message}`));
  await page.goto(`${base}/?demo`);
  await page.getByRole('button', { name: /Character$/ }).click();
  await page.getByRole('button', { name: /Import Character Sheet/ }).click();
  await page.getByLabel('Choose a PDF file').setInputFiles(file);
  await page.getByRole('button', { name: /Save character sheet/ }).waitFor({ timeout: 30000 });
  const review = await page.locator('[role=dialog]').innerText();
  console.log('format line:', (review.match(/Aurora[^\n]*|Text PDF[^\n]*|Fillable[^\n]*/) ?? ['?'])[0]);
  await page.screenshot({ path: `${shots}/import-review.png`, fullPage: true });
  await page.getByRole('button', { name: /Save character sheet/ }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole('button', { name: /Character$/ }).click();
  await page.getByRole('tab', { name: 'Overview' }).click();
  const ov = await text(page);
  check('overview after reload: Sinna, Level 1 Kor Druid', /Sinna/.test(ov) && /Level 1 Kor Druid/.test(ov));
  check('overview: AC 16', /Armor Class\s*16|AC\s*16/i.test(ov), ov.slice(0, 400));
  check('overview: HP 9 / 9', /9\s*\/\s*9/.test(ov));
  await page.getByRole('tab', { name: 'Attributes & Skills' }).click();
  const at = await text(page);
  await page.screenshot({ path: `${shots}/attributes.png`, fullPage: true });
  check('no "No attributes recorded."', !/No attributes recorded/.test(at));
  for (const [n, v] of [['Strength', 11], ['Dexterity', 11], ['Constitution', 12], ['Intelligence', 9], ['Wisdom', 18], ['Charisma', 9]])
    check(`${n} ${v}`, new RegExp(`${n}\\s*\\n?\\s*${v}\\b`, 'i').test(at), at.match(new RegExp(`${n}[^\\n]*\\n?[^\\n]*`, 'i'))?.[0]);
  check('proficiency bonus +2', /Proficiency bonus\s*\+2/i.test(ov + '\n' + at), (ov.match(/Proficiency[^]{0,30}/i) ?? [''])[0]);
  check('saving throws populated (Wisdom save +6)', /Wisdom save\s*\+6/.test(at));
  check('skills populated (Perception +6)', /Perception \(Wis\)\s*\+6/.test(at));
  await page.getByRole('tab', { name: 'Abilities & Spells' }).click();
  const sp = await text(page);
  check('prepared spells shown (Entangle), unprepared hidden by default (Goodberry)', /Entangle/.test(sp) && !/Goodberry/.test(sp));
  await page.getByRole('tab', { name: 'Inventory' }).click();
  const inv = await text(page);
  check('inventory: Breastplate, Shield, Quarterstaff', /Breastplate/.test(inv) && /Shield/.test(inv) && /Quarterstaff/.test(inv));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  await b.close();
  process.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
})().catch((e) => (console.error(e), process.exit(1)));
