/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  إعدادات البيئة — مصدر واحد للحقيقة
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * بدل قراءة `process.env` من عشرين مكاناً (وما يتبعها من أخطاء إملائية صامتة)
 * نقرأها هنا مرة واحدة، ونتحقّق منها، ونشرح للمستخدم ما ينقصه بالعربية.
 *
 * القاعدة: التطبيق **يعمل دائماً** حتى لو نقص شيء — يعرض صفحة إعداد بدل أن
 * ينهار. الاستثناء الوحيد: خطأ يهدّد أمان الإنتاج (سرّ جلسات ضعيف مثلاً).
 */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");

const bool = (value, fallback = false) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

const env = {
  NODE_ENV,
  isProd,
  isTest: NODE_ENV === "test",
  port: int(process.env.PORT || process.argv[2], 8082),

  // ── سلة ────────────────────────────────────────────────────────────────
  salla: {
    clientId: process.env.SALLA_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.SALLA_OAUTH_CLIENT_SECRET || "",
    redirectUri: process.env.SALLA_OAUTH_CLIENT_REDIRECT_URI || "",
    webhookSecret: process.env.SALLA_WEBHOOK_SECRET || "",
    appId: process.env.SALLA_APP_ID || "",
    /** token = سلة ترسل السر كما هو | signature = توقيع HMAC-SHA256 */
    webhookStrategy: (process.env.SALLA_WEBHOOK_STRATEGY || "auto").toLowerCase(),
  },

  // ── قاعدة البيانات ──────────────────────────────────────────────────────
  db: {
    orm: process.env.SALLA_DATABASE_ORM || "Sequelize",
    storage: process.env.DATABASE_STORAGE || "",
    host: process.env.DATABASE_SERVER || "",
    username: process.env.DATABASE_USERNAME || "",
    password: process.env.DATABASE_PASSWORD || "",
    name: process.env.DATABASE_NAME || "",
    dialect: (process.env.DATABASE_DIALECT || "").toLowerCase(),
    pool: { max: int(process.env.DATABASE_POOL_MAX, 10), idle: 10000 },
  },

  // ── الجلسات ─────────────────────────────────────────────────────────────
  session: {
    secret: process.env.SESSION_SECRET || "",
    /** عمر الجلسة بالأيام */
    days: int(process.env.SESSION_DAYS, 14),
  },

  cronSecret: process.env.CRON_SECRET || "",
  unlockAll: bool(process.env.UNLOCK_ALL_FEATURES, false),
  /** يعطّل المؤقتات الداخلية عند الاعتماد على Cloud Scheduler وحده */
  disableInternalTicker: bool(process.env.DISABLE_INTERNAL_TICKER, false),
  /** رابط التطبيق العام — يُستخدم في روابط الإيميل وصفحة الإعداد */
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  supportEmail: process.env.SUPPORT_EMAIL || "",
  supportWhatsapp: (process.env.SUPPORT_WHATSAPP || "").replace(/[^0-9]/g, ""),

  trustProxy: bool(process.env.TRUST_PROXY, isProd),
};

/** هل مفاتيح سلة مضبوطة فعلاً؟ بدونها يعمل التطبيق لكن بلا تسجيل دخول. */
env.sallaConfigured = Boolean(env.salla.clientId && env.salla.clientSecret);

/**
 * سرّ الجلسات: عشوائي في التطوير حتى لا يُضطر المبتدئ لتوليده،
 * وإلزامي في الإنتاج لأن سرّاً ثابتاً معروفاً = تزوير جلسات أي تاجر.
 */
const sessionProblems = [];
if (!env.session.secret) {
  if (isProd) {
    sessionProblems.push(
      "SESSION_SECRET غير مضبوط. ولّد سرّاً عشوائياً طويلاً وضعه في متغيّرات البيئة قبل النشر."
    );
  } else {
    env.session.secret = crypto.randomBytes(32).toString("hex");
    env.session.ephemeral = true;
  }
} else if (isProd && env.session.secret.length < 24) {
  sessionProblems.push("SESSION_SECRET قصير جداً — استخدم 32 حرفاً على الأقل.");
}

if (isProd && !env.salla.webhookSecret) {
  sessionProblems.push(
    "SALLA_WEBHOOK_SECRET غير مضبوط — أي جهة تستطيع إرسال أحداث مزيّفة لتطبيقك."
  );
}

env.fatalProblems = sessionProblems;

/** رسائل إرشادية غير قاتلة تُعرض عند الإقلاع */
env.warnings = [];
if (!env.sallaConfigured) {
  env.warnings.push(
    "مفاتيح سلة غير مضبوطة (SALLA_OAUTH_CLIENT_ID / SECRET) — تسجيل الدخول معطّل، وستظهر صفحة الإعداد."
  );
}
if (!env.cronSecret) {
  env.warnings.push("CRON_SECRET غير مضبوط — مسار المجدول /internal/cron مقفل والمؤقّت الداخلي متوقف.");
}
if (env.unlockAll && !isProd) {
  env.warnings.push("وضع التجربة مفعّل (UNLOCK_ALL_FEATURES) — كل الميزات مفتوحة بلا شراء. احذفه قبل النشر.");
}
if (env.unlockAll && isProd) {
  env.warnings.push("UNLOCK_ALL_FEATURES مفعّل في بيئة إنتاج — تم تجاهله تلقائياً.");
}

module.exports = env;
