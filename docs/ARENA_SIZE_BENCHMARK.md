# Arena size benchmark (radius 39 vs. 78)

Maximum radius raised from 45 to **78** (18,487 hexes, ~3.9× the default). Default stays **39** (4,681 hexes).

Reproduce: `npx tsx bench/arena-size.ts 39 45 78`, `npx tsx bench/worst-player.ts`,
and for the browser `VITE_APEX_ALLOW_DEMO=true npx vite build --outDir <dir>`, `npx vite preview --outDir <dir> --port 4319`,
`npx tsx bench/dump-state.ts <dir>`, `node bench/render.cjs <dir> http://localhost:4319`.

Measured 2026-11-01 in the cloud dev container (Node 22, headless Chromium **without GPU** – canvas numbers are
pessimistic; real browsers composite canvases on the GPU).

## Server / data (Node)

| | radius 39 | radius 45 | radius 78 |
|---|---|---|---|
| Generate new world | 86 ms | 125 ms | 469 ms |
| Full state JSON (GM payload) | 289 KB (gzip 36 KB) | 381 KB (46 KB) | 1,117 KB (128 KB) |
| stringify / parse | 2.6 / 2.6 ms | 3.3 / 3.7 ms | 16 / 11 ms |
| Player view (fresh world) | 11 KB | 11 KB | 11 KB |
| Player view, map **fully explored** (worst case) | 435 KB (33 KB) | – | 1,711 KB (124 KB) |
| GM view build (client) | 7 ms | 10 ms | 35 ms |
| `advancePhase` command | 5 ms | 8 ms | 27 ms |
| Heap for one state | ~10 MB | ~12 MB | ~39 MB |

- Every response stays far below Vercel's 4.5 MB limit (worst case 1.7 MB raw, ~124 KB gzip).
- Postgres TOAST compresses the state ~5.7× (production: 465 KB text → 82 KB stored), so a radius-78 state costs
  roughly 200–400 KB per row. 60 dawn snapshots ≈ 12–24 MB worst case – acceptable (production DB today: 14 MB).
- Import request limit raised from 3.0 to 4.2 MB so a fully explored radius-78 world (~2.1 MB) can still be imported.

## Browser (production build, demo mode, GM view)

| | radius 39 | radius 78 | radius 39, CPU ×4 | radius 78, CPU ×4 |
|---|---|---|---|---|
| First map visible | 688 ms | 639 ms | 1,633 ms | 2,242 ms |
| Pan/zoom frame time, median / p95 | 16.7 / 50 ms | 16.7 / 33 ms | 33 / 150 ms | 83 / 150 ms |
| Advance phase (until rendered) | 216 ms | 214 ms | 520 ms | 729 ms |
| JS heap | 7 MB | 15 MB | 9 MB | 15 MB |
| DOM nodes | 581 | 771 | 620 | 704 |

The terrain is painted into cached chunks with a 12 ms per-frame budget, so a large map never blocks the main thread
on first paint – it fills in progressively. Off-screen and sub-pixel lights are skipped (new in this change: lights
smaller than 1.5 px when zoomed far out are no longer drawn).

## Verdict

Radius 78 is usable: on desktop no measurable difference; on a 4× slower CPU (older phone) the first load and panning
are noticeably slower but still interactive. Players' payloads only grow with what they have explored. Recommended for
occasional "epic" arenas; the default stays 39. The world dialog shows a hint above radius 60.
