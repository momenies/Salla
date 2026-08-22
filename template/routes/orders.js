/** الطلبات: قائمة بها بحث وفلترة وترقيم صفحات، وصفحة تفاصيل لكل طلب. */
const express = require("express");
const config = require("../config");
const { requireStore, asyncRoute } = require("../middleware");
const { normalizePagination } = require("../lib/normalize");

const router = express.Router();

router.get(
  "/orders",
  requireStore,
  asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const keyword = (req.query.q || "").toString().trim();
    const status = (req.query.status || "").toString().trim();

    const view = {
      page: "orders",
      pageTitle: "الطلبات",
      pageSubtitle: "ابحث وصفّي وتابع كل طلبات متجرك",
      isLogin: req.user,
      user: req.user,
      orders: [],
      statuses: [],
      pagination: null,
      filters: { q: keyword, status },
      error: null,
    };

    if (!req.salla) {
      view.error = "لا يوجد اتصال محفوظ بسلة. سجّل الخروج ثم أعد الدخول.";
      return res.render("orders.html", view);
    }

    const [ordersResult, statusesResult] = await Promise.allSettled([
      req.salla.listOrders({ page, perPage: config.ui.perPage, keyword, status }),
      req.salla.listOrderStatuses(),
    ]);

    if (ordersResult.status === "fulfilled") {
      view.orders = Array.isArray(ordersResult.value.data) ? ordersResult.value.data : [];
      view.pagination = normalizePagination(ordersResult.value.pagination, {
        page,
        perPage: config.ui.perPage,
        itemsOnPage: view.orders.length,
      });
    } else {
      view.error = ordersResult.reason?.message || "تعذّر جلب الطلبات.";
    }

    // قائمة الحالات اختيارية — غيابها لا يمنع عرض الطلبات
    if (statusesResult.status === "fulfilled") view.statuses = statusesResult.value;

    res.render("orders.html", view);
  })
);

router.get(
  "/orders/:id",
  requireStore,
  asyncRoute(async (req, res) => {
    const view = {
      page: "orders",
      pageTitle: "تفاصيل الطلب",
      pageSubtitle: `طلب رقم ${req.params.id}`,
      isLogin: req.user,
      user: req.user,
      order: null,
      error: null,
    };

    if (!req.salla) {
      view.error = "لا يوجد اتصال محفوظ بسلة.";
      return res.render("order-detail.html", view);
    }

    try {
      view.order = await req.salla.getOrder(req.params.id);
      const reference = view.order?.reference_id || req.params.id;
      view.pageSubtitle = `طلب رقم ${reference}`;
    } catch (err) {
      res.status(err.status === 404 ? 404 : 502);
      view.error = err.message;
    }

    res.render("order-detail.html", view);
  })
);

module.exports = router;
