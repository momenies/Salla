/**
 * الطبقة الوسطى (Middleware): أمان، تسجيل، مصادقة، وتحميل سياق المتجر.
 */
const config = require("../config");
const db = require("../services/db");
const { normalizeUser, merchantIdOf } = require("../lib/normalize");

/**
 * رؤوس أمان أساسية بدون أي مكتبة خارجية.
 * سياسة المحتوى تسمح فقط بملفاتنا وخطوط Google — لا سكربتات من مواقع أخرى.
 */
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      // 'unsafe-inline' مطلوب لسكربت اختيار الوضع الليلي المضمّن في <head>
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

/** سطر واحد لكل طلب: الطريقة، المسار، الحالة، والزمن */
function requestLogger(req, res, next) {
  if (!config.requestLog) return next();
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms.toFixed(0)}ms)`);
  });
  next();
}

/** يمنع المتصفح من تخزين صفحات تحتوي بيانات المتجر */
function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  next();
}

/** يحوّل غير المسجّلين إلى صفحة الدخول */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.redirect("/login");
}

/**
 * يحمّل سياق المتجر الحالي: صفّه في قاعدة البيانات وعميل سلة الخاص به.
 * يُوضع بعد ensureAuthenticated في كل مسار يحتاج بيانات من سلة.
 */
async function withStore(req, res, next) {
  try {
    req.profile = normalizeUser(req.user);
    req.merchantId = merchantIdOf(req.user);

    const stores = db.stores();
    if (stores && req.merchantId) {
      req.store = await stores.findByMerchantId(req.merchantId);
      req.salla = await stores.clientFor(req.merchantId);
    } else {
      req.store = null;
      req.salla = null;
    }

    // متاح لكل القوالب دون تمريره يدوياً في كل res.render
    res.locals.profile = req.profile;
    res.locals.store = req.store;
    res.locals.storeInfo = req.profile?.store || null;
    next();
  } catch (err) {
    next(err);
  }
}

/** نفس `withStore` لكن يتخطّاها بهدوء لو كان الزائر غير مسجّل */
function withStoreOptional(req, res, next) {
  if (!req.user) return next();
  return withStore(req, res, next);
}

/**
 * يمنع الوصول لميزة مدفوعة إن لم يكن الاشتراك فعّالاً.
 * القالب جاهز للتطبيقات المدفوعة على متجر سلة — استخدمه على المسارات المدفوعة.
 */
function requireSubscription(req, res, next) {
  if (!req.store || req.store.isSubscriptionActive()) return next();
  res.status(402).render("subscription.html", {
    page: "subscription",
    pageTitle: "الاشتراك مطلوب",
    pageSubtitle: "هذه الميزة تحتاج اشتراكاً فعّالاً",
    isLogin: req.user,
    user: req.user,
    blocked: true,
  });
}

/**
 * الحارس القياسي لأي صفحة تحتاج متجراً مسجّلاً.
 * يُمرَّر لكل مسار على حدة وليس عبر `router.use`، لأن `router.use` بلا مسار
 * يعترض حتى الروابط التي لا يعرفها الراوتر، فتتحوّل صفحة 404 إلى تحويل للدخول.
 */
const requireStore = [ensureAuthenticated, withStore, noStore];

/** يلتقط أخطاء الدوال غير المتزامنة ويمرّرها لمعالج الأخطاء */
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = {
  securityHeaders,
  requestLogger,
  noStore,
  ensureAuthenticated,
  withStore,
  withStoreOptional,
  requireStore,
  requireSubscription,
  asyncRoute,
};
