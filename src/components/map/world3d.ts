/**
 * 3D world kit for the battle map (APEX 2.0): true-scale figures and the props of every battle tile.
 *
 * Scale: a hex has corner radius 1 (5 ft flat to flat = √3 ≈ 1.73 units), so 1 ft ≈ 0.346 units and one 5-ft
 * level is 1.73 units high. A medium creature is about 6 ft (≈ 2.1 units), a tree 20–25 ft, a wall 10 ft.
 *
 * Figures:
 *  - characters with an uploaded portrait stand as a STANDEE (the portrait in a framed card on a round base, like a
 *    tabletop cardboard miniature; the card turns towards the camera);
 *  - everybody else gets a small procedural MINIATURE by body shape (humanoid, beast, flyer, spider, undead) and
 *    size (tiny … gargantuan), coloured by the creature;
 *  - a compact label (name, life bar, effect icons) floats above each figure.
 */
import * as THREE from 'three';
import type { SceneToken } from './HexSceneMap';
import { beastIcon } from './effectIcons';
import { ancestryScale, buildLowPoly } from './lowpoly';
import { autoLook, FIGURE_PRESETS, hashText, lookFromPreset, type FigureLook } from '../../game/figure';

/** APEX 2.1 – the low-poly look of a figure: chosen, or automatic (heroes by token, humanoid NPCs by kind). */
export function figureLook(tk: SceneToken): FigureLook | null {
  if (tk.vitals?.form) return null; // wild shape: the beast miniature
  const enemy = tk.enemy;
  if (!enemy) {
    if (tk.view?.figure) return tk.view.figure;
    if (tk.view?.portraitV) return null; // an uploaded portrait stays a standee until a figure is built
    const heroes = FIGURE_PRESETS.filter((p) => p.group === 'hero');
    const h = hashText(tk.tokenId);
    const look = lookFromPreset(heroes[h % heroes.length], h);
    return /^#[0-9a-f]{6}$/i.test(tk.color) ? { ...look, primary: tk.color.toLowerCase() } : look;
  }
  if (enemy.look) return enemy.look;
  if (enemy.build && enemy.build !== 'humanoid' && enemy.build !== 'undead') return null;
  return autoLook(`${enemy.breed ?? ''} ${tk.name}`, tk.tokenId, tk.color);
}

