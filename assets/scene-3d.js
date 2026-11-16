/* mäisyndic — scènes 3D des en-têtes de pages (ordinateur seulement).
   fonds   : la réserve du fonds de travaux se remplit année après année ;
   espace  : un téléphone au pied de l'immeuble affiche l'espace copropriétaire ;
   changer : les cartons d'archives passent de l'ancien bureau à l'immeuble.
   Chargées après l'affichage de la page ; la photo de la maquette reste visible
   tant que la scène n'est pas prête, et partout où la 3D n'est pas disponible. */

const holder = document.querySelector('.head-scene[data-scene]');
const wide = window.matchMedia('(min-width: 901px)');
const saveData = navigator.connection && navigator.connection.saveData;

// Sans accélération graphique (rendu logiciel), la photo de la maquette suffit : rien n'est chargé.
function softwareRendering() {
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

if (holder && wide.matches && !saveData && !softwareRendering()) {
  const go = () => import(new URL('maquette-3d.js?v=2', import.meta.url).href).then(init).catch(() => {});
  const idle = () => ('requestIdleCallback' in window ? window.requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 300));
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
}

function init(M) {
  const { THREE, DIM, createStudio, createMaterials, createBuilder, runLoop } = M;
  const canvas = holder.querySelector('canvas');
  const head = holder.closest('.page-head');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let studio;
  try { studio = createStudio(canvas, { shadowSize: 1024 }); } catch (e) { return; }
  const { renderer, scene, camera, sun } = studio;
  const MAT = createMaterials();
  const B = createBuilder(MAT);
  const { FH, BAY, D, BASE_H } = DIM;
  const BAYS = 4, FLOORS = 3, W = BAYS * BAY, TOP = BASE_H + FLOORS * FH;
  const kind = holder.getAttribute('data-scene');
  const scenes = { fonds: sceneFonds, espace: sceneEspace, changer: sceneChanger };
  const sceneFn = scenes[kind];
  if (!sceneFn) return;
  const ctx = { THREE, scene, MAT, B, W, D, TOP, BASE_H, reduce };
  const { update, view } = sceneFn(ctx);

  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  runLoop(holder, (dt, time, first) => {
    update(dt, time);
    // La scène occupe la partie droite du canevas (la gauche s'efface sous le texte).
    const tanH = tanV * camera.aspect;
    const span = view.x1 - view.x0;
    const d = Math.max(span / 0.64 / (2 * tanH), view.h / 0.86 / (2 * tanV)) + 1.6;
    const viewW = 2 * d * tanH;
    const cx = (view.x0 + view.x1) / 2 - viewW * 0.155;
    const sway = reduce ? 0 : Math.sin(time * 0.18) * 0.1;
    const az = view.az + sway, el = view.el;
    camera.position.set(cx + Math.sin(az) * Math.cos(el) * d, view.cy + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    camera.lookAt(cx, view.cy, 0);
    sun.target.position.set(cx, 1.5, 0);
    renderer.render(scene, camera);
    if (first) { canvas.classList.add('is-ready'); head && head.classList.add('has-scene'); }
  }, { fps: 30, maxFrameMs: 45 });
}

/* ---------- Fonds de travaux : une réserve qui se remplit année après année ---------- */
function sceneFonds({ THREE, scene, MAT, B, W, D, BASE_H, reduce }) {
  const EXTRA = 2.4;
  scene.add(B.makeBuilding(4, 3, { extra: EXTRA }));
  const tx = W / 2 + 1.75, tz = 0.35, TH = 2.6, YEARS = 10;
  const glass = new THREE.MeshStandardMaterial({ color: '#E3EEF6', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.36, depthWrite: false });
  const tank = new THREE.Mesh(new THREE.BoxGeometry(1.25, TH, 1.25), glass);
  tank.position.set(tx, BASE_H + TH / 2 + 0.04, tz);
  scene.add(tank);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.37, 0.08, 1.37), MAT.clay);
  rim.position.set(tx, BASE_H + 0.04, tz); rim.castShadow = true; rim.receiveShadow = true; scene.add(rim);
  const cap = rim.clone(); cap.position.y = BASE_H + TH + 0.08; scene.add(cap);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, TH, 0.05), MAT.clay);
    post.position.set(tx + dx * 0.64, BASE_H + 0.04 + TH / 2, tz + dz * 0.64); post.castShadow = true; scene.add(post);
  }
  const gold = new THREE.MeshStandardMaterial({ color: '#E8A33D', roughness: 0.35, metalness: 0.25, emissive: new THREE.Color('#B85F0C'), emissiveIntensity: 0.25 });
  const liquid = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1, 1.15), gold);
  liquid.position.set(tx, BASE_H + 0.08, tz); liquid.scale.y = 0.001; liquid.castShadow = false; scene.add(liquid);
  // Graduations : une par année.
  const ticks = [];
  for (let i = 1; i <= YEARS; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.012), MAT.clay);
    t.position.set(tx - 0.5, BASE_H + 0.08 + (TH - 0.15) * (i / YEARS), tz + 0.63);
    scene.add(t); ticks.push(t);
  }
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 28), gold);
  coin.castShadow = true; scene.add(coin);
  const step = (TH - 0.15) / YEARS;
  let year = 0, phase = 0, level = 0;
  const yearTime = 0.9;
  function update(dt) {
    if (reduce) { liquid.scale.y = step * 6; liquid.position.y = BASE_H + 0.08 + liquid.scale.y / 2; coin.visible = false; return; }
    phase += dt;
    if (year < YEARS) {
      // Une pièce tombe dans la réserve, puis le niveau monte d'une année.
      const p = Math.min(1, phase / yearTime);
      const fallY = BASE_H + TH + 1.2 - p * p * (TH + 1.2 - (level + 0.1));
      coin.visible = p < 0.92;
      coin.position.set(tx, fallY, tz);
      coin.rotation.x = p * 6;
      if (phase >= yearTime) { phase = 0; year++; }
    } else {
      coin.visible = false;
      if (phase > 2.2) { year = 0; phase = 0; }
    }
    const target = year >= YEARS && phase > 1.6 ? 0 : year * step;
    level += (target - level) * Math.min(1, dt * (target < level ? 3 : 5));
    liquid.scale.y = Math.max(0.001, level);
    liquid.position.y = BASE_H + 0.08 + liquid.scale.y / 2;
    ticks.forEach((t, i) => { t.material = i < year ? goldTick : MAT.clay; });
  }
  const goldTick = new THREE.MeshStandardMaterial({ color: '#C77A1E', roughness: 0.5 });
  return { update, view: { x0: -(W / 2 + 1.7), x1: W / 2 + 2.1 + EXTRA, h: 5.9, cy: 2.2, az: 0.3, el: 0.2 } };
}

