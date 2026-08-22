/**
 * قسم الأدوات — أدوات عملية جاهزة للتاجر:
 *  • حاسبة التسعير والضريبة
 *  • مولّد رسائل واتساب للعملاء
 *  • تصدير البيانات إلى CSV يفتحه Excel بالعربية
 *  • فحص شامل لحالة التطبيق والاتصال بسلة
 */
const express = require("express");

const config = require("../config");
const db = require("../services/db");
const { toCsv, date: fmtDate } = require("../lib/format");
const { requireStore, asyncRoute } = require("../middleware");
const { defaults: settingDefaults } = require("./settings");

const router = express.Router();

const base = (req, extra = {}) => ({
  page: "tools",
  isLogin: req.user,
  user: req.user,
  ...extra,
});

// ----------------------------------------------------------------- الصفحة الرئيسية للأدوات

router.get(
  "/tools",
  requireStore,
  (req, res) => {
  res.render("tools.html", base(req, {
    pageTitle: "الأدوات",
    pageSubtitle: "أدوات جاهزة توفّر عليك وقتاً في إدارة متجرك",
  }));
});

// ------------------------------------------------------------------------ حاسبة التسعير

router.get(
  "/tools/calculator",
  requireStore,
  (req, res) => {
  res.render("tool-calculator.html", base(req, {
    pageTitle: "حاسبة التسعير والضريبة",
    pageSubtitle: "احسب سعر البيع والربح وضريبة القيمة المضافة",
    vatRate: config.ui.vatRate,
  }));
});

// -------------------------------------------------------------------- رسائل واتساب

