// Browser render benchmark: node bench/render.cjs <dir with state-*.json> <baseUrl>
const { chromium } = require('playwright');
const fs = require('fs');
const [dir, base] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const throttle of [1, 4]) {
    for (const r of [39, 78]) {
      const state = fs.readFileSync(`${dir}/state-${r}.json`, 'utf8');
      const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
      await ctx.addInitScript(([s]) => {
        localStorage.setItem('apex.demo.state.v2', s);
        localStorage.setItem('apex.demo.session.v1', JSON.stringify({ role: 'gm', viewerId: 'sinna' }));
      }, [state]);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Performance.enable');
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const t0 = Date.now();
      await page.goto(`${base}/?demo`);
      await page.waitForSelector('canvas', { timeout: 60000 });
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0 && document.body.innerText.includes('Day'), null, { timeout: 60000 });
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      const loadMs = Date.now() - t0;
      await page.waitForTimeout(6000); // let the progressive (frame-budgeted) terrain painting finish
      // pan/zoom: measure frame times while dragging and wheel-zooming
      const box = await page.locator('canvas').first().boundingBox();
      await page.evaluate(() => {
        window.__frames = [];
        let last = performance.now();
        const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 2000) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 40; i++) await page.mouse.move(cx + i * 8, cy + i * 4);
      await page.mouse.up();
      for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
      for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
      const frames = await page.evaluate(() => window.__frames.slice(1));
      frames.sort((a, b) => a - b);
      const p = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))].toFixed(1);
      // GM action: advance phase (full state recompute + render)
      const t1 = Date.now();
      const btn = page.getByRole('button', { name: /Begin Night|Begin Day/ });
      await btn.click();
      await page.waitForFunction(() => /Night 1|Night/.test(document.body.innerText));
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      const actMs = Date.now() - t1;
      const m = await cdp.send('Performance.getMetrics');
      const heap = m.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1048576;
      const nodes = m.metrics.find((x) => x.name === 'Nodes').value;
      console.log(`CPU x${throttle} radius ${r}: first map ${loadMs} ms, pan/zoom frames median ${p(0.5)} ms p95 ${p(0.95)} ms (n=${frames.length}), advance phase ${actMs} ms, JS heap ${heap.toFixed(0)} MB, DOM nodes ${nodes}`);
      await ctx.close();
    }
  }
  await b.close();
})();
