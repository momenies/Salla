/** صفحات بيانات المتجر: الطلبات، العملاء، الفواتير، الحساب */
const express = require("express");
const { asyncRoute, ensureAuthenticated, requireFeature, merchantOf } = require("../middleware");
const db = require("../helpers/salla-db");
const salla = require("../lib/salla");
const { buildInvoice } = require("../helpers/invoice");
const { money, timeAgo, initial, avatarColor, normalizeMobile, toCsv, shortDate } = require("../lib/format");
const log = require("../lib/logger");

const router = express.Router();

/** رسالة الخطأ الصالحة للعرض من أي عطل في نداء سلة */
function apiError(err) {
  log.warn("خطأ من واجهة سلة", { error: err.message, status: err.status });
  return err.userMessage || "تعذّر جلب البيانات من سلة — حاول بعد قليل.";
}

// ─────────────────────────── الطلبات ───────────────────────────

router.get(
  "/orders",
  ensureAuthenticated,
  requireFeature("order_followups"),
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    let orders = [];
    let pagination = null;
    let error = null;
    try {
      const result = await salla.forMerchant(merchantId).getOrders({ page, perPage: 25 });
      orders = result.data;
      pagination = result.pagination;
    } catch (err) {
      error = apiError(err);
    }

    res.render("orders.html", {
      isLogin: req.user,
      user: req.user,
      orders: orders.map((order) => ({
        ...order,
        amount_label: money(order.amounts?.total?.amount ?? order.total?.amount, order.amounts?.total?.currency || order.total?.currency),
        date_label: shortDate(order.date?.date || order.created_at?.date || order.created_at),
        status_label: order.status?.name || order.status || "—",
        customer_label: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || "عميل",
      })),
      error,
      page,
      pages: pagination?.totalPages || 1,
    });
  })
);

// ─────────────────────────── العملاء ───────────────────────────

router.get(
  "/customers",
  ensureAuthenticated,
  requireFeature("customers_crm"),
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = String(req.query.q || "").trim().toLowerCase();

    let customers = [];
    let pagination = null;
    let error = null;
    try {
      const result = await salla.forMerchant(merchantId).getCustomers({ page, perPage: 25 });
      customers = result.data;
      pagination = result.pagination;
    } catch (err) {
      error = apiError(err);
    }

    const manualRows = await db.listManualCustomers(merchantId);
    const manual = manualRows.map((row) => ({ ...row.toJSON(), manual: true }));

    const decorate = (c) => {
      const name = c.manual ? c.name : [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "عميل";
      const mobile = c.manual ? c.mobile : `${c.mobile_code || ""}${c.mobile || ""}`;
      return {
        ...c,
        display_name: name,
        display_mobile: mobile,
        wa_link: normalizeMobile(mobile) ? `https://wa.me/${normalizeMobile(mobile)}` : null,
        initial: initial(name),
        color: avatarColor(name),
      };
    };

    let all = [...manual.map(decorate), ...customers.map(decorate)];
    if (search) {
      all = all.filter(
        (c) =>
          c.display_name.toLowerCase().includes(search) ||
          String(c.display_mobile).includes(search) ||
          String(c.email || "").toLowerCase().includes(search)
      );
    }

    res.render("customers.html", {
      isLogin: req.user,
      user: req.user,
      customers: all,
      manualCount: manual.length,
      error,
      search,
      page,
      pages: pagination?.totalPages || 1,
      added: req.query.added === "1",
      addError: req.query.error === "1",
    });
  })
);

router.post(
  "/customers/add",
  ensureAuthenticated,
  requireFeature("customers_crm"),
  asyncRoute(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const mobile = normalizeMobile(req.body.mobile);
    if (!name || !mobile) return res.redirect("/customers?error=1");

    await db.saveManualCustomer({
      merchant: merchantOf(req),
      name: name.slice(0, 60),
      mobile,
      email: String(req.body.email || "").trim().slice(0, 80),
    });
    res.redirect("/customers?added=1");
  })
);

router.post(
  "/customers/delete",
  ensureAuthenticated,
  requireFeature("customers_crm"),
  asyncRoute(async (req, res) => {
    await db.deleteManualCustomer(merchantOf(req), parseInt(req.body.id, 10));
    res.redirect("/customers");
  })
);

router.get(
  "/customers/export.csv",
  ensureAuthenticated,
  requireFeature("customers_crm"),
  asyncRoute(async (req, res) => {
    const rows = await db.listManualCustomers(merchantOf(req));
    const csv = toCsv(rows.map((r) => r.toJSON()), [
      { label: "الاسم", key: "name" },
      { label: "الجوال", key: "mobile" },
      { label: "البريد", key: "email" },
      { label: "أضيف في", value: (r) => shortDate(r.created_at) },
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="customers.csv"');
    res.send(csv);
  })
);

// ─────────────────────────── الفواتير ───────────────────────────

router.get(
  "/invoices",
  ensureAuthenticated,
  requireFeature("invoices"),
  asyncRoute(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    let orders = [];
    let pagination = null;
    let error = null;
    try {
      const result = await salla.forMerchant(merchantOf(req)).getOrders({ page, perPage: 25 });
      orders = result.data;
      pagination = result.pagination;
    } catch (err) {
      error = apiError(err);
    }
    res.render("invoices.html", {
      isLogin: req.user,
      user: req.user,
      orders: orders.map((order) => ({
        ...order,
        amount_label: money(order.amounts?.total?.amount ?? order.total?.amount, order.amounts?.total?.currency || order.total?.currency),
        date_label: shortDate(order.date?.date || order.created_at?.date || order.created_at),
        customer_label: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || "عميل",
      })),
      error,
      page,
      pages: pagination?.totalPages || 1,
    });
  })
);

router.get(
  "/invoices/:id",
  ensureAuthenticated,
  requireFeature("invoices"),
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const api = salla.forMerchant(merchantId);
    let order = null;
    try {
      // نداء مباشر للطلب الواحد بدل تصفح كل الصفحات بحثاً عنه
      order = await api.getOrder(req.params.id);
    } catch (err) {
      log.warn("تعذّر جلب الطلب", { error: err.message });
    }
    if (!order) {
      return res.status(404).render("error.html", {
        code: 404,
        title: "لم نجد هذا الطلب",
        message: "قد يكون الطلب محذوفاً أو لا يخصّ متجرك.",
        isLogin: req.user,
        user: req.user,
      });
    }

    const settings = (await db.getMerchantSettings(merchantId)) || {};
    res.render("invoice-print.html", {
      invoice: buildInvoice(order, req.user.merchant || {}, settings),
      isLogin: req.user,
      user: req.user,
    });
  })
);

// ─────────────────────────── الحساب ───────────────────────────

router.get(
  "/account",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const token = await db.getOauthToken(merchantId);
    let store = null;
    try {
      store = await salla.forMerchant(merchantId).getStore();
    } catch (err) {
      log.debug("تعذّر جلب بيانات المتجر", { error: err.message });
    }
    res.render("account.html", {
      isLogin: req.user,
      user: req.user,
      store,
      connection: token
        ? {
            connected: true,
            expires_label: token.expires_at ? shortDate(token.expires_at) : "غير معروف",
            expires_ago: token.expires_at ? timeAgo(token.expires_at) : "",
            fresh: token.isFresh ? token.isFresh() : true,
          }
        : { connected: false },
    });
  })
);

module.exports = router;
