/** الصفحة الرئيسية: صفحة تعريفية للزائر، ولوحة مؤشرات للتاجر */
const express = require("express");
const { asyncRoute, merchantOf } = require("../middleware");
const stats = require("../services/stats");
const automation = require("../services/automation");
const messaging = require("../services/messaging");
const db = require("../helpers/salla-db");
const { money, timeAgo } = require("../lib/format");
const env = require("../config/env");
const { FEATURES, BUNDLE } = require("../config/features");

const router = express.Router();

router.get(
  "/",
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);

    // زائر غير مسجّل: صفحة المنتج التعريفية
    if (!merchantId) {
      return res.render("landing.html", {
        isLogin: false,
        user: null,
        features: FEATURES,
        bundle: BUNDLE,
        scenarios: Object.values(automation.SCENARIOS).map((s) => ({ label: s.label, desc: s.desc, icon: s.icon })),
      });
    }

    const [board, setup, settings, recent] = await Promise.all([
      stats.dashboard(merchantId),
      stats.onboarding(merchantId),
      db.getMerchantSettings(merchantId),
      db.listAbandonedCarts(merchantId, { limit: 5 }),
    ]);

    const carts = recent.rows.map((row) => {
      const cart = row.toJSON();
      return { ...cart, time_ago: timeAgo(cart.abandoned_at), amount_label: money(cart.total_amount, cart.currency) };
    });

    res.render("index.html", {
      isLogin: req.user,
      user: req.user,
      board,
      setup,
      carts,
      money,
      channel: messaging.resolveChannel(settings),
      channelProblem: messaging.channelProblem(settings),
      autoEnabled: Boolean(settings && settings.auto_enabled),
      appId: env.salla.appId,
    });
  })
);

/**
 * نفس أرقام اللوحة كـ JSON — تحدّثها الواجهة كل دقيقة بلا إعادة تحميل.
 * نُرسل النصوص منسّقة جاهزة: تنسيق العملة والجمع العربي منطق موجود في
 * الخادم، وتكراره بجافاسكربت يعني نسختين تختلفان يوماً ما.
 */
router.get(
  "/api/stats",
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    if (!merchantId) return res.status(401).json({ ok: false });
    const board = await stats.dashboard(merchantId, { ttl: 15000 });
    res.json({
      ok: true,
      cards: {
        recovered: money(board.totals.recoveredAmount),
        recoveredNote: `${board.totals.recovered} سلة عادت وأصبحت طلباً`,
        pending: money(board.totals.pendingValue),
        pendingNote: `${board.counts.new} سلة تنتظر التذكير`,
        rate: String(board.totals.recoveryRate),
        today: String(board.messages.sentToday),
        todayNote: board.messages.pending
          ? `${board.messages.pending} في الانتظار`
          : "لا شيء في الانتظار",
      },
    });
  })
);

module.exports = router;
