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
      totalOut.textContent = money(monthly, 2);
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
        if (!isQuote && (k === "lots" || k === "plan")) return;
        payload[k] = v;
      });
      payload.consentement = "oui";
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
