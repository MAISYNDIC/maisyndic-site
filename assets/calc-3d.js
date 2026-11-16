/* mäisyndic — configurateur 3D (page Tarifs et accueil).
   L'immeuble (maquette-3d.js) suit le calculateur existant (site.js) : un étage de plus
   quand les logements augmentent, plus large aux paliers de 7, 17, 49 et 97 logements.
   three.js n'est chargé que lorsque le calculateur approche de l'écran ; sans WebGL,
   la photo de la maquette reste affichée et le calculateur fonctionne normalement. */

const stage = document.querySelector('[data-calc-stage]');
const calc = document.querySelector('[data-calc]');

if (stage && calc) {
  const start = () => import(new URL('maquette-3d.js?v=2', import.meta.url).href).then(init).catch(() => {});
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '300px 0px' });
    io.observe(stage);
  } else {
    start();
  }
}

function init({ THREE, DIM, createStudio, createMaterials, createBuilder, runLoop, softwareRendering }) {
  const canvas = stage.querySelector('canvas');
  const countEl = stage.querySelector('.stage-count');
  const countTpl = stage.getAttribute('data-count') || '{n}';
  const lotsInput = calc.querySelector('#calc-lots');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.innerWidth < 700;

  let studio;
  try { studio = createStudio(canvas, { small }); } catch (e) { return; }
  const { renderer, scene, camera, sun } = studio;
  const soft = softwareRendering();
  if (soft) renderer.shadowMap.enabled = false;
  const MAT = createMaterials();
  const B = createBuilder(MAT);
  const { FH, BAY, D, RH, BASE_H } = DIM;
  const MAX_FLOORS = 12;

  function layout(n) {
    const bays = n <= 6 ? 2 : n <= 16 ? 4 : n <= 48 ? 6 : n <= 96 ? 8 : 10;
    return { bays, floors: Math.min(MAX_FLOORS, Math.ceil(n / bays)), W: bays * BAY };
  }

  const building = new THREE.Group();
  scene.add(building);
  let L = { bays: 0, floors: 0, W: 0 }, N = 0, pulse = 0, lastPlan = '';
  let floors = [], roof = null, roofY = BASE_H, dying = [];
  const retire = (obj) => dying.push(obj);

  function setLots(n) {
    const next = layout(n);
    if (next.bays !== L.bays) {
      // Nouvelle largeur : l'ancien immeuble s'efface, le nouveau se monte étage par étage.
      building.children.slice().forEach(retire);
      floors = [];
      building.add(B.makeBase(next.bays));
      roof = B.makeRoof(next.bays); building.add(roof);
      roofY = BASE_H + 2.5; roof.position.y = roofY;
    }
    const prevFloors = floors.length;
    for (let f = prevFloors; f < next.floors; f++) {
      const fl = B.makeFloor(next.bays, f);
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

  /* Caméra : rotation lente, ou glissé à la souris ou au doigt */
  let angle = 0.55, dragging = false, lastX = 0, idle = 0, dist = 16, lookY = 2.5;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!dragging) return; angle -= (e.clientX - lastX) * 0.008; lastX = e.clientX; idle = 0; });
  const stop = () => { dragging = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  const ease = (dt, speed) => (reduce ? 1 : 1 - Math.exp(-dt * speed));

  runLoop(stage, (dt, time, first) => {
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
    MAT.lit.emissiveIntensity = MAT.glowBase.lit * (1 + pulse * 0.9);
    MAT.warm.emissiveIntensity = MAT.glowBase.warm * (1 + pulse * 0.9);

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
    if (first) canvas.classList.add('is-ready');
  }, { fps: soft ? 20 : 60, maxFrameMs: soft ? 120 : 0 });
}

