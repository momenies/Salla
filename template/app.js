// Import Deps
require("dotenv").config({ quiet: true });
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const consolidate = require("consolidate");
const getUnixTimestamp = require("./helpers/getUnixTimestamp");
const bodyParser = require("body-parser");
const wa = require("./helpers/wa");
const wweb = require("./helpers/wa-wweb");
const { handleSubscriptionEvent, activeFeatures, unlockAllEnabled } = require("./helpers/subscriptions");
const { FEATURES, BUNDLE, paidFeatures, featureForRoute } = require("./config/features");
const { buildInvoice } = require("./helpers/invoice");
const port = process.env.PORT || process.argv[2] || 8082;

/*
  Create a .env file in the root directory of your project. 
  Add environment-specific variables on new lines in the form of NAME=VALUE. For example:
  SALLA_OAUTH_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  SALLA_OAUTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ...
*/
const {
  SALLA_OAUTH_CLIENT_ID,
  SALLA_OAUTH_CLIENT_SECRET,
  SALLA_OAUTH_CLIENT_REDIRECT_URI,
  SALLA_WEBHOOK_SECRET,
  SALLA_DATABASE_ORM,
} = process.env;

// Import Salla APIs
const SallaAPIFactory = require("@salla.sa/passport-strategy");
const SallaDatabase = require("./helpers/salla-db");
const SallaWebhook = require("@salla.sa/webhooks-actions");

SallaWebhook.setSecret(SALLA_WEBHOOK_SECRET);

// مكتبة سلة ترمي خطأً في `on()` إذا كان السر فارغاً، فينهار التطبيق كلياً
// قبل أن يقلع. الويبهوك ميزة اختيارية أثناء التطوير، فلا يصحّ أن يمنع
// التشغيل — نسجّل المستمعين فقط عند وجود السر، ونطبع تنبيهاً واضحاً.
if (SALLA_WEBHOOK_SECRET) {
  SallaWebhook.on("app.installed", (eventBody, userArgs) => {
    // handel app.installed event
  });
  SallaWebhook.on("app.store.authorize", (eventBody, userArgs) => {
    // handel app.installed event
  });
  SallaWebhook.on("all", (eventBody, userArgs) => {
    // handel all events even thats not authorized
  });
} else {
  console.warn("⚠️  SALLA_WEBHOOK_SECRET غير مضبوط — أحداث المتجر (Webhooks) لن تُستقبل.");
  console.warn("    التطبيق يعمل طبيعياً، لكن ضع السر في .env لتفعيل الأتمتة والاشتراكات.");
}

// ===================== Automation Hub — scenarios =====================
const AUTOMATION_SCENARIOS = {
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
    desc: "يخبر العميل تلقائياً حين يتحول طلبه إلى التجهيز أو الشحن.",
    icon: "i-box",
    delay_minutes: 0,
    tpl:
      "خبر سار [الاسم] 📦\nطلبك رقم #[رقم الطلب] من متجر [المتجر] الآن قيد الشحن وسيصلك قريباً 🚚",
  },
  review_request: {
    label: "طلب تقييم بعد التسليم",
    desc: "بعد تسليم الطلب بمدة تحددها، نطلب من العميل تقييم تجربته.",
    icon: "i-zap",
    delay_minutes: 2880,
    tpl:
      "مرحباً [الاسم] 👋\nنتمنى أن يكون طلبك من متجر [المتجر] أعجبك ✨\nشاركنا رأيك بتقييم طلبك — رأيك يساعدنا كثيراً 💚",
  },
  cod_confirm: {
    label: "تأكيد الدفع عند الاستلام (COD)",
    desc: "يؤكد الطلبات المدفوع عند الاستلام فور ورودها لتقليل الطلبات الوهمية.",
    icon: "i-wallet",
    delay_minutes: 0,
    tpl:
      "مرحباً [الاسم] 👋\nوصلنا طلبك رقم #[رقم الطلب] من متجر [المتجر] بالدفع عند الاستلام 💵\nلتأكيد طلبك ردّ بكلمة «تأكيد» أو تواصل معنا.",
  },
};

function renderAutomationTpl(tpl, vars) {
  return (tpl || "")
    .replaceAll("[الاسم]", vars.name || "")
    .replaceAll("[المتجر]", vars.store || "")
    .replaceAll("[رقم الطلب]", vars.order ? String(vars.order) : "")
    .replaceAll("[الرابط]", vars.url || "");
}

