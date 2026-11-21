/**
 * APEX 2.9 – paints a creature's own coat (individual.ts) onto its model: the body colours become the coat colour
 * (keeping light and dark parts apart), markings are drawn in the second coat colour by a small shader in model space
 * (stripes across the body, spots, bands, speckles, a dark saddle), reptiles may get a scale shimmer. Eyes, teeth,
 * horns and glowing parts keep their colours.
 */
import * as THREE from 'three';
import type { Individual, Pattern } from '../../game/individual';

const PATTERN_ID: Record<Pattern, number> = { plain: 0, striped: 1, spotted: 2, banded: 3, speckled: 4, saddled: 5 };
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function patterned(base: THREE.MeshStandardMaterial, colour: THREE.Color, mark: THREE.Color, pattern: Pattern, size: THREE.Vector3, minY: number, shimmer: boolean): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.color.copy(colour);
  if (shimmer) { m.metalness = 0.35; m.roughness = 0.32; }
  const id = PATTERN_ID[pattern];
  if (!id) return m;
  const length = Math.max(size.x, size.z, 0.3);
  const uniforms = { uMark: { value: mark.clone() }, uFreq: { value: (pattern === 'speckled' ? 16 : pattern === 'spotted' ? 7 : pattern === 'banded' ? 2.6 : 5.5) / length }, uMid: { value: minY + size.y * 0.52 }, uSpan: { value: size.y * 0.08 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoatPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoatPos = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCoatPos; uniform vec3 uMark; uniform float uFreq; uniform float uMid; uniform float uSpan;
float coatHash(vec3 c) { return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float coatSpots(vec3 p, float keep, float r) { vec3 c = floor(p); vec3 f = fract(p) - 0.5; return coatHash(c) > keep && length(f) < r ? 1.0 : 0.0; }`).replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vCoatPos * uFreq;
  float mark = 0.0;
  #if ${id} == 1
    mark = step(0.58, fract(p.z + sin(p.y * 1.7) * 0.18));
  #elif ${id} == 2
    mark = coatSpots(p, 0.42, 0.3);
  #elif ${id} == 3
    mark = step(0.5, fract(p.z));
  #elif ${id} == 4
    mark = coatSpots(p, 0.55, 0.26);
  #elif ${id} == 5
    mark = smoothstep(uMid - uSpan, uMid + uSpan, vCoatPos.y);
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, uMark, mark * 0.88);
}`);
  };
  m.customProgramCacheKey = () => `apex-coat-${id}`;
  return m;
}

/** Recolours and marks a creature model in place (materials are cloned – the shared ones stay untouched). */
export function applyCoat(group: THREE.Object3D, ind: Individual): void {
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) meshes.push(m); });
  if (!meshes.length) return;
  // the body colour: the colour covering the most vertices (not glowing, not see-through)
  const weight = new Map<string, number>();
  const body = (m: THREE.Mesh) => { const mat = m.material as THREE.MeshStandardMaterial; return !mat.transparent && !(mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0); };
  for (const m of meshes) if (body(m)) { const k = (m.material as THREE.MeshStandardMaterial).color.getHexString(); weight.set(k, (weight.get(k) ?? 0) + (m.geometry.attributes.position?.count ?? 0)); }
  const main = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!main) return;
  const mainColour = new THREE.Color(`#${main}`);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const done = new Map<THREE.Material, THREE.Material>();
  for (const m of meshes) {
    if (!body(m)) continue;
    const mat = m.material as THREE.MeshStandardMaterial;
    const c = mat.color;
    // parts close to the body colour belong to the coat (legs, head); eyes, claws and horns do not
    const d = Math.hypot(c.r - mainColour.r, c.g - mainColour.g, c.b - mainColour.b);
    if (d > 0.3) continue;
    let next = done.get(mat);
    if (!next) {
      const shade = lum(mainColour) > 0.02 ? Math.max(0.6, Math.min(1.5, lum(c) / lum(mainColour))) : 1;
      if (ind.coat) {
        const colour = new THREE.Color(ind.coat.c).multiplyScalar(shade);
        // a saddle is always a darker back; the other markings use the coat's second colour
        const mark = ind.pattern === 'saddled' ? new THREE.Color(ind.coat.c).multiplyScalar(0.16) : new THREE.Color(ind.coat.c2);
        next = patterned(mat, colour, mark, ind.pattern, size, box.min.y, ind.shimmer);
      } else {
        next = mat.clone();
        (next as THREE.MeshStandardMaterial).color.multiplyScalar(1 + ind.jitter * 0.25);
      }
      done.set(mat, next);
    }
    m.material = next;
  }
}
