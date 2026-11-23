/* mäisyndic — scripts du site : menu mobile, calculateur de prix, formulaire de devis. */
(function () {
  "use strict";

  /* ---------- Menu mobile ---------- */
  var toggle = document.querySelector(".menu-toggle");
  var panel = document.getElementById("site-nav");
  if (toggle && panel) {
    toggle.addEventListener("click", function () {
      var open = panel.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  var lang = (document.documentElement.getAttribute("lang") || "fr").slice(0, 2);
  var locales = { fr: "fr-FR", de: "de-LU", en: "en-GB", pt: "pt-PT" };
  var locale = locales[lang] || "fr-LU";

  function money(value, decimals) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value);
    } catch (e) {
      return value.toFixed(decimals) + " €";
    }
  }

  /* ---------- Calculateur ---------- */
  var calc = document.querySelector("[data-calc]");
  if (calc) {
    var lotsInput = calc.querySelector("#calc-lots");
    var totalOut = calc.querySelector("[data-total]");
    var perOut = calc.querySelector("[data-per-out]");
    var warn = calc.querySelector("[data-warn]");
    var big = calc.querySelector("[data-big]");
    var cta = calc.querySelector("[data-calc-cta]");
    var perTemplate = calc.getAttribute("data-per") || "{value}";

    function currentPlan() {
      return calc.querySelector("input[name='calc-plan']:checked");
    }

    var minNote = calc.querySelector("[data-min-note]");
    var resultBox = calc.querySelector(".calc-result");
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var shownTotal = null, tweenFrame = 0;

    // Le total glisse vers sa nouvelle valeur ; les lecteurs d'écran n'entendent que la valeur finale.
    function showTotal(value) {
      if (shownTotal === null || reduceMotion || !window.requestAnimationFrame) {
        shownTotal = value; totalOut.textContent = money(value, 2); return;
      }
      var from = shownTotal, start = performance.now(), duration = 420;
      cancelAnimationFrame(tweenFrame);
      if (resultBox) resultBox.setAttribute("aria-busy", "true");
      (function step(now) {
        var t = Math.min(1, (now - start) / duration), e = 1 - Math.pow(1 - t, 4);
        shownTotal = from + (value - from) * e;
        totalOut.textContent = money(shownTotal, 2);
        if (t < 1) { tweenFrame = requestAnimationFrame(step); return; }
        shownTotal = value; totalOut.textContent = money(value, 2);
        if (resultBox) resultBox.removeAttribute("aria-busy");
      })(start);
    }

    // Prix du palier correspondant au nombre de logements (appliqué à tout l'immeuble).
    function rateFor(input, lots) {
      var tiers = JSON.parse(input.getAttribute("data-tiers") || "[]");
      for (var i = 0; i < tiers.length; i++) {
        if (tiers[i][0] === null || lots <= tiers[i][0]) return tiers[i][1];
      }
      return 0;
    }

    function update() {
      var lots = parseInt(lotsInput.value, 10);
      if (isNaN(lots) || lots < 2) lots = 2;
      if (lots > 200) lots = 200;
      calc.querySelectorAll("input[name='calc-plan']").forEach(function (r) {
        var out = r.parentNode.querySelector("[data-rate]");
        if (out) out.textContent = money(rateFor(r, lots), 2);
      });
      var plan = currentPlan();
      var rate = plan ? rateFor(plan, lots) : 0;
      var min = plan ? parseFloat(plan.getAttribute("data-min")) || 0 : 0;
      var monthly = Math.max(rate * lots, min);
      showTotal(monthly);
      calc.dispatchEvent(new CustomEvent("calc:update", { detail: { lots: lots, plan: plan ? plan.value : "" } }));
      perOut.textContent = perTemplate.replace("{value}", money(monthly * 12, 0));
      if (minNote) minNote.hidden = !(rate * lots < min);
      warn.hidden = !(plan && plan.value === "benevole" && lots > 9);
      big.hidden = lots <= 50;
      if (cta && plan) {
        cta.setAttribute("href", "contact.html?lots=" + lots + "&plan=" + encodeURIComponent(plan.value) + "#devis");
      }
    }

    calc.querySelectorAll("[data-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var step = parseInt(btn.getAttribute("data-step"), 10);
        var lots = parseInt(lotsInput.value, 10) || 9;
        lotsInput.value = Math.min(200, Math.max(2, lots + step));
        update();
      });
    });
    lotsInput.addEventListener("input", update);
    lotsInput.addEventListener("change", function () {
      var lots = parseInt(lotsInput.value, 10);
      if (isNaN(lots) || lots < 2) lotsInput.value = 2;
      if (lots > 200) lotsInput.value = 200;
      update();
    });
    calc.querySelectorAll("input[name='calc-plan']").forEach(function (r) {
      r.addEventListener("change", update);
    });
    update();
  }

  /* ---------- Bouton « Calculer mon prix » sur téléphone ---------- */
  var ctaText = { fr: "Calculer mon prix", de: "Preis berechnen", en: "Calculate my price", pt: "Calcular o meu preço" };
  var footer = document.querySelector(".site-footer");
  if (/\/(fr|de|en|pt)\//.test(location.pathname) && !/(tarifs|contact|devis-syndic)\.html$/.test(location.pathname) && footer && window.IntersectionObserver) {
    var bar = document.createElement("div");
    bar.className = "mobile-cta";
    var link = document.createElement("a");
    link.className = "btn btn-primary";
    // Sur une page qui a son propre calculateur (l'accueil), le bouton y mène directement.
    var calcSection = calc ? calc.closest("section") : null;
    link.href = calcSection && calcSection.id ? "#" + calcSection.id : "tarifs.html#calcul";
    link.textContent = ctaText[lang] || ctaText.fr;
    bar.appendChild(link);
    document.body.appendChild(bar);
    var footerSeen = false, calcSeen = false;
    var refreshBar = function () { bar.classList.toggle("is-visible", window.scrollY > window.innerHeight * 0.6 && !footerSeen && !calcSeen); };
    new IntersectionObserver(function (entries) { footerSeen = entries[0].isIntersecting; refreshBar(); }).observe(footer);
    if (calcSection) new IntersectionObserver(function (entries) { calcSeen = entries[0].isIntersecting; refreshBar(); }).observe(calcSection);
    window.addEventListener("scroll", refreshBar, { passive: true });
    refreshBar();
  }

  /* ---------- Formulaire de devis ---------- */
  var form = document.querySelector("[data-quote-form]");
  if (form) {
    var result = document.querySelector("[data-form-result]");
    var errorBox = form.querySelector("[data-form-error]");
    var submitBtn = form.querySelector("button[type='submit']");
    var endpoint = form.getAttribute("data-endpoint") || "";

    var objet = form.querySelector("#q-objet");

    // Préremplissage depuis le calculateur ou l'encart vente (?lots=…&plan=…&objet=…)
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("lots")) form.querySelector("#q-lots").value = params.get("lots");
      if (params.get("plan")) form.querySelector("#q-plan").value = params.get("plan");
      if (params.get("objet") && objet) objet.value = params.get("objet");
      if (params.get("commune")) form.querySelector("#q-commune").value = params.get("commune");
    } catch (e) { /* ignoré */ }

    // Les champs propres au devis de syndic disparaissent pour une vente ou une location.
    function syncObjet() {
      var quote = !objet || objet.value === "devis";
      form.querySelectorAll("[data-quote-only]").forEach(function (el) { el.hidden = !quote; });
      var lots = form.querySelector("#q-lots");
      if (lots) {
        if (quote) {
          lots.setAttribute("required", "");
        } else {
          lots.removeAttribute("required");
          lots.setAttribute("aria-invalid", "false");
        }
      }
    }
    if (objet) objet.addEventListener("change", syncObjet);
    syncObjet();

    function fieldLabel(el) {
      var l = form.querySelector("label[for='" + el.id + "']");
      return l ? l.textContent.replace(/\s*\*$/, "").trim() : el.name;
    }

    function buildSummary() {
      var lines = [];
      form.querySelectorAll("input, select, textarea").forEach(function (el) {
        if (el.type === "checkbox" || el.type === "submit" || !el.id || el.name === "_honey") return;
        if (el.closest("[hidden]")) return;
        var v = el.tagName === "SELECT" ? el.options[el.selectedIndex].text : el.value.trim();
        if (v) lines.push(fieldLabel(el) + " : " + v);
      });
      return lines.join("\n");
    }

    function showResult(title, text, summary) {
      result.querySelector("[data-result-title]").textContent = title;
      result.querySelector("[data-result-text]").textContent = text;
      var pre = result.querySelector("[data-summary]");
      var copyBtn = result.querySelector("[data-copy]");
      if (summary) {
        pre.textContent = summary;
        pre.hidden = false;
        copyBtn.hidden = false;
      } else {
        pre.hidden = true;
        copyBtn.hidden = true;
      }
      form.hidden = true;
      result.hidden = false;
      result.focus();
    }

    var copyBtn = result.querySelector("[data-copy]");
    copyBtn.addEventListener("click", function () {
      var pre = result.querySelector("[data-summary]");
      var text = pre.textContent;
      function selectText() {
        var range = document.createRange();
        range.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = copyBtn.getAttribute("data-copied");
        }, selectText);
      } else {
        selectText();
      }
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var invalid = [];
      form.querySelectorAll("[required]").forEach(function (el) {
        var ok = el.type === "checkbox" ? el.checked : el.value.trim() !== "" && el.checkValidity();
        el.setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok) invalid.push(el);
      });
      if (invalid.length) {
        errorBox.hidden = false;
        invalid[0].focus();
        return;
      }
      errorBox.hidden = true;
      var summary = buildSummary();
      var d = form.dataset;

      // Piège à robots : un humain ne remplit jamais ce champ invisible.
      var honey = form.querySelector("[name='_honey']");
      if (honey && honey.value) {
        showResult(d.okTitle, d.okText, "");
        return;
      }

      if (!endpoint) {
        showResult(d.fallbackTitle, d.fallbackText, summary);
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = d.sending;
      var payload = {};
      var isQuote = !objet || objet.value === "devis";
      new FormData(form).forEach(function (v, k) {
        if (k === "_honey" || k === "consent") return;
        if (!isQuote && (k === "lots" || k === "plan" || k === "residence")) return;
        payload[k] = v;
      });
      payload.information_lue = "oui"; // case « J'ai lu la politique de protection des données » (pas un consentement)
      payload.page_lang = lang;
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().then(function (data) {
          var ok = res.ok && data && (data.success === true || data.success === "true");
          if (!ok) throw new Error("Envoi refusé");
          showResult(d.okTitle, d.okText, "");
        });
      }).catch(function () {
        showResult(d.fallbackTitle, d.fail, summary);
      });
    });
  }
})();

