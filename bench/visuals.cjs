// APEX 0.5 visual benchmark (production build, demo mode). Usage:
//   VITE_APEX_ALLOW_DEMO=true npx vite build --emptyOutDir --outDir <dir>; npx vite preview --outDir <dir> --port 4319
//   npx tsx bench/dump-state.ts <statedir>; node bench/visuals.cjs <statedir> http://localhost:4319
const { chromium } = require('playwright');
const fs = require('fs');
const [dir, base] = process.argv.slice(2);
const pct = (a, q) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))]?.toFixed(1);

async function frames(page, ms = 2500) {
  return page.evaluate(
    (ms) =>
      new Promise((res) => {
        const f = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (t) => {
          f.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else res(f.slice(1));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

(async () => {
  const b = await chromium.launch();
  // ---- welcome screen: static SVG illustration (APEX 0.7 – no 3D runtime) ----
  {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(base + '/');
    await page.getByTestId('welcome-vista').waitFor();
    console.log(`welcome: illustration visible after ${Date.now() - t0} ms · frames median ${pct(await frames(page), 0.5)} ms`);
    await ctx.close();
  }
  // ---- maps: GM vs player, atmosphere on/off, r39 / r78 ----
  for (const r of [39, 78]) {
    const st = fs.readFileSync(`${dir}/state-${r}.json`, 'utf8');
    for (const role of ['gm', 'player']) {
      for (const atm of ['on', 'off']) {
        const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
        await ctx.addInitScript(
          ([s, role, atm]) => {
            localStorage.setItem('apex.demo.state.v2', s);
            localStorage.setItem('apex.demo.session.v1', JSON.stringify({ role, viewerId: 'sinna' }));
            localStorage.setItem('apex.map.atmosphere', atm);
          },
          [st, role, atm],
        );
        const page = await ctx.newPage();
        const t0 = Date.now();
        await page.goto(base + '/?demo');
        await page.waitForSelector('canvas');
        const load = Date.now() - t0;
        await page.waitForTimeout(5000);
        const idle = await frames(page, 2000);
        const box = await page.locator('canvas').first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const pan = frames(page, 1500);
        await page.mouse.down();
        for (let i = 0; i < 30; i++) await page.mouse.move(box.x + box.width / 2 + i * 10, box.y + box.height / 2 + i * 4);
        await page.mouse.up();
        const pf = await pan;
        let dn = '–';
        if (role === 'gm') {
          const t1 = Date.now();
          await page.getByRole('button', { name: /Begin Night/ }).first().click();
          await page.waitForFunction(() => /Night 1/.test(document.body.innerText));
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          dn = `${Date.now() - t1} ms`;
        }
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Performance.enable');
        const heap = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576;
        console.log(`r${r} ${role.padEnd(6)} atmosphere ${atm.padEnd(3)}: load ${load} ms · idle frames ${pct(idle, 0.5)}/${pct(idle, 0.95)} ms · pan ${pct(pf, 0.5)}/${pct(pf, 0.95)} ms · day→night ${dn} · heap ${heap.toFixed(0)} MB`);
        await ctx.close();
      }
    }
  }
  await b.close();
})();
