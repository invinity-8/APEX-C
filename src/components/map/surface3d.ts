/**
 * APEX 2.11 – surfaces: a small shader patch that gives the kit's smooth shapes a material – woven cloth, grained
 * leather, hammered and scratched metal, ring mail, skin, scales, fur, chitin, stone, wood, bone. Everything is
 * procedural in object space (no textures to load): colour variation, a bump (the normal is tilted by the slope of a
 * height pattern) and roughness variation. Patches compose (a coat marking on top of fur, see coat3d.ts).
 */
import * as THREE from 'three';

export type Surface = 'cloth' | 'leather' | 'metal' | 'chain' | 'skin' | 'scales' | 'fur' | 'chitin' | 'stone' | 'wood' | 'bone' | 'hair' | 'smooth';
const ID: Record<Surface, number> = { smooth: 0, cloth: 1, leather: 2, metal: 3, chain: 4, skin: 5, scales: 6, fur: 7, chitin: 8, stone: 9, wood: 10, bone: 11, hair: 12 };
/** Pattern frequency per figure unit (a medium figure is ≈ 2 units tall) and bump strength. */
const LOOK: Record<Surface, { freq: number; bump: number; tint: number; rough: number }> = {
  smooth: { freq: 1, bump: 0, tint: 0, rough: 0 },
  // APEX 2.13 – a cleaner, painted look (WoW-like): colour variation stays, the bumps are mostly gone except where the
  // material is made of bumps (ring mail, scales, stone, bark, chitin)
  cloth: { freq: 70, bump: 0.06, tint: 0.08, rough: 0.06 },
  leather: { freq: 24, bump: 0.1, tint: 0.14, rough: 0.14 },
  metal: { freq: 9, bump: 0.06, tint: 0.1, rough: 0.3 },
  chain: { freq: 30, bump: 0.3, tint: 0.12, rough: 0.08 },
  skin: { freq: 14, bump: 0.02, tint: 0.06, rough: 0.08 },
  scales: { freq: 16, bump: 0.3, tint: 0.1, rough: 0.08 },
  fur: { freq: 30, bump: 0.22, tint: 0.16, rough: 0.1 },
  chitin: { freq: 9, bump: 0.35, tint: 0.16, rough: 0.25 },
  stone: { freq: 6, bump: 0.8, tint: 0.3, rough: 0.15 },
  wood: { freq: 10, bump: 0.3, tint: 0.26, rough: 0.12 },
  bone: { freq: 12, bump: 0.15, tint: 0.14, rough: 0.15 },
  hair: { freq: 60, bump: 0.25, tint: 0.22, rough: 0.12 },
};

/** Shared GLSL: hashing, value noise, cells and the normal tilt (three's bump-map formula). */
const COMMON = `
varying vec3 vSurfPos;
float sHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float sNoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float sFbm(vec3 p) { return sNoise(p) * 0.55 + sNoise(p * 2.03 + 7.1) * 0.3 + sNoise(p * 4.07 + 3.3) * 0.15; }
vec2 sCells(vec3 p) { vec3 c = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) { vec3 o = vec3(float(i), float(j), float(k)); vec3 r = o + vec3(sHash(c + o), sHash(c + o + 11.3), sHash(c + o + 27.1)) * 0.85 - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1)); }
vec3 sPerturb(vec3 pos, vec3 n, float h, float k, float face) {
  vec2 dh = vec2(dFdx(h), dFdy(h)) * k;
  vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}
`;
/** The height pattern of each surface (0 … 1) and a colour / roughness modulation. */
const HEIGHT = `
float sHeight(vec3 p, int kind) {
  if (kind == 1) return 0.5 + 0.25 * sin(p.x * 6.283) * sin(p.y * 6.283) + 0.25 * sin((p.z + p.y) * 6.283) * 0.5 + sNoise(p * 0.2) * 0.2;
  if (kind == 2) return sFbm(p) * 0.7 + (1.0 - sCells(p * 0.6).y) * 0.3;
  if (kind == 3) return sFbm(p * vec3(1.0, 0.15, 1.0) * 3.0) * 0.4 + sNoise(p * 0.6) * 0.6;
  if (kind == 4) { vec3 q = fract(p) - 0.5; float r = length(q.xy); return smoothstep(0.42, 0.3, abs(r - 0.28)) + 0.0 * q.z; }
  if (kind == 5) return sFbm(p) * 0.6 + sNoise(p * 4.0) * 0.4;
  if (kind == 6) { vec2 c = sCells(p * vec3(1.0, 1.4, 1.0)); return smoothstep(0.0, 0.35, c.y) * (1.0 - c.x * 0.6); }
  if (kind == 7) return sNoise(p * vec3(3.0, 0.35, 3.0)) * 0.7 + sFbm(p * 0.5) * 0.3;
  if (kind == 8) { vec2 c = sCells(p * 0.5); return smoothstep(0.0, 0.12, c.y) * 0.7 + sFbm(p * 2.0) * 0.3; }
  if (kind == 9) { vec2 c = sCells(p * 0.7); return sFbm(p) * 0.6 + smoothstep(0.0, 0.08, c.y) * 0.4; }
  if (kind == 10) return fract(length(p.xz) * 1.5 + sFbm(p * 0.8) * 1.2) * 0.6 + sNoise(p * vec3(0.3, 4.0, 0.3)) * 0.4;
  if (kind == 11) return sFbm(p) * 0.8 + sNoise(p * 3.0) * 0.2;
  if (kind == 12) return sNoise(p * vec3(4.0, 0.25, 4.0)) * 0.8 + sNoise(p * 0.3) * 0.2;
  return 0.5;
}
`;

