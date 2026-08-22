/**
 * إعدادات التطبيق — مصدر واحد لكل متغيّرات البيئة.
 * يقرأ ملف .env مرة واحدة ويتحقّق من المتغيّرات الأساسية عند الإقلاع.
 */
require("dotenv").config({ quiet: true });

const env = process.env;

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const nodeEnv = env.NODE_ENV || "development";

const config = {
  env: nodeEnv,
  isProduction: nodeEnv === "production",

  // Cloud Run وغيره من منصّات الاستضافة يمرّرون المنفذ عبر PORT
  port: int(env.PORT, int(process.argv[2], 8082)),

  appName: env.APP_NAME || "تطبيق سلة",
  appUrl: (env.APP_URL || "").replace(/\/+$/, ""),

  salla: {
    clientId: env.SALLA_OAUTH_CLIENT_ID || "",
    clientSecret: env.SALLA_OAUTH_CLIENT_SECRET || "",
    redirectUri: env.SALLA_OAUTH_CLIENT_REDIRECT_URI || "",
    webhookSecret: env.SALLA_WEBHOOK_SECRET || "",
    appId: env.SALLA_APP_ID || "",
    apiBase: (env.SALLA_API_BASE || "https://api.salla.dev/admin/v2").replace(/\/+$/, ""),
    accountsBase: (env.SALLA_ACCOUNTS_BASE || "https://accounts.salla.sa").replace(/\/+$/, ""),
    timeoutMs: int(env.SALLA_TIMEOUT_MS, 15000),
  },

  database: {
    orm: env.SALLA_DATABASE_ORM || "Sequelize",
    storage: env.DATABASE_STORAGE || "",
  },

  session: {
    secret: env.SESSION_SECRET || "salla-app-dev-secret-change-me",
    maxAgeMs: int(env.SESSION_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000),
  },

  // تسجيل كل طلب في اللوج (يُطفأ تلقائياً في الإنتاج ما لم يُطلب)
  requestLog: bool(env.REQUEST_LOG, nodeEnv !== "production"),

  automation: {
    enabled: bool(env.AUTOMATION_ENABLED, true),
    // كل كم ثانية يفحص التطبيق صندوق الصادر
    dispatchIntervalSec: int(env.AUTOMATION_DISPATCH_INTERVAL_SEC, 30),
    // عدد الرسائل في كل دورة، وحد إعادة المحاولة
    batchSize: int(env.AUTOMATION_BATCH_SIZE, 20),
    maxAttempts: int(env.AUTOMATION_MAX_ATTEMPTS, 4),
    timeoutMs: int(env.AUTOMATION_TIMEOUT_MS, 15000),
    defaultCountryCode: env.DEFAULT_COUNTRY_CODE || "966",
    // توكن يحمي /tasks/dispatch حتى يستدعيه Cloud Scheduler بأمان
    dispatchToken: env.AUTOMATION_DISPATCH_TOKEN || "",

    webhookUrl: env.AUTOMATION_WEBHOOK_URL || "",
    webhookSecret: env.AUTOMATION_WEBHOOK_SECRET || "",

    whatsapp: {
      token: env.WHATSAPP_TOKEN || "",
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || "",
      apiVersion: env.WHATSAPP_API_VERSION || "v21.0",
      templateName: env.WHATSAPP_TEMPLATE_NAME || "",
      templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE || "ar",
    },
  },

  // ضبط عام لواجهة المستخدم
  ui: {
    perPage: int(env.UI_PER_PAGE, 15),
    vatRate: Number.parseFloat(env.VAT_RATE || "0.15"),
    currency: env.DEFAULT_CURRENCY || "SAR",
  },
};

/**
 * يفحص الإعدادات ويرجّع قائمة بالمشاكل، مقسّمة إلى:
 *  errors   — تمنع التطبيق من العمل أصلاً
 *  warnings — التطبيق يعمل لكن ميزة ما ستكون معطّلة
 */
function inspect() {
  const errors = [];
  const warnings = [];

  if (!config.salla.clientId) errors.push("SALLA_OAUTH_CLIENT_ID غير مضبوط — تسجيل الدخول لن يعمل.");
  if (!config.salla.clientSecret) errors.push("SALLA_OAUTH_CLIENT_SECRET غير مضبوط — تسجيل الدخول لن يعمل.");
  if (!config.salla.redirectUri) errors.push("SALLA_OAUTH_CLIENT_REDIRECT_URI غير مضبوط — سلة لن تعرف أين تعيد المستخدم.");

  if (!config.salla.webhookSecret) warnings.push("SALLA_WEBHOOK_SECRET غير مضبوط — أحداث المتجر (Webhooks) لن تُستقبل.");
  if (!config.salla.appId) warnings.push("SALLA_APP_ID غير مضبوط — بعض روابط بوابة الشركاء لن تعمل.");
  if (config.automation.enabled) {
    const { whatsapp, webhookUrl } = config.automation;
    const anyChannel = (whatsapp.token && whatsapp.phoneNumberId) || webhookUrl;
    if (!anyChannel) {
      warnings.push("لا توجد قناة إرسال مهيّأة — الأتمتة ستعمل بوضع التجربة فقط (تسجّل الرسائل ولا ترسلها).");
    }
    if (config.isProduction && !config.automation.dispatchToken) {
      warnings.push("AUTOMATION_DISPATCH_TOKEN غير مضبوط — مسار /tasks/dispatch سيبقى مغلقاً.");
    }
  }
  if (config.isProduction && config.session.secret === "salla-app-dev-secret-change-me") {
    errors.push("SESSION_SECRET ما زال القيمة الافتراضية — اضبط قيمة عشوائية طويلة قبل النشر.");
  }
  if (!config.database.storage && config.database.orm === "Sequelize" && !env.DATABASE_NAME) {
    warnings.push("لا DATABASE_STORAGE ولا DATABASE_NAME مضبوط — قاعدة البيانات قد لا تتصل.");
  }

  return { errors, warnings, ok: errors.length === 0 };
}

module.exports = config;
module.exports.inspect = inspect;