// schedule a scenario message for a merchant (respects enablement + saved template/delay)
async function scheduleAutomation(merchantId, key, opts) {
  const cfg = AUTOMATION_SCENARIOS[key];
  if (!cfg) return false;
  const settings = await SallaDatabase.getMerchantSettings(merchantId);
  const rows = await SallaDatabase.getAutomations(merchantId);
  const row = rows.find((r) => r.key === key);
  const enabled = row ? !!row.enabled : false;
  if (!enabled) return false;
  if (!opts.mobile) return false;
  if (await SallaDatabase.hasMessageForOrder(merchantId, key, opts.orderId)) return false;
  const tpl = row && row.msg_template && row.msg_template.trim() ? row.msg_template : cfg.tpl;
  const body = renderAutomationTpl(tpl, {
    name: opts.name || "",
    store: opts.storeName || "",
    order: opts.orderId || "",
    url: opts.url || "",
  });
  const delay = parseInt(row && row.delay_minutes != null ? row.delay_minutes : cfg.delay_minutes, 10) || 0;
  await SallaDatabase.insertMessage({
    merchant: merchantId,
    kind: key,
    order_id: opts.orderId || null,
    customer_name: opts.name || "",
    customer_mobile: opts.mobile,
    body,
    status: "pending",
    scheduled_at: Math.floor(Date.now() / 1000) + delay * 60,
  });
  console.log(`[automation] scheduled ${key} for order #${opts.orderId} (${merchantId}) in ${delay} min`);
  return true;
}

