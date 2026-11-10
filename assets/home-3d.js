/* mäisyndic — maquette 3D de la page d'accueil (module chargé à l'approche de la section).
   Résidence d'exemple : 9 lots, millièmes fictifs. Textes traduits fournis par la page (script #mx-i18n).
   three.js r160 hébergé sur le site (assets/vendor/three), via la table d'import de la page. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const story = window.__mxStory || { target: 0 };
const canvas = document.getElementById("mx-scene");
const I18N = (() => { try { return JSON.parse(document.getElementById("mx-i18n").textContent); } catch (e) { return {}; } })();
const stage = canvas.parentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = () => stage.clientWidth <= 860;
const SMALL = narrow();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (err) {
  document.getElementById("mx-fallback").hidden = false; throw err;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

/* ---------- Outils ---------- */
let seed = 11;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const jit = (s) => (rnd() - 0.5) * 2 * s;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const lerp = (a, b, t) => a + (b - a) * t;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* Le fond passe par le rendu filmique : on calcule la couleur d'entrée qui ressort exactement comme le fond de la page. */
function aces(c, exposure) {
  const e = exposure / 0.6, r = c[0] * e, g = c[1] * e, b = c[2] * e;
  const i0 = 0.59719 * r + 0.35458 * g + 0.04823 * b, i1 = 0.076 * r + 0.90834 * g + 0.01566 * b, i2 = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const f = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const a0 = f(i0), a1 = f(i1), a2 = f(i2);
  return [clamp01(1.60475 * a0 - 0.53108 * a1 - 0.07367 * a2), clamp01(-0.10208 * a0 + 1.10813 * a1 - 0.00605 * a2), clamp01(-0.00327 * a0 - 0.07276 * a1 + 1.07602 * a2)];
}
function backgroundFor(cssColor) {
  const t = new THREE.Color(cssColor);
  const target = [t.r, t.g, t.b];
  const x = target.slice();
  for (let k = 0; k < 400; k++) {
    const y = aces(x, renderer.toneMappingExposure);
    for (let j = 0; j < 3; j++) x[j] = Math.max(0, x[j] + (target[j] - y[j]) * 1.6);
  }
  return new THREE.Color().setRGB(x[0], x[1], x[2], THREE.LinearSRGBColorSpace);
}

/* ---------- Scène, lumière, environnement ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xdde7f0, 0xcfc8bd, 0.25);
const sun = new THREE.DirectionalLight(0xfff1e0, 2.0);
sun.position.set(-10, 13, 7);
sun.target.position.set(0, 3, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(SMALL ? 1024 : 2048, SMALL ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 2, far: 45 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(hemi, sun, sun.target);

const shadowMat = new THREE.ShadowMaterial({ opacity: 0.14 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), shadowMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.16;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- Matériaux : maquette d'architecte ---------- */
function grainTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d"), img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = 200 + Math.floor(rnd() * 55); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
}
const grain = grainTexture();
const std = (o) => new THREE.MeshStandardMaterial(o);
const MAT = {
  clay: std({ color: "#F5F4F0", roughness: 0.92, bumpMap: grain, bumpScale: 0.6 }),
  stone: std({ color: "#DCD8D0", roughness: 0.95, bumpMap: grain, bumpScale: 0.8 }),
  base: std({ color: "#D9D4CA", roughness: 0.9, bumpMap: grain, bumpScale: 0.5 }),
  path: std({ color: "#C8C2B6", roughness: 0.95 }),
  slate: std({ color: "#39434F", roughness: 0.55, metalness: 0.15, bumpMap: grain, bumpScale: 1.2 }),
  core: std({ color: "#0B5FA5", roughness: 0.5 }),
  lot: std({ color: "#F4D7BA", roughness: 0.8, emissive: new THREE.Color("#FF8A2A"), emissiveIntensity: 0 }),
  rail: std({ color: "#D3E2EC", roughness: 0.1, transparent: true, opacity: 0.3, depthWrite: false }),
  phone: std({ color: "#121A22", roughness: 0.3, metalness: 0.55 }),
  cable: std({ color: "#F6F5F2", roughness: 0.4 })
};
const envMats = Object.values(MAT).slice();

