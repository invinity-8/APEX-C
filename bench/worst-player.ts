import { gzipSync } from 'node:zlib';
import { createDemoState } from '../src/data/demo';
import { buildPlayerView } from '../src/game/visibility';
for (const radius of [39, 78]) {
  const s = createDemoState({ radius, seed: 1 });
  const explored: Record<string, true> = {};
  for (const k of Object.keys(s.hexes)) explored[k] = true;
  for (const id of Object.keys(s.knowledge)) (s.knowledge[id] as { explored: Record<string, unknown> }).explored = explored;
  const t0 = performance.now();
  const v = buildPlayerView(s, 'sinna');
  const ms = performance.now() - t0;
  const { hexByKey: _drop, ...wire } = v as unknown as Record<string, unknown>;
  const j = JSON.stringify(wire);
  console.log(`radius ${radius} fully explored: player view ${(j.length / 1024).toFixed(0)} KB (gzip ${(gzipSync(j).length / 1024).toFixed(0)} KB), build ${ms.toFixed(0)} ms; state ${(JSON.stringify(s).length / 1024).toFixed(0)} KB`);
}
