/* mäisyndic — configurateur 3D de la page Tarifs.
   L'immeuble suit le calculateur existant (site.js) : nombre de logements et formule.
   three.js n'est chargé que lorsque le calculateur approche de l'écran ; sans WebGL,
   la photo de la maquette reste affichée et le calculateur fonctionne normalement. */

const stage = document.querySelector('[data-calc-stage]');
const calc = document.querySelector('[data-calc]');

if (stage && calc) {
  const start = () => import('three').then((THREE) => init(THREE)).catch(() => {});
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '300px 0px' });
    io.observe(stage);
  } else {
    start();
  }
}

function init(THREE) {
  const canvas = stage.querySelector('canvas');
  const countEl = stage.querySelector('.stage-count');
  const countTpl = stage.getAttribute('data-count') || '{n}';
  const lotsInput = calc.querySelector('#calc-lots');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch (e) { return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#CACBCD');
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa1aa, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(7, 13, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 16, bottom: -6, near: 1, far: 45 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const unitMat = new THREE.MeshStandardMaterial({ color: '#F3F1EC', roughness: 0.85 });
  const commonMat = new THREE.MeshStandardMaterial({ color: '#E6E9EC', roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#6E7882', roughness: 0.75 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xFFC983, emissive: 0xFFA54F, emissiveIntensity: 1.1, roughness: 0.4 });

  const H = 0.62, BASE = 0.18, MAX_FLOORS = 12;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const winGeo = new THREE.BoxGeometry(0.24, 0.22, 0.02);
  const roofGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g;
  })();

  // Disposition d'un étage selon la taille de l'immeuble.
  function layout(n) {
    const perFloor = n <= 6 ? 2 : n <= 16 ? 4 : n <= 48 ? 6 : n <= 96 ? 8 : 10;
    const rows = perFloor >= 8 ? 2 : 1;
    const cols = perFloor / (2 * rows);
    // Maquette schématique : le dernier étage est toujours complet ; le compteur affiche le nombre réel.
    const shown = Math.min(Math.ceil(n / perFloor) * perFloor, perFloor * MAX_FLOORS);
    return { perFloor, rows, cols, shown, floors: Math.ceil(shown / perFloor), W: cols * 2 + 0.6, D: 1.6 };
  }
  let L = layout(9);

  function target(i) {
    const f = Math.floor(i / L.perFloor), j = i % L.perFloor;
    const perSide = L.cols * L.rows;
    const side = j < perSide ? -1 : 1, k = j % perSide;
    const col = k % L.cols, row = Math.floor(k / L.cols);
    const z = L.rows === 2 ? (row === 0 ? 0.4 : -0.4) : 0;
    return [side * (0.8 + col), BASE + f * H + H / 2, z];
  }

  function makeUnit() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(box, unitMat);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    g.userData = { body, wins: [], s: 0, t: 0, tgt: new THREE.Vector3() };
    for (let w = 0; w < 4; w++) { const m = new THREE.Mesh(winGeo, glowMat); g.add(m); g.userData.wins.push(m); }
    g.scale.setScalar(0.001);
    scene.add(g);
    return g;
  }
  // Fenêtres sur les faces extérieures, selon que le lot occupe toute la profondeur ou une rangée.
  function dressUnit(u, z) {
    const depth = L.rows === 2 ? 0.76 : 1.56;
    u.userData.body.scale.set(0.96, H * 0.92, depth);
    const faces = L.rows === 2 ? [z > 0 ? depth / 2 + 0.005 : -depth / 2 - 0.005] : [depth / 2 + 0.005, -depth / 2 - 0.005];
    u.userData.wins.forEach((m, w) => {
      const face = faces[w % faces.length];
      const x = faces.length === 2 ? (w < 2 ? -0.2 : 0.2) : (w % 2 === 0 ? -0.2 : 0.2);
      m.visible = faces.length === 2 || w < 2;
      m.position.set(x, 0.02, face);
    });
  }

  const units = [];
  const core = new THREE.Mesh(box, commonMat); core.castShadow = true; scene.add(core);
  const roof = new THREE.Mesh(roofGeo, roofMat); roof.castShadow = true; scene.add(roof);
  const plinth = new THREE.Mesh(box, commonMat); plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);
  core.scale.set(0.56, 0.01, 1.5);
  plinth.scale.set(3, BASE, 2.6);
  roof.scale.set(3, 0.85, 1.8);

  let N = 0, pulse = 0, lastPlan = '';
  function setLots(n) {
    const prev = Math.min(N, L.shown);
    N = n; L = layout(n);
    for (let i = units.length; i < L.shown; i++) {
      const u = makeUnit();
      const [x, y, z] = target(i);
      u.position.set(x, y + 1.6, z);
      u.userData.t = reduce ? 0 : -Math.max(0, i - prev) * 0.03;
      units.push(u);
    }
    units.forEach((u, i) => { if (i < L.shown) dressUnit(u, target(i)[2]); });
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

  // Caméra : rotation lente, ou glissé à la souris ou au doigt.
  let angle = 0.6, dragging = false, lastX = 0, idle = 0, dist = 12, lookY = 1.5;
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
    const k = ease(dt, 7);

    units.forEach((u, i) => {
      const d = u.userData;
      d.t += dt;
      if (d.t < 0) return;
      const alive = i < L.shown;
      if (alive) { const [x, y, z] = target(i); d.tgt.set(x, y, z); }
      u.position.lerp(d.tgt, k);
      d.s += ((alive ? 1 : 0) - d.s) * k;
      u.scale.setScalar(Math.max(0.001, d.s));
    });
    while (units.length > L.shown && units[units.length - 1].userData.s < 0.02) scene.remove(units.pop());

    const height = L.floors * H;
    core.scale.y += (height - core.scale.y) * k;
    core.position.set(0, BASE + core.scale.y / 2, 0);
    core.scale.z = L.D - 0.1;
    plinth.scale.x += (L.W + 1.2 - plinth.scale.x) * k;
    plinth.scale.z = L.D + 1;
    plinth.position.set(0, BASE / 2, 0);
    roof.scale.x += (L.W + 0.24 - roof.scale.x) * k;
    roof.scale.z = L.D + 0.2;
    roof.position.y += (BASE + height - roof.position.y) * k;

    pulse = Math.max(0, pulse - dt * 1.6);
    glowMat.emissiveIntensity = 1.1 + pulse * 1.4;

    const totalH = BASE + height + 0.85;
    const size = Math.max(L.W + 1.6, totalH * 1.45);
    dist += (size * 1.5 + 3 - dist) * ease(dt, 2.5);
    lookY += (totalH * 0.42 - lookY) * ease(dt, 2.5);
    idle += dt;
    if (!dragging && !reduce && idle > 1.2) angle += dt * 0.16;
    const elev = 0.3;
    camera.position.set(Math.sin(angle) * dist * Math.cos(elev), lookY + dist * Math.sin(elev), Math.cos(angle) * dist * Math.cos(elev));
    camera.lookAt(0, lookY, 0);

    renderer.render(scene, camera);
    if (first) { first = false; canvas.classList.add('is-ready'); }
  }
  requestAnimationFrame(frame);
}
