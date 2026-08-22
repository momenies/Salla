/** العملاء: قائمة بها بحث وترقيم صفحات وروابط تواصل مباشرة. */
const express = require("express");
const config = require("../config");
const { requireStore, asyncRoute } = require("../middleware");
const { normalizePagination } = require("../lib/normalize");

const router = express.Router();

router.get(
  "/customers",
  requireStore,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const keyword = (req.query.q || "").toString().trim();

    const view = {
      page: "customers",
      pageTitle: "العملاء",
      pageSubtitle: "قائمة عملاء متجرك وبيانات التواصل معهم",
      isLogin: req.user,
      user: req.user,
      customers: [],
      pagination: null,
      filters: { q: keyword },
      error: null,
    };

    if (!req.salla) {
      view.error = "لا يوجد اتصال محفوظ بسلة. سجّل الخروج ثم أعد الدخول.";
      return res.render("customers.html", view);
    }

    try {
      const result = await req.salla.listCustomers({ page, perPage: config.ui.perPage, keyword });
      view.customers = Array.isArray(result.data) ? result.data : [];
      view.pagination = normalizePagination(result.pagination, {
        page,
        perPage: config.ui.perPage,
        itemsOnPage: view.customers.length,
      });
    } catch (err) {
      view.error = err.message;
    }

    res.render("customers.html", view);
  })
);

module.exports = router;