/* Intérieurs des fenêtres allumées : rideaux, lampe, étagère, store */
function interiorTextures() {
  const out = [];
  for (let v = 0; v < 5; v++) {
    const c = document.createElement("canvas"); c.width = 64; c.height = 96;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, "#FFFFFF"); g.addColorStop(1, "#9A9A9A");
    x.fillStyle = g; x.fillRect(0, 0, 64, 96);
    x.fillStyle = "rgba(0,0,0,0.55)";
    if (v === 0) { const cg = x.createLinearGradient(0, 0, 22, 0); cg.addColorStop(0, "rgba(0,0,0,0.7)"); cg.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = cg; x.fillRect(0, 0, 22, 96); }
    if (v === 1) { const rg = x.createRadialGradient(40, 22, 2, 40, 22, 40); rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = rg; x.fillRect(0, 0, 64, 96); x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(0, 70, 64, 26); }
    if (v === 2) { x.fillRect(6, 52, 30, 4); x.fillRect(6, 30, 30, 4); x.fillRect(10, 38, 6, 14); x.fillRect(22, 18, 8, 12); x.beginPath(); x.arc(48, 74, 12, 0, Math.PI * 2); x.fill(); }
    if (v === 3) { x.fillStyle = "rgba(0,0,0,0.28)"; for (let y = 0; y < 44; y += 6) x.fillRect(0, y, 64, 3); }
    if (v === 4) { const cg = x.createLinearGradient(64, 0, 40, 0); cg.addColorStop(0, "rgba(0,0,0,0.6)"); cg.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = cg; x.fillRect(40, 0, 24, 96); x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(12, 60, 22, 36); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    out.push(t);
  }
  return out;
}
const INTERIORS = interiorTextures();

/* ---------- Construction de l'immeuble ---------- */
const FH = 1, W = 4.4, D = 2.6, T = 0.12, SLAB = 0.12, RH = 1.35, GAP = 0.62;
const ROOF_ANG = Math.atan2(RH, D / 2);
const building = new THREE.Group();
scene.add(building);
const floors = [];
const windows = [];
const bloomSet = new Set();
const hideInBloom = new Set([ground]);

function box(list, w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g); return g; }
function meshFrom(list, mat, parent, cast = true) {
  if (!list.length) return null;
  const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function addWindow(parent, geo, pos, lit, rot) {
  const mat = std({ color: "#2A3947", roughness: 0.12, metalness: 0.0, emissive: new THREE.Color("#FF8E33"), emissiveIntensity: 0, emissiveMap: INTERIORS[Math.floor(rnd() * INTERIORS.length)] });
  envMats.push(mat);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos);
  if (rot) m.rotation.x = rot;
  parent.add(m);
  bloomSet.add(m);
  windows.push({ mesh: m, lit, order: rnd(), cur: 1 });
}