/* ---------- Espace copropriétaire : un téléphone au pied de l'immeuble ---------- */
function sceneEspace({ THREE, scene, MAT, B, W, D, BASE_H, reduce }) {
  const EXTRA = 2.2;
  scene.add(B.makeBuilding(4, 3, { extra: EXTRA }));
  const txt = Object.assign({
    app: 'mäisyndic', residence: 'Résidence Les Tilleuls', sub: 'Exemple · 9 lots', balanceK: 'Votre solde', balanceV: '0,00 €',
    agK: 'Prochaine AG', agV: 'Mar. 9 mars, 16 h', fundK: 'Fonds de travaux', fundV: '18 450 €', docsK: 'Derniers documents',
    docs: ['Décompte des charges 2025', 'Procès-verbal de l\'AG 2026', 'Contrat d\'entretien'],
  }, JSON.parse(holder.getAttribute('data-i18n') || '{}'));
  const SW = 360, SH = 720;
  const cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
  const x = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const rr = (X, Y, w, h, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
  const font = (w, s) => `${w} ${s}px Inter, "Segoe UI", system-ui, sans-serif`;
  function draw(t) {
    const fill = Math.min(1, (t % 6) / 3.2) * 0.62;
    x.fillStyle = '#F2F6F9'; x.fillRect(0, 0, SW, SH);
    x.fillStyle = '#0B5FA5'; x.fillRect(0, 0, SW, 132);
    x.fillStyle = '#FFFFFF'; x.font = font(700, 26); x.fillText(txt.app, 26, 62);
    x.font = font(500, 18); x.fillStyle = 'rgba(255,255,255,0.86)'; x.fillText(txt.residence, 26, 96);
    x.font = font(400, 15); x.fillText(txt.sub, 26, 118);
    const card = (Y, h) => { x.fillStyle = '#FFFFFF'; rr(18, Y, SW - 36, h, 18); x.fill(); };
    card(152, 104);
    x.fillStyle = '#4A5B6A'; x.font = font(500, 16); x.fillText(txt.balanceK, 38, 184);
    x.fillStyle = '#0E1E2C'; x.font = font(300, 40); x.fillText(txt.balanceV, 38, 232);
    card(272, 92);
    x.fillStyle = '#4A5B6A'; x.font = font(500, 16); x.fillText(txt.agK, 38, 304);
    x.fillStyle = '#0E1E2C'; x.font = font(700, 20); x.fillText(txt.agV, 38, 338);
    card(380, 112);
    x.fillStyle = '#4A5B6A'; x.font = font(500, 16); x.fillText(txt.fundK, 38, 412);
    x.fillStyle = '#0E1E2C'; x.font = font(700, 20); x.fillText(txt.fundV, 38, 444);
    x.fillStyle = '#E3E9EE'; rr(38, 460, SW - 76, 12, 6); x.fill();
    x.fillStyle = '#0B5FA5'; rr(38, 460, Math.max(12, (SW - 76) * fill), 12, 6); x.fill();
    card(508, 186);
    x.fillStyle = '#4A5B6A'; x.font = font(500, 16); x.fillText(txt.docsK, 38, 540);
    txt.docs.slice(0, 3).forEach((d, i) => {
      const Y = 566 + i * 40;
      x.fillStyle = '#E3EEF8'; rr(38, Y, 28, 28, 7); x.fill();
      x.fillStyle = '#0E1E2C'; x.font = font(500, 16);
      let label = d; while (x.measureText(label).width > SW - 130 && label.length > 4) label = label.slice(0, -2);
      x.fillText(label === d ? d : label + '…', 78, Y + 20);
    });
    tex.needsUpdate = true;
  }
  const phone = new THREE.Group();
  const shell = new THREE.Mesh(new M_RBox(THREE, 1.12, 2.24, 0.1), new THREE.MeshStandardMaterial({ color: '#121A22', roughness: 0.3, metalness: 0.55 }));
  shell.castShadow = true; phone.add(shell);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.052; phone.add(screen);
  phone.position.set(W / 2 + 1.55, BASE_H + 1.45, D / 2 + 0.25);
  phone.rotation.y = -0.38;
  scene.add(phone);
  let acc = 0;
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => draw(0));
  function update(dt, time) {
    if (reduce) return;
    phone.position.y = BASE_H + 1.45 + Math.sin(time * 1.1) * 0.06;
    phone.rotation.y = -0.38 + Math.sin(time * 0.5) * 0.06;
    acc += dt;
    if (acc > 0.1) { acc = 0; draw(time); }
  }
  return { update, view: { x0: -(W / 2 + 1.7), x1: W / 2 + 2.1 + EXTRA, h: 5.9, cy: 2.15, az: 0.3, el: 0.18 } };
}
// Boîtier arrondi du téléphone (sans dépendance supplémentaire).
function M_RBox(THREE, w, h, d) {
  const r = 0.14, s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

/* ---------- Changer de syndic : les archives passent à l'immeuble ---------- */
function sceneChanger({ THREE, scene, MAT, B, W, D, BASE_H, reduce }) {
  const EXTRA = 3.2;
  scene.add(B.makeBuilding(4, 3, { extra: EXTRA }));
  // L'ancien bureau : un petit volume gris, fenêtres éteintes.
  const officeMat = new THREE.MeshStandardMaterial({ color: '#AEB4BA', roughness: 0.9 });
  const ox = W / 2 + 2.5, oz = -0.2;
  const office = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.45, 1.5), officeMat);
  office.position.set(ox, BASE_H + 0.725, oz); office.castShadow = true; office.receiveShadow = true; scene.add(office);
  for (const dx of [-0.38, 0.38]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.02), MAT.dark);
    w.position.set(ox + dx, BASE_H + 0.86, oz + 0.76); scene.add(w);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.7, 0.4), MAT.dark);
  door.position.set(ox - 0.86, BASE_H + 0.37, oz + 0.1); scene.add(door);
  // Cartons d'archives sur un arc, de la porte de l'ancien bureau à l'entrée de l'immeuble.
  const cardboard = new THREE.MeshStandardMaterial({ color: '#C9A27A', roughness: 0.85 });
  const lid = new THREE.MeshStandardMaterial({ color: '#B58C63', roughness: 0.8 });
  const start = new THREE.Vector3(ox - 0.95, BASE_H + 0.3, oz + 0.1);
  const end = new THREE.Vector3(0.0, BASE_H + 0.3, D / 2 + 0.25);
  const curve = new THREE.QuadraticBezierCurve3(start, new THREE.Vector3((start.x + end.x) / 2 + 0.4, BASE_H + 2.4, 1.6), end);
  const boxes = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.34), cardboard); body.castShadow = true; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.05, 0.37), lid); top.position.y = 0.185; g.add(top);
    g.userData.offset = i / 5;
    scene.add(g); boxes.push(g);
  }
  let pulse = 0;
  function update(dt, time) {
    const speed = 0.22;
    boxes.forEach((g) => {
      const p = reduce ? g.userData.offset : (time * speed + g.userData.offset) % 1;
      curve.getPointAt(p, g.position);
      const s = p < 0.08 ? p / 0.08 : p > 0.9 ? Math.max(0.001, (1 - p) / 0.1) : 1;
      g.scale.setScalar(s);
      g.rotation.y = -0.6 + p * 1.2;
      g.rotation.z = Math.sin(p * Math.PI) * 0.25;
      if (!reduce && p > 0.985) pulse = 1;
    });
    pulse = Math.max(0, pulse - dt * 2);
    MAT.lit.emissiveIntensity = MAT.glowBase.lit * (1 + pulse * 0.5);
  }
  return { update, view: { x0: -(W / 2 + 1.7), x1: W / 2 + 2.1 + EXTRA, h: 5.9, cy: 2.1, az: 0.3, el: 0.2 } };
}
