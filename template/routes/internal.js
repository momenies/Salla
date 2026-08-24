/** مسارات تشغيلية: المجدول وفحص الصحة */
const express = require("express");
const automation = require("../services/automation");
const db = require("../helpers/salla-db");
const cache = require("../lib/cache");
const env = require("../config/env");
const log = require("../lib/logger");
const { safeEqual } = require("../lib/webhooks");

const router = express.Router();
const startedAt = Date.now();

/**
 * فحص الصحة لمنصّات الاستضافة.
 * سريع عمداً: لا نداءات خارجية، وفحص قاعدة البيانات خفيف —
 * فحص بطيء يجعل المنصّة تظن أن النسخة ميتة فتعيد تشغيلها.
 */
router.get("/healthz", async (req, res) => {
  const health = {
    ok: true,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    env: env.NODE_ENV,
    salla_configured: env.sallaConfigured,
    cache: cache.stats(),
  };
  try {
    const conn = await db.ensureConnection();
    await conn.query("SELECT 1");
    health.database = "ok";
  } catch (err) {
    health.ok = false;
    health.database = "error: " + err.message;
  }
  res.status(health.ok ? 200 : 503).json(health);
});

/** فحص الجاهزية — يستخدمه موازن الأحمال قبل توجيه الطلبات */
router.get("/readyz", async (req, res) => {
  const ready = Boolean(db.connection);
  res.status(ready ? 200 : 503).json({ ready });
});

/**
 * نقطة المجدول (Cloud Scheduler / cron).
 * السرّ في المسار للتوافق مع ما هو منشور، ويُقبل أيضاً في ترويسة —
 * وهي الطريقة الأفضل لأن المسارات تُسجَّل في سجلات الوصول.
 */
router.all("/internal/cron/:secret?", async (req, res) => {
  const provided = req.params.secret || req.get("x-cron-secret") || "";
  if (!env.cronSecret || !safeEqual(provided, env.cronSecret)) {
    return res.sendStatus(403);
  }
  try {
    const result = await automation.runCycle();
    log.info("دورة المجدول", { merchants: result.merchants, queue: result.queue });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error("فشلت دورة المجدول", { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
