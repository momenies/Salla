/** السلات المتروكة: العرض، التصفية، التصدير، والإجراءات اليدوية */
const express = require("express");
const { asyncRoute, ensureAuthenticated, merchantOf } = require("../middleware");
const db = require("../helpers/salla-db");
const salla = require("../lib/salla");
const automation = require("../services/automation");
const messaging = require("../services/messaging");
const log = require("../lib/logger");
const { timeAgo, money, avatarColor, initial, normalizeMobile, toCsv } = require("../lib/format");

const router = express.Router();
const PAGE_SIZE = 25;

/** رابط واتساب جاهز برسالة مكتوبة — للتواصل اليدوي بضغطة */
function whatsappLink(cart, storeName) {
  const digits = normalizeMobile(cart.customer_mobile);
  if (!digits) return null;
  const message = automation.renderTemplate(automation.SCENARIOS.cart_reminder.tpl, {
    name: cart.customer_name,
    store: storeName,
    url: cart.checkout_url,
  });
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function decorate(row, storeName) {
  const cart = row.toJSON ? row.toJSON() : row;
  return {
    ...cart,
    time_ago: timeAgo(cart.abandoned_at),
    amount_label: money(cart.total_amount, cart.currency),
    initial: initial(cart.customer_name),
    color: avatarColor(cart.customer_name || cart.customer_mobile),
    whatsapp_url: whatsappLink(cart, storeName),
    mailto_url: cart.customer_email
      ? `mailto:${cart.customer_email}?subject=${encodeURIComponent("سلتك بانتظارك 🛒")}`
      : null,
  };
}

router.get(
  "/abandoned",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const status = String(req.query.status || "all");
    const search = String(req.query.q || "").trim().slice(0, 60);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const storeName = req.user?.merchant?.name || "";

    const [list, counts, amounts, settings] = await Promise.all([
      db.listAbandonedCarts(merchantId, { status, search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      db.cartStatusCounts(merchantId),
      db.cartAmountByStatus(merchantId),
      db.getMerchantSettings(merchantId),
    ]);

    const carts = list.rows.map((row) => decorate(row, storeName));
    const handled = counts.contacted + counts.recovered;

    res.render("abandoned.html", {
      isLogin: req.user,
      user: req.user,
      carts,
      stats: counts,
      total: list.count,
      page,
      pages: Math.max(1, Math.ceil(list.count / PAGE_SIZE)),
      status,
      search,
      kpis: {
        recoveredAmount: money(amounts.recovered || 0),
        pendingAmount: money((amounts.new || 0) + (amounts.contacted || 0)),
        sentCount: handled,
        pendingCount: counts.new,
        rate: handled ? Math.round((counts.recovered / handled) * 100) : 0,
      },
      channelReady: Boolean(messaging.resolveChannel(settings)),
      channelProblem: messaging.channelProblem(settings),
      autoEnabled: Boolean(settings && settings.auto_enabled),
      flash: req.query.done || null,
    });
  })
);

/** تعليم سلة كـ«تم التواصل» — معرّف المتجر من الجلسة لا من النموذج */
router.post(
  "/abandoned/contact",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const cartId = parseInt(req.body.cart_id, 10);
    if (cartId) await db.setAbandonedCartStatus(merchantId, cartId, "contacted");
    res.redirect(back(req, "/abandoned"));
  })
);

/** تعليم سلة كمستعادة يدوياً (اشترى العميل عبر قناة أخرى) */
router.post(
  "/abandoned/recover",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const cartId = parseInt(req.body.cart_id, 10);
    if (cartId) await db.setAbandonedCartStatus(merchantId, cartId, "recovered");
    res.redirect(back(req, "/abandoned"));
  })
);

/** تجاهل سلة — لا تذكير ولا إحصاء */
router.post(
  "/abandoned/ignore",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const cartId = parseInt(req.body.cart_id, 10);
    if (cartId) await db.setAbandonedCartStatus(merchantId, cartId, "ignored");
    res.redirect(back(req, "/abandoned"));
  })
);

