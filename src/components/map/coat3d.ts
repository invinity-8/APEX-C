/**
 * APEX 2.9 – paints a creature's own coat (individual.ts) onto its model: the body colours become the coat colour
 * (keeping light and dark parts apart), markings are drawn in the second coat colour by a small shader in model space
 * (stripes across the body, spots, bands, speckles, a dark saddle), reptiles may get a scale shimmer. Eyes, teeth,
 * horns and glowing parts keep their colours.
 */
import * as THREE from 'three';
import type { Individual, Pattern } from '../../game/individual';

/** APEX 2.10: species-only markings on top of the individual ones – tiger stripes, zebra stripes, a giraffe's net
 * of patches and a cow's blotches. */
export type Marking = Pattern | 'tiger' | 'zebra' | 'net' | 'blotch';
const PATTERN_ID: Record<Marking, number> = { plain: 0, striped: 1, spotted: 2, banded: 3, speckled: 4, saddled: 5, tiger: 6, zebra: 7, net: 8, blotch: 9 };
const FREQ: Partial<Record<Marking, number>> = { speckled: 16, spotted: 7, banded: 2.6, striped: 6, tiger: 11, zebra: 10, net: 6, blotch: 2.4 };
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function patterned(base: THREE.MeshStandardMaterial, colour: THREE.Color, mark: THREE.Color, pattern: Marking, size: THREE.Vector3, minY: number, shimmer: boolean): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.color.copy(colour);
  if (shimmer) { m.metalness = 0.35; m.roughness = 0.32; }
  const id = PATTERN_ID[pattern];
  if (!id) return m;
  const length = Math.max(size.x, size.z, 0.3);
  const uniforms = { uMark: { value: mark.clone() }, uFreq: { value: (FREQ[pattern] ?? 5.5) / length }, uMid: { value: minY + size.y * 0.52 }, uSpan: { value: size.y * 0.08 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoatPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoatPos = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCoatPos; uniform vec3 uMark; uniform float uFreq; uniform float uMid; uniform float uSpan;
float coatHash(vec3 c) { return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float coatSpots(vec3 p, float keep, float r) { vec3 c = floor(p); vec3 f = fract(p) - 0.5; return coatHash(c) > keep && length(f) < r ? 1.0 : 0.0; }
vec2 coatCells(vec3 p) { vec3 c = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) { vec3 o = vec3(float(i), float(j), float(k)); vec3 r = o + vec3(coatHash(c + o), coatHash(c + o + 17.1), coatHash(c + o + 31.7)) * 0.8 - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; id = coatHash(c + o + 5.3); } else if (d < d2) d2 = d; }
  return vec2(sqrt(d2) - sqrt(d1), id); }`).replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vCoatPos * uFreq;
  float mark = 0.0;
  #if ${id} == 1
    mark = step(0.64, fract(p.z + sin(p.y * 1.7 + p.x * 0.9) * 0.18));
  #elif ${id} == 2
    mark = coatSpots(p, 0.42, 0.3);
  #elif ${id} == 3
    mark = step(0.5, fract(p.z));
  #elif ${id} == 4
    mark = coatSpots(p, 0.55, 0.26);
  #elif ${id} == 5
    mark = smoothstep(uMid - uSpan, uMid + uSpan, vCoatPos.y);
  #elif ${id} == 6
    mark = step(0.76, fract(p.z + sin(p.y * 2.1 + p.x * 1.6) * 0.2 + sin(p.z * 0.6 + p.x * 0.7) * 0.2)) * smoothstep(uMid - uSpan * 5.0, uMid - uSpan * 2.0, vCoatPos.y);
  #elif ${id} == 7
    mark = step(0.5, fract(p.z + sin(p.y * 2.2) * 0.2 + abs(p.x) * 0.15));
  #elif ${id} == 8
    mark = step(0.09, coatCells(p).x);
  #elif ${id} == 9
    { vec2 cc = coatCells(p + vec3(sin(p.y * 2.0) * 0.2)); mark = cc.y > 0.55 && cc.x > 0.06 ? 1.0 : 0.0; }
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, uMark, mark * 0.88);
}`);
  };
  m.customProgramCacheKey = () => `apex-coat-${id}`;
  m.userData = { ...m.userData, marking: undefined };
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
      // APEX 2.10: a species marking (tiger stripes, cow blotches …) stays – in the individual's colours
      const marking = mat.userData.marking as { kind: Marking; mark: string } | undefined;
      if (ind.coat) {
        const colour = new THREE.Color(ind.coat.c).multiplyScalar(shade);
        // a saddle is always a darker back; the other markings use the coat's second colour
        const mark = ind.pattern === 'saddled' ? new THREE.Color(ind.coat.c).multiplyScalar(0.16) : new THREE.Color(ind.coat.c2);
        next = marking ? patterned(mat, colour, mark, marking.kind, size, box.min.y, ind.shimmer) : patterned(mat, colour, mark, ind.pattern, size, box.min.y, ind.shimmer);
      } else if (marking) {
        next = patterned(mat, mat.color.clone().multiplyScalar(1 + ind.jitter * 0.25), new THREE.Color(marking.mark), marking.kind, size, box.min.y, false);
      } else {
        next = mat.clone();
        (next as THREE.MeshStandardMaterial).color.multiplyScalar(1 + ind.jitter * 0.25);
      }
      done.set(mat, next);
    }
    m.material = next;
  }
}
