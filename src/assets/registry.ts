/**
 * APEX graphics asset registry (APEX 0.5). Game logic never references image files directly – it asks the
 * registry for an asset id, so artwork can be replaced or updated without touching gameplay code.
 * Documented in docs/design/ASSET_REGISTRY.md. Every entry names its fallback; nothing may require a live
 * Spline editor connection at runtime.
 */
export type AssetFormat = 'svg-inline' | 'canvas-procedural' | 'webp' | 'png' | 'avif' | 'css' | 'splinecode';

export interface AssetEntry {
  id: string;
  use: string;
  format: AssetFormat;
  /** Served path (public/…) or source module for procedural assets. */
  path: string;
  /** Where the artwork comes from (Spline file link, procedural code …). */
  source: string;
  optimisation: string;
  licence: string;
  fallback: string;
  version: string;
}

export const ASSETS: AssetEntry[] = [
  {
    id: 'map.terrain',
    use: 'Painted hex terrain (all terrain types, rivers, roads, features)',
    format: 'canvas-procedural',
    path: 'src/components/map/painter.ts',
    source: 'Original procedural painter (APEX)',
    optimisation: 'Chunked bitmap cache with LOD, 12 ms frame budget, LRU pixel budget',
    licence: 'Original APEX code',
    fallback: '— (is itself the baseline renderer)',
    version: '0.4',
  },
  {
    id: 'map.lights',
    use: 'Day/night lighting, torches, magic glow, water glints',
    format: 'canvas-procedural',
    path: 'src/components/map/LightCanvas.tsx',
    source: 'Original procedural code',
    optimisation: 'Viewport culling, sub-pixel culling, ~30 fps cap, off with reduced motion',
    licence: 'Original APEX code',
    fallback: 'No lights (static map)',
    version: '0.4',
  },
  {
    id: 'ui.markers',
    use: 'Character markers: medallion, gem, hexagon, crest',
    format: 'svg-inline',
    path: 'src/components/CharacterVisuals.tsx',
    source: 'Original SVG paths',
    optimisation: 'Inline SVG, no requests',
    licence: 'Original APEX artwork',
    fallback: 'Circle with initials',
    version: '0.4',
  },
  {
    id: 'ui.panel',
    use: 'Stone slab panel, widget header, gold inlay rule',
    format: 'css',
    path: 'src/index.css (.panel, .widget-header, .imperial-rule)',
    source: 'Design tokens (APEX_VISUAL_STYLE_GUIDE.md §6)',
    optimisation: 'Pure CSS',
    licence: 'Original APEX',
    fallback: 'Plain dark box',
    version: '0.5',
  },
  {
    id: 'spline.aquila-aurea',
    use: 'Welcome-screen hero: Aquila Aurea monument, labyrinth plinth, column ring, aqueduct, Centurion-red banners, meadow',
    format: 'splinecode',
    path: 'public/assets/spline/aquila-aurea.splinecode',
    source: 'Spline file "APEX Imperial Asset Kit" https://app.spline.design/file/09a1cf4b-f497-45ea-b5e5-5578e3d6f96c (code export https://prod.spline.design/xie9ry1qfODiundG/scene.splinecode)',
    optimisation: '128 KB, procedural primitives only (no textures); runtime lazy-loaded only on capable devices, only on the welcome screen, disposed on unmount; served from our origin',
    licence: 'Original APEX artwork created for the project in the owner’s Spline account; no third-party assets',
    fallback: 'spline.aquila-aurea.poster (static image)',
    version: '0.5',
  },
  {
    id: 'spline.aquila-aurea.poster',
    use: 'Static poster of the same scene (shown first; the only image on reduced-motion / low-end devices)',
    format: 'webp',
    path: 'public/assets/spline/aquila-aurea-poster.webp',
    source: 'Render of the Spline scene above (Spline viewport capture), converted to WebP',
    optimisation: '1280×800, 8 KB WebP (quality 72)',
    licence: 'Original APEX artwork',
    fallback: 'Dark panel background',
    version: '0.5',
  },
  {
    id: 'map.atmosphere',
    use: 'Map atmosphere: drifting fog banks, day/night light tint, vignette',
    format: 'canvas-procedural',
    path: 'src/components/map/AtmosphereCanvas.tsx',
    source: 'Original procedural code',
    optimisation: '≤ 12 soft gradients per frame, 24 fps cap, paused when hidden or idle; static under reduced motion',
    licence: 'Original APEX code',
    fallback: 'No overlay (classic map)',
    version: '0.5',
  },
];

export const asset = (id: string): AssetEntry | undefined => ASSETS.find((a) => a.id === id);