/** إرسال تذكير الآن لسلة واحدة، بلا انتظار المجدول */
router.post(
  "/abandoned/remind",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const cartId = parseInt(req.body.cart_id, 10);
    const cart = cartId ? await db.getCart(merchantId, cartId) : null;
    if (!cart) return res.status(404).json({ ok: false, error: "لم نجد هذه السلة" });

    const settings = await db.getMerchantSettings(merchantId);
    if (!messaging.resolveChannel(settings)) {
      return res.status(400).json({ ok: false, error: messaging.channelProblem(settings) });
    }

    const scenario = await automation.scenarioConfig(merchantId, "cart_reminder");
    const body = automation.renderTemplate(
      (settings.msg_template && settings.msg_template.trim()) || scenario.msg_template,
      {
        name: cart.customer_name,
        store: settings.sender_name || settings.store_name || req.user?.merchant?.name || "",
        url: cart.checkout_url,
        amount: cart.total_amount,
      }
    );

    await db.insertMessage({
      merchant: merchantId,
      kind: "cart_reminder",
      cart_id: cart.cart_id,
      customer_name: cart.customer_name || "",
      customer_mobile: normalizeMobile(cart.customer_mobile),
      body,
      status: "pending",
      scheduled_at: Math.floor(Date.now() / 1000),
    });
    await db.setAbandonedCartStatus(merchantId, cart.cart_id, "contacted");

    // نرسل فوراً بدل انتظار الدورة القادمة — التاجر ضغط الزر الآن
    const summary = await automation.processDueMessages(5);
    res.json({ ok: true, sent: summary.sent, failed: summary.failed });
  })
);

/**
 * استيراد السلات الموجودة لدى سلة.
 * الويبهوك لا يرسل ما حدث قبل التثبيت، فتبدو اللوحة فارغة بلا سبب مفهوم.
 */
router.post(
  "/abandoned/import",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const api = salla.forMerchant(merchantId);
    try {
      const { data } = await api.getAbandonedCarts({ maxPages: 3 });
      let imported = 0;
      for (const cart of data) {
        const customer = cart.customer || {};
        await db.saveAbandonedCart({
          merchant: merchantId,
          cart_id: cart.id,
          customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.name || "",
          customer_mobile: customer.mobile || "",
          customer_email: customer.email || "",
          total_amount: cart.total?.amount || cart.total || 0,
          currency: cart.total?.currency || "SAR",
          checkout_url: cart.checkout_url || "",
          items_count: Array.isArray(cart.items) ? cart.items.length : 0,
          abandoned_at: Math.floor(new Date(cart.updated_at?.date || cart.created_at?.date || Date.now()).getTime() / 1000),
        });
        imported++;
      }
      log.info("استيراد سلات من سلة", { merchant: merchantId, imported });
      res.json({ ok: true, imported });
    } catch (err) {
      log.warn("فشل استيراد السلات", { merchant: merchantId, error: err.message });
      res.status(400).json({
        ok: false,
        error:
          err.status === 403 || err.status === 401
            ? "لا يملك التطبيق صلاحية قراءة السلات — فعّلها من بوابة الشركاء ثم أعد ربط المتجر."
            : err.userMessage || "تعذّر الاستيراد من سلة.",
      });
    }
  })
);

/** تصدير CSV يفتحه Excel العربي بلا رموز مشوّهة */
router.get(
  "/abandoned/export.csv",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    const { rows } = await db.listAbandonedCarts(merchantId, { status: String(req.query.status || "all"), limit: 200 });
    const csv = toCsv(
      rows.map((r) => r.toJSON()),
      [
        { label: "العميل", key: "customer_name" },
        { label: "الجوال", key: "customer_mobile" },
        { label: "البريد", key: "customer_email" },
        { label: "المبلغ", key: "total_amount" },
        { label: "العملة", key: "currency" },
        { label: "عدد المنتجات", key: "items_count" },
        { label: "الحالة", value: (r) => ({ new: "جديدة", contacted: "تم التواصل", recovered: "مستعادة", ignored: "متجاهلة" }[r.status] || r.status) },
        { label: "رابط الإكمال", key: "checkout_url" },
      ]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="abandoned-carts.csv"');
    res.send(csv);
  })
);

/** يعيد المستخدم إلى نفس الصفحة والتصفية التي كان يراها */
function back(req, fallback) {
  const ref = req.get("referer");
  if (!ref) return fallback;
  try {
    const url = new URL(ref);
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

module.exports = router;
