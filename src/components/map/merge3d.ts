/** Merging helper for the low-poly kits: one mesh (one draw call) per material. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merges all meshes of a group per material (one draw call per material); keeps transforms baked. */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh || Array.isArray(mm.material)) return;
    const geo = (mm.geometry.index ? mm.geometry.toNonIndexed() : mm.geometry.clone()).applyMatrix4(mm.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    buckets.set(mm.material, [...(buckets.get(mm.material) ?? []), geo]);
    mm.geometry.dispose();
  });
  const out = new THREE.Group();
  for (const [material, list] of buckets) {
    const merged = mergeGeometries(list, false);
    list.forEach((x) => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