function makeFloor(f) {
  const g = new THREE.Group();
  const clay = [], stone = [], core = [], lot = [], rail = [];
  const ground0 = f === 0;
  const walls = ground0 ? stone : clay;
  box(clay, W + 0.06, SLAB, D + 0.06, 0, SLAB / 2, 0);
  if (ground0) box(stone, W + 0.16, 0.08, D + 0.16, 0, FH - 0.04, 0);
  else box(clay, W + 0.09, 0.045, D + 0.09, 0, FH - 0.0225, 0);
  const sill = ground0 ? 0.1 : 0.26, wh = ground0 ? 0.62 : 0.52;
  const v0 = SLAB + sill, v1 = v0 + wh, vc = (v0 + v1) / 2;
  const facades = [
    { axis: "x", L: W, n: 4, s: 1, name: "front" },
    { axis: "x", L: W, n: 4, s: -1, name: "back" },
    { axis: "z", L: D, n: 2, s: 1, name: "right" },
    { axis: "z", L: D, n: 2, s: -1, name: "left" }
  ];
  for (const fc of facades) {
    const bw = fc.L / fc.n;
    let open = [];
    for (let i = 0; i < fc.n; i++) open.push({ c: -fc.L / 2 + bw * (i + 0.5), w: bw * 0.56 });
    if (ground0 && fc.name === "front") open = [open[0], { c: 0, w: bw * 1.4, entrance: true }, open[3]];
    const put = (list, du, dv, dd, u, v, dIn) => {
      if (fc.axis === "x") box(list, du, dv, dd, u, v, fc.s * (D / 2 - dIn));
      else box(list, dd, dv, du, fc.s * (W / 2 - dIn), v, u);
    };
    put(walls, fc.L, v0 - SLAB, T, 0, SLAB + (v0 - SLAB) / 2, T / 2);
    put(walls, fc.L, (FH - 0.045) - v1, T, 0, v1 + ((FH - 0.045) - v1) / 2, T / 2);
    let cur = -fc.L / 2;
    for (const o of open) {
      const a = o.c - o.w / 2;
      if (a - cur > 0.001) put(walls, a - cur, wh, T, (a + cur) / 2, vc, T / 2);
      cur = o.c + o.w / 2;
    }
    if (fc.L / 2 - cur > 0.001) put(walls, fc.L / 2 - cur, wh, T, (fc.L / 2 + cur) / 2, vc, T / 2);
    for (const o of open) {
      put(clay, o.w + 0.09, 0.035, 0.12, o.c, v0 - 0.017, -0.02);
      put(clay, o.w, 0.026, 0.035, o.c, v1 - 0.013, T * 0.5);
      put(clay, o.w, 0.022, 0.035, o.c, v0 + 0.011, T * 0.5);
      put(clay, 0.026, wh, 0.035, o.c - o.w / 2 + 0.013, vc, T * 0.5);
      put(clay, 0.026, wh, 0.035, o.c + o.w / 2 - 0.013, vc, T * 0.5);
      if (!o.entrance) put(clay, 0.024, wh, 0.03, o.c, vc, T * 0.45);
      const geo = fc.axis === "x" ? new THREE.BoxGeometry(o.w, wh, 0.02) : new THREE.BoxGeometry(0.02, wh, o.w);
      const pos = fc.axis === "x" ? V(o.c, vc, fc.s * (D / 2 - T * 0.6)) : V(fc.s * (W / 2 - T * 0.6), vc, o.c);
      addWindow(g, geo, pos, o.entrance ? true : rnd() < 0.55);
    }
  }
  if (ground0) {
    box(clay, 1.75, 0.06, 0.55, 0, v1 + 0.1, D / 2 + 0.26);
  } else {
    const bw2 = 2 * (W / 4) - 0.12, zf = D / 2;
    box(clay, bw2, 0.06, 0.44, 0, SLAB - 0.03, zf + 0.22);
    box(rail, bw2, 0.3, 0.015, 0, SLAB + 0.15, zf + 0.43);
    box(rail, 0.015, 0.3, 0.44, -bw2 / 2, SLAB + 0.15, zf + 0.22);
    box(rail, 0.015, 0.3, 0.44, bw2 / 2, SLAB + 0.15, zf + 0.22);
    box(clay, bw2, 0.022, 0.035, 0, SLAB + 0.31, zf + 0.43);
    const lw = W / 2 - T - 0.04;
    box(lot, lw, 0.012, D - 2 * T, -(lw / 2 + 0.04), SLAB + 0.007, 0);
    box(lot, lw, 0.012, D - 2 * T, lw / 2 + 0.04, SLAB + 0.007, 0);
  }
  box(core, 0.9, FH - SLAB - 0.05, 0.9, 0, SLAB + (FH - SLAB - 0.05) / 2, -D / 2 + T + 0.45);
  box(clay, 0.06, 0.5, D - 2 * T - 0.9, 0, SLAB + 0.25, 0.45);
  meshFrom(clay, MAT.clay, g);
  meshFrom(stone, MAT.stone, g);
  meshFrom(core, MAT.core, g);
  meshFrom(lot, MAT.lot, g, false);
  const rm = meshFrom(rail, MAT.rail, g, false);
  if (rm) hideInBloom.add(rm);
  building.add(g);
  return g;
}

function makeRoof() {
  const g = new THREE.Group();
  const clay = [], slate = [];
  box(clay, W + 0.06, SLAB, D + 0.06, 0, SLAB / 2, 0);
  const shape = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, RH)]);
  const prism = new THREE.ExtrudeGeometry(shape, { depth: W - 0.02, bevelEnabled: false });
  prism.translate(0, 0, -(W - 0.02) / 2);
  prism.rotateY(Math.PI / 2);
  prism.translate(0, SLAB, 0);
  clay.push(prism);
  const half = D / 2, slant = Math.hypot(half, RH);
  for (const s of [1, -1]) {
    const r = new THREE.BoxGeometry(W + 0.34, 0.07, slant + 0.24);
    r.translate(0, 0.035, s * 0.12);
    r.rotateX(s * ROOF_ANG);
    r.translate(0, SLAB + RH / 2, s * half / 2);
    slate.push(r);
    const gt = new THREE.CylinderGeometry(0.035, 0.035, W + 0.34, 12);
    gt.rotateZ(Math.PI / 2);
    gt.translate(0, SLAB - 0.07, s * (half + 0.2));
    clay.push(gt);
  }
  for (const x of [-1.0, 1.0]) {
    box(clay, 0.34, 1.1, 0.34, x, SLAB + 0.7 + 0.55, -0.35);
    box(slate, 0.42, 0.06, 0.42, x, SLAB + 1.83, -0.35);
  }
  const n = V(0, Math.cos(ROOF_ANG), Math.sin(ROOF_ANG));
  for (const x of [-0.95, 0.95]) {
    const pos = V(x, SLAB + RH / 2, half / 2).addScaledVector(n, 0.075);
    addWindow(g, new THREE.BoxGeometry(0.46, 0.02, 0.56), pos, true, ROOF_ANG);
    const fr = new THREE.BoxGeometry(0.54, 0.03, 0.64);
    fr.translate(0, 0.06, 0); fr.rotateX(ROOF_ANG); fr.translate(x, SLAB + RH / 2, half / 2);
    slate.push(fr);
  }
  for (const s of [1, -1]) addWindow(g, new THREE.BoxGeometry(0.02, 0.38, 0.32), V(s * (W / 2 - 0.004), SLAB + 0.42, 0), rnd() < 0.7);
  meshFrom(clay, MAT.clay, g);
  meshFrom(slate, MAT.slate, g);
  building.add(g);
  return g;
}

