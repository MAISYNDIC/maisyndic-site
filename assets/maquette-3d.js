/* mäisyndic — maquette 3D commune : studio, matériaux et immeuble paramétrique.
   Utilisée par le configurateur de la page Tarifs (calc-3d.js) et par les scènes des
   en-têtes (scene-3d.js). Même vocabulaire que la maquette de l'accueil : façades
   blanches, fenêtres éclairées, balcons vitrés, toit en ardoise, socle et arbres. */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE, RoundedBoxGeometry, mergeGeometries };

export const DIM = { FH: 1, BAY: 1.1, D: 2.6, T: 0.12, SLAB: 0.12, RH: 1.25, BASE_H: 0.16 };
DIM.ROOF_ANG = Math.atan2(DIM.RH, DIM.D / 2);

/* ---------- Studio : rendu, fond, lumière, sol ---------- */
export function createStudio(canvas, { small = false, background = '#CACBCD', shadowSize } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 300);
  scene.add(new THREE.HemisphereLight(0xdde7f0, 0xcfc8bd, 0.3));
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.0);
  sun.position.set(-10, 15, 9);
  sun.castShadow = true;
  const size = shadowSize || (small ? 1024 : 2048);
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 18, bottom: -10, near: 2, far: 60 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  resize();
  return { renderer, scene, camera, sun, resize };
}

/* ---------- Matériaux de la maquette ---------- */
export function createMaterials() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const grain = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = 200 + Math.floor(rnd() * 55); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
    return t;
  })();
  const interior = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 64;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#8E8E8E');
    x.fillStyle = g; x.fillRect(0, 0, 32, 64);
    return new THREE.CanvasTexture(c);
  })();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const MAT = {
    clay: std({ color: '#F5F4F0', roughness: 0.92, bumpMap: grain, bumpScale: 0.6 }),
    stone: std({ color: '#DCD8D0', roughness: 0.95, bumpMap: grain, bumpScale: 0.8 }),
    base: std({ color: '#D9D4CA', roughness: 0.9, bumpMap: grain, bumpScale: 0.5 }),
    path: std({ color: '#C8C2B6', roughness: 0.95 }),
    slate: std({ color: '#39434F', roughness: 0.55, metalness: 0.15, bumpMap: grain, bumpScale: 1.2 }),
    rail: std({ color: '#D3E2EC', roughness: 0.1, transparent: true, opacity: 0.3, depthWrite: false }),
    lit: std({ color: '#2A3947', roughness: 0.15, emissive: new THREE.Color('#FFB257'), emissiveIntensity: 1.15, emissiveMap: interior }),
    warm: std({ color: '#2A3947', roughness: 0.15, emissive: new THREE.Color('#FFD49B'), emissiveIntensity: 0.7, emissiveMap: interior }),
    dark: std({ color: '#2A3947', roughness: 0.12, metalness: 0.1 }),
  };
  MAT.glowBase = { lit: 1.15, warm: 0.7 };
  MAT.rnd = rnd;
  return MAT;
}

