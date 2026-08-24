/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  منقذ السلات — تطبيق سلة لاسترداد السلات المتروكة عبر واتساب
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * هذا الملف هو نقطة التجميع فقط: يركّب الطبقات بالترتيب الصحيح ثم يستمع.
 * المنطق كله في مجلداته: lib (بنية تحتية)، services (منطق المنتج)،
 * routes (الواجهات)، Actions (أحداث سلة).
 *
 * ترتيب الوسائط مقصود ولا يصحّ خلطه:
 *   أمان → ضغط → ملفات ثابتة → جسم الطلب → جلسة → هوية → حماية CSRF → مسارات
 */
const path = require("path");
const express = require("express");
const session = require("express-session");
const compression = require("compression");

const env = require("./config/env");
const log = require("./lib/logger");
const db = require("./helpers/salla-db");
const cache = require("./lib/cache");
const { passport } = require("./lib/auth");
const SequelizeStore = require("./lib/session-store");
const { securityHeaders, csrf, rateLimit } = require("./lib/security");
const automation = require("./services/automation");
const wweb = require("./helpers/wa-wweb");
const routes = require("./routes");
const { withFeatures } = require("./middleware");
const { configureViews } = require("./lib/views");

// إعدادات ناقصة تهدّد الأمان توقف الإقلاع — الفشل الصامت في الإنتاج أسوأ
if (env.fatalProblems.length) {
  for (const problem of env.fatalProblems) log.error("إعداد ناقص: " + problem);
  process.exit(1);
}
for (const warning of env.warnings) log.warn(warning);

const app = express();

// خلف موازن أحمال (Cloud Run مثلاً): بدون هذا يظن التطبيق أن كل الطلبات
// http فيرفض إرسال كوكي الجلسة الآمنة، فيبدو تسجيل الدخول «معطّلاً».
if (env.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");

// ─────────────────────────── العرض ───────────────────────────
// في الإنتاج تُترجَم القوالب مرة وتُخزَّن — فرق ملموس في زمن كل صفحة
configureViews(app, { cache: env.isProd });

// ─────────────────────────── الوسائط ───────────────────────────
app.use(securityHeaders);
app.use(compression());

// الملفات الثابتة: بصمة المحتوى في الاسم تسمح بتخزين طويل بلا خوف من القِدم
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: env.isProd ? "30d" : 0,
    etag: true,
    lastModified: true,
  })
);

/**
 * نحتفظ بالجسم الخام لأن التحقق من توقيع الويبهوك يُحسب على البايتات كما
 * وصلت — أي إعادة ترتيب أو تنسيق تكسر التوقيع.
 */
const rawBodySaver = (req, res, buf) => {
  if (buf && buf.length) req.rawBody = buf;
};
app.use(express.json({ limit: "1mb", verify: rawBodySaver }));
app.use(express.urlencoded({ extended: false, limit: "1mb", verify: rawBodySaver }));

