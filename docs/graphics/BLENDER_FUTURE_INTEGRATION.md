# Blender – future asset pipeline (not part of APEX 0.6)

Status: **planning only.** No Blender installation, MCP server, credentials or assets are part of 0.6. The 0.6
graphics overhaul with Spline was cancelled; the experimental changes were discarded before they were committed.
The live map is the Canvas renderer from 0.4/0.5 and stays the fallback for any future 3D work.

## What still uses Spline (kept, in production)
- Welcome-screen hero `public/assets/spline/aquila-aurea.splinecode` + poster (APEX 0.5, lazy-loaded, poster fallback).
- These are the first candidates for replacement by Blender-made assets; nothing in gameplay depends on them.

## Proposed pipeline
1. **Author** in Blender (owner or a Blender MCP agent): one `.blend` per asset family (monuments, terrain
   modules, props), kept outside the web bundle (e.g. a separate `apex-assets` repository or LFS).
2. **Export** per asset as **glTF 2.0 binary (`.glb`)**: Y-up, metres (1 hex ≈ 1.5 m), applied transforms,
   Draco or Meshopt geometry compression, KTX2/Basis textures, ≤ 2048² per texture, PBR metal/rough materials.
   Animated assets: glTF animation clips (loopable idle clips, no bone count > 64 for web).
3. **Pre-render where 3D is not needed:** map sprites (trees, rocks, monuments) rendered from Blender at the map's
   camera angle into transparent WebP atlases – the Canvas renderer draws them like today's procedural sprites.
4. **Register** every asset in `src/assets/registry.ts` (id, use, format `glb` | `webp`, path, source `.blend`
   + commit, licence, optimisation, fallback, version, tier).
5. **Runtime:** three.js (or React Three Fiber) only where real 3D adds value (welcome hero, a 3D monument view);
   lazy-loaded chunk, one renderer instance, disposed on unmount, `prefers-reduced-motion` → static poster.

## Interfaces to define then
- `AssetLoader.loadModel(id) → Promise<GLTF | null>` and `AssetLoader.sprite(id) → HTMLImageElement | null`,
  both resolving through the registry, with the procedural painter as the fallback when they return null.
- A `glb` variant of the registry entry with `lods: [{ path, maxScreenPx }]`.

## Performance rules (inherited from 0.5 measurements)
- No per-hex 3D objects; instanced or pre-rendered sprites for repeated vegetation.
- Budget: ≤ 1.5 MB lazily loaded for the hero, ≤ 300 KB sprite atlases per biome, 16.7 ms frames at radius 78 on
  a mid-range laptop; measure with `bench/visuals.cjs` before shipping.
- Always keep the Canvas renderer selectable as fallback.
