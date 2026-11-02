/**
 * Arena size benchmark: generation, serialization, player-view build and memory for a given radius.
 * Run: npx tsx bench/arena-size.ts 39 78
 */
import { gzipSync } from 'node:zlib';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { hexCount } from '../src/game/hex';
import { buildGmView, buildPlayerView } from '../src/game/visibility';

const radii = process.argv.slice(2).map(Number).filter(Boolean);
const time = <T>(fn: () => T, n = 5) => {
  fn();
  const t0 = performance.now();
  let r!: T;
  for (let i = 0; i < n; i++) r = fn();
  return { ms: (performance.now() - t0) / n, r };
};
const kb = (s: string) => `${(s.length / 1024).toFixed(0)} KB (gzip ${(gzipSync(s).length / 1024).toFixed(0)} KB)`;

for (const radius of radii) {
  global.gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  const gen = time(() => createDemoState({ radius, seed: 1 }), 3);
  const s = gen.r;
  const heap1 = process.memoryUsage().heapUsed;
  const json = time(() => JSON.stringify(s));
  const parse = time(() => JSON.parse(json.r));
  const pv = time(() => buildPlayerView(s, 'sinna'));
  const gv = time(() => buildGmView(s));
  const adv = time(() => executeCommand(s, { role: 'gm' }, { type: 'advancePhase' }), 3);
  console.log(`radius ${radius} (${hexCount(radius).toLocaleString('en-US')} hexes, actual ${s.config.mapRadius}, ${Object.keys(s.hexes).length} in state)`);
  console.log(`  generate        ${gen.ms.toFixed(0)} ms`);
  console.log(`  state JSON      ${kb(json.r)}  stringify ${json.ms.toFixed(1)} ms, parse ${parse.ms.toFixed(1)} ms`);
  console.log(`  player view     ${kb(JSON.stringify(pv.r))}  build ${pv.ms.toFixed(1)} ms`);
  console.log(`  GM view         ${kb(JSON.stringify(gv.r))}  build ${gv.ms.toFixed(1)} ms`);
  console.log(`  advancePhase    ${adv.ms.toFixed(1)} ms`);
  console.log(`  heap (approx.)  +${((heap1 - heap0) / 1048576).toFixed(1)} MB`);
}
