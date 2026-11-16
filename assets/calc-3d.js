/* mäisyndic — configurateur 3D de la page Tarifs.
   L'immeuble reprend le vocabulaire de la maquette de l'accueil (façades blanches,
   fenêtres éclairées, balcons vitrés, toit en ardoise, socle et arbres) et suit le
   calculateur existant (site.js) : un étage de plus quand les logements augmentent.
   three.js n'est chargé que lorsque le calculateur approche de l'écran ; sans WebGL,
   la photo de la maquette reste affichée et le calculateur fonctionne normalement. */

const stage = document.querySelector('[data-calc-stage]');
const calc = document.querySelector('[data-calc]');

if (stage && calc) {
  const start = () => Promise.all([
    import('three'),
    import('three/addons/environments/RoomEnvironment.js'),
    import('three/addons/geometries/RoundedBoxGeometry.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]).then(([THREE, env, rounded, utils]) => init(THREE, env.RoomEnvironment, rounded.RoundedBoxGeometry, utils.mergeGeometries)).catch(() => {});
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '300px 0px' });
    io.observe(stage);
  } else {
    start();
  }
}

function init(THREE, RoomEnvironment, RoundedBoxGeometry, mergeGeometries) {
  const canvas = stage.querySelector('canvas');
  const countEl = stage.querySelector('.stage-count');
  const countTpl = stage.getAttribute('data-count') || '{n}';
  const lotsInput = calc.querySelector('#calc-lots');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SMALL = window.innerWidth < 700;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch (e) { return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SMALL ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* ---------- Studio : fond, lumière, sol ---------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#CACBCD');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 300);
  scene.add(new THREE.HemisphereLight(0xdde7f0, 0xcfc8bd, 0.3));
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.0);
  sun.position.set(-10, 15, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SMALL ? 1024 : 2048, SMALL ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 18, bottom: -10, near: 2, far: 60 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- Matériaux de la maquette ---------- */
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
  const glowBase = { lit: 1.15, warm: 0.7 };

  /* ---------- Dimensions ---------- */
  const FH = 1, BAY = 1.1, D = 2.6, T = 0.12, SLAB = 0.12, RH = 1.25, BASE_H = 0.16, MAX_FLOORS = 12;
  const ROOF_ANG = Math.atan2(RH, D / 2);
  const box = (list, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(g); };
  const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);

  // Logements par étage selon la taille de l'immeuble (= travées sur la façade principale).
  function layout(n) {
    const bays = n <= 6 ? 2 : n <= 16 ? 4 : n <= 48 ? 6 : n <= 96 ? 8 : 10;
    const floors = Math.min(MAX_FLOORS, Math.ceil(n / bays));
    return { bays, floors, W: bays * BAY };
  }

  /* ---------- Étage type : géométries partagées par largeur ---------- */
  const templates = new Map();
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
      // Bandeau haut, puis trumeaux, allèges et linteaux autour des ouvertures.
      put(wallList, fc.len, top - band, T, 0, (top + band) / 2, T / 2);
      let cur = -fc.len / 2;
      for (const o of open) {
        const a = o.c - o.w / 2, b = o.c + o.w / 2;
        if (a - cur > 0.001) put(wallList, a - cur, band - SLAB, T, (a + cur) / 2, SLAB + (band - SLAB) / 2, T / 2);
        const lo = o.entrance || o.tall ? SLAB + 0.02 : SLAB + sill;
        const hi = o.entrance ? SLAB + 0.82 : o.tall ? SLAB + sill + wh : SLAB + sill + wh;
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

  /* ---------- Toit, socle et arbres (refaits quand la largeur change) ---------- */
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
  function makeBase(bays) {
    const W = bays * BAY, g = new THREE.Group();
    const slab = new THREE.Mesh(new RoundedBoxGeometry(W + 3, BASE_H, D + 3, 3, 0.07), MAT.base);
    slab.position.y = BASE_H / 2; slab.receiveShadow = true; slab.castShadow = true; g.add(slab);
    const path = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.012, 1.2), MAT.path);
    path.position.set(0, BASE_H + 0.006, D / 2 + 0.9); path.receiveShadow = true; g.add(path);
    const parts = [];
    const trees = [[-(W / 2 + 0.95), D / 2 + 0.75, 0.78], [-(W / 2 + 0.7), -(D / 2 + 0.8), 0.62], [W / 2 + 1.0, -(D / 2) + 0.2, 0.85]];
    for (const [x, z, s] of trees) {
      const trunk = new THREE.CylinderGeometry(0.045 * s, 0.06 * s, 0.95 * s, 8); trunk.translate(x, BASE_H + 0.475 * s, z); parts.push(trunk);
      const c1 = new THREE.SphereGeometry(0.62 * s, 28, 18); c1.scale(1, 1.12, 1); c1.translate(x, BASE_H + 1.4 * s, z); parts.push(c1);
      const c2 = new THREE.SphereGeometry(0.42 * s, 22, 14); c2.translate(x + 0.34 * s, BASE_H + 1.15 * s, z + 0.12 * s); parts.push(c2);
    }
    const tm = new THREE.Mesh(merge(parts), MAT.clay); tm.castShadow = true; tm.receiveShadow = true; g.add(tm);
    return g;
  }

  /* ---------- Assemblage et animation ---------- */
  const building = new THREE.Group();
  scene.add(building);
  let L = { bays: 0, floors: 0, W: 0 }, N = 0, pulse = 0, lastPlan = '';
  let floors = [], roof = null, base = null, roofY = BASE_H, dying = [];
  const retire = (obj) => dying.push(obj);

  function setLots(n) {
    const next = layout(n);
    if (next.bays !== L.bays) {
      // Nouvelle largeur : l'ancien immeuble s'efface, le nouveau se monte étage par étage.
      floors.forEach(retire); if (roof) retire(roof); if (base) retire(base);
      floors = [];
      base = makeBase(next.bays); building.add(base);
      roof = makeRoof(next.bays); building.add(roof);
      roofY = BASE_H + 2.5; roof.position.y = roofY;
    }
    const prevFloors = floors.length;
    for (let f = prevFloors; f < next.floors; f++) {
      const fl = makeFloor(next.bays, f);
      fl.position.y = BASE_H + f * FH + 1.6;
      fl.userData.t = reduce ? 0 : -(f - prevFloors) * 0.06;
      fl.visible = reduce;
      building.add(fl); floors.push(fl);
    }
    for (let f = floors.length - 1; f >= next.floors; f--) retire(floors.pop());
    L = next; N = n;
    if (countEl) countEl.textContent = countTpl.replace('{n}', String(n));
  }

  const readLots = () => {
    const v = parseInt(lotsInput && lotsInput.value, 10);
    return Math.min(200, Math.max(2, isNaN(v) ? 9 : v));
  };
  calc.addEventListener('calc:update', (e) => {
    const d = e.detail || {};
    if (d.plan && lastPlan && d.plan !== lastPlan) pulse = 1;
    lastPlan = d.plan || lastPlan;
    if (d.lots !== N) setLots(d.lots);
  });
  if (lotsInput) lotsInput.addEventListener('input', () => { const n = readLots(); if (n !== N) setLots(n); });
  setLots(readLots());

  /* ---------- Caméra : rotation lente, ou glissé à la souris ou au doigt ---------- */
  let angle = 0.55, dragging = false, lastX = 0, idle = 0, dist = 16, lookY = 2.5;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!dragging) return; angle -= (e.clientX - lastX) * 0.008; lastX = e.clientX; idle = 0; });
  const stop = () => { dragging = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true, first = true, last = performance.now();
  if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(stage);
  const ease = (dt, speed) => (reduce ? 1 : 1 - Math.exp(-dt * speed));

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((!visible || document.hidden) && !first) return;
    const k = ease(dt, 6);

    floors.forEach((fl, f) => {
      const d = fl.userData; d.t += dt;
      if (d.t < 0) return;
      fl.visible = true;
      fl.position.y += (BASE_H + f * FH - fl.position.y) * k;
    });
    roofY += (BASE_H + L.floors * FH - roofY) * k;
    if (roof) roof.position.y = roofY;
    dying = dying.filter((o) => {
      o.scale.y *= reduce ? 0 : Math.max(0, 1 - dt * 9);
      if (o.scale.y < 0.02) { building.remove(o); return false; }
      return true;
    });

    pulse = Math.max(0, pulse - dt * 1.4);
    MAT.lit.emissiveIntensity = glowBase.lit * (1 + pulse * 0.9);
    MAT.warm.emissiveIntensity = glowBase.warm * (1 + pulse * 0.9);

    const totalH = BASE_H + L.floors * FH + RH + 0.6;
    const size = Math.max(L.W + 4.6, D + 4.6, totalH * 1.6);
    dist += (size * 1.45 + 3 - dist) * ease(dt, 2.5);
    lookY += (totalH * 0.4 - lookY) * ease(dt, 2.5);
    idle += dt;
    if (!dragging && !reduce && idle > 1.2) angle += dt * 0.14;
    const elev = 0.28;
    camera.position.set(Math.sin(angle) * dist * Math.cos(elev), lookY + dist * Math.sin(elev), Math.cos(angle) * dist * Math.cos(elev));
    camera.lookAt(0, lookY, 0);
    sun.target.position.set(0, totalH * 0.4, 0);

    renderer.render(scene, camera);
    if (first) { first = false; canvas.classList.add('is-ready'); }
  }
  requestAnimationFrame(frame);
}