/** A shader patch: what it adds to the program, and a key for three's program cache. */
export interface Patch { key: string; apply: (shader: THREE.WebGLProgramParametersWithUniforms) => void }

/** Installs patches on a material (in order). Material.clone() drops them, so callers re-install from userData. */
export function installPatches(m: THREE.Material, patches: Patch[]): void {
  if (!patches.length) return;
  m.onBeforeCompile = (shader) => { for (const p of patches) p.apply(shader); };
  const key = patches.map((p) => p.key).join('+');
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}

/** The surface patch for a kind (`scale` multiplies the pattern size, e.g. for a huge creature). */
export function surfacePatch(kind: Surface, scale = 1): Patch | null {
  if (kind === 'smooth') return null;
  const L = LOOK[kind], id = ID[kind];
  const freq = (L.freq / scale).toFixed(3);
  return {
    key: `surf-${id}-${freq}`,
    apply: (shader) => {
      if (!shader.vertexShader.includes('varying vec3 vSurfPos;')) shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSurfPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfPos = position;');
      if (!shader.fragmentShader.includes('float sHash(')) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COMMON}${HEIGHT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float sh = sHeight(vSurfPos * ${freq}, ${id});
  float sv = sFbm(vSurfPos * ${(L.freq / scale / 5).toFixed(3)});
  float sFade = 1.0 - smoothstep(0.12, 0.5, length(fwidth(vSurfPos * ${freq})));
  diffuseColor.rgb *= 1.0 + (sv - 0.5) * ${(L.tint * 2).toFixed(3)} + (sh - 0.5) * ${(L.tint).toFixed(3)} * sFade;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (sFbm(vSurfPos * ${(L.freq / scale / 3).toFixed(3)}) - 0.5) * ${(L.rough * 2).toFixed(3)}, 0.04, 1.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ float sFadeN = 1.0 - smoothstep(0.12, 0.5, length(fwidth(vSurfPos * ${freq}))); if (sFadeN > 0.01) normal = sPerturb(-vViewPosition, normal, sHeight(vSurfPos * ${freq}, ${id}), ${((L.bump * 0.8) / (L.freq / scale)).toFixed(5)} * sFadeN, faceDirection); }`);
    },
  };
}

/** Puts a surface on a material (remembered in userData, so coat markings can re-install it after a clone). */
export function withSurface<T extends THREE.Material>(m: T, kind: Surface, scale = 1): T {
  const p = surfacePatch(kind, scale);
  m.userData = { ...m.userData, surface: { kind, scale } };
  if (p) installPatches(m, [p]);
  return m;
}
/** The surface patch remembered on a material (for composing with other patches). */
export function rememberedSurface(m: THREE.Material): Patch | null {
  const s = m.userData?.surface as { kind: Surface; scale: number } | undefined;
  return s ? surfacePatch(s.kind, s.scale) : null;
}
