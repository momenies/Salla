/**
 * إعداد تسجيل الدخول عبر سلة (OAuth) — نفس تدفّق المكتبة الرسمية،
 * لكن مع حفظ صحيح للمستخدم والمتجر والتوكن في قاعدة البيانات.
 */
const passport = require("passport");
const SallaAPIFactory = require("@salla.sa/passport-strategy");

const config = require("../config");
const db = require("../services/db");
const getUnixTimestamp = require("../helpers/getUnixTimestamp");
const { merchantIdOf } = require("./normalize");

const SallaAPI = new SallaAPIFactory({
  clientID: config.salla.clientId,
  clientSecret: config.salla.clientSecret,
  callbackURL: config.salla.redirectUri,
});

// نخزّن ملف المستخدم كما هو في الجلسة (لا قاعدة بيانات في كل طلب)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));
passport.use(SallaAPI.getPassportStrategy());

/**
 * بعد نجاح الدخول: نحفظ المستخدم، ثم المتجر، ثم التوكن.
 * ترتيب متسلسل مقصود — التوكن مرتبط بالمستخدم وبمعرّف المتجر.
 */
SallaAPI.onAuth(async (accessToken, refreshToken, expiresIn, profile) => {
  try {
    const stores = db.stores();
    if (!stores) {
      console.error("onAuth: قاعدة البيانات غير جاهزة، لم يُحفظ التوكن.");
      return;
    }

    const merchantId = merchantIdOf(profile);
    if (!merchantId) {
      console.error("onAuth: رد سلة لا يحتوي معرّف متجر — لم يُحفظ شيء.");
      return;
    }

    const user = await stores.upsertUser({
      username: profile.name,
      email: profile.email,
      email_verified_at: getUnixTimestamp(),
      verified_at: getUnixTimestamp(),
      password: "",
      remember_token: "",
    });

    await stores.upsertFromAuth(profile, { userId: user ? user.id : null });
    await stores.saveTokens(merchantId, {
      accessToken,
      refreshToken,
      expiresIn,
      userId: user ? user.id : null,
    });

    console.log(`✅ تم ربط المتجر ${merchantId} بنجاح.`);
  } catch (err) {
    console.error("onAuth: فشل حفظ بيانات الدخول:", err.message);
  }
});

module.exports = { SallaAPI, passport };