for (let f = 0; f < 5; f++) floors.push(makeFloor(f));
floors.push(makeRoof());

/* Socle de maquette, allée et trois tilleuls */
{
  const base = [], path = [], clay = [];
  box(base, W + 2.4, 0.16, D + 3.2, 0, -0.08, 0.35);
  box(path, 1.3, 0.012, 1.25, 0, 0.006, D / 2 + 0.95);
  const trees = [[-3.55, 1.75, 1], [-3.0, -1.85, 0.85], [3.65, -1.55, 1.1]];
  for (const [x, z, s] of trees) {
    const trunk = new THREE.CylinderGeometry(0.045 * s, 0.06 * s, 0.95 * s, 10); trunk.translate(x, 0.475 * s, z); clay.push(trunk);
    const c1 = new THREE.SphereGeometry(0.62 * s, 40, 24); c1.scale(1, 1.12, 1); c1.translate(x, 1.4 * s, z); clay.push(c1);
    const c2 = new THREE.SphereGeometry(0.42 * s, 32, 20); c2.translate(x + 0.34 * s, 1.15 * s, z + 0.12 * s); clay.push(c2);
  }
  meshFrom(base, MAT.base, scene);
  meshFrom(path, MAT.path, scene, false);
  meshFrom(clay, MAT.clay, scene);
}

/* ---------- Étiquettes : lots et millièmes ---------- */
const LABELS = I18N.labels || [
  { t: "Rez-de-chaussée", s: "Hall et caves", m: "Parties communes", common: true },
  { t: "1er étage", s: "Lots 1 et 2", m: "200/1000" },
  { t: "2e étage", s: "Lots 3 et 4", m: "204/1000" },
  { t: "3e étage", s: "Lots 5 et 6", m: "208/1000" },
  { t: "4e étage", s: "Lots 7 et 8", m: "212/1000" },
  { t: "Combles", s: "Lot 9, duplex", m: "176/1000" }
];
const labelBox = document.getElementById("mx-labels");
const labelEls = LABELS.map((l) => {
  const el = document.createElement("div");
  el.className = "mx-lbl" + (l.common ? " is-common" : "");
  el.innerHTML = "<i></i><b></b><span></span><em></em>";
  el.querySelector("b").textContent = l.t;
  el.querySelector("span").textContent = l.s;
  el.querySelector("em").textContent = l.m;
  labelBox.appendChild(el);
  return el;
});

/* ---------- Téléphone : l'espace copropriétaire ---------- */
const PH = V(5.4, 3.9, 3.0), PSCALE = 1.4;
const phone = new THREE.Group();
phone.position.copy(PH);
const body = new THREE.Mesh(new RoundedBoxGeometry(1.0, 2.05, 0.1, 4, 0.13), MAT.phone);
body.castShadow = true;
phone.add(body);
const screenCanvas = document.createElement("canvas");
screenCanvas.width = 600; screenCanvas.height = 1284;
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, color: new THREE.Color(1.35, 1.35, 1.35) });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.97), screenMat);
screen.position.z = 0.0506;
phone.add(screen);
phone.visible = false;
scene.add(phone);

