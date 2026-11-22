/**
 * APEX 2.11 – weapons, shields and things held in the off hand, for the "Rome meets magic" figures: gladius, spatha,
 * pugio, hasta, scutum and parma next to axes, maces, staves with crystals, wands, bows, lanterns and holy symbols.
 * Weapons are modelled along +y with the grip at the origin; `grip` slides them in the hand, `tilt` angles them
 * forward. Off-hand things sit in front of the left hand.
 */
import * as THREE from 'three';
import type { FigureLook } from '../../game/figure';
import { blob, claw, horn, part, skin, tube, type V3 } from './kit3d';

export interface GearMats { metal: THREE.Material; metalD: THREE.Material; leather: THREE.Material; leatherD: THREE.Material; prim: THREE.Material; sec: THREE.Material; gold: THREE.Material; wood: THREE.Material; glow: THREE.Material; flame: THREE.Material; bone: THREE.Material; dark: THREE.Material }

/** A flat blade along +y from `y0`, `len` long, `w` wide; `leaf` swells it in the middle (gladius, pugio, spear). */
function blade(o: THREE.Object3D, m: GearMats, y0: number, len: number, w: number, leaf = 0, curve = 0): void {
  const pts: V3[] = [0, 0.33, 0.66, 1].map((t) => [Math.sin(t * Math.PI * 0.5) * curve * len, y0 + t * len, 0]);
  tube(o, pts, (t) => [w * (1 + leaf * Math.sin(Math.PI * Math.min(1, t * 1.25)) - 0.15 * t) * (t > 0.85 ? (1 - t) / 0.15 * 0.95 + 0.05 : 1), 0.009], m.metal, { sides: 8, steps: 18 });
  // the fuller: a darker groove down the middle
  tube(o, [[pts[0][0], y0 + len * 0.05, 0.007], [pts[2][0], y0 + len * 0.7, 0.007]], () => [w * 0.18, 0.002], m.metalD, { sides: 6, steps: 6 });
}
function grip(o: THREE.Object3D, m: GearMats, len = 0.13, r = 0.018): void {
  tube(o, [[0, -len / 2, 0], [0, len / 2, 0]], (t) => r * (1 + 0.15 * Math.sin(t * Math.PI * 6)), m.leatherD, { sides: 8, steps: 12 });
}
function haft(o: THREE.Object3D, m: GearMats, len: number, r = 0.022, from = -0.12): void {
  tube(o, [[0, from, 0], [0.005, from + len * 0.5, 0], [0, from + len, 0]], () => r, m.wood, { sides: 8, steps: 10 });
}

