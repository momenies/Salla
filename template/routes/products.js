/** المنتجات: قسم جديد — عرض منتجات المتجر مع بحث وترقيم صفحات. */
const express = require("express");
const config = require("../config");
const { requireStore, asyncRoute } = require("../middleware");
const { normalizePagination } = require("../lib/normalize");

const router = express.Router();

router.get(
  "/products",
  requireStore,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const keyword = (req.query.q || "").toString().trim();

    const view = {
      page: "products",
      pageTitle: "المنتجات",
      pageSubtitle: "منتجات متجرك وأسعارها وكمياتها",
      isLogin: req.user,
      user: req.user,
      products: [],
      pagination: null,
      filters: { q: keyword },
      error: null,
    };

    if (!req.salla) {
      view.error = "لا يوجد اتصال محفوظ بسلة. سجّل الخروج ثم أعد الدخول.";
      return res.render("products.html", view);
    }

    try {
      const result = await req.salla.listProducts({ page, perPage: config.ui.perPage, keyword });
      view.products = Array.isArray(result.data) ? result.data : [];
      view.pagination = normalizePagination(result.pagination, {
        page,
        perPage: config.ui.perPage,
        itemsOnPage: view.products.length,
      });
    } catch (err) {
      view.error = err.message;
    }

    res.render("products.html", view);
  })
);

module.exports = router;
