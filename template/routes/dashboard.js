/** الصفحة الرئيسية: صفحة تعريفية للزائر، ولوحة تحكم للتاجر. */
const express = require("express");
const { withStoreOptional, asyncRoute } = require("../middleware");
const { normalizeUser } = require("../lib/normalize");
const config = require("../config");

const router = express.Router();

/** يبني سلسلة مبيعات آخر 14 يوماً من قائمة الطلبات لرسمها كمخطّط */
function buildSalesSeries(orders, days = 14) {
  const buckets = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    buckets.set(day.toISOString().slice(0, 10), { date: day, total: 0, count: 0 });
  }

  for (const order of orders) {
    const raw = order?.date?.date || order?.date || order?.created_at;
    if (!raw) continue;
    const key = String(raw).slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const amount = Number(order?.total?.amount);
    bucket.total += Number.isFinite(amount) ? amount : 0;
    bucket.count += 1;
  }

  return [...buckets.values()];
}

/**
 * يحوّل سلسلة المبيعات إلى بيانات جاهزة للرسم.
 * الحساب هنا وليس في القالب، حتى تبقى القوالب بلا منطق.
 */
function buildChart(orders, currency, days = 14) {
  const series = buildSalesSeries(orders, days);
  const max = series.reduce((m, d) => Math.max(m, d.total), 0);
  const grandTotal = series.reduce((sum, d) => sum + d.total, 0);
  const dayFormat = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { day: "numeric", month: "short" });

  return {
    currency,
    max,
    total: Math.round(grandTotal * 100) / 100,
    hasData: max > 0,
    days: series.map((d) => ({
      label: dayFormat.format(d.date),
      iso: d.date.toISOString().slice(0, 10),
      total: Math.round(d.total * 100) / 100,
      count: d.count,
      // ارتفاع نسبي؛ نضمن حداً أدنى مرئياً لليوم الذي فيه مبيعات قليلة
      pct: max > 0 ? Math.max(d.total > 0 ? 4 : 0, Math.round((d.total / max) * 100)) : 0,
      isMax: max > 0 && d.total === max,
    })),
  };
}

/** ملخّص رقمي للطلبات المعروضة */
function summarize(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const total = list.reduce((sum, o) => sum + (Number(o?.total?.amount) || 0), 0);
  const currency = list.find((o) => o?.total?.currency)?.total?.currency || config.ui.currency;
  const round = (v) => Math.round(v * 100) / 100;

  const byStatus = new Map();
  for (const order of list) {
    const name = order?.status?.name || "غير محدّدة";
    const slug = order?.status?.slug || "";
    const entry = byStatus.get(name) || { name, slug, count: 0 };
    entry.count += 1;
    byStatus.set(name, entry);
  }

  return {
    count: list.length,
    total: round(total),
    average: list.length ? round(total / list.length) : 0,
    currency,
    statuses: [...byStatus.values()].sort((a, b) => b.count - a.count),
  };
}

router.get(
  "/",
  withStoreOptional,
  asyncRoute(async (req, res) => {
    // زائر لم يسجّل دخوله بعد
    if (!req.user) {
      return res.render("index.html", {
        page: "home",
        pageTitle: "مرحباً بك",
        pageSubtitle: "",
        isLogin: false,
      });
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");

    const profile = req.profile || normalizeUser(req.user);
    const view = {
      page: "home",
      pageTitle: "الرئيسية",
      pageSubtitle: "نظرة عامة على متجرك",
      isLogin: req.user,
      user: req.user,
      profile,
      storeInfo: profile?.store || null,
      store: req.store,
      connected: Boolean(req.salla),
      stats: null,
      chart: null,
      recentOrders: [],
      customersCount: null,
      error: null,
    };

    if (!req.salla) {
      view.error = "لم نعثر على توكن محفوظ لهذا المتجر. سجّل الخروج ثم أعد الدخول لإعادة الربط.";
      return res.render("index.html", view);
    }

    // نجلب الطلبات والعملاء بالتوازي — أسرع من انتظار كل طلب على حدة
    const [ordersResult, customersResult] = await Promise.allSettled([
      req.salla.listOrders({ page: 1, perPage: 50 }),
      req.salla.listCustomers({ page: 1, perPage: 1 }),
    ]);

    if (ordersResult.status === "fulfilled") {
      const orders = Array.isArray(ordersResult.value.data) ? ordersResult.value.data : [];
      view.stats = summarize(orders);
      view.chart = buildChart(orders, view.stats.currency);
      view.recentOrders = orders.slice(0, 5);
    } else {
      view.error = ordersResult.reason?.message || "تعذّر جلب الطلبات.";
    }

    if (customersResult.status === "fulfilled") {
      const pagination = customersResult.value.pagination;
      view.customersCount = pagination?.total ?? (customersResult.value.data || []).length;
    }

    res.render("index.html", view);
  })
);

module.exports = router;
module.exports.summarize = summarize;
module.exports.buildSalesSeries = buildSalesSeries;
module.exports.buildChart = buildChart;