function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
const TXT = Object.assign({
  example: "Exemple", residence: "Résidence Les Tilleuls", sub: "Esch-sur-Alzette · 9 lots", status: "Compte à jour",
  balanceK: "Votre solde", balanceV: "0,00 €", agK: "Prochaine AG", agV: "Mar. 9 mars, 16 h", agS: "Convocation FR · PT",
  fundK: "Fonds de travaux", fundV: "18 450 € sur 30 000 €", docsK: "Derniers documents",
  docs: ["Décompte des charges 2025", "Procès-verbal de l'AG 2026", "Contrat d'entretien de l'ascenseur"],
  alert: "Éclairage du hall · intervention jeudi"
}, I18N.screen || {});
function drawScreen() {
  const x = screenCanvas.getContext("2d"), w = screenCanvas.width, h = screenCanvas.height;
  const F = (wt, px) => wt + " " + px + "px Inter, 'Segoe UI', system-ui, sans-serif";
  /* Texte réduit au besoin pour tenir dans la largeur (les traductions sont plus ou moins longues) */
  const fit = (text, X, Y, maxW, wt, px) => { let p = px; x.font = F(wt, p); while (p > 12 && x.measureText(text).width > maxW) { p -= 1; x.font = F(wt, p); } x.fillText(text, X, Y); };
  const ink = "#0E1E2C", ink2 = "#5A6B7B", card = "#FFFFFF", orange = "#E8781A", blue = "#0B5FA5";
  x.clearRect(0, 0, w, h);
  x.save();
  rr(x, 0, 0, w, h, 64); x.fillStyle = "#EEF2F6"; x.fill(); x.clip();
  x.fillStyle = ink; x.font = F(600, 24); x.fillText("9:41", 52, 58);
  rr(x, w / 2 - 74, 26, 148, 38, 19); x.fillStyle = "#0A0E13"; x.fill();
  const lx = 44, ly = 100, s = 0.85;
  x.fillStyle = blue;
  rr(x, lx + 18 * s, ly + 2 * s, 11 * s, 11 * s, 3 * s); x.fill();
  rr(x, lx + 35 * s, ly + 2 * s, 11 * s, 11 * s, 3 * s); x.fill();
  rr(x, lx + 4 * s, ly + 16 * s, 56 * s, 46 * s, 14 * s); x.fill();
  x.fillStyle = orange; rr(x, lx + 17 * s, ly + 29 * s, 11 * s, 10 * s, 2 * s); x.fill(); rr(x, lx + 36 * s, ly + 29 * s, 11 * s, 10 * s, 2 * s); x.fill();
  x.fillStyle = "#EEF2F6"; rr(x, lx + 27 * s, ly + 46 * s, 10 * s, 16 * s, 2 * s); x.fill();
  x.fillStyle = ink; x.font = F(700, 32); x.fillText("mäisyndic", 108, 146);
  x.font = F(600, 19);
  const exW = Math.min(170, x.measureText(TXT.example).width + 32);
  rr(x, w - 44 - exW, 116, exW, 40, 20); x.strokeStyle = "#C9D3DC"; x.lineWidth = 2; x.stroke();
  x.fillStyle = ink2; fit(TXT.example, w - 44 - exW + 16, 143, exW - 32, 600, 19);
  x.fillStyle = ink; fit(TXT.residence, 44, 232, w - 88, 600, 40);
  x.fillStyle = ink2; fit(TXT.sub, 44, 270, w - 88, 500, 23);
  x.font = F(600, 20);
  const stW = Math.min(w - 88, x.measureText("●  " + TXT.status).width + 36);
  rr(x, 44, 292, stW, 42, 21); x.fillStyle = "#DDF1E4"; x.fill();
  x.fillStyle = "#1E7A44"; fit("●  " + TXT.status, 62, 320, stW - 36, 600, 20);
  const cardAt = (Y, H) => { rr(x, 36, Y, w - 72, H, 28); x.fillStyle = card; x.fill(); };
  cardAt(356, 168);
  x.fillStyle = ink2; fit(TXT.balanceK, 66, 404, w - 132, 500, 22);
  x.fillStyle = ink; fit(TXT.balanceV, 64, 482, w - 132, 600, 64);
  cardAt(540, 150);
  x.fillStyle = ink2; fit(TXT.agK, 66, 588, w - 132, 500, 22);
  x.fillStyle = ink; fit(TXT.agV, 66, 632, w - 132, 600, 34);
  x.fillStyle = ink2; fit(TXT.agS, 66, 668, w - 132, 500, 21);
  cardAt(706, 168);
  x.fillStyle = ink2; fit(TXT.fundK, 66, 754, w - 132, 500, 22);
  x.fillStyle = ink; fit(TXT.fundV, 66, 798, w - 132, 600, 32);
  rr(x, 66, 826, w - 132, 14, 7); x.fillStyle = "#E6EBF0"; x.fill();
  rr(x, 66, 826, (w - 132) * 0.615, 14, 7); x.fillStyle = orange; x.fill();
  x.fillStyle = ink; fit(TXT.docsK, 44, 930, w - 88, 600, 24);
  TXT.docs.slice(0, 3).forEach((d, i) => {
    const Y = 956 + i * 62;
    rr(x, 44, Y, 40, 46, 8); x.fillStyle = "#DCE8F4"; x.fill();
    x.fillStyle = blue; x.fillRect(54, Y + 14, 20, 3); x.fillRect(54, Y + 22, 20, 3); x.fillRect(54, Y + 30, 14, 3);
    x.fillStyle = ink; fit(d, 100, Y + 31, w - 144, 500, 23);
  });
  rr(x, 36, 1160, w - 72, 84, 24); x.fillStyle = ink; x.fill();
  x.fillStyle = "#FFFFFF"; fit(TXT.alert, 62, 1209, w - 124, 500, 20);
  x.restore();
  screenTex.needsUpdate = true;
}
drawScreen();
if (document.fonts) Promise.all([document.fonts.load("600 32px Inter"), document.fonts.load("500 22px Inter")]).then(drawScreen).catch(() => {});