function extractCustomer(d) {
  const c = d.customer || {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "";
  let mobile = String(c.mobile || "").trim();
  if (mobile && !mobile.startsWith("+")) mobile = String(c.country_code || "") + mobile;
  return { name, mobile };
}

function isCodOrder(d) {
  const pm = d.payment_method;
  const code = typeof pm === "object" && pm ? pm.code || pm.id : pm;
  return String(code || "").toLowerCase() === "cod";
}

async function handleOrderCreated(eventBody) {
  const merchant = eventBody.merchant;
  const d = eventBody.data || {};
  const orderId = d.id;
  if (!merchant || !orderId) return;
  await SallaDatabase.connect();
  const { name, mobile } = extractCustomer(d);
  if (!mobile) return;
  const key = isCodOrder(d) ? "cod_confirm" : "order_thanks";
  await scheduleAutomation(merchant, key, { orderId, name, mobile });
}

const CANCEL_STATUSES = ["canceled", "cancelled", "restored", "payment_failed"];
const SHIPPING_STATUSES = ["in_progress", "shipped", "out_for_delivery"];
const DELIVERED_STATUSES = ["delivered", "completed"];

async function handleOrderStatusUpdated(eventBody) {
  const merchant = eventBody.merchant;
  const d = eventBody.data || {};
  const orderId = d.id;
  if (!merchant || !orderId) return;
  await SallaDatabase.connect();
  const stRaw = typeof d.status === "object" && d.status ? d.status.id || d.status.name : d.status;
  const st = String(stRaw || "").toLowerCase();
  if (CANCEL_STATUSES.includes(st)) {
    await SallaDatabase.cancelPendingForOrder(merchant, orderId);
    console.log(`[automation] cancelled pending messages for order #${orderId} (${st})`);
    return;
  }
  if (SHIPPING_STATUSES.includes(st)) {
    await SallaDatabase.cancelPendingForOrder(merchant, orderId, ["cod_confirm"]);
    const { name, mobile } = extractCustomer(d);
    await scheduleAutomation(merchant, "shipping_update", { orderId, name, mobile });
    return;
  }
  if (DELIVERED_STATUSES.includes(st)) {
    const { name, mobile } = extractCustomer(d);
    await scheduleAutomation(merchant, "review_request", { orderId, name, mobile });
  }
}

SallaWebhook.on("order.created", async (eventBody) => {
  try {
    await handleOrderCreated(eventBody);
  } catch (err) {
    console.log("[automation] order.created error:", err.message);
  }
});
SallaWebhook.on("order.status.updated", async (eventBody) => {
  try {
    await handleOrderStatusUpdated(eventBody);
  } catch (err) {
    console.log("[automation] order.status.updated error:", err.message);
  }
});

// we initialize our Salla API
const SallaAPI = new SallaAPIFactory({
  clientID: SALLA_OAUTH_CLIENT_ID,
  clientSecret: SALLA_OAUTH_CLIENT_SECRET,
  callbackURL: SALLA_OAUTH_CLIENT_REDIRECT_URI,
});

// set Listener on auth success
SallaAPI.onAuth(async (accessToken, refreshToken, expires_in, data) => {
  SallaDatabase.connect()
    .then(async (connection) => {
      let user_id = await SallaDatabase.saveUser({
        username: data.name,
        email: data.email,
        email_verified_at: getUnixTimestamp(),
        verified_at: getUnixTimestamp(),
        password: "",
        remember_token: "",
      });
      await SallaDatabase.saveOauth(
        {
          merchant: data.merchant.id,
          access_token: accessToken,
          expires_in: expires_in,
          refresh_token: refreshToken,
          user_id
        },
      );
    })
    .catch((err) => {
      console.log("Error connecting to database: ", err);
    });
});

//   Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session. Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing. However, since this example does not
//   have a database of user records, the complete salla user is serialized
//   and deserialized.

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

//   Use the Salla Strategy within Passport.
passport.use(SallaAPI.getPassportStrategy());
// save token and user data to your selected database

var app = express();

// lightweight request logger for debugging
app.use((req, res, next) => {
  if (!req.url.startsWith("/internal/")) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

// configure Express
app.set("views", __dirname + "/views");
app.set("view engine", "html");

// set the session secret
// you can store session data in any database (monogdb - mysql - inmemory - etc) for more (https://www.npmjs.com/package/express-session)
app.use(
  session({ secret: "keyboard cat", resave: true, saveUninitialized: true })
);

// Initialize Passport!  Also use passport.session() middleware, to support
// persistent login sessions (recommended).
app.use(passport.initialize());
app.use(passport.session());

// serve static files from public folder
app.use(express.static(__dirname + "/public"));

// set the render engine to nunjucks

app.engine("html", consolidate.nunjucks);
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use((req, res, next) => SallaAPI.setExpressVerify(req, res, next));

// تُتاح قائمة الميزات المفتوحة لكل القوالب
app.use(withFeatures);

// POST /webhook
app.post("/webhook", async function (req, res) {
  const body = req.body || {};
  const eventName = body.event || "unknown";
  const authorization = req.headers.authorization || "";

  // نتحقّق من السر بأنفسنا حتى نعرف هل رُفض الحدث أم عولج.
  // (checkActions تتجاهل الحدث بصمت عند سر خاطئ ولا تخبرنا.)
  const secret = process.env.SALLA_WEBHOOK_SECRET || "";
  if (secret && authorization !== secret) {
    console.warn(`webhook: سر غير صحيح للحدث ${eventName} — مرفوض.`);
    return res.status(401).json({ ok: false });
  }

  // أحداث الاشتراك تفتح الميزات أو تقفلها
  try {
    await handleSubscriptionEvent(body);
  } catch (err) {
    console.error(`webhook: فشل معالجة اشتراك ${eventName}:`, err.message);
  }

  SallaWebhook.checkActions(body, authorization, {
    /* your args to pass to action files or listeners */
  });

  // acknowledge receipt immediately so Salla doesn't mark the delivery as failed
  res.sendStatus(200);
});

// GET /oauth/redirect
//   Use passport.authenticate() as route middleware to authenticate the
//   request. The first step in salla authentication will involve redirecting
//   the user to accounts.salla.sa. After authorization, salla will redirect the user
//   back to this application at /oauth/callback
app.get(["/oauth/redirect", "/login"], passport.authenticate("salla"));

// GET /oauth/callback
//   Use passport.authenticate() as route middleware to authenticate the
//   request. If authentication fails, the user will be redirected back to the
//   login page. Otherwise, the primary route function function will be called,
//   which, in this example, will redirect the user to the home page.
app.get(
  "/oauth/callback",
  passport.authenticate("salla", { failureRedirect: "/login" }),
  function (req, res) {
    res.redirect("/");
  }
);

// GET /
// render the index page

app.get("/", async function (req, res) {
  let userDetails = {
    user: req.user,
    isLogin: req.user
  }
  if (req.user) {
    try {
      await SallaDatabase.connect();
      const userFromDB = await SallaDatabase.retrieveUser({ email: req.user.email }, true);
      const accessToken = userFromDB?.OauthTokens?.[0]?.access_token;
      if (accessToken) {
        const userFromAPI = await SallaAPI.getResourceOwner(accessToken);
        // Merge user details with additional information from the API
        userDetails = { ...userDetails, ...userFromAPI };
      }
    } catch (err) {
      console.log("Error loading dashboard data: ", err.message);
    }
  }
  res.render("index.html", userDetails);
});

// GET /account
// get account information and ensure user is authenticated


// GET /plans — الباقات والميزات
app.get("/plans", ensureAuthenticated, async function (req, res) {
  const merchantId = req.user && req.user.merchant && req.user.merchant.id;
  let open = [];
  let unmatched = null;
  try {
    open = [...(await activeFeatures(merchantId))];
    unmatched = await SallaDatabase.lastSubscriptionPayload(merchantId);
  } catch (err) {
    console.log("Error loading plans:", err.message);
  }
  res.render("plans.html", {
    isLogin: req.user,
    user: req.user,
    features: FEATURES,
    bundle: BUNDLE,
    open,
    locked: null,
    appId: process.env.SALLA_APP_ID || "",
    unmatched,
  });
});


// ─────────────────────────────── الفواتير ───────────────────────────────
// GET /invoices — قائمة الطلبات، لكل طلب فاتورة
app.get("/invoices", ensureAuthenticated, requireFeature("invoices"), async function (req, res) {
  let orders = [];
  let error = null;
  try {
    orders = (await SallaAPI.getAllOrders()) || [];
  } catch (err) {
    console.log("Error loading orders for invoices:", err.message);
    error = "تعذّر جلب الطلبات من سلة.";
  }
  res.render("invoices.html", { orders, error, isLogin: req.user, user: req.user });
});

// GET /invoices/:id — الفاتورة نفسها، مهيّأة للطباعة أو الحفظ PDF
app.get("/invoices/:id", ensureAuthenticated, requireFeature("invoices"), async function (req, res) {
  let order = null;
  try {
    // سلة لا توفّر جلب طلب واحد في هذه المكتبة، فنأخذه من القائمة
    const orders = (await SallaAPI.getAllOrders()) || [];
    order = orders.find((o) => String(o.id) === req.params.id || String(o.reference_id) === req.params.id);
  } catch (err) {
    console.log("Error loading order:", err.message);
  }

  if (!order) {
    return res.status(404).render("invoices.html", {
      orders: [],
      error: "لم نعثر على هذا الطلب.",
      isLogin: req.user,
      user: req.user,
    });
  }

  let settings = {};
  try {
    settings = (await SallaDatabase.getMerchantSettings(req.user.merchant.id)) || {};
  } catch (err) {
    /* الإعدادات اختيارية هنا */
  }

  res.render("invoice-print.html", {
    invoice: buildInvoice(order, req.user.merchant || {}, settings),
    isLogin: req.user,
    user: req.user,
  });
});

app.get("/account", ensureAuthenticated, function (req, res) {
  res.render("account.html", {
    user: req.user,
    isLogin: req.user,
  });
});

// GET /refreshToken
// get new access token

app.get("/refreshToken", ensureAuthenticated, function (req, res) {
  SallaAPI.requestNewAccessToken(SallaAPI.getRefreshToken())
    .then((token) => {
      res.render("token.html", {
        token,
        isLogin: req.user,
      });
    })
    .catch((err) => res.send(err));
});

// GET /orders
// get all orders from user store

app.get("/orders", ensureAuthenticated, requireFeature("order_followups"), async function (req, res) {
  let orders = [];
  try {
    orders = (await SallaAPI.getAllOrders()) || [];
  } catch (err) {
    console.log("Error loading orders:", err.message);
  }
  res.render("orders.html", {
    orders,
    isLogin: req.user,
  });
});

// GET /customers
// get all customers from user store

app.get("/customers", ensureAuthenticated, requireFeature("customers_crm"), async function (req, res) {
  let customers = [];
  let manual = [];
  try {
    await SallaDatabase.connect();
    customers = (await SallaAPI.getAllCustomers()) || [];
  } catch (err) {
    console.log("Error loading customers:", err.message);
  }
  try {
    manual = (await SallaDatabase.listManualCustomers(req.user.merchant.id)) || [];
    manual = manual.map((m) => ({ ...m.toJSON(), manual: true }));
  } catch (err) {
    console.log("Error loading manual customers:", err.message);
  }
  res.render("customers.html", {
    customers,
    manual,
    added: req.query.added === "1",
    addError: req.query.error === "1",
    isLogin: req.user,
  });
});

// POST /customers/add — manually add a customer
app.post("/customers/add", ensureAuthenticated, requireFeature("customers_crm"), async function (req, res) {
  const name = (req.body.name || "").trim();
  const digits = (req.body.mobile || "").replace(/[^0-9]/g, "");
  if (!name || digits.length < 9) {
    return res.redirect("/customers?error=1");
  }
  try {
    await SallaDatabase.saveManualCustomer({
      merchant: req.user.merchant.id,
      name: name.slice(0, 60),
      mobile: digits,
      email: (req.body.email || "").trim().slice(0, 80),
    });
    res.redirect("/customers?added=1");
  } catch (err) {
    console.log("Error adding customer:", err.message);
    res.redirect("/customers?error=1");
  }
});

// POST /customers/delete — remove a manually added customer
app.post("/customers/delete", ensureAuthenticated, requireFeature("customers_crm"), async function (req, res) {
  try {
    await SallaDatabase.deleteManualCustomer(req.user.merchant.id, parseInt(req.body.id, 10));
  } catch (err) {
    console.log("Error deleting customer:", err.message);
  }
  res.redirect("/customers");
});

// GET /abandoned
// abandoned carts dashboard: list carts + WhatsApp reminder buttons

function buildWhatsappLink(cart, storeName) {
  if (!cart.customer_mobile) return null;
  const digits = cart.customer_mobile.replace(/[^0-9]/g, "");
  if (digits.length < 10) return null;
  const message =
    `مرحباً ${cart.customer_name || ""} 👋\n` +
    `لاحظنا أنك تركت بعض المنتجات في سلتك${storeName ? ` في متجر ${storeName}` : ""} 😊\n` +
    `أكمل طلبك الآن من هنا:\n${cart.checkout_url}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

app.get("/abandoned", ensureAuthenticated, async function (req, res) {
  let carts = [];
  const stats = { new: 0, contacted: 0, recovered: 0 };
  const storeName = req.user && req.user.merchant ? req.user.merchant.name : "";
  try {
    await SallaDatabase.connect();
    const merchantId = req.user && req.user.merchant ? req.user.merchant.id : null;
    carts = (await SallaDatabase.listAbandonedCarts(merchantId)) || [];
    carts = carts.map((c) => {
      const plain = c.toJSON();
      const mins = Math.max(0, Math.floor((Date.now() / 1000 - (plain.abandoned_at || 0)) / 60));
      plain.time_ago =
        mins < 1 ? "الآن" : mins < 60 ? `قبل ${mins} دقيقة` : Math.floor(mins / 60) < 24 ? `قبل ${Math.floor(mins / 60)} ساعة` : `قبل ${Math.floor(mins / 1440)} يوم`;
      return {
        ...plain,
        whatsapp_url: buildWhatsappLink(plain, storeName),
        mailto_url: plain.customer_email
          ? `mailto:${plain.customer_email}?subject=${encodeURIComponent("سلتك بانتظارك 🛒")}`
          : null,
      };
    });
    carts.forEach((c) => {
      if (stats[c.status] !== undefined) stats[c.status]++;
    });
  } catch (err) {
    console.log("Error loading abandoned carts:", err.message);
  }
  const kpis = {
    recoveredAmount: carts
      .filter((c) => c.status === "recovered")
      .reduce((s, c) => s + (parseFloat(c.total_amount) || 0), 0),
    sentCount: carts.filter((c) => c.status !== "new").length,
    pendingCount: stats.new,
  };
  const handled = kpis.sentCount;
  kpis.rate = handled ? Math.round((stats.recovered / handled) * 100) : 0;
  res.render("abandoned.html", {
    isLogin: req.user,
    user: req.user,
    carts,
    stats,
    kpis,
  });
});

// POST /abandoned/contact
// mark an abandoned cart as contacted

app.post("/abandoned/contact", ensureAuthenticated, async function (req, res) {
  try {
    await SallaDatabase.connect();
    await SallaDatabase.setAbandonedCartStatus(
      parseInt(req.body.merchant),
      parseInt(req.body.cart_id),
      "contacted"
    );
  } catch (err) {
    console.log("Error marking cart contacted:", err.message);
  }
  res.redirect("/abandoned");
});

// ===================== WhatsApp automation (Meta Cloud API) =====================

// send due reminders for one merchant; returns summary
async function runAutomationForMerchant(merchantId) {
  const result = { merchant: merchantId, sent: 0, failed: 0, skipped: null };
  let settings;
  try {
    settings = await SallaDatabase.getMerchantSettings(merchantId);
  } catch (err) {
    result.skipped = "db:" + err.message;
    return result;
  }
  const channel =
    settings && settings.channel === "wweb"
      ? "wweb"
      : settings && settings.wa_token && settings.wa_phone_id
        ? "cloud"
        : null;
  if (!settings || !settings.auto_enabled || !channel) {
    result.skipped = "not-configured";
    return result;
  }
  const delaySec = (settings.delay_minutes || 60) * 60;
  const cutoff = Math.floor(Date.now() / 1000) - delaySec;
  let carts = [];
  try {
    carts = await SallaDatabase.listAbandonedCarts(merchantId);
  } catch (err) {
    result.skipped = "carts:" + err.message;
    return result;
  }
  const due = carts.filter(
    (raw) => raw.status === "new" && (raw.abandoned_at || 0) <= cutoff && raw.customer_mobile
  );
  const storeName = settings.store_name || "";
  for (const cartRaw of due) {
    const cart = cartRaw.toJSON ? cartRaw.toJSON() : cartRaw;
    let res;
    if (channel === "cloud") {
      res = await wa.sendTemplate(
        settings.wa_token,
        settings.wa_phone_id,
        cart.customer_mobile,
        settings.template_name || "cart_reminder",
        [cart.customer_name || "", storeName, cart.checkout_url || ""]
      );
    } else {
      const text = buildWwebMessage(settings.msg_template, cart.customer_name || "", storeName, cart.checkout_url || "");
      res = await wweb.sendMessage(merchantId, cart.customer_mobile, text);
    }
    if (res.ok) {
      await SallaDatabase.setAbandonedCartStatus(merchantId, cart.cart_id, "contacted");
      try {
        await SallaDatabase.insertMessage({
          merchant: merchantId,
          kind: "cart_reminder",
          cart_id: cart.cart_id,
          customer_name: cart.customer_name || "",
          customer_mobile: cart.customer_mobile || "",
          body: channel === "cloud" ? "(قالب Meta: " + (settings.template_name || "cart_reminder") + ")" : text,
          status: "sent",
          channel,
          scheduled_at: cutoff,
          sent_at: Math.floor(Date.now() / 1000),
        });
      } catch (e) {
        console.log("[automation] log insert failed:", e.message);
      }
      console.log(`[automation] reminder sent (${channel}) to ${cart.customer_mobile} for cart #${cart.cart_id}`);
      result.sent++;
    } else {
      console.log(`[automation] send failed for cart #${cart.cart_id}:`, res.error);
      result.failed++;
    }
  }
  return result;
}

function buildWwebMessage(tpl, name, store, url) {
  if (tpl && tpl.trim()) {
    return tpl.replaceAll("[الاسم]", name).replaceAll("[المتجر]", store).replaceAll("[الرابط]", url);
  }
  return (
    `مرحباً ${name} 👋\n` +
    `لاحظنا أنك تركت بعض المنتجات في سلتك في متجر ${store} 😊\n` +
    `أكمل طلبك الآن من هنا:\n${url}`
  );
}

// process due messages from the automation queue (all merchants)
async function processDueMessages() {
  const summary = { checked: 0, sent: 0, failed: 0 };
  let due = [];
  try {
    due = await SallaDatabase.listDueMessages(50);
  } catch (err) {
    console.log("[queue] list error:", err.message);
    return summary;
  }
  if (!due.length) return summary;
  const settingsCache = {};
  for (const raw of due) {
    const m = raw.toJSON ? raw.toJSON() : raw;
    summary.checked++;
    try {
      if (!settingsCache[m.merchant]) {
        settingsCache[m.merchant] = await SallaDatabase.getMerchantSettings(m.merchant);
      }
      const s = settingsCache[m.merchant];
      const channel =
        s && s.channel === "wweb"
          ? "wweb"
          : s && s.wa_token && s.wa_phone_id
            ? "cloud"
            : null;
      if (!channel) {
        await SallaDatabase.bumpMessageAttempt(m.id, "قناة واتساب غير مهيأة — أكمل الإعداد في صفحة الإعدادات");
        summary.failed++;
        continue;
      }
      let res;
      if (channel === "cloud") {
        const tplName = m.kind === "cart_reminder" ? (s.template_name || "cart_reminder") : m.kind;
        res = await wa.sendTemplate(
          s.wa_token,
          s.wa_phone_id,
          m.customer_mobile,
          tplName,
          [m.customer_name || "", s.store_name || "", ""]
        );
      } else {
        res = await wweb.sendMessage(m.merchant, m.customer_mobile, m.body || "");
      }
      if (res && res.ok) {
        await SallaDatabase.markMessageSent(m.id, channel);
        summary.sent++;
        console.log(`[queue] ${m.kind} sent (${channel}) → ${m.customer_mobile}`);
      } else {
        await SallaDatabase.bumpMessageAttempt(m.id, (res && res.error) || "send-failed");
        summary.failed++;
        console.log(`[queue] ${m.kind} failed for msg #${m.id}:`, res && res.error);
      }
    } catch (err) {
      await SallaDatabase.bumpMessageAttempt(m.id, err.message).catch(() => {});
      summary.failed++;
      console.log(`[queue] error msg #${m.id}:`, err.message);
    }
  }
  return summary;
}

// GET /settings — merchant WhatsApp connection & automation preferences
app.get("/settings", ensureAuthenticated, async function (req, res) {
  await SallaDatabase.connect();
  let s = null;
  try {
    s = await SallaDatabase.getMerchantSettings(req.user.merchant.id);
  } catch (err) {
    console.log("Error loading settings:", err.message);
  }
  res.render("settings.html", {
    isLogin: req.user,
    user: req.user,
    saved: req.query.saved === "1",
    ran: parseInt(req.query.ran || "0", 10),
    cfg: s
      ? {
          channel: s.channel || "cloud",
          phone_id: s.wa_phone_id || "",
          template_name: s.template_name || "cart_reminder",
          msg_template: s.msg_template || "",
          delay_minutes: s.delay_minutes || 60,
          auto_enabled: !!s.auto_enabled,
          token_last4: s.wa_token ? s.wa_token.slice(-4) : null,
        }
      : { channel: "cloud", phone_id: "", template_name: "cart_reminder", msg_template: "", delay_minutes: 60, auto_enabled: false, token_last4: null },
  });
});

// POST /settings/save
app.post("/settings/save", ensureAuthenticated, async function (req, res) {
  try {
    await SallaDatabase.connect();
    const existing = await SallaDatabase.getMerchantSettings(req.user.merchant.id);
    const data = {
      store_name: (req.user.merchant && req.user.merchant.name) || "",
      channel: req.body.channel === "wweb" ? "wweb" : "cloud",
      wa_phone_id: (req.body.wa_phone_id || "").trim(),
      template_name: (req.body.template_name || "cart_reminder").trim() || "cart_reminder",
      msg_template: req.body.msg_template || "",
      delay_minutes: parseInt(req.body.delay_minutes || "60", 10),
      auto_enabled: req.body.auto_enabled === "on" || req.body.auto_enabled === "true",
    };
    if ((req.body.wa_token || "").trim()) {
      data.wa_token = req.body.wa_token.trim();
    } else if (!existing || !existing.wa_token) {
      data.wa_token = "";
    }
    await SallaDatabase.saveMerchantSettings(req.user.merchant.id, data);
    res.redirect("/settings?saved=1");
  } catch (err) {
    console.log("Error saving settings:", err.message);
    res.redirect("/settings");
  }
});

// POST /settings/test — verify Meta credentials (uses posted values or falls back to saved)
app.post("/settings/test", ensureAuthenticated, async function (req, res) {
  try {
    await SallaDatabase.connect();
    let token = (req.body.wa_token || "").trim();
    let phoneId = (req.body.wa_phone_id || "").trim();
    if (!token || !phoneId) {
      const s = await SallaDatabase.getMerchantSettings(req.user.merchant.id);
      token = token || (s && s.wa_token) || "";
      phoneId = phoneId || (s && s.wa_phone_id) || "";
    }
    if (!token || !phoneId) return res.json({ ok: false, error: "أدخل رمز الوصول ومعرّف الرقم أولاً" });
    const out = await wa.verifyNumber(token, phoneId);
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /settings/runnow — trigger automation immediately for this merchant
app.post("/settings/runnow", ensureAuthenticated, async function (req, res) {
  let sent = 0;
  try {
    const r = await runAutomationForMerchant(req.user.merchant.id);
    sent = r.sent;
  } catch (err) {
    console.log("runnow error:", err.message);
  }
  res.redirect("/settings?ran=" + sent + "&saved=1");
});

// GET /automations — Automation Hub page
const KIND_LABELS = {
  cart_reminder: "تذكير سلة متروكة",
  order_thanks: "شكر على الطلب",
  shipping_update: "تحديث شحن",
  review_request: "طلب تقييم",
  cod_confirm: "تأكيد COD",
};
app.get("/automations", ensureAuthenticated, async function (req, res) {
  let scenarios = [];
  let stats = { pending: 0, sentToday: 0, sentTotal: 0, failed: 0 };
  let messages = [];
  try {
    await SallaDatabase.connect();
    const merchantId = req.user.merchant.id;
    const rows = await SallaDatabase.getAutomations(merchantId);
    scenarios = Object.entries(AUTOMATION_SCENARIOS).map(([key, cfg]) => {
      const row = rows.find((r) => r.key === key);
      return {
        key,
        label: cfg.label,
        desc: cfg.desc,
        icon: cfg.icon,
        enabled: row ? !!row.enabled : false,
        delay_minutes: row && row.delay_minutes != null ? row.delay_minutes : cfg.delay_minutes,
        msg_template: row && row.msg_template != null ? row.msg_template : cfg.tpl,
      };
    });
    stats = await SallaDatabase.messageStats(merchantId);
    const rawMsgs = await SallaDatabase.listMessages(merchantId, 40);
    messages = rawMsgs.map((mRaw) => {
      const m = mRaw.toJSON ? mRaw.toJSON() : mRaw;
      const mins = Math.max(0, Math.floor((Date.now() / 1000 - (m.created_at || 0)) / 60));
      m.time_ago =
        mins < 1 ? "الآن" : mins < 60 ? `قبل ${mins} دقيقة` : Math.floor(mins / 60) < 24 ? `قبل ${Math.floor(mins / 60)} ساعة` : `قبل ${Math.floor(mins / 1440)} يوم`;
      m.kind_label = KIND_LABELS[m.kind] || m.kind;
      return m;
    });
  } catch (err) {
    console.log("Error loading automations:", err.message);
  }
  res.render("automations.html", {
    isLogin: req.user,
    user: req.user,
    scenarios,
    stats,
    messages,
    saved: req.query.saved === "1",
  });
});

// POST /automations/save — save one scenario config
app.post("/automations/save", ensureAuthenticated, async function (req, res) {
  const key = String(req.body.key || "");
  if (!AUTOMATION_SCENARIOS[key]) return res.redirect("/automations");
  try {
    await SallaDatabase.connect();
    await SallaDatabase.saveAutomation(req.user.merchant.id, key, {
      enabled: req.body.enabled === "on" || req.body.enabled === "true",
      delay_minutes: parseInt(req.body.delay_minutes || "0", 10) || 0,
      msg_template: req.body.msg_template || "",
    });
    res.redirect("/automations?saved=1");
  } catch (err) {
    console.log("Error saving automation:", err.message);
    res.redirect("/automations");
  }
});

// ===================== WhatsApp QR bridge (Linked Devices) =====================

app.post("/wa/connect", ensureAuthenticated, async function (req, res) {
  try {
    res.json(await wweb.connect(req.user.merchant.id));
  } catch (err) {
    res.json({ status: "error", error: err.message });
  }
});

app.get("/wa/status", ensureAuthenticated, async function (req, res) {
  try {
    res.json(await wweb.restoreIfNeeded(req.user.merchant.id));
  } catch (err) {
    res.json({ status: "disconnected" });
  }
});

app.post("/wa/disconnect", ensureAuthenticated, async function (req, res) {
  await wweb.disconnect(req.user.merchant.id);
  res.json({ ok: true, status: "disconnected" });
});

app.post("/wa/testsend", ensureAuthenticated, async function (req, res) {
  const r = await wweb.sendMessage(
    req.user.merchant.id,
    req.body.phone || "",
    req.body.text || "مرحباً 👋 هذه رسالة تجريبية من تطبيق منقذ السلات ✅"
  );
  res.json(r);
});

// GET /internal/cron/:secret — scheduler entry point (Cloud Scheduler will call this)
app.get("/internal/cron/:secret", async function (req, res) {
  if (!process.env.CRON_SECRET || req.params.secret !== process.env.CRON_SECRET) {
    return res.sendStatus(403);
  }
  const results = [];
  try {
    await SallaDatabase.connect();
    const merchants = await SallaDatabase.getAllMerchantIds();
    for (const m of merchants) {
      results.push(await runAutomationForMerchant(m));
    }
    const queue = await processDueMessages();
    results.push({ queue });
  } catch (err) {
    console.log("cron error:", err.message);
  }
  res.json({ ok: true, results });
});

// local development ticker — every 5 minutes
setInterval(async function () {
  try {
    if (!process.env.CRON_SECRET) return;
    await SallaDatabase.connect();
    const merchants = await SallaDatabase.getAllMerchantIds();
    for (const m of merchants) await runAutomationForMerchant(m);
  } catch (err) {
    /* silent */
  }
}, 5 * 60 * 1000);

// message queue worker — every 60 seconds
setInterval(async function () {
  try {
    if (!process.env.CRON_SECRET) return;
    await processDueMessages();
  } catch (err) {
    /* silent */
  }
}, 60 * 1000);

// GET /logout
//   logout from passport
app.get("/logout", function (req, res) {
  SallaAPI.logout();
  req.logout(function (err) {
    if (err) { return next(err); }
    res.redirect("/");
  });
});

if (unlockAllEnabled()) {
  console.warn("⚠️  وضع التجربة مفعّل (UNLOCK_ALL_FEATURES) — كل الميزات مفتوحة بلا شراء.");
  console.warn("    احذف المتغيّر من .env قبل النشر، وإلا لن يدفع أحد.");
}

app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});


/**
 * ─────────────────────── حارس الميزات المدفوعة ───────────────────────
 * يُوضع بعد ensureAuthenticated على أي مسار يخصّ ميزة مدفوعة.
 * إن لم يكن التاجر قد اشتراها، نعرض صفحة الباقات بدل رسالة خطأ جافّة —
 * فهذه أفضل لحظة لإقناعه بالشراء.
 */
function requireFeature(featureKey) {
  return async function (req, res, next) {
    const merchantId = req.user && req.user.merchant && req.user.merchant.id;
    let open = new Set();
    try {
      open = await activeFeatures(merchantId);
      if (open.has(featureKey)) return next();
    } catch (err) {
      console.log("requireFeature:", err.message);
    }

    const feature = FEATURES.find((f) => f.key === featureKey);
    res.status(402).render("plans.html", {
      isLogin: req.user,
      user: req.user,
      features: FEATURES,
      bundle: BUNDLE,
      // الحالة الحقيقية — وإلا ظهرت الميزة المجانية مقفلة في هذه الصفحة
      open: [...open],
      locked: feature || null,
      appId: process.env.SALLA_APP_ID || "",
      unmatched: null,
    });
  };
}

/**
 * يضع قائمة الميزات المفتوحة في كل صفحة، حتى تعرض القائمة الجانبية
 * قفلاً بجانب ما لم يُشترَ. لا يمنع شيئاً — العرض فقط.
 */
async function withFeatures(req, res, next) {
  const merchantId = req.user && req.user.merchant && req.user.merchant.id;
  try {
    res.locals.openFeatures = [...(await activeFeatures(merchantId))];
  } catch (err) {
    res.locals.openFeatures = [];
  }
  res.locals.allFeatures = FEATURES;
  res.locals.unlockAll = unlockAllEnabled();
  next();
}


// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed. Otherwise, the user will be redirected to the
//   login page.
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}
