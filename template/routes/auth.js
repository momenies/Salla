/** مسارات الدخول والخروج وصفحة الإعداد */
const express = require("express");
const { passport } = require("../lib/auth");
const env = require("../config/env");
const log = require("../lib/logger");
const { rateLimit } = require("../lib/security");

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 60000, max: 20, message: "محاولات كثيرة — انتظر دقيقة." });

/**
 * التطبيق غير مضبوط بعد. من يرى هذه الصفحة يختلف باختلاف البيئة:
 *
 *   • في التطوير: أنت. فنعرض ما ينقص بالضبط وكيف تضبطه.
 *   • في الإنتاج: **تاجر** فتح التطبيق من متجر سلة. لا يصحّ أن يرى أسماء
 *     متغيّرات البيئة ولا محتوى ملف .env ولا أمر توليد المفتاح السرّي —
 *     تلك داخليّاتنا، وعرضها عليه تسريب وإرباك معاً. يرى اعتذاراً وطريق دعم.
 */
function renderSetup(req, res) {
  if (env.isProd) {
    log.error("تاجر فتح التطبيق وهو غير مضبوط — أكمل مفاتيح سلة فوراً", {
      hasClientId: Boolean(env.salla.clientId),
      hasClientSecret: Boolean(env.salla.clientSecret),
    });
    return res.status(503).render("error.html", {
      code: 503,
      title: "التطبيق قيد الإعداد",
      message:
        "نجري تحديثاً على الربط مع سلة، ولن يطول. جرّب بعد قليل — وإن تكرّر الأمر فراسلنا وسنتكفّل به.",
      isLogin: false,
      user: null,
      support: { email: env.supportEmail, whatsapp: env.supportWhatsapp },
    });
  }

  const guessed =
    env.salla.redirectUri || `${req.protocol}://${req.get("host")}/oauth/callback`;
  return res.status(503).render("setup.html", {
    isLogin: false,
    user: null,
    callbackUrl: guessed,
    hasClientId: Boolean(env.salla.clientId),
    hasClientSecret: Boolean(env.salla.clientSecret),
    hasRedirect: Boolean(env.salla.redirectUri),
    hasWebhook: Boolean(env.salla.webhookSecret),
  });
}

router.get(["/oauth/redirect", "/login"], loginLimiter, (req, res, next) => {
  if (!env.sallaConfigured) return renderSetup(req, res);
  return passport.authenticate("salla")(req, res, next);
});

router.get(
  "/oauth/callback",
  loginLimiter,
  passport.authenticate("salla", { failureRedirect: "/login?error=1" }),
  (req, res) => {
    // نعيده إلى الصفحة التي طلبها قبل الدخول
    const target = req.session.returnTo || "/";
    delete req.session.returnTo;
    log.info("دخول ناجح", { merchant: req.user?.merchant?.id });
    res.redirect(target);
  }
);

router.post("/logout", (req, res, next) => doLogout(req, res, next));
router.get("/logout", (req, res, next) => doLogout(req, res, next));

/**
 * الخروج يُنهي جلسة **هذا** التاجر فقط.
 * (النسخة السابقة كانت تنادي SallaAPI.logout() الذي يمسح التوكن على مستوى
 * العملية كلها — فيخرج كل التجار المتصلين معاً.)
 */
function doLogout(req, res, next) {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("salla.sid");
      res.redirect("/");
    });
  });
}

module.exports = router;
