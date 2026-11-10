/* mäisyndic — page d'accueil animée : vidéo du haut de page, progression du récit 3D, chargement de la maquette.
   Le texte reste lisible et complet même si ce script ou la 3D ne se chargent pas. */
(function () {
  "use strict";
  var hero = document.getElementById("mx-hero");
  var storyEl = document.getElementById("mx-story");
  if (!hero || !storyEl) return;
  var scriptSrc = (document.currentScript && document.currentScript.src) || location.href;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }
  function smooth(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  /* Hauteur de l'en-tête collant : les scènes se placent juste en dessous */
  var header = document.querySelector(".site-header");
  function syncTop() {
    var h = header ? Math.round(header.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--mx-top", h + "px");
  }
  syncTop();

  /* ---------- 1. Haut de page : images de la vidéo, en boucle puis au défilement ---------- */
  var FRAMES = 121, base = new URL("hero/", scriptSrc).href;
  var canvas = document.getElementById("mx-hero-canvas");
  var ctx = canvas.getContext("2d");
  var heroCopy = hero.querySelector(".mx-hero-copy");
  var heroEnd = hero.querySelector(".mx-hero-end");
  var heroFade = hero.querySelector(".mx-fade");
  var probe = document.createElement("canvas"); probe.width = 32; probe.height = 18;
  var probeCtx = probe.getContext("2d", { willReadFrequently: true });
  var frames = new Array(FRAMES), loadedCount = 0;
  var heroP = 0, shown = -1, cur = 0;

  /* Aller-retour sans coupure : l'immeuble tourne et s'allume, reste allumé, puis revient en s'éteignant */
  var FWD = 6500, HOLD_END = 2200, BACK = 6500, HOLD_START = 900, CYCLE = FWD + HOLD_END + BACK + HOLD_START;
  var autoStart = null, auto = reduced ? 1 : 0, pageStart = performance.now();
  function ease(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  function loopAt(t) {
    t = t % CYCLE;
    if (t < FWD) return ease(t / FWD);
    t -= FWD; if (t < HOLD_END) return 1;
    t -= HOLD_END; if (t < BACK) return 1 - ease(t / BACK);
    return 0;
  }

  function pad(n) { return ("00" + n).slice(-3); }
  function loadFrame(i) {
    if (frames[i]) return;
    var img = new Image();
    img.decoding = "async";
    img.onload = function () { loadedCount++; shown = -1; };
    img.src = base + "f" + pad(i + 1) + ".webp";
    frames[i] = img;
  }
  loadFrame(reduced ? FRAMES - 1 : 0);
  [8, 4, 2, 1].forEach(function (step, pass) {
    setTimeout(function () { for (var i = 0; i < FRAMES; i += step) loadFrame(i); }, 150 + pass * 250);
  });
  function nearest(i) {
    for (var d = 0; d < FRAMES; d++) {
      var a = frames[i - d], b = frames[i + d];
      if (a && a.complete && a.naturalWidth) return a;
      if (b && b.complete && b.naturalWidth) return b;
    }
    return null;
  }
  function sample(img, x, y, w, h) {
    try {
      probeCtx.drawImage(img, 0, 0, 32, 18);
      var d = probeCtx.getImageData(x, y, w, h).data, r = 0, g = 0, b = 0, n = d.length / 4;
      for (var k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    } catch (e) { return [204, 204, 206]; }
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    shown = -1;
  }
  function draw(i) {
    var img = nearest(i), W = canvas.width, H = canvas.height;
    if (!img) { ctx.fillStyle = "rgb(204,204,206)"; ctx.fillRect(0, 0, W, H); return; }
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (canvas.clientWidth > 860) {
      /* Hauteur pleine, l'immeuble à droite du texte ; la bande libre reprend la couleur du studio */
      var s = Math.max(H / ih, (W * 0.62) / iw), dw = iw * s, dh = ih * s;
      var dx = Math.min(W * 0.64 - dw / 2, W * 0.42), dy = (H - dh) / 2;
      var L = sample(img, 1, 3, 1, 10), R = sample(img, 30, 3, 1, 10);
      ctx.fillStyle = rgba(L, 1); ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, dx, dy, dw, dh);
      if (dx > 0) {
        var fw = dw * 0.16, gl = ctx.createLinearGradient(dx, 0, dx + fw, 0);
        gl.addColorStop(0, rgba(L, 1)); gl.addColorStop(1, rgba(L, 0));
        ctx.fillStyle = gl; ctx.fillRect(dx - 1, 0, fw + 1, H);
      }
      if (dx + dw < W) {
        var fr = dw * 0.16, gr = ctx.createLinearGradient(dx + dw, 0, dx + dw - fr, 0);
        gr.addColorStop(0, rgba(R, 1)); gr.addColorStop(1, rgba(R, 0));
        ctx.fillStyle = gr; ctx.fillRect(dx + dw - fr, 0, fr + 1, H);
        ctx.fillStyle = rgba(R, 1); ctx.fillRect(dx + dw, 0, W - dx - dw, H);
      }
      return;
    }
    /* Téléphone : l'image en haut, fondue dans la couleur du studio vers le texte */
    var top = sample(img, 0, 0, 5, 1), bot = sample(img, 0, 17, 5, 1);
    var s2 = Math.max((W * 1.62) / iw, (H * 0.44) / ih), w2 = iw * s2, h2 = ih * s2;
    var x2 = (W - w2) / 2, y2 = Math.max(H * 0.04, H * 0.3 - h2 / 2);
    ctx.fillStyle = rgba(top, 1); ctx.fillRect(0, 0, W, y2 + 2);
    ctx.fillStyle = rgba(bot, 1); ctx.fillRect(0, y2 + h2 - 2, W, H);
    ctx.drawImage(img, x2, y2, w2, h2);
    var f = h2 * 0.18, g = ctx.createLinearGradient(0, y2 + h2 - f, 0, y2 + h2);
    g.addColorStop(0, rgba(bot, 0)); g.addColorStop(1, rgba(bot, 1));
    ctx.fillStyle = g; ctx.fillRect(0, y2 + h2 - f, W, f + 1);
    var g2 = ctx.createLinearGradient(0, y2, 0, y2 + f * 0.6);
    g2.addColorStop(0, rgba(top, 1)); g2.addColorStop(1, rgba(top, 0));
    ctx.fillStyle = g2; ctx.fillRect(0, y2 - 1, W, f * 0.6);
  }
  var heroVisible = true;
  function heroLoop(now) {
    now = now || performance.now();
    if (heroVisible) {
      if (autoStart === null && !reduced && frames[0] && frames[0].complete &&
          (loadedCount >= FRAMES * 0.9 || now - pageStart > 3500)) autoStart = now + 400;
      if (autoStart !== null && now >= autoStart) auto = loopAt(now - autoStart);
      var goal = auto + (1 - auto) * smooth(0.03, 0.4, heroP);
      cur += (goal - cur) * (reduced ? 1 : 0.16);
      var i = Math.round(cur * (FRAMES - 1));
      if (i !== shown) { draw(i); shown = i; }
    }
    requestAnimationFrame(heroLoop);
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { heroVisible = en[0].isIntersecting; }).observe(hero);
  }
  function readHero() {
    var r = hero.getBoundingClientRect(), vh = window.innerHeight;
    var p = clamp01(-r.top / Math.max(1, r.height - vh));
    heroP = p;
    var out = smooth(0.4, 0.58, p);
    heroCopy.style.opacity = (1 - out).toFixed(3);
    heroCopy.style.transform = reduced ? "" : "translateY(" + (-out * 40).toFixed(1) + "px)";
    heroCopy.style.visibility = out > 0.99 ? "hidden" : "visible";
    var inn = smooth(0.64, 0.8, p);
    heroEnd.style.opacity = inn.toFixed(3);
    heroEnd.style.transform = reduced ? "" : "translateY(" + ((1 - inn) * 30).toFixed(1) + "px)";
    heroFade.style.opacity = smooth(0.84, 1, p).toFixed(3);
  }

  /* ---------- 2. Récit 3D : progression entre les chapitres ---------- */
  var story = window.__mxStory = { target: 0 };
  var chapters = Array.prototype.slice.call(storyEl.querySelectorAll(".mx-chapter"));
  var copies = chapters.map(function (c) { return c.querySelector(".mx-copy"); });
  var timeline = document.getElementById("mx-timeline");
  var tlLinks = timeline ? Array.prototype.slice.call(timeline.querySelectorAll("a")) : [];
  var fills = timeline ? Array.prototype.slice.call(timeline.querySelectorAll("i b")) : [];
  function readStory() {
    var vh = window.innerHeight, y = window.scrollY;
    var ks = chapters.map(function (c) { var r = c.getBoundingClientRect(); return y + r.top + r.height / 2 - vh / 2; });
    var p = 0;
    for (var i = 0; i < ks.length - 1; i++) {
      if (y >= ks[i]) p = i + smooth(0.1, 0.9, (y - ks[i]) / Math.max(1, ks[i + 1] - ks[i]));
    }
    story.target = Math.min(ks.length - 1, Math.max(0, p));
    var active = Math.round(story.target);
    tlLinks.forEach(function (a) { a.classList.toggle("is-on", +a.dataset.ch === active); });
    fills.forEach(function (b, i) { b.style.transform = "scaleX(" + clamp01(story.target - i + 1).toFixed(3) + ")"; });
    var sr = storyEl.getBoundingClientRect();
    if (timeline) timeline.classList.toggle("is-visible", sr.top < vh * 0.5 && sr.bottom > vh * 0.6);
    copies.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var d = (r.top + r.height / 2 - vh / 2) / vh;
      var o = 1 - Math.min(1, Math.max(0, Math.abs(d) - 0.2) * 1.7);
      el.style.opacity = (0.12 + 0.88 * o).toFixed(3);
      if (!reduced) el.style.transform = "translateY(" + (d * 46).toFixed(1) + "px)";
    });
  }

  function read() { readHero(); readStory(); }
  window.addEventListener("scroll", read, { passive: true });
  window.addEventListener("resize", function () { syncTop(); size(); read(); });
  size(); read();
  requestAnimationFrame(heroLoop);

  /* ---------- Maquette 3D : chargée seulement à l'approche de la section ---------- */
  var fallback = document.getElementById("mx-fallback");
  var requested = false;
  function load3d() {
    if (requested) return;
    requested = true;
    import(new URL("home-3d.js?v=3", scriptSrc).href).catch(function () { if (fallback) fallback.hidden = false; });
    setTimeout(function () { if (!window.__mxSceneReady && fallback) fallback.hidden = false; }, 12000);
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { load3d(); io.disconnect(); }
    }, { rootMargin: "900px 0px" });
    io.observe(storyEl);
  } else {
    load3d();
  }
})();
