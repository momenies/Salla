/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  محرّك الأتمتة — من حدث في المتجر إلى رسالة في جوال العميل
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ثلاث مراحل واضحة:
 *   ١. حدث يصل من سلة (طلب جديد، تغيّر حالة، سلة متروكة)
 *   ٢. نجدول رسالة في جدول `Messages` بحالة pending ووقت استحقاق
 *   ٣. عامل دوري يلتقط المستحق ويُرسله ويسجّل النتيجة
 *
 * لماذا الجدولة بدل الإرسال الفوري؟ لأن التذكير الفوري يفشل غالباً (العميل
 * ما زال يتصفّح)، ولأن الطابور يعطينا إعادة محاولة، وسجلّاً، وإلغاءً عند
 * إتمام الطلب — وهذه الثلاثة هي الفرق بين «أداة» و«منتج».
 */
const db = require("../helpers/salla-db");
const log = require("../lib/logger");
const messaging = require("./messaging");
const { normalizeMobile } = require("../lib/format");

// ─────────────────────────── كتالوج السيناريوهات ───────────────────────────

const SCENARIOS = {
  cart_reminder: {
    label: "تذكير السلة المتروكة",
    desc: "رسالة لطيفة برابط السلة نفسها لمن ترك منتجاته دون إتمام الطلب.",
    icon: "i-cart",
    delay_minutes: 60,
    core: true, // يعمل من مسار السلات، لا من أحداث الطلبات
    tpl:
      "مرحباً [الاسم] 👋\nلاحظنا أنك تركت بعض المنتجات في سلتك بمتجر [المتجر] 😊\nأكمل طلبك الآن من هنا:\n[الرابط]",
  },
  order_thanks: {
    label: "شكر على الطلب الجديد",
    desc: "رسالة شكر فورية تصل للعميل بمجرد إتمام طلبه، مع رقم الطلب.",
    icon: "i-check",
    delay_minutes: 0,
    tpl:
      "شكراً لك [الاسم] 🎉\nتم استلام طلبك رقم #[رقم الطلب] من متجر [المتجر] بنجاح.\nسنوافيك بكل تحديثات الشحن 🚚",
  },
  shipping_update: {
    label: "تحديث حالة الشحن",
    desc: "يخبر العميل تلقائياً حين يتحوّل طلبه إلى التجهيز أو الشحن.",
    icon: "i-box",
    delay_minutes: 0,
    tpl:
      "خبر سار [الاسم] 📦\nطلبك رقم #[رقم الطلب] من متجر [المتجر] الآن قيد الشحن وسيصلك قريباً 🚚",
  },
  review_request: {
    label: "طلب تقييم بعد التسليم",
    desc: "بعد تسليم الطلب بمدة تحدّدها، نطلب من العميل تقييم تجربته.",
    icon: "i-zap",
    delay_minutes: 2880,
    tpl:
      "مرحباً [الاسم] 👋\nنتمنى أن يكون طلبك من متجر [المتجر] أعجبك ✨\nشاركنا رأيك بتقييم طلبك — رأيك يساعدنا كثيراً 💚",
  },
  cod_confirm: {
    label: "تأكيد الدفع عند الاستلام",
    desc: "يؤكّد طلبات الدفع عند الاستلام فور ورودها لتقليل الطلبات الوهمية.",
    icon: "i-wallet",
    delay_minutes: 0,
    tpl:
      "مرحباً [الاسم] 👋\nوصلنا طلبك رقم #[رقم الطلب] من متجر [المتجر] بالدفع عند الاستلام 💵\nلتأكيد طلبك ردّ بكلمة «تأكيد» أو تواصل معنا.",
  },
  win_back: {
    label: "استعادة العميل الصامت",
    desc: "رسالة ودّية لمن لم يُكمل حتى بعد التذكير الأول — الفرصة الأخيرة.",
    icon: "i-send",
    delay_minutes: 2880,
    tpl:
      "[الاسم] 👋\nسلتك في متجر [المتجر] ما زالت محفوظة، وقد تنفد الكمية قريباً ⏳\nأكملها من هنا:\n[الرابط]",
  },
};

const KIND_LABELS = Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.label]));

