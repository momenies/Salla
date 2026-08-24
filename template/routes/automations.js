/** مركز الأتمتة: السيناريوهات وسجلّ الرسائل */
const express = require("express");
const { asyncRoute, ensureAuthenticated, merchantOf } = require("../middleware");
const db = require("../helpers/salla-db");
const automation = require("../services/automation");
const messaging = require("../services/messaging");
const { timeAgo, truncate } = require("../lib/format");

const router = express.Router();
const PAGE_SIZE = 25;

const STATUS_LABELS = {
  pending: "بانتظار الإرسال",
  sent: "أُرسلت",
  failed: "فشلت",
  cancelled: "أُلغيت",
};

router.get(
  "/automations",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const status = String(req.query.status || "all");
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const [scenarios, stats, list, settings] = await Promise.all([
      automation.listScenarios(merchantId),
      db.messageStats(merchantId),
      db.listMessages(merchantId, { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      db.getMerchantSettings(merchantId),
    ]);

    const messages = list.rows.map((row) => {
      const msg = row.toJSON();
      return {
        ...msg,
        time_ago: timeAgo(msg.created_at),
        kind_label: automation.KIND_LABELS[msg.kind] || msg.kind,
        status_label: STATUS_LABELS[msg.status] || msg.status,
        preview: truncate(msg.body, 90),
        scheduled_in:
          msg.status === "pending" && msg.scheduled_at > Math.floor(Date.now() / 1000)
            ? Math.ceil((msg.scheduled_at - Date.now() / 1000) / 60)
            : 0,
      };
    });

    res.render("automations.html", {
      isLogin: req.user,
      user: req.user,
      scenarios,
      stats,
      messages,
      total: list.count,
      page,
      pages: Math.max(1, Math.ceil(list.count / PAGE_SIZE)),
      status,
      vars: automation.TEMPLATE_VARS,
      channelReady: Boolean(messaging.resolveChannel(settings)),
      channelProblem: messaging.channelProblem(settings),
      quietHours: (settings && settings.quiet_hours) || "",
      saved: req.query.saved === "1",
    });
  })
);

/** حفظ سيناريو واحد (تفعيل، مهلة، نص) */
router.post(
  "/automations/save",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const key = String(req.body.key || "");
    if (!automation.SCENARIOS[key]) return res.redirect("/automations");

    const delay = Math.max(0, Math.min(parseInt(req.body.delay_minutes, 10) || 0, 60 * 24 * 14));
    await db.saveAutomation(merchantOf(req), key, {
      enabled: req.body.enabled === "on" || req.body.enabled === "true",
      delay_minutes: delay,
      msg_template: String(req.body.msg_template || "").slice(0, 1200),
    });
    res.redirect("/automations?saved=1");
  })
);

/** تبديل التفعيل سريعاً من البطاقة (بلا إعادة تحميل) */
router.post(
  "/automations/toggle",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const key = String(req.body.key || "");
    if (!automation.SCENARIOS[key]) return res.status(400).json({ ok: false, error: "سيناريو غير معروف" });
    const enabled = req.body.enabled === true || req.body.enabled === "true" || req.body.enabled === "on";
    await db.saveAutomation(merchantOf(req), key, { enabled });
    res.json({ ok: true, key, enabled });
  })
);

/** إعادة محاولة رسالة فشلت */
router.post(
  "/automations/retry",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const row = await db.retryMessage(merchantOf(req), parseInt(req.body.id, 10));
    if (!row) return res.status(404).json({ ok: false, error: "لم نجد الرسالة" });
    const summary = await automation.processDueMessages(5);
    res.json({ ok: true, sent: summary.sent, failed: summary.failed });
  })
);

/** إلغاء رسالة ما زالت في الانتظار */
router.post(
  "/automations/cancel",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const row = await db.cancelMessage(merchantOf(req), parseInt(req.body.id, 10));
    res.json({ ok: Boolean(row) });
  })
);

/** معاينة النص بعد استبدال المتغيّرات — تُستخدم في المحرّر الحي */
router.post(
  "/automations/preview",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const text = automation.renderTemplate(String(req.body.template || "").slice(0, 1200), {
      name: "أحمد",
      store: req.user?.merchant?.name || "متجرك",
      order: "12345",
      url: "https://store.salla.sa/cart/abc123",
      amount: "240",
    });
    res.json({ ok: true, text });
  })
);

module.exports = router;