/** ينظّف رقم الجوال ويحوّله لصيغة دولية يقبلها واتساب */
function toWhatsAppNumber(mobile, countryCode = "966") {
  let digits = String(mobile || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  if (digits.length <= 9) digits = countryCode + digits;
  return digits;
}

router.get(
  "/tools/whatsapp",
  requireStore,
  asyncRoute(async (req, res) => {
    const keyword = (req.query.q || "").toString().trim();
    const settings = { ...settingDefaults(), ...(req.store ? req.store.getSettings() : {}) };

    const view = base(req, {
      pageTitle: "رسائل واتساب",
      pageSubtitle: "أرسل رسالة جاهزة لأي عميل بضغطة واحدة",
      customers: [],
      filters: { q: keyword },
      defaultMessage: settings.default_message || "",
      error: null,
    });

    if (!req.salla) {
      view.error = "لا يوجد اتصال محفوظ بسلة.";
      return res.render("tool-whatsapp.html", view);
    }

    try {
      const result = await req.salla.listCustomers({ page: 1, perPage: 30, keyword });
      view.customers = (Array.isArray(result.data) ? result.data : [])
        .map((c) => ({
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "عميل",
          mobile: c.mobile || "",
          waNumber: toWhatsAppNumber(c.mobile),
          city: c.city || "",
        }))
        .filter((c) => c.waNumber);
    } catch (err) {
      view.error = err.message;
    }

    res.render("tool-whatsapp.html", view);
  })
);

// ------------------------------------------------------------------ تصدير CSV

/** تعريف كل تصدير: كيف نجلب البيانات وكيف نحوّل الصف إلى أعمدة */
const EXPORTS = {
  orders: {
    filename: "orders",
    headers: ["رقم الطلب", "التاريخ", "العميل", "الجوال", "الحالة", "عدد المنتجات", "الإجمالي", "العملة"],
    fetch: (salla) => salla.fetchAll((p) => salla.listOrders(p)),
    row: (o) => [
      o.reference_id || o.id,
      fmtDate(o.date),
      [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" "),
      o.customer?.mobile || "",
      o.status?.name || "",
      Array.isArray(o.items) ? o.items.length : 0,
      o.total?.amount ?? "",
      o.total?.currency || "",
    ],
  },
  customers: {
    filename: "customers",
    headers: ["المعرّف", "الاسم", "الجوال", "البريد", "المدينة", "تاريخ التسجيل"],
    fetch: (salla) => salla.fetchAll((p) => salla.listCustomers(p)),
    row: (c) => [
      c.id,
      [c.first_name, c.last_name].filter(Boolean).join(" "),
      c.mobile || "",
      c.email || "",
      c.city || "",
      fmtDate(c.updated_at),
    ],
  },
  products: {
    filename: "products",
    headers: ["المعرّف", "الاسم", "SKU", "السعر", "العملة", "الكمية", "الحالة"],
    fetch: (salla) => salla.fetchAll((p) => salla.listProducts(p)),
    row: (p) => [
      p.id,
      p.name || "",
      p.sku || "",
      p.price?.amount ?? p.price ?? "",
      p.price?.currency || "",
      p.quantity ?? "",
      p.status || "",
    ],
  },
};

router.get(
  "/tools/export/:resource.csv",
  requireStore,
  asyncRoute(async (req, res) => {
    const spec = EXPORTS[req.params.resource];
    if (!spec) return res.status(404).send("نوع التصدير غير معروف.");
    if (!req.salla) return res.status(400).send("لا يوجد اتصال محفوظ بسلة.");

    const rows = await spec.fetch(req.salla);
    const csv = toCsv(spec.headers, rows.map(spec.row));
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${spec.filename}-${stamp}.csv"`);
    res.send(csv);
  })
);

// ------------------------------------------------------------------ فحص الحالة

router.get(
  "/tools/diagnostics",
  requireStore,
  asyncRoute(async (req, res) => {
    const checks = [];
    const add = (name, ok, detail, level = "error") =>
      checks.push({ name, ok, detail, level: ok ? "ok" : level });

    // 1. الإعدادات
    const inspection = config.inspect();
    add("إعدادات الاتصال بسلة", inspection.ok,
      inspection.ok ? "كل المتغيّرات الأساسية مضبوطة." : inspection.errors.join(" | "));
    for (const warning of inspection.warnings) {
      add("تنبيه في الإعدادات", false, warning, "warn");
    }

    // 2. قاعدة البيانات
    const dbOk = await db.ping();
    add("قاعدة البيانات", dbOk, dbOk ? "الاتصال يعمل." : "لا يمكن الوصول لقاعدة البيانات.");

    // 3. التوكن
    const stores = db.stores();
    const tokens = stores && req.merchantId ? await stores.getTokens(req.merchantId) : null;
    add("توكن المتجر", Boolean(tokens?.access_token),
      tokens?.access_token ? "توكن محفوظ لهذا المتجر." : "لا يوجد توكن — سجّل الخروج ثم أعد الدخول.");

    // 4. الاتصال الفعلي بواجهة سلة
    if (req.salla) {
      try {
        const result = await req.salla.listOrders({ page: 1, perPage: 1 });
        add("الاتصال بواجهة سلة", true, `الرد سليم (${Array.isArray(result.data) ? result.data.length : 0} سجل في العيّنة).`);
      } catch (err) {
        add("الاتصال بواجهة سلة", false, err.message);
      }
    } else {
      add("الاتصال بواجهة سلة", false, "لم يُبنَ عميل سلة — التوكن مفقود.");
    }

    // 5. الويبهوك
    const webhookOk = Boolean(config.salla.webhookSecret);
    add("سر الويبهوك", webhookOk,
      webhookOk ? "مضبوط، أحداث المتجر ستُستقبل." : "غير مضبوط — لن تصل أحداث المتجر.", "warn");

    // 6. آخر حدث مستلم
    if (stores) {
      const recent = await stores.listEvents({ storeId: req.merchantId, page: 1, perPage: 1 });
      const last = recent.rows[0];
      add("آخر حدث مستلم", Boolean(last),
        last ? `${last.event} — ${last.createdAt.toISOString().slice(0, 16).replace("T", " ")}`
             : "لم يصل أي حدث بعد.", "warn");
    }

    const failures = checks.filter((c) => c.level === "error").length;
    const warnings = checks.filter((c) => c.level === "warn").length;

    res.render("tool-diagnostics.html", base(req, {
      pageTitle: "فحص الحالة",
      pageSubtitle: "تشخيص سريع لكل ما يحتاجه التطبيق ليعمل",
      checks,
      failures,
      warnings,
      healthy: failures === 0,
    }));
  })
);

module.exports = router;
module.exports.toWhatsAppNumber = toWhatsAppNumber;
