/* ═══════════════════════════════════════════════════════════════════════════
   منقذ السلات — سكربت الواجهة المشترك
   ملف واحد مخزَّن في المتصفّح، بلا أي مكتبة خارجية: لا React ولا jQuery.
   الصفحة تعمل كاملة بدون جافاسكربت أصلاً (نماذج HTML عادية)، وهذا الملف
   يضيف الراحة فقط — وهذا هو الفرق بين موقع سريع وموقع «يحمّل».
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ─────────────────── الوضع الليلي ───────────────────
  var THEME_KEY = "cr-theme";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* وضع التصفّح الخاص */ }
    document.querySelectorAll("[data-theme-icon]").forEach(function (el) {
      el.textContent = theme === "dark" ? "☀️" : "🌙";
    });
  }

  window.toggleTheme = function () {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  };

  // ─────────────────── الإشعارات ───────────────────
  window.showToast = function (msg, isError) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.toggle("err", !!isError);
    toast.classList.add("show");
    clearTimeout(toast._hide);
    toast._hide = setTimeout(function () { toast.classList.remove("show"); }, 3200);
  };

  // ─────────────────── طلبات JSON ───────────────────
  /**
   * كل طلب كتابة يحمل رمز CSRF تلقائياً — لا نريد تذكّره في كل نداء.
   */
  window.postJSON = function (url, data) {
    var token = document.querySelector('meta[name="csrf-token"]');
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token ? token.content : "",
      },
      body: JSON.stringify(data || {}),
    }).then(function (res) { return res.json().catch(function () { return { ok: false, error: "رد غير مفهوم من الخادم" }; }); });
  };

  // ─────────────────── القائمة الجانبية على الجوّال ───────────────────
  window.toggleNav = function () {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    var open = sidebar.classList.toggle("open");
    var scrim = document.getElementById("scrim");
    if (open && !scrim) {
      scrim = document.createElement("div");
      scrim.id = "scrim";
      scrim.className = "scrim";
      scrim.onclick = window.toggleNav;
      document.body.appendChild(scrim);
    } else if (!open && scrim) {
      scrim.remove();
    }
  };

  // ─────────────────── النوافذ ───────────────────
  window.openModal = function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("open");
  };
  window.closeModal = function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove("open");
  };

  document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("modal-bg")) {
      e.target.classList.remove("open");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-bg.open").forEach(function (m) { m.classList.remove("open"); });
    }
  });

  // ─────────────────── نسخ إلى الحافظة ───────────────────
  window.copyText = function (text, message) {
    var done = function () { window.showToast(message || "✓ تم النسخ"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); done(); } catch (err) { window.showToast("تعذّر النسخ", true); }
      area.remove();
    }
  };

  // ─────────────────── تشغيل عند تحميل الصفحة ───────────────────
  document.addEventListener("DOMContentLoaded", function () {
    // تمييز الصفحة الحالية في القائمة
    var path = location.pathname;
    document.querySelectorAll(".nav a[href]").forEach(function (link) {
      var href = link.getAttribute("href");
      if (href === path || (href !== "/" && path.indexOf(href) === 0)) link.classList.add("active");
    });

    // زر يعرض حالة انتظار أثناء إرسال النموذج — يمنع الضغط المزدوج
    document.querySelectorAll("form[data-busy]").forEach(function (form) {
      form.addEventListener("submit", function () {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) {
          btn.disabled = true;
          btn.dataset.label = btn.innerHTML;
          btn.innerHTML = "… جارٍ الحفظ";
        }
      });
    });

    // بحث فوري داخل الجداول المحلية
    document.querySelectorAll("[data-filter-target]").forEach(function (input) {
      input.addEventListener("input", function () {
        var q = input.value.trim().toLowerCase();
        document.querySelectorAll(input.dataset.filterTarget).forEach(function (row) {
          row.style.display = !q || row.textContent.toLowerCase().indexOf(q) > -1 ? "" : "none";
        });
      });
    });
  });

  // الوضع يُطبَّق فوراً في <head> لتفادي وميض أبيض؛ هنا نضمن الأيقونة فقط
  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
  } catch (e) { /* تجاهل */ }
})();
