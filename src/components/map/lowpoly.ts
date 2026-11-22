/**
 * APEX 2.1 – the figure builder's entry point (FigureLook → 3D figure).
 * APEX 2.11 – the figures are built by hero3d.ts (heroic proportions, sculpted faces, Roman-meets-magic gear,
 * procedural materials); weapons and shields live in gear3d.ts. This module keeps the old import path.
 */
export { buildHero as buildLowPoly, ancestryScale, type LowPolyFigure } from './hero3d';
export { mergeByMaterial } from './merge3d';