export function weaponModel(id: FigureLook['main'], m: GearMats): { obj: THREE.Group; grip: number; tilt: number } | null {
  const o = new THREE.Group();
  const sword = (len: number, w: number, leaf: number, guard: number, pommel = 0.03) => {
    grip(o, m); blade(o, m, 0.09, len, w, leaf);
    tube(o, [[-guard, 0.075, 0], [0, 0.08, 0], [guard, 0.075, 0]], () => [0.018, 0.024], m.metalD, { sides: 8 });
    blob(o, [pommel, pommel * 0.8, pommel], m.gold, [0, -0.085, 0]);
  };
  switch (id) {
    case 'none': return null;
    case 'sword': sword(0.5, 0.032, 0.18, 0.05, 0.034); return { obj: o, grip: 0, tilt: 0.95 }; // gladius
    case 'longsword': sword(0.72, 0.028, 0.05, 0.07); return { obj: o, grip: 0, tilt: 0.9 }; // spatha
    case 'greatsword': grip(o, m, 0.26); blade(o, m, 0.16, 0.98, 0.04, 0.05); tube(o, [[-0.15, 0.14, 0], [0, 0.15, 0], [0.15, 0.14, 0]], () => [0.018, 0.022], m.metalD, { sides: 8 }); blob(o, [0.04, 0.035, 0.04], m.metalD, [0, -0.15, 0]); return { obj: o, grip: 0, tilt: 0.65 };
    case 'dagger': grip(o, m, 0.1, 0.016); blade(o, m, 0.06, 0.22, 0.026, 0.35); tube(o, [[-0.04, 0.055, 0], [0.04, 0.055, 0]], () => 0.012, m.gold, { sides: 6 }); return { obj: o, grip: 0, tilt: 1.2 };
    case 'scimitar': grip(o, m); blade(o, m, 0.09, 0.6, 0.032, 0.25, 0.12); tube(o, [[-0.05, 0.08, 0], [0.05, 0.08, 0]], () => 0.013, m.gold, { sides: 6 }); return { obj: o, grip: 0, tilt: 0.95 };
    case 'axe': haft(o, m, 0.8); tube(o, [[0, 0.5, 0], [0.12, 0.47, 0], [0.18, 0.4, 0], [0.19, 0.6, 0]], (t) => [0.03 + t * 0.06, 0.012 - t * 0.008], m.metal, { sides: 6, steps: 12 }); return { obj: o, grip: 0, tilt: 0.85 };
    case 'greataxe': haft(o, m, 1.2, 0.026); for (const sx of [-1, 1]) tube(o, [[0, 0.9, 0], [sx * 0.16, 0.86, 0], [sx * 0.24, 0.72, 0], [sx * 0.25, 1.08, 0]], (t) => [0.04 + t * 0.09, 0.014 - t * 0.009], m.metal, { sides: 6, steps: 12 }); return { obj: o, grip: 0.1, tilt: 0.55 };
    case 'mace': haft(o, m, 0.6, 0.02); blob(o, [0.05, 0.07, 0.05], m.metalD, [0, 0.45, 0]); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; tube(o, [[0, 0.38, 0], [Math.cos(a) * 0.075, 0.43, Math.sin(a) * 0.075], [0, 0.52, 0]], () => [0.01, 0.03], m.metal, { sides: 5, steps: 6, up: [Math.cos(a), 0, Math.sin(a)] }); } return { obj: o, grip: 0, tilt: 0.85 };
    case 'hammer': haft(o, m, 0.6, 0.02); tube(o, [[-0.09, 0.47, 0], [0.09, 0.47, 0]], () => [0.045, 0.045], m.metal, { sides: 8 }); return { obj: o, grip: 0, tilt: 0.85 };
    case 'warhammer': haft(o, m, 1.0, 0.026); tube(o, [[-0.05, 0.82, 0], [0.13, 0.82, 0]], () => [0.06, 0.06], m.metal, { sides: 8 }); claw(o, [-0.05, 0.82, 0], [-1, 0.1, 0], 0.2, 0.035, m.metalD, 0.4); return { obj: o, grip: 0, tilt: 0.6 };
    case 'club': tube(o, [[0, -0.1, 0], [0.01, 0.25, 0], [0, 0.55, 0]], (t) => 0.022 + t * t * 0.05, m.wood, { sides: 9 }); for (let i = 0; i < 5; i++) blob(o, [0.018, 0.018, 0.018], m.wood, [Math.cos(i * 2.4) * 0.055, 0.38 + i * 0.03, Math.sin(i * 2.4) * 0.055]); return { obj: o, grip: 0, tilt: 0.85 };
    case 'spear': haft(o, m, 1.75, 0.02, -0.6); blade(o, m, 1.12, 0.26, 0.03, 0.5); tube(o, [[0, 1.08, 0], [0, 1.16, 0]], () => 0.026, m.metalD, { sides: 8 }); claw(o, [0, -0.6, 0], [0, -1, 0], 0.08, 0.02, m.metalD, 0); return { obj: o, grip: 0.0, tilt: 0.6 }; // hasta
    case 'halberd': haft(o, m, 1.85, 0.022, -0.6); blade(o, m, 1.2, 0.2, 0.025, 0.2); tube(o, [[0, 1.0, 0], [0.12, 1.03, 0], [0.2, 0.95, 0], [0.2, 1.14, 0]], (t) => [0.03 + t * 0.06, 0.01], m.metal, { sides: 6, steps: 10 }); claw(o, [0, 1.05, 0], [-1, 0.2, 0], 0.15, 0.025, m.metalD, 0.6); return { obj: o, grip: 0, tilt: 0.55 };
    case 'trident': haft(o, m, 1.65, 0.02, -0.5); tube(o, [[-0.09, 1.12, 0], [0, 1.08, 0], [0.09, 1.12, 0]], () => 0.015, m.metal, { sides: 6 }); for (const x of [-0.09, 0, 0.09]) claw(o, [x, 1.11, 0], [x * 0.5, 1, 0], 0.22, 0.016, m.metal, 0); return { obj: o, grip: 0, tilt: 0.6 };
    case 'staff': {
      // gnarled wood ending in claws that hold a glowing crystal
      const pts: V3[] = Array.from({ length: 7 }, (_, i) => [Math.sin(i * 1.7) * 0.012, -0.55 + i * 0.32, Math.cos(i * 2.3) * 0.01]);
      tube(o, pts, (t) => 0.024 - t * 0.006 + 0.004 * Math.sin(t * 30), m.wood, { sides: 8, steps: 30 });
      const top: V3 = [0, 1.42, 0];
      part(o, new THREE.OctahedronGeometry(0.06, 0), m.glow, top, [0, 0.4, 0], [0.8, 1.3, 0.8]);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; horn(o, [Math.cos(a) * 0.02, 1.33, Math.sin(a) * 0.02], [Math.cos(a), 1.1, Math.sin(a)], 0.14, 0.012, m.wood, { curl: -1.2, axis: [Math.sin(a), 0, -Math.cos(a)] }); }
      return { obj: o, grip: 0, tilt: 0.55 };
    }
    case 'wand': tube(o, [[0, -0.08, 0], [0, 0.26, 0]], (t) => 0.014 - t * 0.007, m.wood, { sides: 7 }); blob(o, [0.018, 0.018, 0.018], m.gold, [0, -0.08, 0]); blob(o, [0.022, 0.03, 0.022], m.glow, [0, 0.28, 0]); return { obj: o, grip: 0, tilt: 1.2 };
    case 'bow': {
      const limbPts: V3[] = [[0.02, -0.62, -0.06], [-0.06, -0.35, 0], [-0.07, 0, 0.02], [-0.06, 0.35, 0], [0.02, 0.62, -0.06]];
      tube(o, limbPts, (t) => 0.02 - Math.abs(t - 0.5) * 0.022, m.wood, { sides: 7, steps: 24 });
      tube(o, [[0.02, -0.61, -0.06], [0.12, 0, -0.06], [0.02, 0.61, -0.06]], () => 0.003, m.sec, { sides: 4, steps: 4, linear: true });
      grip(o, m, 0.12, 0.024);
      return { obj: o, grip: 0, tilt: 0.25 };
    }
    case 'crossbow': tube(o, [[0, -0.2, 0], [0, 0.45, 0]], () => [0.03, 0.035], m.wood, { sides: 8 }); tube(o, [[-0.3, 0.38, -0.02], [0, 0.44, 0.02], [0.3, 0.38, -0.02]], () => [0.02, 0.012], m.wood, { sides: 6 }); tube(o, [[-0.29, 0.38, -0.02], [0, 0.3, 0], [0.29, 0.38, -0.02]], () => 0.003, m.sec, { sides: 4, steps: 4, linear: true }); return { obj: o, grip: 0, tilt: 1.45 };
    case 'torch': tube(o, [[0, -0.12, 0], [0, 0.34, 0]], (t) => 0.02 + t * 0.012, m.wood, { sides: 7 }); tube(o, [[0, 0.3, 0], [0, 0.36, 0]], () => 0.036, m.leatherD, { sides: 8 }); for (let i = 0; i < 4; i++) claw(o, [Math.cos(i * 1.6) * 0.015, 0.36, Math.sin(i * 1.6) * 0.015], [Math.cos(i * 1.6) * 0.2, 1, Math.sin(i * 1.6) * 0.2], 0.14 + (i % 2) * 0.05, 0.03, m.flame, -0.2); return { obj: o, grip: 0, tilt: 0.5 };
    case 'pick': haft(o, m, 0.75); tube(o, [[-0.2, 0.52, 0], [0, 0.58, 0], [0.2, 0.52, 0]], (t) => 0.024 * (1 - Math.abs(t - 0.5) * 1.6), m.metal, { sides: 6 }); return { obj: o, grip: 0, tilt: 0.75 };
    case 'scythe': haft(o, m, 1.65, 0.02, -0.5); tube(o, [[0, 1.12, 0], [-0.2, 1.16, 0], [-0.45, 1.05, 0], [-0.6, 0.88, 0]], (t) => [0.05 * (1 - t) + 0.004, 0.008], m.metal, { sides: 6, steps: 16 }); return { obj: o, grip: 0.5, tilt: 0.55 };
    case 'flail': grip(o, m, 0.3); for (let i = 0; i < 4; i++) part(o, new THREE.TorusGeometry(0.018, 0.005, 5, 8), m.metalD, [0.02 * i, 0.18 + i * 0.04, 0], [0, i * 1.57, 0]); blob(o, [0.06, 0.06, 0.06], m.metal, [0.1, 0.38, 0]); for (let i = 0; i < 7; i++) { const a = i * 2.39996, d: V3 = [Math.cos(a) * 0.7, Math.sin(a * 1.3) * 0.7, Math.sin(a) * 0.7]; claw(o, [0.1 + d[0] * 0.055, 0.38 + d[1] * 0.055, d[2] * 0.055], d, 0.04, 0.012, m.metalD, 0); } return { obj: o, grip: 0, tilt: 0.95 };
    case 'lute': blob(o, [0.16, 0.2, 0.07], m.wood, [0, 0, 0]); tube(o, [[0, 0.15, 0.02], [0, 0.58, 0.02]], () => [0.025, 0.012], m.leatherD, { sides: 6 }); blob(o, [0.035, 0.03, 0.02], m.dark, [0, 0.02, 0.06]); return { obj: o, grip: 0, tilt: 1.2 };
    case 'sickle': grip(o, m, 0.14); tube(o, [[0, 0.07, 0], [0.12, 0.17, 0], [0.13, 0.33, 0], [0.02, 0.4, 0]], (t) => [0.03 * (1 - t) + 0.004, 0.006], m.metal, { sides: 6, steps: 14 }); return { obj: o, grip: 0, tilt: 1.0 };
    case 'whip': grip(o, m, 0.2, 0.016); tube(o, [[0, 0.1, 0], [0.1, 0.22, 0.02], [0.2, 0.15, 0.05], [0.18, 0.02, 0.1], [0.08, 0.0, 0.14]], (t) => 0.012 * (1 - t * 0.7), m.leather, { sides: 5, steps: 24 }); return { obj: o, grip: 0, tilt: 1.3 };
  }
  return null;
}

