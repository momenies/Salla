/** قسم الأتمتة: قواعد الإرسال التلقائي وصندوق الصادر. */
const express = require("express");

const db = require("../services/db");
const config = require("../config");
const { TRIGGERS, getTrigger, variableNamesFor } = require("../lib/triggers");
const { channelStatus, getChannel } = require("../lib/channels");
const { unknownVariables } = require("../lib/template");
const { requireStore, asyncRoute } = require("../middleware");

const router = express.Router();

const base = (req, extra = {}) => ({
  page: "automation",
  isLogin: req.user,
  user: req.user,
  ...extra,
});

/** يقرأ نموذج القاعدة ويتحقّق منه. يرجّع { values, errors } */
function parseRuleForm(body) {
  const errors = [];

  const name = String(body.name || "").trim().slice(0, 120);
  const event = String(body.event || "").trim();
  const channel = String(body.channel || "").trim();
  const template = String(body.template || "").trim().slice(0, 2000);
  const delay = Number.parseInt(body.delay_minutes, 10);

  if (!name) errors.push("اكتب اسماً للقاعدة حتى تميّزها لاحقاً.");
  if (!getTrigger(event)) errors.push("اختر حدثاً صحيحاً من القائمة.");
  if (!getChannel(channel)) errors.push("اختر قناة إرسال صحيحة.");
  if (!template) errors.push("نص الرسالة مطلوب.");

  const delayMinutes = Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 60 * 24 * 7) : 0;

  // نحذّر من متغيّر غير موجود بدل أن يخرج فارغاً في رسالة العميل
  if (getTrigger(event)) {
    const unknown = unknownVariables(template, variableNamesFor(event));
    if (unknown.length) {
      errors.push(`متغيّرات غير متاحة لهذا الحدث: ${unknown.map((v) => "{" + v + "}").join("، ")}`);
    }
  }

  const conditions = {};
  const field = String(body.condition_field || "").trim();
  const equals = String(body.condition_equals || "").trim();
  if (field && equals) {
    conditions.field = field;
    conditions.equals = equals;
  }

  return {
    values: { name, event, channel, template, delay_minutes: delayMinutes, conditions: JSON.stringify(conditions) },
    errors,
  };
}

/**
 * بيانات مشتركة بين صفحتي الإنشاء والتعديل.
 * `rule` قد يكون: صفاً من قاعدة البيانات، أو كائناً عادياً بعد فشل التحقّق، أو null
 * لصفحة الإنشاء — لذلك نستخرج الشروط هنا بدل استدعاء دالة داخل القالب.
 */
function readConditions(rule) {
  if (!rule) return {};
  if (typeof rule.getConditions === "function") return rule.getConditions();
  try {
    return JSON.parse(rule.conditions || "{}");
  } catch (err) {
    return {};
  }
}

function formContext(req, rule, extra = {}) {
  const event = rule?.event || TRIGGERS[0].id;
  return base(req, {
    conditions: readConditions(rule),
    triggers: TRIGGERS,
    channels: channelStatus(),
    rule,
    variablesByEvent: Object.fromEntries(TRIGGERS.map((t) => [t.id, variableNamesFor(t.id)])),
    samplesByEvent: Object.fromEntries(TRIGGERS.map((t) => [t.id, t.sample])),
    selectedEvent: event,
    // القاعدة الجديدة تبدأ بوضع التجربة — يعمل بلا إعداد ولا يرسل لأحد
    selectedChannel: rule?.channel || "dry-run",
    ...extra,
  });
}

// -------------------------------------------------------------- قائمة القواعد

router.get(
  "/automation",
  requireStore,
  asyncRoute(async (req, res) => {
    const automation = db.automation();
    const rules = automation && req.merchantId ? await automation.listRules(req.merchantId) : [];
    const counts = automation && req.merchantId ? await automation.outboxCounts(req.merchantId) : {};

    res.render("automation.html", base(req, {
      pageTitle: "الأتمتة",
      pageSubtitle: "رسائل تُرسل تلقائياً عند أحداث متجرك",
      rules,
      counts,
      triggers: TRIGGERS,
      channels: channelStatus(),
      enabled: config.automation.enabled,
      saved: req.query.saved === "1",
      deleted: req.query.deleted === "1",
      tested: req.query.tested === "1",
    }));
  })
);

// ------------------------------------------------------------ إنشاء / تعديل

router.get("/automation/new", requireStore, (req, res) => {
  res.render("automation-form.html", formContext(req, null, {
    pageTitle: "قاعدة أتمتة جديدة",
    pageSubtitle: "اختر الحدث والقناة واكتب نص الرسالة",
    errors: [],
  }));
});

router.post(
  "/automation/new",
  requireStore,
  asyncRoute(async (req, res) => {
    const { values, errors } = parseRuleForm(req.body || {});
    if (errors.length) {
      return res.status(400).render("automation-form.html", formContext(req, { ...values, id: null }, {
        pageTitle: "قاعدة أتمتة جديدة",
        pageSubtitle: "اختر الحدث والقناة واكتب نص الرسالة",
        errors,
      }));
    }

    await db.automation().createRule(req.merchantId, values);
    res.redirect("/automation?saved=1");
  })
);