/** المتغيّرات المتاحة داخل نص الرسالة — تُعرض للتاجر في المحرّر */
const TEMPLATE_VARS = [
  { token: "[الاسم]", desc: "اسم العميل" },
  { token: "[المتجر]", desc: "اسم متجرك" },
  { token: "[رقم الطلب]", desc: "رقم الطلب" },
  { token: "[الرابط]", desc: "رابط إكمال السلة" },
  { token: "[المبلغ]", desc: "قيمة السلة أو الطلب" },
];

/** يستبدل المتغيّرات بقيمها الحقيقية */
function renderTemplate(tpl, vars = {}) {
  return String(tpl || "")
    .replaceAll("[الاسم]", vars.name || "")
    .replaceAll("[المتجر]", vars.store || "")
    .replaceAll("[رقم الطلب]", vars.order ? String(vars.order) : "")
    .replaceAll("[الرابط]", vars.url || "")
    .replaceAll("[المبلغ]", vars.amount || "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** إعدادات سيناريو لمتجر: ما حفظه التاجر، وإلا الافتراضي */
async function scenarioConfig(merchantId, key) {
  const base = SCENARIOS[key];
  if (!base) return null;
  const rows = await db.getAutomations(merchantId);
  const row = rows.find((r) => r.key === key);
  return {
    key,
    ...base,
    enabled: row ? !!row.enabled : false,
    delay_minutes: row && row.delay_minutes != null ? row.delay_minutes : base.delay_minutes,
    msg_template: row && row.msg_template ? row.msg_template : base.tpl,
  };
}

/** كل السيناريوهات بحالتها الحالية — لصفحة الأتمتة */
async function listScenarios(merchantId) {
  const rows = await db.getAutomations(merchantId);
  return Object.entries(SCENARIOS).map(([key, base]) => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      label: base.label,
      desc: base.desc,
      icon: base.icon,
      core: !!base.core,
      enabled: row ? !!row.enabled : false,
      delay_minutes: row && row.delay_minutes != null ? row.delay_minutes : base.delay_minutes,
      msg_template: row && row.msg_template != null && row.msg_template !== "" ? row.msg_template : base.tpl,
    };
  });
}

// ─────────────────────────── الجدولة ───────────────────────────

/**
 * يجدول رسالة سيناريو لعميل واحد.
 * يتجاهل بهدوء إن كان السيناريو مغلقاً أو الرقم ناقصاً أو الرسالة مكرّرة.
 *
 * @returns {Promise<boolean>} هل جُدولت فعلاً؟
 */
async function schedule(merchantId, key, opts = {}) {
  const cfg = await scenarioConfig(merchantId, key);
  if (!cfg || !cfg.enabled) return false;

  const mobile = normalizeMobile(opts.mobile, opts.countryCode);
  if (!mobile) return false;

  // منع التكرار: نفس النوع لنفس الطلب/السلة مرة واحدة فقط
  if (opts.orderId && (await db.hasMessageForOrder(merchantId, key, opts.orderId))) return false;

  const settings = await db.getMerchantSettings(merchantId);
  const storeName = (settings && (settings.sender_name || settings.store_name)) || opts.storeName || "";

  const body = renderTemplate(cfg.msg_template, {
    name: opts.name,
    store: storeName,
    order: opts.orderId,
    url: opts.url,
    amount: opts.amount,
  });

  const delay = parseInt(cfg.delay_minutes, 10) || 0;
  await db.insertMessage({
    merchant: merchantId,
    kind: key,
    order_id: opts.orderId || null,
    cart_id: opts.cartId || null,
    customer_name: opts.name || "",
    customer_mobile: mobile,
    body,
    status: "pending",
    scheduled_at: Math.floor(Date.now() / 1000) + delay * 60,
  });

  log.info("جُدولت رسالة أتمتة", { merchant: merchantId, kind: key, order: opts.orderId, delay });
  return true;
}

// ─────────────────────────── أحداث الطلبات ───────────────────────────

