/* واجهة التطبيق: تبديل الوضع الليلي، قائمة الجوال، ونسخ النصوص. */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- الوضع الليلي / النهاري ---------- */
  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch (e) {
      /* التخزين المحلي قد يكون معطّلاً — نتجاهل الخطأ */
    }
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute(
        "aria-label",
        theme === "dark" ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي"
      );
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  });
  applyTheme(currentTheme());

  /* ---------- قائمة التنقل على الجوال ---------- */
  var body = document.body;

  function closeNav() {
    body.classList.remove("nav-open");
    document.querySelectorAll("[data-nav-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
    });
  }

  document.querySelectorAll("[data-nav-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var open = body.classList.toggle("nav-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  var scrim = document.querySelector("[data-nav-scrim]");
  if (scrim) scrim.addEventListener("click", closeNav);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeNav();
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 960) closeNav();
  });

  /* ---------- رسالة سريعة (Toast) ---------- */
  var toastEl = null;
  var toastTimer = null;

  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-visible");
    }, 2200);
  }

  /* ---------- نسخ النصوص ---------- */
  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    body.removeChild(area);
    return ok;
  }

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var selector = btn.getAttribute("data-copy");
      var target = selector ? document.querySelector(selector) : null;
      var text = target ? target.textContent.trim() : "";
      if (!text) return;

      var done = function () { toast("تم النسخ ✓"); };
      var failed = function () { toast("تعذّر النسخ"); };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () {
          legacyCopy(text) ? done() : failed();
        });
      } else {
        legacyCopy(text) ? done() : failed();
      }
    });
  });

  /* ---------- إظهار/إخفاء القيم الحسّاسة ---------- */
  document.querySelectorAll("[data-reveal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.querySelector(btn.getAttribute("data-reveal"));
      if (!target) return;
      var hidden = target.classList.toggle("is-masked");
      btn.textContent = hidden ? "إظهار" : "إخفاء";
    });
  });

  /* ---------- حاسبة التسعير والضريبة ---------- */
  var calcRoot = document.querySelector("[data-vat-rate]");
  if (calcRoot) {
    var vatRate = parseFloat(calcRoot.getAttribute("data-vat-rate")) || 0.15;

    var fmt = function (n) {
      if (!isFinite(n)) return "—";
      return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    var val = function (id) {
      var el = document.getElementById(id);
      var n = el ? parseFloat(el.value) : NaN;
      return isFinite(n) && n >= 0 ? n : 0;
    };
    var put = function (id, n) {
      var el = document.getElementById(id);
      if (el) el.textContent = fmt(n);
    };

    var recalcPricing = function () {
      var cost = val("cost");
      var margin = val("margin");
      var withVat = document.getElementById("includeVat");
      var profit = cost * (margin / 100);
      var net = cost + profit;
      var vat = withVat && withVat.checked ? net * vatRate : 0;

      put("outProfit", profit);
      put("outNet", net);
      put("outVat", vat);
      put("outGross", net + vat);
    };

    var recalcExtract = function () {
      var gross = val("gross");
      var base = gross / (1 + vatRate);
      put("outBase", base);
      put("outTaxOnly", gross - base);
    };

    ["cost", "margin", "includeVat"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", recalcPricing);
      if (el) el.addEventListener("change", recalcPricing);
    });
    var grossEl = document.getElementById("gross");
    if (grossEl) grossEl.addEventListener("input", recalcExtract);

    recalcPricing();
    recalcExtract();
  }

  /* ---------- مولّد رسائل واتساب ---------- */
  var waMessage = document.getElementById("waMessage");

  document.querySelectorAll("[data-wa-template]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!waMessage) return;
      waMessage.value = btn.getAttribute("data-wa-template") || "";
      waMessage.focus();
    });
  });

  document.querySelectorAll("[data-wa-send]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var number = btn.getAttribute("data-wa-number");
      if (!number) return;
      var name = btn.getAttribute("data-wa-name") || "";
      var text = (waMessage ? waMessage.value : "").replace(/\{name\}/g, name).trim();
      var url = "https://wa.me/" + number + (text ? "?text=" + encodeURIComponent(text) : "");
      window.open(url, "_blank", "noopener");
    });
  });

  /* ---------- تأكيد قبل الإجراءات المدمّرة ---------- */
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!window.confirm(form.getAttribute("data-confirm"))) e.preventDefault();
    });
  });

  /* ---------- محرّر قواعد الأتمتة ---------- */
  var ruleForm = document.querySelector("[data-automation-form]");
  if (ruleForm) {
    var parse = function (attr) {
      try { return JSON.parse(ruleForm.getAttribute(attr) || "{}"); } catch (e) { return {}; }
    };
    var variablesByEvent = parse("data-variables");
    var samplesByEvent = parse("data-samples");

    var eventSelect = ruleForm.querySelector("[data-event-select]");
    var templateBox = ruleForm.querySelector("#template");
    var chipsRow = ruleForm.querySelector("[data-variable-chips]");
    var preview = ruleForm.querySelector("[data-template-preview]");
    var conditionField = ruleForm.querySelector("[data-condition-field]");
    var currentCondition = (ruleForm.querySelector("[data-current-condition]") || {}).value || "";

    // قيم تجريبية للمعاينة فقط
    var SAMPLE_VALUES = {
      customer_name: "سارة العتيبي", store_name: "متجر النخبة", store_domain: "https://store.salla.sa",
      order_id: "40001", order_total: "350", order_currency: "ر.س", order_status: "تم التنفيذ",
      items_count: "2", items_list: "2× قميص قطن، 1× حزام جلد", payment_method: "mada",
      tracking_number: "SP123456789", shipping_company: "سمسا",
      cart_total: "210", cart_currency: "ر.س", cart_url: "https://store.salla.sa/cart",
      customer_city: "الرياض", product_name: "عطر شرقي 100مل", product_sku: "SKU-104",
      quantity: "2", date: "٢٢ أغسطس ٢٠٢٦", event: "order.created",
    };

    var insertAtCursor = function (text) {
      if (!templateBox) return;
      var start = templateBox.selectionStart || 0;
      var end = templateBox.selectionEnd || 0;
      var value = templateBox.value;
      templateBox.value = value.slice(0, start) + text + value.slice(end);
      var pos = start + text.length;
      templateBox.focus();
      templateBox.setSelectionRange(pos, pos);
      renderPreview();
    };

    var renderPreview = function () {
      if (!preview || !templateBox) return;
      var text = templateBox.value.replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(SAMPLE_VALUES, name) ? SAMPLE_VALUES[name] : "";
      });
      preview.textContent = text.trim() || "—";
    };

    var currentVariables = function () {
      var id = eventSelect ? eventSelect.value : "";
      return variablesByEvent[id] || [];
    };

    var renderChips = function () {
      if (!chipsRow) return;
      chipsRow.querySelectorAll("[data-var-chip]").forEach(function (el) { el.remove(); });
      currentVariables().forEach(function (name) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip chip--action";
        btn.setAttribute("data-var-chip", "");
        btn.textContent = "{" + name + "}";
        btn.addEventListener("click", function () { insertAtCursor("{" + name + "}"); });
        chipsRow.appendChild(btn);
      });
    };

    var renderConditionOptions = function () {
      if (!conditionField) return;
      var keep = conditionField.value || currentCondition;
      conditionField.innerHTML = "";
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "— بلا شرط —";
      conditionField.appendChild(none);
      currentVariables().forEach(function (name) {
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === keep) opt.selected = true;
        conditionField.appendChild(opt);
      });
    };

    var onEventChange = function () {
      renderChips();
      renderConditionOptions();
      renderPreview();
    };

    if (eventSelect) eventSelect.addEventListener("change", onEventChange);
    if (templateBox) templateBox.addEventListener("input", renderPreview);

    var sampleBtn = ruleForm.querySelector("[data-use-sample]");
    if (sampleBtn) {
      sampleBtn.addEventListener("click", function () {
        var id = eventSelect ? eventSelect.value : "";
        if (templateBox && samplesByEvent[id]) {
          templateBox.value = samplesByEvent[id];
          renderPreview();
        }
      });
    }

    onEventChange();
  }
})();