/** A curved shield surface: part of a cylinder (`arc` radians, radius `r`), `w` wide and `h` tall, facing +z. */
function curvedPanel(arc: number, r: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 18, 1, true, Math.PI - arc / 2 + Math.PI, arc);
  g.translate(0, 0, -r);
  return g;
}

export function offModel(id: FigureLook['off'], m: GearMats): THREE.Object3D | null {
  const o = new THREE.Group();
  switch (id) {
    case 'none': return null;
    case 'towershield': {
      // scutum: a tall curved board, metal rim, a boss and painted wings and lightning
      const s = new THREE.Group();
      const arc = 1.25, R = 0.42, H = 0.98;
      part(s, curvedPanel(arc, R, H), m.prim);
      part(s, curvedPanel(arc, R - 0.025, H), m.leatherD);
      const edge = (y: number) => Array.from({ length: 9 }, (_, i) => { const a = -arc / 2 + (i / 8) * arc; return [Math.sin(a) * R, y, Math.cos(a) * R - R] as V3; });
      tube(s, edge(H / 2), () => 0.014, m.metalD, { sides: 6, steps: 24 }); tube(s, edge(-H / 2), () => 0.014, m.metalD, { sides: 6, steps: 24 });
      for (const a of [-arc / 2, arc / 2]) tube(s, [[Math.sin(a) * R, -H / 2, Math.cos(a) * R - R], [Math.sin(a) * R, H / 2, Math.cos(a) * R - R]], () => 0.014, m.metalD, { sides: 6 });
      blob(s, [0.085, 0.085, 0.05], m.gold, [0, 0, 0.02]);
      for (const sx of [-1, 1]) { tube(s, [[sx * 0.07, 0.02, 0.012], [sx * 0.17, 0.12, 0.0], [sx * 0.24, 0.3, -0.03]], (t) => [0.03 * (1 - t) + 0.01, 0.004], m.sec, { sides: 6 }); tube(s, [[sx * 0.06, -0.05, 0.012], [sx * 0.12, -0.18, 0.0], [sx * 0.08, -0.3, 0.0], [sx * 0.16, -0.42, -0.01]], () => [0.012, 0.004], m.gold, { sides: 5, linear: true }); }
      s.rotation.set(0.12, 0.15, 0); s.position.set(-0.04, 0.04, 0.16);
      o.add(s); return o;
    }
    case 'roundshield': {
      const s = new THREE.Group();
      const prof = [new THREE.Vector2(0, 0.06), new THREE.Vector2(0.18, 0.045), new THREE.Vector2(0.3, 0.012), new THREE.Vector2(0.32, 0)];
      part(s, new THREE.LatheGeometry(prof, 28), m.prim, [0, 0, 0], [-Math.PI / 2, 0, 0]);
      part(s, new THREE.TorusGeometry(0.32, 0.016, 6, 32), m.metalD);
      part(s, new THREE.TorusGeometry(0.2, 0.008, 5, 28), m.sec, [0, 0, 0.042]);
      blob(s, [0.075, 0.075, 0.05], m.gold, [0, 0, 0.055]);
      s.rotation.set(0.12, 0.2, 0); s.position.set(-0.05, 0.04, 0.14);
      o.add(s); return o;
    }
    case 'kiteshield': {
      const s = new THREE.Group();
      const shp = new THREE.Shape(); shp.moveTo(-0.26, 0.3); shp.quadraticCurveTo(0, 0.36, 0.26, 0.3); shp.quadraticCurveTo(0.27, 0.0, 0, -0.5); shp.quadraticCurveTo(-0.27, 0.0, -0.26, 0.3);
      part(s, new THREE.ExtrudeGeometry(shp, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 12 }), m.prim, [0, 0, -0.015]);
      tube(s, [[0, 0.3, 0.03], [0, -0.42, 0.03]], () => [0.035, 0.006], m.sec, { sides: 6 }); tube(s, [[-0.2, 0.12, 0.03], [0.2, 0.12, 0.03]], () => [0.035, 0.006], m.sec, { sides: 6 });
      s.rotation.set(0.12, 0.15, 0); s.position.set(-0.06, 0.04, 0.14);
      o.add(s); return o;
    }
    case 'buckler': { const s = new THREE.Group(); part(s, new THREE.LatheGeometry([new THREE.Vector2(0, 0.04), new THREE.Vector2(0.12, 0.025), new THREE.Vector2(0.17, 0)], 20), m.metal, [0, 0, 0], [-Math.PI / 2, 0, 0]); blob(s, [0.04, 0.04, 0.03], m.gold, [0, 0, 0.04]); s.position.set(-0.03, 0.02, 0.1); o.add(s); return o; }
    case 'dagger': { const w = weaponModel('dagger', m)!; w.obj.rotation.x = 1.2; o.add(w.obj); return o; }
    case 'handaxe': { const w = weaponModel('axe', m)!; w.obj.scale.setScalar(0.65); w.obj.rotation.x = 0.9; o.add(w.obj); return o; }
    case 'book': { const b = new THREE.Group(); part(b, new THREE.BoxGeometry(0.2, 0.26, 0.06), m.leather); part(b, new THREE.BoxGeometry(0.185, 0.245, 0.062), skin('#e8dcc0', { surface: 'cloth' }), [0.01, 0, 0]); blob(b, [0.03, 0.03, 0.012], m.gold, [0, 0, 0.034]); b.rotation.set(0.35, 0.3, 0); b.position.set(0, 0.0, 0.09); o.add(b); return o; }
    case 'lantern': { part(o, new THREE.TorusGeometry(0.035, 0.006, 5, 10, Math.PI), m.metalD, [0, -0.04, 0]); part(o, new THREE.CylinderGeometry(0.05, 0.06, 0.13, 6), m.metalD, [0, -0.15, 0]); blob(o, [0.04, 0.05, 0.04], m.flame, [0, -0.15, 0]); part(o, new THREE.ConeGeometry(0.07, 0.06, 6), m.metalD, [0, -0.06, 0]); return o; }
    case 'orb': { blob(o, [0.085, 0.085, 0.085], m.glow, [0, 0.1, 0.06], undefined, 1.4); for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; horn(o, [Math.cos(a) * 0.03, 0.0, 0.06 + Math.sin(a) * 0.03], [Math.cos(a), 1.2, Math.sin(a)], 0.12, 0.008, m.gold, { curl: -1.4, axis: [Math.sin(a), 0, -Math.cos(a)] }); } return o; }
    case 'torch': { const w = weaponModel('torch', m)!; w.obj.rotation.x = 0.4; o.add(w.obj); return o; }
    case 'holy': { const d = new THREE.Group(); part(d, new THREE.CylinderGeometry(0.09, 0.09, 0.02, 24), m.gold, [0, 0, 0], [Math.PI / 2, 0, 0]); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; claw(d, [Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0], [Math.cos(a), Math.sin(a), 0], 0.07 + (i % 2) * 0.04, 0.014, m.gold, 0); } d.rotation.set(0.3, 0, 0); d.position.set(0, 0.12, 0.08); o.add(d); return o; }
    case 'potion': { blob(o, [0.065, 0.07, 0.065], skin('#c97fff', { glow: 0.9, opacity: 0.85 }), [0, 0.07, 0.04]); tube(o, [[0, 0.12, 0.04], [0, 0.2, 0.04]], () => 0.02, skin('#d8e0e8', { opacity: 0.7 }), { sides: 8 }); blob(o, [0.022, 0.02, 0.022], m.wood, [0, 0.21, 0.04]); return o; }
    case 'skull': { blob(o, [0.09, 0.1, 0.1], m.bone, [0, 0.12, 0.05]); blob(o, [0.06, 0.04, 0.06], m.bone, [0, 0.05, 0.08]); for (const sx of [-1, 1]) blob(o, [0.022, 0.026, 0.015], m.dark, [sx * 0.035, 0.13, 0.14]); return o; }
  }
  return null;
}
