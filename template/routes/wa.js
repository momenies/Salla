/** جسر ربط واتساب بالباركود (يُستخدم من صفحة الإعدادات عبر fetch) */
const express = require("express");
const { asyncRoute, ensureAuthenticated, merchantOf } = require("../middleware");
const wweb = require("../helpers/wa-wweb");
const { rateLimit } = require("../lib/security");

const router = express.Router();
const limiter = rateLimit({ windowMs: 60000, max: 60 });

router.post(
  "/wa/connect",
  ensureAuthenticated,
  limiter,
  asyncRoute(async (req, res) => {
    res.json(await wweb.connect(merchantOf(req)));
  })
);

router.get(
  "/wa/status",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    res.json(await wweb.restoreIfNeeded(merchantOf(req)));
  })
);

router.post(
  "/wa/disconnect",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    await wweb.disconnect(merchantOf(req));
    res.json({ ok: true, status: "disconnected" });
  })
);

module.exports = router;