export const FT = Math.sqrt(3) / 5;
export const LEVEL = 5 * FT;
const SIZE: Record<string, number> = { tiny: 0.45, small: 0.75, medium: 1, large: 1.9, huge: 2.8, gargantuan: 3.8 };
export const sizeScale = (size?: string) => SIZE[(size ?? 'medium').toLowerCase()] ?? 1;

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) { m = make(); mats.set(key, m); }
  return m;
}
const std = (color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => mat(`std:${new THREE.Color(color).getHexString()}:${JSON.stringify(opts)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

// ---------------------------------------------------------------- figures

export interface FigureParts { group: THREE.Group; card?: THREE.Object3D; wings?: THREE.Object3D[]; label: THREE.Sprite; height: number }

/** A figure: base, standee or miniature, label. `ringColor` marks the side / selection. */
export function buildFigure(tk: SceneToken, ringColor: number): FigureParts {
  const enemy = tk.enemy;
  const scale = enemy ? sizeScale(enemy.size) : 1;
  const down = enemy?.condition === 'down';
  const g = new THREE.Group();
  const baseR = Math.max(0.42, 0.6 * Math.min(scale, 2.6));
  g.add(mesh(new THREE.CylinderGeometry(baseR, baseR * 1.06, 0.12, 32), std(0x1d1a16, { roughness: 0.5 }), 0, 0.06, 0));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(baseR * 1.03, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: ringColor }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
  if (enemy?.elite) { const crown = new THREE.Mesh(new THREE.TorusGeometry(baseR * 1.12, 0.05, 8, 6), std(0xd8b25a, { metalness: 0.7, roughness: 0.3 })); crown.rotation.x = Math.PI / 2; crown.position.y = 0.13; g.add(crown); }
  let card: THREE.Object3D | undefined;
  let wings: THREE.Object3D[] | undefined;
  let height = 2.1 * scale;
  const body = new THREE.Group(); body.position.y = 0.12;
  const look = figureLook(tk);
  if (look) {
    const lp = buildLowPoly(look);
    // enemies: the stat block's size class sets the height (a Small goblin is not shrunk twice)
    const k = enemy?.size ? scale / ancestryScale(look) : scale;
    lp.group.scale.setScalar(k);
    body.add(lp.group);
    height = lp.height * k;
  } else if (!enemy && tk.view?.portraitV && !tk.vitals?.form) {
    card = standee(tk); body.add(card); height = 2.25;
  } else {
    const build = tk.vitals?.form ? (/eagle|hawk|owl|bat|raven|bird/i.test(tk.vitals.form) ? 'flyer' : /spider/i.test(tk.vitals.form) ? 'spider' : 'beast') : enemy?.build ?? 'humanoid';
    const color = new THREE.Color(tk.color);
    const made: { group: THREE.Group; height: number; wings?: THREE.Object3D[] } = build === 'beast' ? beast(color) : build === 'flyer' ? flyer(color) : build === 'spider' ? spider(color) : humanoid(color, build === 'undead', !!enemy && !enemy.ally);
    made.group.scale.setScalar(scale);
    body.add(made.group);
    wings = made.wings;
    height = made.height * scale;
  }
  if (down) { body.rotation.z = Math.PI / 2.2; body.position.y = 0.3 * scale; body.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && 'color' in m && !(o as THREE.Mesh).userData.keep) (o as THREE.Mesh).material = std(new THREE.Color(m.color).multiplyScalar(0.45)); }); }
  g.add(body);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(tk), depthWrite: false, transparent: true }));
  label.scale.set(2.6, 0.65, 1);
  label.position.y = (down ? 0.9 * scale : height) + 0.55;
  label.renderOrder = 5;
  g.add(label);
  if (tk.target) { const tr = new THREE.Mesh(new THREE.TorusGeometry(baseR * 1.3, 0.04, 6, 40), new THREE.MeshBasicMaterial({ color: 0xffd36b })); tr.rotation.x = Math.PI / 2; tr.position.y = 0.14; g.add(tr); }
  return { group: g, card, wings, label, height };
}

/** Cardboard standee: the portrait in a framed card with a printed back. */
function standee(tk: SceneToken): THREE.Object3D {
  const w = 1.25, h = 2.1;
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 430;
  const c = cv.getContext('2d')!;
  const paint = (img?: HTMLImageElement) => {
    c.clearRect(0, 0, 256, 430);
    const r = 26;
    c.beginPath(); c.roundRect(4, 4, 248, 422, r); c.fillStyle = '#e8d4a6'; c.fill();
    c.beginPath(); c.roundRect(12, 12, 232, 406, r - 6); c.fillStyle = tk.color; c.fill();
    if (img) { c.save(); c.beginPath(); c.roundRect(16, 16, 224, 398, r - 8); c.clip(); const sc = Math.max(224 / img.width, 398 / img.height); c.drawImage(img, 128 - (img.width * sc) / 2, 215 - (img.height * sc) / 2, img.width * sc, img.height * sc); c.restore(); }
    else { c.fillStyle = '#14110d'; c.font = 'bold 110px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(tk.view?.initials ?? tk.name.slice(0, 2), 128, 200); }
    const grad = c.createLinearGradient(0, 330, 0, 426); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.65)'); c.fillStyle = grad; c.fillRect(16, 330, 224, 84);
  };
  paint();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  if (tk.view?.portraitV) { const img = new Image(); img.onload = () => { paint(img); tex.needsUpdate = true; }; img.src = `/api/apex?op=portrait&token=${encodeURIComponent(tk.tokenId)}&v=${tk.view.portraitV}`; }
  const card = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 }));
  front.position.y = h / 2 + 0.02; front.castShadow = true; front.userData.keep = true;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, h * 0.99, 0.03), std(0xe8d4a6, { roughness: 0.5 }));
  edge.position.set(0, h / 2 + 0.02, -0.02); edge.userData.keep = true;
  const slot = mesh(new THREE.BoxGeometry(w * 0.7, 0.12, 0.16), std(0x2a241c), 0, 0.06, 0);
  card.add(edge, front, slot);
  card.userData.billboard = true;
  return card;
}

const SKIN = [0xe0b48a, 0xc68e5e, 0x8d5a3a, 0xf0c8a0];
function humanoid(color: THREE.Color, undead: boolean, armed: boolean): { group: THREE.Group; height: number } {
  const g = new THREE.Group();
  const skin = undead ? 0xd8d2bc : SKIN[Math.abs(Math.round(color.r * 7 + color.g * 3)) % SKIN.length];
  const cloth = std(color), dark = std(color.clone().multiplyScalar(0.55)), skinM = std(skin);
  const leg = new THREE.CylinderGeometry(0.085, 0.07, 0.82, 10);
  g.add(mesh(leg, dark, -0.11, 0.41, 0), mesh(leg, dark, 0.11, 0.41, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.74, 14), cloth, 0, 1.18, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.07, 14), std(0x3a2a1a), 0, 0.88, 0));
  g.add(mesh(new THREE.SphereGeometry(0.17, 16, 12), skinM, 0, 1.75, 0));
  const arm = new THREE.CylinderGeometry(0.06, 0.055, 0.68, 8);
  const la = mesh(arm, cloth, -0.32, 1.2, 0); la.rotation.z = 0.18;
  const ra = mesh(arm, cloth, 0.32, 1.2, 0.05); ra.rotation.z = -0.18; ra.rotation.x = -0.35;
  g.add(la, ra);
  if (undead) { g.add(mesh(new THREE.SphereGeometry(0.04, 6, 6), std(0x111111), -0.06, 1.78, 0.15), mesh(new THREE.SphereGeometry(0.04, 6, 6), std(0x111111), 0.06, 1.78, 0.15)); }
  else g.add(mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(color.clone().offsetHSL(0, -0.1, -0.15)), 0, 1.78, 0)); // hair / hood
  if (armed) { const blade = mesh(new THREE.BoxGeometry(0.05, 0.8, 0.02), std(0xc8ccd2, { metalness: 0.8, roughness: 0.25 }), 0.4, 1.25, 0.32); blade.rotation.x = -0.6; g.add(blade); }
  return { group: g, height: 1.95 };
}
function beast(color: THREE.Color): { group: THREE.Group; height: number } {
  const g = new THREE.Group();
  const fur = std(color), dark = std(color.clone().multiplyScalar(0.6));
  const body = mesh(new THREE.CapsuleGeometry(0.28, 0.75, 6, 12), fur, 0, 0.72, 0); body.rotation.z = Math.PI / 2; g.add(body);
  const leg = new THREE.CylinderGeometry(0.07, 0.06, 0.5, 8);
  for (const [x, z] of [[-0.38, -0.16], [-0.38, 0.16], [0.38, -0.16], [0.38, 0.16]]) g.add(mesh(leg, dark, x, 0.25, z));
  g.add(mesh(new THREE.SphereGeometry(0.22, 14, 10), fur, 0.68, 0.95, 0));
  const snout = mesh(new THREE.ConeGeometry(0.11, 0.28, 10), dark, 0.9, 0.9, 0); snout.rotation.z = -Math.PI / 2; g.add(snout);
  for (const z of [-0.1, 0.1]) g.add(mesh(new THREE.ConeGeometry(0.06, 0.16, 6), dark, 0.62, 1.17, z));
  const tail = mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.5, 6), fur, -0.72, 0.85, 0); tail.rotation.z = 0.9; g.add(tail);
  return { group: g, height: 1.2 };
}
function flyer(color: THREE.Color): { group: THREE.Group; height: number; wings: THREE.Object3D[] } {
  const g = new THREE.Group();
  const m = std(color), dark = std(color.clone().multiplyScalar(0.55), { side: THREE.DoubleSide });
  g.add(mesh(new THREE.SphereGeometry(0.26, 14, 10), m, 0, 0.9, 0));
  g.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), m, 0.25, 1.05, 0));
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.9, 0.25), new THREE.Vector2(1.05, -0.05), new THREE.Vector2(0.7, -0.2), new THREE.Vector2(0.35, -0.12)]);
  const wings: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.95, 0.12 * side);
    const w = new THREE.Mesh(new THREE.ShapeGeometry(shape), dark); w.rotation.x = side * Math.PI / 2; w.rotation.z = side > 0 ? 0 : 0; w.scale.set(1, side, 1); w.castShadow = true;
    pivot.add(w); pivot.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; pivot.userData.side = side;
    g.add(pivot); wings.push(pivot);
  }
  return { group: g, height: 1.3, wings };
}
function spider(color: THREE.Color): { group: THREE.Group; height: number } {
  const g = new THREE.Group();
  const m = std(color.clone().multiplyScalar(0.7)), dark = std(0x1a1614);
  g.add(mesh(new THREE.SphereGeometry(0.42, 16, 12), m, -0.35, 0.6, 0));
  g.add(mesh(new THREE.SphereGeometry(0.24, 14, 10), dark, 0.2, 0.55, 0));
  const seg = new THREE.CylinderGeometry(0.035, 0.03, 0.6, 6);
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(0.15 - i * 0.14, 0.58, 0.12 * side);
    const up = mesh(seg, dark, 0, 0.18, 0.22 * side); up.rotation.x = side * 1.0;
    const lo = mesh(seg, dark, 0, -0.15, 0.55 * side); lo.rotation.x = -side * 0.35;
    leg.add(up, lo); leg.rotation.y = (i - 1.5) * 0.35 * side;
    g.add(leg);
  }
  return { group: g, height: 1.0 };
}

/** Compact label: name, life bar, effect icons (wild shape shows the beast icon). */
export function labelTexture(tk: SceneToken): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const enemy = tk.enemy;
  const name = `${tk.vitals?.form ? `${beastIcon(tk.vitals.form)} ` : ''}${tk.name.slice(0, 22)}`;
  g.font = 'bold 34px Inter, sans-serif'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(name, 256, 74); g.fillStyle = enemy ? (enemy.ally ? '#cfe4ff' : '#ffd6d0') : '#f3e4bd'; g.fillText(name, 256, 74);
  const hp = tk.vitals ?? (enemy?.hp !== undefined && enemy.maxHp ? { hp: enemy.hp, maxHp: enemy.maxHp, temp: enemy.tempHp ?? 0 } : null);
  if (hp && hp.maxHp > 0) {
    const w = 220, x = 256 - w / 2, frac = Math.max(0, Math.min(1, hp.hp / hp.maxHp));
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(x - 4, 100, w + 8, 18);
    g.fillStyle = '#3a1414'; g.fillRect(x, 104, w, 10);
    g.fillStyle = frac <= 0.25 ? '#e5484d' : frac <= 0.5 ? '#f59e0b' : '#4ade80'; g.fillRect(x, 104, w * frac, 10);
    if (hp.temp) { g.fillStyle = '#60a5fa'; g.fillRect(x + w * frac, 104, Math.min(w * (1 - frac), (w * hp.temp) / hp.maxHp), 10); }
  }
  const icons = (tk.icons ?? []).slice(0, 6);
  icons.forEach((ic, i) => {
    const x = 256 - ((icons.length - 1) * 40) / 2 + i * 40, y = 26;
    g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fillStyle = '#14110d'; g.fill(); g.lineWidth = 4; g.strokeStyle = ic.tone === 'conc' ? '#b9a8e3' : ic.tone === 'bad' ? '#e5484d' : '#c09b58'; g.stroke();
    g.font = '20px sans-serif'; g.fillStyle = '#fff'; g.fillText(ic.icon, x, y + 1);
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- tile props

/**
 * The 3D prop standing on a hex of the given tile (null = nothing extra). `rnd` gives a stable per-hex random
 * 0..1 for variation; `anim` collects things the render loop moves (crowns, flames, lava).
 */
export function tileProp(id: string, fill: string, rnd: (i: number) => number, anim: { crowns: THREE.Object3D[]; flames: THREE.Object3D[] }): THREE.Object3D | null {
  const g = new THREE.Group();
  const add = (o: THREE.Object3D) => { g.add(o); return o; };
  const bark = std(0x5a3d22, { roughness: 1 }), stone = std(0x8a847a, { roughness: 1, flatShading: true });
  const wood = std(0x8a5f36), darkWood = std(0x5a3d22);
  switch (id) {
    case 'tree': {
      // ~22 ft: a trunk and a broad, lumpy crown that sways
      add(mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 8), bark, 0, 1.6, 0));
      const crown = new THREE.Group(); crown.position.y = 3.0; crown.userData.phase = rnd(1) * 6.28;
      const leafM = std(new THREE.Color(0x2f5a33).offsetHSL((rnd(2) - 0.5) * 0.04, 0, (rnd(3) - 0.5) * 0.1), { flatShading: true });
      for (let i = 0; i < 6; i++) crown.add(mesh(new THREE.IcosahedronGeometry(0.85 + rnd(i + 10) * 0.4, 1), leafM, (rnd(i + 20) - 0.5) * 1.3, 0.9 + rnd(i + 30) * 1.6, (rnd(i + 40) - 0.5) * 1.3));
      add(crown); anim.crowns.push(crown);
      return g;
    }
    case 'pine': {
      add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 2, 8), bark, 0, 1, 0));
      const crown = new THREE.Group(); crown.position.y = 1.4; crown.userData.phase = rnd(1) * 6.28;
      const pm = std(0x1f4a30, { flatShading: true });
      [[1.2, 2.2, 1.0], [0.95, 1.9, 2.3], [0.65, 1.6, 3.5], [0.38, 1.2, 4.5]].forEach(([r, h, y]) => crown.add(mesh(new THREE.ConeGeometry(r, h, 9), pm, 0, y, 0)));
      add(crown); anim.crowns.push(crown);
      return g;
    }
    case 'bush': case 'hedge': {
      const bm = std(new THREE.Color(fill).offsetHSL(0, 0.05, 0.03), { flatShading: true });
      const n = id === 'hedge' ? 7 : 4;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd(i); const r = id === 'hedge' ? 0.55 : 0.4 * rnd(i + 5); add(mesh(new THREE.IcosahedronGeometry(id === 'hedge' ? 0.62 : 0.45 + rnd(i + 9) * 0.2, 1), bm, Math.cos(a) * r, (id === 'hedge' ? 1.0 : 0.45) + rnd(i + 3) * 0.3, Math.sin(a) * r)); }
      return g;
    }
    case 'stump': add(mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 10), bark, 0, 0.25, 0)); add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 10), std(0xb08a5a), 0, 0.51, 0)); return g;
    case 'boulder': { const r = mesh(new THREE.DodecahedronGeometry(0.75, 0), stone, 0, 0.6, 0); r.rotation.set(rnd(1), rnd(2) * 3, rnd(3)); r.scale.set(1, 0.8, 1.1); add(r); return g; }
    case 'rubble': case 'trap': {
      for (let i = 0; i < 7; i++) { const s = 0.12 + rnd(i) * 0.2; const r = mesh(new THREE.DodecahedronGeometry(s, 0), stone, (rnd(i + 10) - 0.5) * 1.3, s * 0.6, (rnd(i + 20) - 0.5) * 1.3); r.rotation.set(rnd(i + 30) * 3, rnd(i + 40) * 3, 0); add(r); }
      if (id === 'trap') for (let i = 0; i < 9; i++) add(mesh(new THREE.ConeGeometry(0.05, 0.35, 5), std(0x9a9890, { metalness: 0.6 }), ((i % 3) - 1) * 0.35, 0.17, (Math.floor(i / 3) - 1) * 0.35));
      return g;
    }
    case 'stalagmite': for (let i = 0; i < 3; i++) add(mesh(new THREE.ConeGeometry(0.3 - i * 0.07, 2.6 - i * 0.7, 7), stone, (rnd(i) - 0.5) * 0.6, (2.6 - i * 0.7) / 2, (rnd(i + 5) - 0.5) * 0.6)); return g;
    case 'palisade': for (let i = -2; i <= 2; i++) { add(mesh(new THREE.CylinderGeometry(0.14, 0.15, 3.0, 7), darkWood, i * 0.33, 1.5, 0)); add(mesh(new THREE.ConeGeometry(0.14, 0.35, 7), darkWood, i * 0.33, 3.15, 0)); } return g;
    case 'fence': for (const x of [-0.75, 0, 0.75]) add(mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), darkWood, x, 0.6, 0)); for (const y of [0.45, 0.95]) add(mesh(new THREE.BoxGeometry(1.7, 0.08, 0.05), wood, 0, y, 0)); return g;
    case 'door': add(mesh(new THREE.BoxGeometry(1.6, 3.4, 0.35), std(0x6a645c), 0, 1.7, 0)); add(mesh(new THREE.BoxGeometry(0.95, 2.4, 0.4), std(0x7a5230), 0, 1.2, 0)); add(mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xd8b25a, { metalness: 0.8 }), 0.32, 1.2, 0.22)); return g;
    case 'pillar': add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.25, 14), stone, 0, 0.12, 0)); add(mesh(new THREE.CylinderGeometry(0.3, 0.33, 3.2, 14), std(0xc8c2b6), 0, 1.85, 0)); add(mesh(new THREE.BoxGeometry(0.85, 0.22, 0.85), stone, 0, 3.55, 0)); return g;
    case 'statue': { add(mesh(new THREE.BoxGeometry(1.0, 0.6, 1.0), stone, 0, 0.3, 0)); const h = humanoid(new THREE.Color(0xb8b2a6), false, true); h.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = std(0xb8b2a6, { roughness: 0.9 }); }); h.group.position.y = 0.6; h.group.scale.setScalar(1.25); add(h.group); return g; }
    case 'stairs': for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(1.5, 0.22 * (i + 1), 0.4), std(0x8d8a83), 0, 0.11 * (i + 1), -0.6 + i * 0.4)); return g;
    case 'table': add(mesh(new THREE.BoxGeometry(1.3, 0.08, 0.8), wood, 0, 1.0, 0)); for (const [x, z] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) add(mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), darkWood, x, 0.5, z)); return g;
    case 'crates': add(mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), std(0xa87a46), -0.25, 0.42, 0)); add(mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), std(0x9a6e3c), 0.45, 0.3, 0.2)); add(mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), std(0xa87a46), -0.2, 1.15, 0.05)); return g;
    case 'barrels': for (const [x, z] of [[-0.35, 0], [0.4, 0.15], [0.05, -0.45]]) { add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.0, 14), std(0x6a4a2a), x, 0.5, z)); add(mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 16), std(0x3a3632, { metalness: 0.6 }), x, 0.75, z).rotateX(Math.PI / 2)); } return g;
    case 'bed': add(mesh(new THREE.BoxGeometry(1.0, 0.45, 1.6), wood, 0, 0.22, 0)); add(mesh(new THREE.BoxGeometry(0.9, 0.12, 1.5), std(0xc8c0a8), 0, 0.5, 0)); add(mesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), std(0xffffff), 0, 0.6, -0.55)); return g;
    case 'altar': add(mesh(new THREE.BoxGeometry(1.4, 1.0, 0.8), std(0x8d8a83), 0, 0.5, 0)); add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.9), std(0xe8d4a6, { metalness: 0.5, roughness: 0.3 }), 0, 1.04, 0)); return g;
    case 'campfire': case 'brazier': {
      if (id === 'campfire') { for (let i = 0; i < 5; i++) { const l = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), darkWood, 0, 0.12, 0); l.rotation.z = Math.PI / 2; l.rotation.y = (i / 5) * Math.PI; add(l); } for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(mesh(new THREE.DodecahedronGeometry(0.12, 0), stone, Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5)); } }
      else { add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.0, 8), std(0x3a3632, { metalness: 0.7 }), 0, 0.5, 0)); add(mesh(new THREE.CylinderGeometry(0.4, 0.2, 0.25, 12), std(0x3a3632, { metalness: 0.7 }), 0, 1.1, 0)); }
      const flame = new THREE.Group(); flame.position.y = id === 'campfire' ? 0.25 : 1.2;
      flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 })).translateY(0.4));
      flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 8), new THREE.MeshBasicMaterial({ color: 0xffe08a })).translateY(0.3));
      add(flame); anim.flames.push(flame);
      return g;
    }
    case 'mushrooms': for (let i = 0; i < 6; i++) { const x = (rnd(i) - 0.5) * 1.2, z = (rnd(i + 7) - 0.5) * 1.2, s = 0.5 + rnd(i + 3) * 0.7; add(mesh(new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.25 * s, 6), std(0xd8d2c6), x, 0.12 * s, z)); add(mesh(new THREE.SphereGeometry(0.12 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x7ae0d0, { emissive: 0x2a9a8a, emissiveIntensity: 1.2 }), x, 0.25 * s, z)); } return g;
    case 'swampwater': for (let i = 0; i < 10; i++) add(mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.6 + rnd(i) * 0.6, 4), std(0x6a7a3a), (rnd(i + 3) - 0.5) * 1.4, 0.3, (rnd(i + 9) - 0.5) * 1.4)); return g;
    case 'bridge': for (let i = -3; i <= 3; i++) add(mesh(new THREE.BoxGeometry(0.22, 0.08, 1.5), std(0x9a6a3c), i * 0.25, 0.04, 0)); return g;
    case 'web': { const w = new THREE.Mesh(new THREE.CircleGeometry(0.9, 8), new THREE.MeshBasicMaterial({ map: webTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false })); w.position.y = 0.9; w.rotation.y = rnd(1) * 3; add(w); return g; }
    case 'circle': { const r = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 6, 40), new THREE.MeshBasicMaterial({ color: 0xc8a0ff })); r.rotation.x = Math.PI / 2; r.position.y = 0.03; add(r); const r2 = r.clone(); r2.scale.setScalar(0.6); add(r2); anim.flames.push(r); return g; }
    case 'sand': for (let i = 0; i < 4; i++) { const d = mesh(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(new THREE.Color(fill).offsetHSL(0, 0, (rnd(i) - 0.5) * 0.06)), (rnd(i + 1) - 0.5) * 1.1, 0, (rnd(i + 2) - 0.5) * 1.1); d.scale.set(1, 0.18, 0.6); d.rotation.y = rnd(i + 5) * 3; add(d); } return g;
    case 'snow': for (let i = 0; i < 3; i++) { const d = mesh(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf4f8fb), (rnd(i + 1) - 0.5) * 0.9, 0, (rnd(i + 2) - 0.5) * 0.9); d.scale.set(1, 0.3, 1); add(d); } return g;
    case 'cavewall': case 'wall': return null; // walls are columns (see HexScene3D)
    default: return null;
  }
}

let webTex: THREE.Texture | null = null;
function webTexture(): THREE.Texture {
  if (webTex) return webTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.strokeStyle = 'rgba(240,240,240,0.8)'; g.lineWidth = 2;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 126, 128 + Math.sin(a) * 126); g.stroke(); }
  for (let r = 18; r < 128; r += 18) { g.beginPath(); for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
  webTex = new THREE.CanvasTexture(cv);
  return webTex;
}

// ---------------------------------------------------------------- surface textures

const texCache = new Map<string, THREE.Texture>();
/** Texture family of a tile's top surface. */
export const surfaceOf = (id: string): string => (['stone', 'cavefloor'].includes(id) ? 'flag' : ['wood', 'bridge'].includes(id) ? 'planks' : id === 'cobbles' ? 'cobbles' : id === 'marble' ? 'marble' : id === 'carpet' ? 'carpet' : ['sand', 'snow', 'ice'].includes(id) ? 'smooth' : ['dirt', 'mud', 'rubble'].includes(id) ? 'earth' : 'grass');
export function surfaceTexture(kind: string): THREE.Texture {
  const hit = texCache.get(kind);
  if (hit) return hit;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  let s = kind.length * 977 + 13;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, 256, 256);
  const speckle = (n: number, a: number) => { for (let i = 0; i < n; i++) { const v = 170 + Math.floor(rnd() * 85); g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3); } };
  if (kind === 'flag') {
    for (let y = 0; y < 256; y += 64) for (let x = (y / 64) % 2 ? -32 : 0; x < 256; x += 64) { const v = 205 + Math.floor(rnd() * 40); g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(x + 3, y + 3, 58, 58); }
    g.strokeStyle = 'rgba(70,70,70,0.6)'; g.lineWidth = 3; for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    speckle(900, 0.4);
  } else if (kind === 'planks') {
    for (let x = 0; x < 256; x += 32) { const v = 190 + Math.floor(rnd() * 50); g.fillStyle = `rgb(${v},${v - 10},${v - 25})`; g.fillRect(x + 1, 0, 30, 256); g.fillStyle = 'rgba(60,40,20,0.5)'; g.fillRect(x, 0, 2, 256); g.fillRect(x, Math.floor(rnd() * 256), 32, 2); }
    for (let i = 0; i < 120; i++) { g.strokeStyle = `rgba(90,60,30,${0.15 + rnd() * 0.15})`; g.beginPath(); const x = rnd() * 256; g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 6, 256); g.stroke(); }
  } else if (kind === 'cobbles') {
    for (let i = 0; i < 70; i++) { const v = 190 + Math.floor(rnd() * 55); g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 14 + rnd() * 8, 11 + rnd() * 6, rnd() * 3, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(60,60,60,0.55)'; g.lineWidth = 2.5; g.stroke(); }
  } else if (kind === 'marble') {
    g.fillStyle = '#fafafa'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(150,150,160,${0.2 + rnd() * 0.3})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); let x = rnd() * 256, y = 0; g.moveTo(x, y); while (y < 256) { x += (rnd() - 0.5) * 30; y += 12; g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = 'rgba(120,120,120,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, 127, 127); g.strokeRect(128, 128, 127, 127); g.strokeRect(128, 1, 127, 127); g.strokeRect(1, 128, 127, 127);
  } else if (kind === 'carpet') {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(232,212,166,0.9)'; g.lineWidth = 10; g.strokeRect(14, 14, 228, 228);
    g.strokeStyle = 'rgba(232,212,166,0.6)'; g.lineWidth = 4; g.strokeRect(36, 36, 184, 184);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; g.fillRect(rnd() * 256, rnd() * 256, 1, 1); }
  } else if (kind === 'smooth') {
    for (let y = 0; y < 256; y += 9) { g.strokeStyle = `rgba(150,150,150,${0.1 + rnd() * 0.12})`; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3); g.stroke(); }
    speckle(500, 0.25);
  } else if (kind === 'earth') {
    speckle(3500, 0.5);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,100,90,${0.15 + rnd() * 0.25})`; g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 0, Math.PI * 2); g.fill(); }
  } else {
    speckle(2600, 0.45);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(120,120,120,${0.08 + rnd() * 0.1})`; g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 4 + rnd() * 14, 0, Math.PI * 2); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.5, 0.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(kind, tex);
  return tex;
}
