/** إعدادات المتجر: قناة واتساب، النص، المهلة، ساعات الهدوء */
const express = require("express");
const { asyncRoute, ensureAuthenticated, merchantOf } = require("../middleware");
const db = require("../helpers/salla-db");
const wa = require("../helpers/wa");
const wweb = require("../helpers/wa-wweb");
const messaging = require("../services/messaging");
const automation = require("../services/automation");
const log = require("../lib/logger");
const { rateLimit } = require("../lib/security");
const { normalizeMobile } = require("../lib/format");

const router = express.Router();

const testLimiter = rateLimit({ windowMs: 60000, max: 10, message: "محاولات اختبار كثيرة — انتظر دقيقة." });

const DEFAULTS = {
  channel: "cloud",
  phone_id: "",
  template_name: "cart_reminder",
  msg_template: "",
  delay_minutes: 60,
  auto_enabled: false,
  quiet_hours: "",
  daily_cap: messaging.DEFAULT_DAILY_CAP,
  sender_name: "",
  token_last4: null,
};

router.get(
  "/settings",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const settings = await db.getMerchantSettings(merchantOf(req));
    res.render("settings.html", {
      isLogin: req.user,
      user: req.user,
      saved: req.query.saved === "1",
      ran: parseInt(req.query.ran || "0", 10),
      qrAvailable: wweb.isAvailable(),
      vars: automation.TEMPLATE_VARS,
      defaultTemplate: automation.SCENARIOS.cart_reminder.tpl,
      cfg: settings
        ? {
            channel: settings.channel || "cloud",
            phone_id: settings.wa_phone_id || "",
            template_name: settings.template_name || "cart_reminder",
            msg_template: settings.msg_template || "",
            delay_minutes: settings.delay_minutes || 60,
            auto_enabled: !!settings.auto_enabled,
            quiet_hours: settings.quiet_hours || "",
            daily_cap: settings.daily_cap || messaging.DEFAULT_DAILY_CAP,
            sender_name: settings.sender_name || "",
            token_last4: settings.wa_token ? String(settings.wa_token).slice(-4) : null,
          }
        : { ...DEFAULTS },
    });
  })
);

router.post(
  "/settings/save",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const existing = await db.getMerchantSettings(merchantId);

    const quiet = String(req.body.quiet_hours || "").trim();
    const data = {
      store_name: req.user?.merchant?.name || "",
      sender_name: String(req.body.sender_name || "").slice(0, 60),
      channel: req.body.channel === "wweb" ? "wweb" : "cloud",
      wa_phone_id: String(req.body.wa_phone_id || "").trim().slice(0, 40),
      template_name: String(req.body.template_name || "cart_reminder").trim().slice(0, 80) || "cart_reminder",
      msg_template: String(req.body.msg_template || "").slice(0, 1200),
      delay_minutes: Math.max(5, Math.min(parseInt(req.body.delay_minutes, 10) || 60, 60 * 24 * 7)),
      daily_cap: Math.max(0, Math.min(parseInt(req.body.daily_cap, 10) || messaging.DEFAULT_DAILY_CAP, 5000)),
      // نقبل الصيغة الصحيحة فقط، وإلا نتركها فارغة بدل تعطيل الإرسال بصمت
      quiet_hours: /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(quiet) ? quiet : "",
      auto_enabled: req.body.auto_enabled === "on" || req.body.auto_enabled === "true",
    };

    // الرمز الفارغ يعني «أبقِ المحفوظ» — وإلا فقده التاجر بأول حفظ عابر
    const token = String(req.body.wa_token || "").trim();
    if (token) data.wa_token = token;
    else if (!existing || !existing.wa_token) data.wa_token = "";

    await db.saveMerchantSettings(merchantId, data);
    log.info("حُفظت إعدادات متجر", { merchant: merchantId, channel: data.channel });
    res.redirect("/settings?saved=1");
  })
);

/** اختبار بيانات Meta قبل الاعتماد عليها */
router.post(
  "/settings/test",
  ensureAuthenticated,
  testLimiter,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    let token = String(req.body.wa_token || "").trim();
    let phoneId = String(req.body.wa_phone_id || "").trim();
    if (!token || !phoneId) {
      const saved = await db.getMerchantSettings(merchantId);
      token = token || (saved && saved.wa_token) || "";
      phoneId = phoneId || (saved && saved.wa_phone_id) || "";
    }
    if (!token || !phoneId) {
      return res.json({ ok: false, error: "أدخل رمز الوصول ومعرّف الرقم أولاً" });
    }
    res.json(await wa.verifyNumber(token, phoneId));
  })
);

/** رسالة تجريبية إلى رقم التاجر نفسه — إثبات أن السلسلة كاملة تعمل */
router.post(
  "/settings/testsend",
  ensureAuthenticated,
  testLimiter,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const settings = await db.getMerchantSettings(merchantId);
    const to = normalizeMobile(req.body.phone);
    if (!to) return res.json({ ok: false, error: "أدخل رقم جوال صحيح بصيغته الدولية" });

    const text = automation.renderTemplate(
      (settings && settings.msg_template) || automation.SCENARIOS.cart_reminder.tpl,
      {
        name: req.user?.name || "صديقي",
        store: (settings && (settings.sender_name || settings.store_name)) || req.user?.merchant?.name || "متجرك",
        url: "https://salla.sa",
        amount: "240",
      }
    );

    const result = await messaging.send({
      merchantId,
      settings,
      to,
      text,
      templateName: (settings && settings.template_name) || "cart_reminder",
      params: [req.user?.name || "صديقي", req.user?.merchant?.name || "متجرك", "https://salla.sa"],
    });
    res.json(result);
  })
);

/** تشغيل دورة الأتمتة فوراً لهذا المتجر */
router.post(
  "/settings/runnow",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    await automation.scheduleCartReminders(merchantId);
    const summary = await automation.processDueMessages(25);
    res.redirect(`/settings?saved=1&ran=${summary.sent}`);
  })
);

module.exports = router;