router.get(
  "/automation/:id/edit",
  requireStore,
  asyncRoute(async (req, res) => {
    const rule = await db.automation().findRule(req.merchantId, req.params.id);
    if (!rule) return res.status(404).render("error.html", base(req, {
      pageTitle: "القاعدة غير موجودة", pageSubtitle: "", code: "404",
      message: "لم نعثر على قاعدة الأتمتة المطلوبة.",
    }));

    res.render("automation-form.html", formContext(req, rule, {
      pageTitle: "تعديل القاعدة",
      pageSubtitle: rule.name,
      errors: [],
    }));
  })
);

router.post(
  "/automation/:id/edit",
  requireStore,
  asyncRoute(async (req, res) => {
    const { values, errors } = parseRuleForm(req.body || {});
    if (errors.length) {
      return res.status(400).render("automation-form.html", formContext(req, { ...values, id: req.params.id }, {
        pageTitle: "تعديل القاعدة",
        pageSubtitle: values.name,
        errors,
      }));
    }

    const updated = await db.automation().updateRule(req.merchantId, req.params.id, values);
    if (!updated) return res.status(404).redirect("/automation");
    res.redirect("/automation?saved=1");
  })
);

// ------------------------------------------------------------ تفعيل / حذف / تجربة

router.post(
  "/automation/:id/toggle",
  requireStore,
  asyncRoute(async (req, res) => {
    await db.automation().toggleRule(req.merchantId, req.params.id);
    res.redirect("/automation");
  })
);

router.post(
  "/automation/:id/delete",
  requireStore,
  asyncRoute(async (req, res) => {
    await db.automation().deleteRule(req.merchantId, req.params.id);
    res.redirect("/automation?deleted=1");
  })
);

/** بيانات وهمية واقعية لتجربة القاعدة دون انتظار حدث حقيقي */
function sampleEventFor(eventId, merchantId) {
  const customer = { first_name: "سارة", last_name: "العتيبي", mobile: "0555555555", city: "الرياض" };
  const order = {
    id: 90001, reference_id: 40001,
    total: { amount: 350, currency: "SAR" },
    status: { slug: "under_review", name: "بانتظار المراجعة" },
    items: [{ name: "قميص قطن أزرق", quantity: 2 }],
    payment_method: "mada",
    customer,
  };

  const data = {
    "order.created": order,
    "order.status.updated": { ...order, status: { slug: "completed", name: "تم التنفيذ" } },
    "order.shipment.created": { order, tracking_number: "SP123456789", courier_name: "سمسا", customer },
    "abandoned.cart": { customer, total: { amount: 210, currency: "SAR" }, checkout_url: "https://example.salla.sa/cart" },
    "customer.created": customer,
    "product.quantity.low": { name: "عطر شرقي 100مل", sku: "SKU-104", quantity: 2 },
    "order.refunded": order,
  }[eventId] || {};

  return { event: eventId, merchant: merchantId, data };
}

router.post(
  "/automation/:id/test",
  requireStore,
  asyncRoute(async (req, res) => {
    const automation = db.automation();
    const rule = await automation.findRule(req.merchantId, req.params.id);
    if (!rule) return res.status(404).redirect("/automation");

    await automation.sendTest(rule, req.store, sampleEventFor(rule.event, req.merchantId));
    await automation.dispatch({ limit: 5 });

    res.redirect("/automation/outbox?tested=1");
  })
);

// ----------------------------------------------------------- صندوق الصادر

router.get(
  "/automation/outbox",
  requireStore,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const status = String(req.query.status || "").trim();
    const automation = db.automation();

    const result = await automation.listOutbox({ storeId: req.merchantId, page, perPage: 20, status });
    const counts = await automation.outboxCounts(req.merchantId);

    res.render("outbox.html", base(req, {
      pageTitle: "صندوق الصادر",
      pageSubtitle: "كل رسالة أرسلها التطبيق أو ينتظر إرسالها",
      messages: result.rows,
      counts,
      filters: { status },
      tested: req.query.tested === "1",
      pagination: {
        page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages,
        hasPrev: result.page > 1, hasNext: result.page < result.totalPages,
        prevPage: result.page - 1, nextPage: result.page + 1,
      },
    }));
  })
);

router.post(
  "/automation/outbox/:id/retry",
  requireStore,
  asyncRoute(async (req, res) => {
    const automation = db.automation();
    await automation.retryMessage(req.merchantId, req.params.id);
    await automation.dispatch({ limit: 5 });
    res.redirect("/automation/outbox");
  })
);

module.exports = router;
module.exports.parseRuleForm = parseRuleForm;
module.exports.sampleEventFor = sampleEventFor;
