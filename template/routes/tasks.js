/**
 * مسار خدمي لتشغيل إرسال صندوق الصادر من الخارج.
 *
 * لماذا نحتاجه؟ على Cloud Run قد تنام الحاوية عندما لا تصل طلبات، فيتوقّف
 * المؤقّت الداخلي. الحل المعتمد هو أن يستدعي Cloud Scheduler هذا المسار كل
 * دقيقة. محميّ بتوكن حتى لا يستدعيه أحد غيرك.
 *
 * مثال:
 *   curl -X POST https://your-app/tasks/dispatch \
 *        -H "Authorization: Bearer $AUTOMATION_DISPATCH_TOKEN"
 */
const crypto = require("crypto");
const express = require("express");

const config = require("../config");
const db = require("../services/db");
const { asyncRoute } = require("../middleware");

const router = express.Router();

function tokenMatches(received) {
  const expected = config.automation.dispatchToken;
  if (!expected || !received) return false;
  const a = Buffer.from(String(received));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post(
  "/tasks/dispatch",
  asyncRoute(async (req, res) => {
    if (!config.automation.dispatchToken) {
      return res.status(503).json({ ok: false, reason: "AUTOMATION_DISPATCH_TOKEN غير مضبوط" });
    }

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!tokenMatches(token)) {
      return res.status(401).json({ ok: false, reason: "توكن غير صحيح" });
    }

    const automation = db.automation();
    if (!automation) return res.status(503).json({ ok: false, reason: "المحرّك غير جاهز" });

    const summary = await automation.dispatch();
    res.json({ ok: true, ...summary });
  })
);

module.exports = router;
