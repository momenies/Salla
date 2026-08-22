/** سجل الأحداث: كل webhook وصل من سلة، مع فلترة وترقيم صفحات. */
const express = require("express");
const db = require("../services/db");
const config = require("../config");
const { requireStore, asyncRoute } = require("../middleware");

const router = express.Router();

router.get(
  "/events",
  requireStore,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const event = (req.query.event || "").toString().trim();

    const view = {
      page: "events",
      pageTitle: "سجل الأحداث",
      pageSubtitle: "كل حدث يرسله متجرك إلى التطبيق",
      isLogin: req.user,
      user: req.user,
      events: [],
      eventNames: [],
      pagination: null,
      filters: { event },
      webhookConfigured: Boolean(config.salla.webhookSecret),
      webhookUrl: config.appUrl ? `${config.appUrl}/webhook` : "",
      error: null,
    };

    const stores = db.stores();
    if (!stores) {
      view.error = "قاعدة البيانات غير متصلة.";
      return res.render("events.html", view);
    }

    const result = await stores.listEvents({ storeId: req.merchantId, page, perPage: 20, event });
    view.events = result.rows;
    view.eventNames = await stores.distinctEventNames(req.merchantId);
    view.pagination = {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
      totalPages: result.totalPages,
      hasPrev: result.page > 1,
      hasNext: result.page < result.totalPages,
      prevPage: result.page - 1,
      nextPage: result.page + 1,
    };

    res.render("events.html", view);
  })
);

module.exports = router;
