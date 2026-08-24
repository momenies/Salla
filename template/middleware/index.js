/**
 * الوسائط المشتركة بين المسارات: من المستخدم؟ وماذا يملك؟ وكيف نلتقط أخطاءه؟
 */
const { FEATURES, BUNDLE } = require("../config/features");
const { activeFeatures, unlockAllEnabled } = require("../helpers/subscriptions");
const log = require("../lib/logger");
const env = require("../config/env");

/**
 * يلفّ معالجاً غير متزامن فيمرّر أي خطأ إلى معالج الأخطاء العام.
 * بدونه أي `await` فاشل داخل مسار يترك الطلب معلّقاً حتى تنتهي المهلة —
 * وهو أسوأ أنواع الأعطال: لا رسالة ولا سجل.
 */
function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** معرّف متجر المستخدم الحالي — المصدر الوحيد الموثوق لملكية البيانات */
function merchantOf(req) {
  const id = req.user?.merchant?.id ?? req.user?.store?.id ?? null;
  return id ? Number(id) : null;
}

/** يمنع الوصول لغير المسجّلين، ويحفظ الوجهة للعودة إليها بعد الدخول */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && merchantOf(req)) return next();
  if (req.method === "GET" && req.accepts("html")) {
    req.session.returnTo = req.originalUrl;
    return res.redirect("/login");
  }
  return res.status(401).json({ ok: false, error: "يجب تسجيل الدخول أولاً" });
}

/**
 * يضع حالة الميزات في كل صفحة (للقائمة الجانبية والأقفال).
 * لا يمنع شيئاً — العرض فقط.
 */
async function withFeatures(req, res, next) {
  try {
    res.locals.openFeatures = [...(await activeFeatures(merchantOf(req)))];
  } catch (err) {
    log.warn("تعذّرت قراءة الميزات المفتوحة", { error: err.message });
    res.locals.openFeatures = [];
  }
  res.locals.allFeatures = FEATURES;
  res.locals.bundle = BUNDLE;
  res.locals.unlockAll = unlockAllEnabled();
  res.locals.currentPath = req.path;
  res.locals.support = { email: env.supportEmail, whatsapp: env.supportWhatsapp };
  next();
}

/**
 * حارس الميزات المدفوعة. عند المنع نعرض صفحة الباقات لا رسالة خطأ —
 * فهذه أفضل لحظة لشرح القيمة، والتاجر هنا لأنه أراد الميزة فعلاً.
 */
function requireFeature(featureKey) {
  return async function gate(req, res, next) {
    let open = new Set();
    try {
      open = await activeFeatures(merchantOf(req));
      if (open.has(featureKey)) return next();
    } catch (err) {
      log.warn("فشل فحص الصلاحية", { feature: featureKey, error: err.message });
    }
    const feature = FEATURES.find((f) => f.key === featureKey) || null;
    return res.status(402).render("plans.html", {
      isLogin: req.user,
      user: req.user,
      features: FEATURES,
      bundle: BUNDLE,
      open: [...open],
      locked: feature,
      appId: env.salla.appId,
      unmatched: null,
    });
  };
}

module.exports = { asyncRoute, ensureAuthenticated, withFeatures, requireFeature, merchantOf };
