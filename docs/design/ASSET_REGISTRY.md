# APEX asset registry

Source of truth: `src/assets/registry.ts` (typed; tests check every entry is complete). Each asset documents:

| Field | Meaning |
|---|---|
| `id` | stable id used by code (`ui.orb.health`, `map.tree.oak` …) |
| `use` | where it appears |
| `format` | `svg-inline`, `canvas-procedural`, `webp`/`avif`/`png`, `css`, `splinecode` |
| `path` | served file (`public/assets/…`) or source module |
| `source` | Spline file link or code that produced it |
| `optimisation` | size, compression, caching, LOD |
| `licence` | usage rights – only original APEX work or assets generated for APEX under the owner's account |
| `fallback` | what renders if the asset fails or the device is too slow |
| `version` | APEX version that introduced/changed it |

Rules: no copyrighted reference-game assets; no runtime dependency on the Spline editor; large assets lazy-loaded
and cached (immutable file names under `public/assets/`, served with long cache headers by Vercel).