/* ---------- Immeuble paramétrique ---------- */
export function createBuilder(MAT) {
  const { FH, BAY, D, T, SLAB, RH, BASE_H, ROOF_ANG } = DIM;
  const rnd = MAT.rnd;
  const box = (list, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g); };
  const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
  const templates = new Map();

  // Étage type : géométries partagées par largeur (bays = travées sur la façade principale).
  function floorTemplate(bays, kind) {
    const key = bays + ':' + kind;
    if (templates.has(key)) return templates.get(key);
    const W = bays * BAY, ground0 = kind === 'ground';
    const L = { walls: [], clay: [], rail: [], lit: [], warm: [], dark: [] };
    const wallList = ground0 ? L.walls : L.clay;
    box(L.clay, W + 0.06, SLAB, D + 0.06, 0, SLAB / 2, 0);
    box(wallList, W + (ground0 ? 0.16 : 0.09), ground0 ? 0.08 : 0.045, D + (ground0 ? 0.16 : 0.09), 0, FH - (ground0 ? 0.04 : 0.0225), 0);
    const sill = ground0 ? 0.12 : 0.28, wh = ground0 ? 0.6 : 0.5;
    const top = FH - 0.045, band = Math.max(SLAB + sill + wh, SLAB + 0.82);
    const facades = [
      { axis: 'x', len: W, n: bays, s: 1, front: true },
      { axis: 'x', len: W, n: bays, s: -1 },
      { axis: 'z', len: D, n: 2, s: 1 },
      { axis: 'z', len: D, n: 2, s: -1 },
    ];
    for (const fc of facades) {
      const bw = fc.len / fc.n;
      let open = [];
      for (let i = 0; i < fc.n; i++) {
        const balcony = !ground0 && fc.axis === 'x' && bays >= 4 && i > 0 && i < fc.n - 1;
        open.push({ c: -fc.len / 2 + bw * (i + 0.5), w: bw * 0.56, tall: balcony, balcony });
      }
      if (ground0 && fc.front) {
        const mid = fc.n / 2;
        open = open.filter((o, i) => i !== mid - 1 && i !== mid);
        open.splice(mid - 1, 0, { c: 0, w: Math.min(bw * 1.3, 1.2), entrance: true });
      }
      const put = (list, du, dv, dd, u, v, dIn) => {
        if (fc.axis === 'x') box(list, du, dv, dd, u, v, fc.s * (D / 2 - dIn));
        else box(list, dd, dv, du, fc.s * (W / 2 - dIn), v, u);
      };
      put(wallList, fc.len, top - band, T, 0, (top + band) / 2, T / 2);
      let cur = -fc.len / 2;
      for (const o of open) {
        const a = o.c - o.w / 2, b = o.c + o.w / 2;
        if (a - cur > 0.001) put(wallList, a - cur, band - SLAB, T, (a + cur) / 2, SLAB + (band - SLAB) / 2, T / 2);
        const lo = o.entrance || o.tall ? SLAB + 0.02 : SLAB + sill;
        const hi = o.entrance ? SLAB + 0.82 : SLAB + sill + wh;
        if (lo > SLAB + 0.001) put(wallList, o.w, lo - SLAB, T, o.c, SLAB + (lo - SLAB) / 2, T / 2);
        if (band - hi > 0.001) put(wallList, o.w, band - hi, T, o.c, hi + (band - hi) / 2, T / 2);
        // Vitrage en retrait, avec un meneau ; environ trois fenêtres sur quatre éclairées.
        const glass = o.entrance ? L.lit : rnd() < 0.74 ? (rnd() < 0.5 ? L.lit : L.warm) : L.dark;
        put(glass, o.w, hi - lo, 0.02, o.c, (lo + hi) / 2, T * 0.78);
        put(L.clay, 0.025, hi - lo, 0.04, o.c, (lo + hi) / 2, T * 0.72);
        if (o.balcony) {
          const bwid = bw * 0.86, depth = 0.34;
          const out = (list, du, dv, dd, u, v, dOut) => box(list, du, dv, dd, u, v, fc.s * (D / 2 + dOut));
          out(L.clay, bwid, 0.06, depth, o.c, SLAB + 0.03, depth / 2);
          out(L.rail, bwid, 0.3, 0.012, o.c, SLAB + 0.21, depth - 0.006);
          for (const side of [-1, 1]) out(L.rail, 0.012, 0.3, depth, o.c + side * bwid / 2, SLAB + 0.21, depth / 2);
        }
        if (o.entrance) box(L.clay, o.w + 0.3, 0.05, 0.42, o.c, SLAB + 0.9, fc.s * (D / 2 + 0.21));
        cur = b;
      }
      if (fc.len / 2 - cur > 0.001) put(wallList, fc.len / 2 - cur, band - SLAB, T, (fc.len / 2 + cur) / 2, SLAB + (band - SLAB) / 2, T / 2);
    }
    const t = {
      walls: merge(L.walls), clay: merge(L.clay), rail: merge(L.rail),
      lit: merge(L.lit), warm: merge(L.warm), dark: merge(L.dark), wallMat: ground0 ? MAT.stone : MAT.clay,
    };
    templates.set(key, t);
    return t;
  }

  function makeFloor(bays, f) {
    const t = floorTemplate(bays, f === 0 ? 'ground' : 'up' + (f % 3));
    const g = new THREE.Group();
    const add = (geo, mat, cast) => { if (!geo) return; const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); };
    add(t.walls, t.wallMat, true); add(t.clay, MAT.clay, true); add(t.rail, MAT.rail, false);
    add(t.lit, MAT.lit, false); add(t.warm, MAT.warm, false); add(t.dark, MAT.dark, false);
    g.userData = { t: 0 };
    return g;
  }

  function makeRoof(bays) {
    const W = bays * BAY, g = new THREE.Group();
    const clay = [], slate = [], lit = [];
    box(clay, W + 0.06, SLAB, D + 0.06, 0, SLAB / 2, 0);
    const shape = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, RH)]);
    const prism = new THREE.ExtrudeGeometry(shape, { depth: W - 0.02, bevelEnabled: false });
    prism.translate(0, 0, -(W - 0.02) / 2); prism.rotateY(Math.PI / 2); prism.translate(0, SLAB, 0);
    clay.push(prism);
    const half = D / 2, slant = Math.hypot(half, RH);
    for (const s of [1, -1]) {
      const r = new THREE.BoxGeometry(W + 0.34, 0.07, slant + 0.24);
      r.translate(0, 0.035, s * 0.12); r.rotateX(s * ROOF_ANG); r.translate(0, SLAB + RH / 2, s * half / 2);
      slate.push(r);
      const gt = new THREE.CylinderGeometry(0.035, 0.035, W + 0.34, 10);
      gt.rotateZ(Math.PI / 2); gt.translate(0, SLAB - 0.07, s * (half + 0.2));
      clay.push(gt);
    }
    const cx = Math.max(0.55, W / 2 - 0.85);
    for (const x of [-cx, cx]) { box(clay, 0.34, 1.0, 0.34, x, SLAB + 1.12, -0.35); box(slate, 0.42, 0.06, 0.42, x, SLAB + 1.65, -0.35); }
    const nrm = new THREE.Vector3(0, Math.cos(ROOF_ANG), Math.sin(ROOF_ANG));
    const count = Math.max(1, bays / 2);
    for (let i = 0; i < count; i++) {
      const x = -W / 2 + (W / count) * (i + 0.5);
      const pos = new THREE.Vector3(x, SLAB + RH / 2, half / 2).addScaledVector(nrm, 0.075);
      const win = new THREE.BoxGeometry(0.42, 0.02, 0.5); win.rotateX(ROOF_ANG); win.translate(pos.x, pos.y, pos.z); lit.push(win);
      const fr = new THREE.BoxGeometry(0.5, 0.03, 0.58); fr.translate(0, 0.06, 0); fr.rotateX(ROOF_ANG); fr.translate(x, SLAB + RH / 2, half / 2); slate.push(fr);
    }
    for (const [list, mat, cast] of [[clay, MAT.clay, true], [slate, MAT.slate, true], [lit, MAT.warm, false]]) {
      const m = new THREE.Mesh(merge(list), mat); m.castShadow = cast; m.receiveShadow = true; g.add(m);
    }
    return g;
  }

  // Socle arrondi, allée et arbres blancs ; extra élargit le socle d'un côté (x > 0) pour un décor.
  function makeBase(bays, { extra = 0, trees = true } = {}) {
    const W = bays * BAY, g = new THREE.Group();
    const slab = new THREE.Mesh(new RoundedBoxGeometry(W + 3 + extra, BASE_H, D + 3, 3, 0.07), MAT.base);
    slab.position.set(extra / 2, BASE_H / 2, 0); slab.receiveShadow = true; slab.castShadow = true; g.add(slab);
    const path = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.012, 1.2), MAT.path);
    path.position.set(0, BASE_H + 0.006, D / 2 + 0.9); path.receiveShadow = true; g.add(path);
    if (trees) {
      const parts = [];
      const list = [[-(W / 2 + 0.95), D / 2 + 0.75, 0.78], [-(W / 2 + 0.7), -(D / 2 + 0.8), 0.62], [W / 2 + 1.0 + extra, -(D / 2) + 0.2, 0.85]];
      for (const [x, z, s] of list) {
        const trunk = new THREE.CylinderGeometry(0.045 * s, 0.06 * s, 0.95 * s, 8); trunk.translate(x, BASE_H + 0.475 * s, z); parts.push(trunk);
        const c1 = new THREE.SphereGeometry(0.62 * s, 28, 18); c1.scale(1, 1.12, 1); c1.translate(x, BASE_H + 1.4 * s, z); parts.push(c1);
        const c2 = new THREE.SphereGeometry(0.42 * s, 22, 14); c2.translate(x + 0.34 * s, BASE_H + 1.15 * s, z + 0.12 * s); parts.push(c2);
      }
      const tm = new THREE.Mesh(merge(parts), MAT.clay); tm.castShadow = true; tm.receiveShadow = true; g.add(tm);
    }
    return g;
  }

  // Immeuble complet, posé (pour les scènes fixes).
  function makeBuilding(bays, floors, baseOpts) {
    const g = new THREE.Group();
    g.add(makeBase(bays, baseOpts));
    for (let f = 0; f < floors; f++) { const fl = makeFloor(bays, f); fl.position.y = BASE_H + f * FH; g.add(fl); }
    const roof = makeRoof(bays); roof.position.y = BASE_H + floors * FH; g.add(roof);
    return g;
  }

  return { floorTemplate, makeFloor, makeRoof, makeBase, makeBuilding, box, merge };
}

/* ---------- Boucle de rendu : s'arrête hors de l'écran, se fige si l'appareil peine ---------- */
export function runLoop(target, step, { fps = 60, maxFrameMs = 0 } = {}) {
  let visible = true, last = performance.now(), first = true, slow = 0, stopped = false;
  const minGap = 1000 / fps - 2;
  if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(target);
  function frame(now) {
    if (stopped) return;
    requestAnimationFrame(frame);
    if (!first && now - last < minGap) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((!visible || document.hidden) && !first) return;
    const t0 = performance.now();
    step(dt, now / 1000, first);
    first = false;
    // Trop lent (pas d'accélération graphique) : on garde la dernière image et on s'arrête.
    if (maxFrameMs && performance.now() - t0 > maxFrameMs) { if (++slow >= 3) stopped = true; } else slow = 0;
  }
  requestAnimationFrame(frame);
}

/* ---------- Rendu logiciel (sans carte graphique) : la 3D n'en vaut pas la peine ---------- */
export function softwareRendering() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch (e) { return true; }
}