const sessionStore = new SequelizeStore({ db });
app.use(
  session({
    name: "salla.sid",
    secret: env.session.secret,
    store: sessionStore,
    resave: false,             // الكتابة في كل طلب تُثقل القاعدة بلا فائدة
    saveUninitialized: false,  // لا نُنشئ جلسة لزائر لم يفعل شيئاً
    rolling: true,             // النشاط يمدّد الجلسة، فلا يُطرد التاجر أثناء العمل
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProd,
      maxAge: env.session.days * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// الويبهوك والمجدول ينادَيان من خارج المتصفّح، فلا رمز CSRF لديهما
app.use(csrf({ ignorePaths: ["/webhook", "/internal"] }));

// حدّ عام معتدل: يوقف الفحص الآلي دون أن يزعج تاجراً يتصفّح بسرعة
app.use(rateLimit({ windowMs: 60000, max: 300 }));

app.use(withFeatures);

app.use(routes);

// ─────────────────────────── الأخطاء ───────────────────────────

app.use((req, res) => {
  res.status(404);
  if (req.accepts("html")) {
    return res.render("error.html", {
      code: 404,
      title: "الصفحة غير موجودة",
      message: "الرابط الذي فتحته لا يوجد — ربما تغيّر أو حُذف.",
      isLogin: req.user,
      user: req.user,
    });
  }
  res.json({ ok: false, error: "غير موجود" });
});

// eslint-disable-next-line no-unused-vars — التوقيع الرباعي ضروري ليعرفه express
app.use((err, req, res, next) => {
  log.error("خطأ غير متوقّع", { path: req.path, error: err.message, stack: err.stack });
  res.status(err.status || 500);
  if (req.accepts("html")) {
    return res.render("error.html", {
      code: 500,
      title: "حدث خلل غير متوقّع",
      message: "سجّلنا المشكلة وسنعالجها. جرّب إعادة تحميل الصفحة.",
      detail: env.isProd ? null : err.message,
      isLogin: req.user,
      user: req.user,
    });
  }
  res.json({ ok: false, error: env.isProd ? "خطأ داخلي" : err.message });
});

// ─────────────────────────── المؤقّتات ───────────────────────────

const timers = [];

/**
 * مؤقّت داخلي للتطوير ولعمليات التشغيل الصغيرة.
 * في الإنتاج على منصّة تُطفئ النسخ عند الخمول (Cloud Run) لا يُعتمد عليه —
 * اضبط Cloud Scheduler على `/internal/cron` وعطّله بـ DISABLE_INTERNAL_TICKER.
 */
function startTickers() {
  if (env.disableInternalTicker || env.isTest) return;

  timers.push(
    setInterval(async () => {
      try {
        await automation.processDueMessages(50);
      } catch (err) {
        log.warn("خطأ في عامل الطابور", { error: err.message });
      }
    }, 60 * 1000)
  );

  timers.push(
    setInterval(async () => {
      try {
        const merchants = await db.getAllMerchantIds();
        for (const merchant of merchants) await automation.scheduleCartReminders(merchant);
      } catch (err) {
        log.warn("خطأ في دورة السلات", { error: err.message });
      }
    }, 5 * 60 * 1000)
  );

  for (const timer of timers) if (timer.unref) timer.unref();
}

// ─────────────────────────── الإقلاع ───────────────────────────

async function start() {
  // نتصل بالقاعدة قبل الاستماع: أول طلب لا ينبغي أن ينتظر إنشاء الجداول
  await db.connect();

  const server = app.listen(env.port, () => {
    log.info(`🚀 التطبيق يعمل على http://localhost:${env.port}`, { env: env.NODE_ENV });
    if (!env.sallaConfigured) {
      log.warn("افتح /login لترى صفحة الإعداد وما ينقصك من مفاتيح سلة.");
    }
  });

  startTickers();

  /**
   * إيقاف لطيف: ننهي الطلبات الجارية ونغلق الموارد.
   * بدونه تُقطع الطلبات في منتصفها عند كل نشر، وقد يبقى ملف SQLite مقفلاً.
   */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`إيقاف التطبيق (${signal})…`);

    const force = setTimeout(() => process.exit(1), 10000);
    if (force.unref) force.unref();

    server.close(async () => {
      for (const timer of timers) clearInterval(timer);
      sessionStore.stop();
      cache.invalidate();
      try {
        await wweb.shutdown();
      } catch {
        /* جلسات واتساب قد تكون غير مهيّأة أصلاً */
      }
      try {
        await db.close();
      } catch {
        /* الاتصال قد يكون مغلقاً */
      }
      log.info("تم الإيقاف بسلام");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    log.error("وعد مرفوض بلا معالج", { error: reason?.message || String(reason) });
  });
  process.on("uncaughtException", (err) => {
    log.error("استثناء غير ملتقط", { error: err.message, stack: err.stack });
    shutdown("uncaughtException");
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    log.error("فشل إقلاع التطبيق", { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { app, start };
