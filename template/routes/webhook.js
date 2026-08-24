/**
 * نقطة استقبال أحداث سلة.
 *
 * ثلاث قواعد تحكم هذا الملف:
 *   ١. تحقّق قبل أي عمل — الحدث غير الموقّع لا يلمس قاعدة البيانات.
 *   ٢. ردّ سريع (200) — سلة تعتبر البطء فشلاً وتعيد الإرسال، فنعالج بعد الردّ.
 *   ٣. لا تكرار — نفس الحدث مرتين يعني رسالتين للعميل نفسه.
 */
const express = require("express");
const webhooks = require("../lib/webhooks");
const { handleSubscriptionEvent } = require("../helpers/subscriptions");
const automation = require("../services/automation");
const db = require("../helpers/salla-db");
const cache = require("../lib/cache");
const env = require("../config/env");
const log = require("../lib/logger");
const { rateLimit } = require("../lib/security");

const router = express.Router();

// ─────────────────── المستمعون (تُسجَّل مرة عند التحميل) ───────────────────

webhooks.on("order.created", (body) => automation.handleOrderCreated(body));
webhooks.on("order.status.updated", (body) => automation.handleOrderStatusUpdated(body));
webhooks.on("order.updated", (body) => automation.handleOrderStatusUpdated(body));

webhooks.on("app.installed", (body) => {
  log.info("تثبيت التطبيق", { merchant: body.merchant });
});

/**
 * إزالة التطبيق: نغلق الصلاحيات ونمسح التوكن.
 * لا نحذف السجل التاريخي فوراً — التاجر كثيراً ما يعيد التثبيت خلال أيام،
 * وفقدان تاريخه يعني بداية من الصفر وشعوراً بأن التطبيق «نسيه».
 */
webhooks.on("app.uninstalled", async (body) => {
  const merchant = body.merchant;
  if (!merchant) return;
  await db.revokeAllFeatures(merchant, "canceled");
  await db.deleteOauthToken(merchant);
  cache.invalidate(`salla:${merchant}:`);
  cache.invalidate(`stats:${merchant}:`);
  log.info("أُزيل التطبيق من متجر", { merchant });
});

const webhookLimiter = rateLimit({
  windowMs: 60000,
  max: 600,
  message: "طلبات كثيرة",
});

router.post("/webhook", webhookLimiter, async (req, res) => {
  const body = req.body || {};
  const eventName = body.event || "unknown";

  const check = webhooks.verify({
    headers: req.headers,
    rawBody: req.rawBody,
    secret: env.salla.webhookSecret,
    strategy: env.salla.webhookStrategy,
  });

  if (!check.ok) {
    // بلا سرّ مضبوط لا نستطيع التحقق: نقبل في التطوير لتسهيل التجربة،
    // ونرفض في الإنتاج لأن القبول يعني السماح لأي جهة بتزوير الأحداث.
    if (check.reason === "no-secret" && !env.isProd) {
      log.warn("حدث بلا تحقّق (لا يوجد SALLA_WEBHOOK_SECRET)", { event: eventName });
    } else {
      log.warn("حدث مرفوض", { event: eventName, reason: check.reason, strategy: check.strategy });
      return res.status(401).json({ ok: false });
    }
  }

  if (webhooks.isDuplicate(body)) {
    log.debug("حدث مكرّر — تجاهُل", { event: eventName });
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // الردّ أولاً ثم المعالجة: سلة لا تنتظرنا، ونحن لا نريد إعادة إرسال
  res.status(200).json({ ok: true });

  try {
    await db.connect();
    await handleSubscriptionEvent(body);
    await webhooks.dispatch(body, { source: "salla" });
  } catch (err) {
    log.error("فشل معالجة حدث", { event: eventName, error: err.message });
  }
});

module.exports = router;