/* ---------- Câbles lumineux : chaque lot relié à l'espace en ligne ---------- */
const SEG = 150, RAD = 6;
const cables = [];
const pulseMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uOff: { value: 0 }, uAmp: { value: 1 }, uColor: { value: new THREE.Vector3(3.2, 1.0, 0.18) } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: "varying float vU; void main(){ vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: [
    "uniform float uTime; uniform float uOff; uniform float uAmp; uniform vec3 uColor; varying float vU;",
    "void main(){",
    "  float x = fract(vU * 1.4 - uTime * 0.42 + uOff);",
    "  float p = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.05, 0.2, x));",
    "  float a = p * uAmp; if (a < 0.01) discard;",
    "  gl_FragColor = vec4(uColor * a, a);",
    "}"
  ].join("\n")
});
const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 1.05, 0.2) });
const tipGeo = new THREE.SphereGeometry(0.045, 16, 12);
{
  const anchors = [];
  for (let f = 1; f <= 4; f++) for (const xx of [-1.65, 1.65]) anchors.push(V(xx, f * FH + SLAB + 0.26 + 0.26, D / 2 + 0.02));
  const n = V(0, Math.cos(ROOF_ANG), Math.sin(ROOF_ANG));
  for (const xx of [-0.95, 0.95]) anchors.push(V(xx, 5 * FH + SLAB + RH / 2, D / 4).addScaledVector(n, 0.1));
  const B = V(3.4, 2.6, 3.3);
  anchors.forEach((a, li) => {
    const k = li >= 8 ? 2 : 3;
    for (let c = 0; c < k; c++) {
      const p0 = a.clone().add(V((c - (k - 1) / 2) * 0.12, jit(0.04), 0));
      const p1 = p0.clone().add(V(jit(0.12), -0.12 + jit(0.12), 0.75 + rnd() * 0.55));
      const b = B.clone().add(V(jit(0.1), jit(0.1), jit(0.1)));
      const p2 = p1.clone().lerp(b, 0.55).add(V(jit(0.25), jit(0.4), jit(0.2)));
      const end = PH.clone().add(V(jit(0.16 * PSCALE), -1.0 * PSCALE, -0.02));
      const p3 = end.clone().add(V(jit(0.04), -0.5, 0.02));
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, b, p3, end], false, "centripetal");
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.017, RAD, false), MAT.cable);
      tube.castShadow = true;
      const pm = pulseMat.clone();
      pm.uniforms.uOff.value = rnd();
      const pulse = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.025, RAD, false), pm);
      const tip = new THREE.Mesh(tipGeo, tipMat);
      const root = new THREE.Mesh(tipGeo, tipMat);
      root.position.copy(p0); root.scale.setScalar(0.8);
      [tube, pulse, tip, root].forEach((m) => { m.visible = false; scene.add(m); });
      bloomSet.add(pulse); bloomSet.add(tip); bloomSet.add(root);
      cables.push({ curve, tube, pulse, tip, root, delay: li * 0.035 + rnd() * 0.06 });
    }
  });
}

