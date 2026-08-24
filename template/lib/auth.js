/**
 * تسجيل الدخول عبر سلة (OAuth 2.0).
 *
 * ما نستخدمه من المكتبة الرسمية: استراتيجية passport فقط — فهي تعرف
 * تفاصيل بوابة سلة. أما التوكنات فنحفظها نحن لكل متجر على حدة
 * (انظر lib/salla.js)، لأن المكتبة تحتفظ بتوكن واحد للعملية كلها.
 */
const passport = require("passport");
const SallaAPIFactory = require("@salla.sa/passport-strategy");
const db = require("../helpers/salla-db");
const env = require("../config/env");
const log = require("./logger");
const cache = require("./cache");
const getUnixTimestamp = require("../helpers/getUnixTimestamp");

/**
 * قيمة نائبة عند غياب المفاتيح: المكتبة ترمي خطأً إن كان clientID فارغاً،
 * فينهار التطبيق قبل أن يقلع ولا يرى المستخدم صفحة الإعداد التي تشرح له
 * ما ينقصه.
 */
const sallaApi = new SallaAPIFactory({
  clientID: env.salla.clientId || "not-configured",
  clientSecret: env.salla.clientSecret || "not-configured",
  callbackURL: env.salla.redirectUri || `http://localhost:${env.port}/oauth/callback`,
});

sallaApi.onAuth(async (accessToken, refreshToken, expiresIn, data) => {
  try {
    await db.connect();
    const merchantId = data?.merchant?.id || null;

    const userId = await db.saveUser({
      username: data?.name || "",
      email: data?.email || "",
      email_verified_at: getUnixTimestamp(),
      verified_at: getUnixTimestamp(),
      password: "",
      remember_token: "",
    });

    await db.saveOauth({
      user_id: userId,
      merchant: merchantId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      scope: data?.scope || null,
    });

    // بيانات المتجر المخزّنة صارت قديمة بعد ربط جديد
    if (merchantId) cache.invalidate(`salla:${merchantId}:`);
    log.info("تم ربط متجر", { merchant: merchantId });
  } catch (err) {
    log.error("فشل حفظ بيانات الربط", { error: err.message });
  }
});

/**
 * نخزّن في الجلسة ما نحتاجه فقط.
 * حفظ كائن سلة كاملاً يضخّم كل جلسة بكيلوبايتات لا تُقرأ أبداً.
 */
passport.serializeUser((user, done) => {
  done(null, {
    id: user?.id,
    name: user?.name,
    email: user?.email,
    role: user?.role,
    merchant: user?.merchant
      ? {
          id: user.merchant.id,
          name: user.merchant.name,
          avatar: user.merchant.avatar,
          domain: user.merchant.domain,
          plan: user.merchant.plan,
        }
      : null,
  });
});

passport.deserializeUser((obj, done) => done(null, obj));
passport.use(sallaApi.getPassportStrategy());

module.exports = { passport, sallaApi };