/* Mesure d'audience anonyme (stats/collect.php) : ni cookie, ni identifiant, ni adresse IP.
   Envoie la page vue, le site d'origine et quelques actions (calculateur, téléphone, e-mail,
   fiche Google, Facebook, WhatsApp). Désactivée hors de maisyndic.lu, pour les navigateurs qui demandent
   à ne pas être suivis, et sur le navigateur du gérant (adresse terminée par #nostats). */
(function () {
  "use strict";
  var ls = null;
  try { ls = window.localStorage; } catch (e) {}
  if (location.hash === "#nostats" && ls) { try { ls.setItem("mx-nostats", "1"); } catch (e) {} }
  if (location.hostname !== "maisyndic.lu" || navigator.webdriver) return;
  if (navigator.globalPrivacyControl || navigator.doNotTrack === "1") return;
  try { if (ls && ls.getItem("mx-nostats") === "1") return; } catch (e) {}

  var lang = (document.documentElement.lang || "").slice(0, 2);
  function send(e, extra) {
    var data = { e: e, p: location.pathname, l: lang };
    if (extra) for (var k in extra) data[k] = extra[k];
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/stats/collect.php", new Blob([body], { type: "text/plain" }))) return;
    } catch (err) {}
    try { fetch("/stats/collect.php", { method: "POST", body: body, keepalive: true, credentials: "omit" }); } catch (err) {}
  }

  var nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || {};
  var repeat = nav.type === "reload" || nav.type === "back_forward";
  var utm = (location.search.match(/[?&]utm_source=([^&#]*)/) || [])[1] || "";
  send("view", { r: repeat ? location.origin + "/" : document.referrer, u: repeat ? "" : decodeURIComponent(utm) });

  // Calculateur : compté une fois par page, au premier geste du visiteur (pas au calcul initial).
  var calcSent = false;
  function calcUsed(ev) {
    if (calcSent || !ev.target.closest || !ev.target.closest("[data-calc]")) return;
    if (ev.type === "click" && !ev.target.closest("button, label")) return;
    calcSent = true;
    send("calc");
  }
  ["input", "change", "click"].forEach(function (t) { document.addEventListener(t, calcUsed, true); });

  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    var h = a.getAttribute("href");
    if (h.indexOf("tel:") === 0) send("tel");
    else if (h.indexOf("mailto:") === 0) send("mail");
    else if (/maps\.google\.|google\.[a-z.]+\/maps|g\.page/.test(h)) send("google");
    else if (/facebook\.com/.test(h)) send("facebook");
    else if (/^https:\/\/wa\.me\//.test(h)) send("whatsapp");
  }, true);
})();