/* ---------- Caméra : un plan par chapitre (le premier reprend la fin de la vidéo, vue de face) ---------- */
const KEYS = [
  { t: [0, 3.3, 0], az: 6, el: 9, d: 21, sx: 0.15 },
  { t: [0, 5.2, 0], az: 50, el: 20, d: 28.5, sx: 0.07 },
  { t: [2.1, 3.3, 1.5], az: 21, el: 8, d: 22, sx: 0.12 },
  { t: [0, 3.4, 0], az: 9, el: 5, d: 21, sx: 0.15 }
];
function camKey(p) {
  const i = Math.min(KEYS.length - 2, Math.floor(p)), t = p - i, a = KEYS[i], b = KEYS[i + 1];
  return { t: a.t.map((v, j) => lerp(v, b.t[j], t)), az: lerp(a.az, b.az, t), el: lerp(a.el, b.el, t), d: lerp(a.d, b.d, t), sx: lerp(a.sx, b.sx, t) };
}
{
  const k = KEYS[2], az = THREE.MathUtils.degToRad(k.az);
  const cx = k.t[0] + Math.sin(az) * k.d, cz = k.t[2] + Math.cos(az) * k.d;
  phone.rotation.y = Math.atan2(cx - PH.x, cz - PH.z) * 0.85;
  phone.rotation.x = -0.05;
}

/* ---------- Post-traitement : occlusion ambiante et halo sélectif ---------- */
const renderPass = new RenderPass(scene, camera);
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.3, 0.0);
bloomComposer.addPass(bloom);
const mixPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv); }"
}), "baseTexture");
mixPass.needsSwap = true;
const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
let gtao = null;
if (!SMALL) {
  try {
    gtao = new GTAOPass(scene, camera, stage.clientWidth, stage.clientHeight);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(gtao);
  } catch (e) { gtao = null; }
}
composer.addPass(mixPass);
composer.addPass(new OutputPass());
const darkMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const BLACK = new THREE.Color(0x000000);
function toBloom(o) {
  if (!o.isMesh) return;
  if (hideInBloom.has(o)) { o.userData.v = o.visible; o.visible = false; }
  else if (!bloomSet.has(o)) { o.userData.m = o.material; o.material = darkMat; }
}
function fromBloom(o) {
  if (!o.isMesh) return;
  if (hideInBloom.has(o)) o.visible = o.userData.v;
  else if (o.userData.m) { o.material = o.userData.m; o.userData.m = null; }
}

let dark = false, winGain = 2, lotGain = 0.35;
function applyTheme() {
  const cs = getComputedStyle(document.documentElement);
  dark = cs.getPropertyValue("--mx-scheme").trim() === "dark";
  scene.background = backgroundFor(cs.getPropertyValue("--mx-studio").trim() || "#CACBCD");
  sun.intensity = dark ? 0.4 : 2.6;
  sun.color.set(dark ? "#9DB6D4" : "#FFF1E0");
  hemi.intensity = dark ? 0.08 : 0.25;
  for (const m of envMats) m.envMapIntensity = dark ? 0.08 : 0.42;
  shadowMat.opacity = dark ? 0.32 : 0.2;
  bloom.strength = dark ? 0.75 : 0.32;
  bloom.radius = dark ? 0.42 : 0.25;
  winGain = dark ? 2.4 : 1.7;
  lotGain = dark ? 0.9 : 0.4;
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function frameView(sx) {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (narrow()) camera.setViewOffset(w, h, 0, h * 0.17, w, h);
  else camera.setViewOffset(w, h, -w * sx, 0, w, h);
  camera.updateProjectionMatrix();
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const pr = Math.min(devicePixelRatio || 1, narrow() ? 1.5 : 1.75);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  for (const c of [bloomComposer, composer]) { c.setPixelRatio(pr); c.setSize(w, h); }
  camera.aspect = w / h;
  frameView(0.15);
}
addEventListener("resize", resize);
resize();

const pointer = { x: 0, y: 0 }, tilt = { x: 0, y: 0 };
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  pointer.x = e.clientX / innerWidth - 0.5;
  pointer.y = e.clientY / innerHeight - 0.5;
}, { passive: true });

/* ---------- Boucle : ne tourne que quand la maquette est à l'écran ---------- */
let P = story.target, last = performance.now(), visible = true, looping = false;
const tmp = new THREE.Vector3();
function kick() { if (visible && !looping && !document.hidden) { last = performance.now(); looping = true; requestAnimationFrame(frame); } }
new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; kick(); }, { rootMargin: "300px 0px" }).observe(document.getElementById("mx-story"));
document.addEventListener("visibilitychange", kick);