function extractCustomer(data = {}) {
  const c = data.customer || {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.name || "";
  return { name, mobile: c.mobile || "", countryCode: c.country_code || c.mobile_code || "966" };
}

function isCodOrder(data = {}) {
  const pm = data.payment_method;
  const code = typeof pm === "object" && pm ? pm.code || pm.id || pm.name : pm;
  return String(code || "").toLowerCase().includes("cod");
}

function orderAmount(data = {}) {
  const total = data.amounts?.total || data.total;
  const value = typeof total === "object" ? total?.amount : total;
  return value ? String(value) : "";
}

async function handleOrderCreated(eventBody) {
  const merchant = eventBody.merchant;
  const data = eventBody.data || {};
  if (!merchant || !data.id) return;

  const { name, mobile, countryCode } = extractCustomer(data);
  if (!mobile) return;

  const key = isCodOrder(data) ? "cod_confirm" : "order_thanks";
  await schedule(merchant, key, {
    orderId: data.id,
    name,
    mobile,
    countryCode,
    amount: orderAmount(data),
  });
}

const CANCEL_STATUSES = ["canceled", "cancelled", "restored", "payment_failed"];
const SHIPPING_STATUSES = ["in_progress", "shipped", "out_for_delivery", "under_review"];
const DELIVERED_STATUSES = ["delivered", "completed"];

function statusOf(data = {}) {
  const raw = typeof data.status === "object" && data.status ? data.status.slug || data.status.id || data.status.name : data.status;
  return String(raw || "").toLowerCase();
}

async function handleOrderStatusUpdated(eventBody) {
  const merchant = eventBody.merchant;
  const data = eventBody.data || {};
  if (!merchant || !data.id) return;

  const status = statusOf(data);
  const { name, mobile, countryCode } = extractCustomer(data);

  if (CANCEL_STATUSES.includes(status)) {
    const n = await db.cancelPendingForOrder(merchant, data.id);
    if (n) log.info("أُلغيت رسائل معلّقة لطلب ملغى", { merchant, order: data.id, count: n });
    return;
  }
  if (SHIPPING_STATUSES.includes(status)) {
    // الطلب صار حقيقياً: لا داعي لتأكيد الدفع عند الاستلام
    await db.cancelPendingForOrder(merchant, data.id, ["cod_confirm"]);
    await schedule(merchant, "shipping_update", { orderId: data.id, name, mobile, countryCode });
    return;
  }
  if (DELIVERED_STATUSES.includes(status)) {
    await schedule(merchant, "review_request", { orderId: data.id, name, mobile, countryCode });
  }
}

// ─────────────────────────── السلات المتروكة ───────────────────────────

/**
 * يجدول تذكيرات السلات المستحقّة لمتجر واحد.
 * تُحسب المهلة من إعدادات المتجر (`delay_minutes`)، وتُعلَّم السلة كـ«تم التواصل»
 * فور الجدولة حتى لا تُجدول مرتين لو تأخّر المرسل.
 */
async function scheduleCartReminders(merchantId) {
  const result = { merchant: merchantId, queued: 0, skipped: null };

  const settings = await db.getMerchantSettings(merchantId);
  if (!settings || !settings.auto_enabled) {
    result.skipped = "الأتمتة غير مفعّلة";
    return result;
  }
  if (!messaging.resolveChannel(settings)) {
    result.skipped = messaging.channelProblem(settings);
    return result;
  }

  const cfg = await scenarioConfig(merchantId, "cart_reminder");
  const delayMinutes = parseInt(settings.delay_minutes, 10) || cfg.delay_minutes || 60;
  const cutoff = Math.floor(Date.now() / 1000) - delayMinutes * 60;

  const carts = await db.dueCarts(merchantId, cutoff);
  if (!carts.length) return result;

  const storeName = settings.sender_name || settings.store_name || "";
  const template =
    (settings.msg_template && settings.msg_template.trim()) ||
    (cfg.msg_template && cfg.msg_template.trim()) ||
    SCENARIOS.cart_reminder.tpl;

  for (const cartRow of carts) {
    const cart = cartRow.toJSON ? cartRow.toJSON() : cartRow;
    const mobile = normalizeMobile(cart.customer_mobile);
    if (!mobile) continue;

    const body = renderTemplate(template, {
      name: cart.customer_name,
      store: storeName,
      url: cart.checkout_url,
      amount: cart.total_amount,
    });

    await db.insertMessage({
      merchant: merchantId,
      kind: "cart_reminder",
      cart_id: cart.cart_id,
      customer_name: cart.customer_name || "",
      customer_mobile: mobile,
      body,
      status: "pending",
      scheduled_at: Math.floor(Date.now() / 1000),
    });
    await db.setAbandonedCartStatus(merchantId, cart.cart_id, "contacted");
    result.queued++;
  }

  if (result.queued) log.info("جُدولت تذكيرات سلات", { merchant: merchantId, count: result.queued });
  return result;
}

// ─────────────────────────── عامل الطابور ───────────────────────────

/**
 * يلتقط الرسائل المستحقّة ويرسلها.
 * يُحترم فيه: ساعات الهدوء، السقف اليومي، وثلاث محاولات كحد أقصى.
 */
async function processDueMessages(limit = 50) {
  const summary = { checked: 0, sent: 0, failed: 0, deferred: 0 };

  let due = [];
  try {
    due = await db.listDueMessages(limit);
  } catch (err) {
    log.error("تعذّرت قراءة طابور الرسائل", { error: err.message });
    return summary;
  }
  if (!due.length) return summary;

  const settingsCache = new Map();
  const guardCache = new Map();

  for (const raw of due) {
    const msg = raw.toJSON ? raw.toJSON() : raw;
    summary.checked++;
    try {
      if (!settingsCache.has(msg.merchant)) {
        settingsCache.set(msg.merchant, await db.getMerchantSettings(msg.merchant));
      }
      const settings = settingsCache.get(msg.merchant);

      if (!messaging.resolveChannel(settings)) {
        await db.bumpMessageAttempt(msg.id, messaging.channelProblem(settings));
        summary.failed++;
        continue;
      }

      if (!guardCache.has(msg.merchant)) {
        guardCache.set(msg.merchant, await messaging.guard(msg.merchant, settings));
      }
      const gate = guardCache.get(msg.merchant);
      if (!gate.allowed) {
        // تأجيل ليس فشلاً: نعيد الجدولة بلا زيادة عدّاد المحاولات
        await raw.update({ scheduled_at: gate.retryAt || Math.floor(Date.now() / 1000) + 1800 });
        summary.deferred++;
        continue;
      }

      const templateName =
        msg.kind === "cart_reminder" ? settings.template_name || "cart_reminder" : msg.kind;

      const result = await messaging.send({
        merchantId: msg.merchant,
        settings,
        to: msg.customer_mobile,
        text: msg.body,
        templateName,
        params: [msg.customer_name || "", settings.sender_name || settings.store_name || "", cartUrlFromBody(msg.body)],
      });

      if (result.ok) {
        await db.markMessageSent(msg.id, result.channel);
        summary.sent++;
        log.info("أُرسلت رسالة", { merchant: msg.merchant, kind: msg.kind, channel: result.channel });
      } else {
        await db.bumpMessageAttempt(msg.id, result.error);
        summary.failed++;
        log.warn("فشل إرسال رسالة", { merchant: msg.merchant, id: msg.id, error: result.error });
      }
    } catch (err) {
      await db.bumpMessageAttempt(msg.id, err.message).catch(() => {});
      summary.failed++;
      log.error("خطأ أثناء معالجة رسالة", { id: msg.id, error: err.message });
    }
  }
  return summary;
}

/** يستخرج الرابط من نص الرسالة ليملأ متغيّر القالب الثالث لدى Meta */
function cartUrlFromBody(body) {
  const match = /https?:\/\/\S+/.exec(String(body || ""));
  return match ? match[0] : "";
}

/** دورة كاملة لكل المتاجر — يستدعيها المجدول */
async function runCycle() {
  const results = [];
  const merchants = await db.getAllMerchantIds();
  for (const merchant of merchants) {
    try {
      results.push(await scheduleCartReminders(merchant));
    } catch (err) {
      log.error("فشلت دورة متجر", { merchant, error: err.message });
      results.push({ merchant, error: err.message });
    }
  }
  const queue = await processDueMessages();
  return { merchants: merchants.length, results, queue };
}

module.exports = {
  SCENARIOS,
  KIND_LABELS,
  TEMPLATE_VARS,
  renderTemplate,
  listScenarios,
  scenarioConfig,
  schedule,
  handleOrderCreated,
  handleOrderStatusUpdated,
  scheduleCartReminders,
  processDueMessages,
  runCycle,
  statusOf,
  isCodOrder,
  extractCustomer,
};
