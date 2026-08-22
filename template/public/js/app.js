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
})();