function frame(now) {
  if (!visible || document.hidden) { looping = false; return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = now / 1000;
  P += (story.target - P) * (reduced ? 1 : Math.min(1, dt * 4));
  const p = P;

  const e = smooth(0.12, 0.85, p) * (1 - smooth(1.12, 1.5, p));
  floors.forEach((g, i) => { g.position.y = i * FH + e * i * GAP + (i === 5 ? e * 0.3 : 0); });
  MAT.lot.emissiveIntensity = e * lotGain;

  /* Toutes les fenêtres allumées au début (suite de la vidéo) et à la fin ; un éclairage de vie entre les deux */
  const allOn = Math.max(1 - smooth(0.15, 0.7, p), smooth(2.3, 2.85, p));
  for (const w of windows) {
    const tgt = w.lit || allOn > w.order ? 1 : 0;
    w.cur += (tgt - w.cur) * Math.min(1, dt * 5);
    w.mesh.material.emissiveIntensity = w.cur * winGain;
  }

  const ph = smooth(1.4, 1.72, p) * (1 - smooth(2.12, 2.45, p));
  phone.visible = ph > 0.002;
  phone.scale.setScalar(Math.max(0.001, easeOut(ph) * PSCALE));
  phone.position.y = PH.y + (1 - ph) * -0.4;
  const G = smooth(1.5, 1.95, p) * (1 - smooth(2.02, 2.38, p));
  for (const c of cables) {
    const g = clamp01((G * 1.5 - c.delay) / 1.0);
    const n = Math.floor(g * SEG) * RAD * 6;
    const vis = n > 0;
    c.tube.visible = c.pulse.visible = c.root.visible = vis;
    if (vis) {
      c.tube.geometry.setDrawRange(0, n);
      c.pulse.geometry.setDrawRange(0, n);
      c.pulse.material.uniforms.uTime.value = reduced ? 0 : time;
      c.pulse.material.uniforms.uAmp.value = dark ? 1 : 0.8;
    }
    c.tip.visible = vis && g < 0.995;
    if (c.tip.visible) c.curve.getPointAt(g, c.tip.position);
  }

  tilt.x += (pointer.x - tilt.x) * Math.min(1, dt * 2.5);
  tilt.y += (pointer.y - tilt.y) * Math.min(1, dt * 2.5);
  const k = camKey(p);
  const fit = Math.max(1, 0.8 / camera.aspect);
  const az = THREE.MathUtils.degToRad(k.az + (reduced ? 0 : Math.sin(time * 0.12) * 3.5) + tilt.x * 6);
  const el = THREE.MathUtils.degToRad(k.el + tilt.y * 3);
  const d = k.d * fit;
  camera.position.set(k.t[0] + Math.sin(az) * Math.cos(el) * d, k.t[1] + Math.sin(el) * d, k.t[2] + Math.cos(az) * Math.cos(el) * d);
  camera.lookAt(k.t[0], k.t[1], k.t[2]);
  frameView(k.sx);
  camera.updateMatrixWorld();

  const lv = narrow() ? 0 : smooth(0.55, 0.92, p) * (1 - smooth(1.08, 1.3, p));
  const sw = stage.clientWidth, sh = stage.clientHeight;
  labelEls.forEach((el, i) => {
    if (lv < 0.01) { if (el.style.opacity !== "0") el.style.opacity = "0"; return; }
    const g = floors[i];
    tmp.set(W / 2 + 0.12, g.position.y + 0.55, i === 5 ? -D / 2 - 0.1 : -D / 2).project(camera);
    const y = (-tmp.y * 0.5 + 0.5) * sh;
    /* Les traductions plus longues ne doivent pas sortir de l'écran */
    if (!el._w) el._w = el.offsetWidth;
    const x = Math.min((tmp.x * 0.5 + 0.5) * sw, sw - el._w - 16);
    el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) translateY(-50%)";
    el.style.opacity = (lv * clamp01((p - 0.55 - i * 0.04) * 6)).toFixed(3);
  });

  const bg = scene.background;
  scene.background = BLACK;
  scene.traverse(toBloom);
  bloomComposer.render(dt);
  scene.traverse(fromBloom);
  scene.background = bg;
  renderer.shadowMap.needsUpdate = true;
  composer.render(dt);
  if (!window.__mxSceneReady) { window.__mxSceneReady = true; document.getElementById("mx-fallback").hidden = true; }
  requestAnimationFrame(frame);
}
kick();
