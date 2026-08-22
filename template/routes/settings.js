/**
 * إعدادات التطبيق لكل متجر على حدة.
 * القيم تُحفظ في عمود JSON داخل جدول المتاجر، فتضيف إعداداً جديداً
 * بسطر واحد في `FIELDS` دون أي تعديل على قاعدة البيانات.
 */
const express = require("express");
const db = require("../services/db");
const { requireStore, asyncRoute } = require("../middleware");

const router = express.Router();

/** تعريف الإعدادات: الاسم، النوع، العنوان، والقيمة الافتراضية */
const FIELDS = [
  {
    key: "notify_email",
    type: "email",
    label: "بريد الإشعارات",
    hint: "نرسل إليه تنبيهات التطبيق. اتركه فارغاً لإيقاف الإشعارات.",
    default: "",
  },
  {
    key: "whatsapp_number",
    type: "tel",
    label: "رقم واتساب للتواصل مع العملاء",
    hint: "يُستخدم في أداة رسائل واتساب. مثال: 9665xxxxxxxx",
    default: "",
  },
  {
    key: "order_alerts",
    type: "boolean",
    label: "تنبيه عند كل طلب جديد",
    hint: "يسجّل الطلبات الجديدة في سجل الأحداث ويُظهرها في الرئيسية.",
    default: true,
  },
  {
    key: "low_stock_threshold",
    type: "number",
    label: "حد التنبيه لنفاد الكمية",
    hint: "نعتبر المنتج على وشك النفاد إذا قلّت كميته عن هذا الرقم.",
    default: 5,
  },
  {
    key: "default_message",
    type: "textarea",
    label: "نص الرسالة الافتراضي",
    hint: "يظهر جاهزاً في أداة رسائل واتساب. استخدم {name} لاسم العميل.",
    default: "أهلاً {name}، شكراً لطلبك من متجرنا 🌟",
  },
];

function defaults() {
  return Object.fromEntries(FIELDS.map((f) => [f.key, f.default]));
}

/** يحوّل ما وصل من النموذج إلى قيم بأنواعها الصحيحة */
function parseForm(body) {
  const values = {};
  for (const field of FIELDS) {
    const raw = body[field.key];
    if (field.type === "boolean") {
      values[field.key] = raw === "on" || raw === "true" || raw === true;
    } else if (field.type === "number") {
      const n = Number.parseInt(raw, 10);
      values[field.key] = Number.isFinite(n) && n >= 0 ? n : field.default;
    } else {
      values[field.key] = String(raw ?? "").trim().slice(0, 500);
    }
  }
  return values;
}

function render(req, res, extra = {}) {
  const stored = req.store ? req.store.getSettings() : {};
  res.render("settings.html", {
    page: "settings",
    pageTitle: "الإعدادات",
    pageSubtitle: "اضبط سلوك التطبيق في متجرك",
    isLogin: req.user,
    user: req.user,
    fields: FIELDS,
    values: { ...defaults(), ...stored },
    saved: req.query.saved === "1",
    ...extra,
  });
}

router.get(
  "/settings",
  requireStore,
  (req, res) => render(req, res));

router.post(
  "/settings",
  requireStore,
  asyncRoute(async (req, res) => {
    const stores = db.stores();
    if (!stores || !req.merchantId) {
      return render(req, res, { error: "تعذّر حفظ الإعدادات — لا يوجد متجر مرتبط." });
    }

    const values = parseForm(req.body || {});
    await stores.updateSettings(req.merchantId, values);

    // نُعيد التحميل عبر تحويل حتى لا يُعيد المتصفح إرسال النموذج عند التحديث
    res.redirect("/settings?saved=1");
  })
);

module.exports = router;
module.exports.FIELDS = FIELDS;
module.exports.defaults = defaults;
