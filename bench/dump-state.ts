import { writeFileSync } from 'node:fs';
import { createDemoState } from '../src/data/demo';
for (const r of [39, 78]) writeFileSync(`${process.argv[2]}/state-${r}.json`, JSON.stringify(createDemoState({ radius: r, seed: 1 })));
