/**
 * مستقبل أحداث سلة (Webhooks).
 *
 * ثلاثة إصلاحات مهمة مقارنة بالقالب الأصلي:
 *  1. كان لا يرد على سلة إطلاقاً، فيبقى الطلب معلّقاً وتعيد سلة المحاولة.
 *  2. لم يكن يتحقّق من السر بنفسه، فلا يعرف هل رُفض الحدث أم عولج.
 *  3. لم يكن يحفظ شيئاً، فلا توجد أي طريقة لمعرفة ما وصل ومتى.
 */
const crypto = require("crypto");
const express = require("express");
const SallaWebhook = require("@salla.sa/webhooks-actions");

const config = require("../config");
const db = require("../services/db");

const router = express.Router();

SallaWebhook.setSecret(config.salla.webhookSecret);

/** مقارنة لا يتسرّب منها الوقت، لمنع تخمين السر حرفاً حرفاً */
function secretMatches(received) {
  const expected = config.salla.webhookSecret;
  if (!expected || !received) return false;
  const a = Buffer.from(String(received));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post("/webhook", async (req, res) => {
  const body = req.body || {};
  const eventName = body.event || "unknown";
  const authorization = req.headers.authorization || req.headers["x-salla-signature"] || "";

  if (!config.salla.webhookSecret) {
    console.warn("webhook: SALLA_WEBHOOK_SECRET غير مضبوط — تم تجاهل الحدث.");
    return res.status(503).json({ ok: false, reason: "webhook secret not configured" });
  }

  if (!secretMatches(authorization)) {
    console.warn(`webhook: سر غير صحيح للحدث ${eventName} — مرفوض.`);
    return res.status(401).json({ ok: false, reason: "invalid signature" });
  }

  const stores = db.stores();
  let record = null;

  try {
    if (stores) {
      record = await stores.recordEvent({
        storeId: body.merchant || null,
        event: eventName,
        payload: body,
        status: "received",
      });

      // أحداث التطبيق تغيّر حالة التثبيت والاشتراك
      if (eventName.startsWith("app.")) {
        await stores.applyAppEvent(eventName, body);
      }
    }

    // ثم نمرّر الحدث لملفات Actions/ ومستمعيك كما في القالب الأصلي
    SallaWebhook.checkActions(body, authorization, { store: stores });

    if (record) await record.update({ status: "processed" });
  } catch (err) {
    console.error(`webhook: فشل معالجة ${eventName}:`, err.message);
    if (record) await record.update({ status: "failed", error: err.message }).catch(() => {});
  }

  // نرد بنجاح دائماً بعد قبول الحدث حتى لا تعيد سلة إرساله بلا فائدة —
  // الفشل مسجَّل عندنا في سجل الأحداث.
  res.status(200).json({ ok: true, event: eventName });
});

module.exports = router;
