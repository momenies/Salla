/**
 * نقطة انطلاق التطبيق.
 *
 * الترتيب هنا مقصود:
 *   إعدادات → قاعدة بيانات → محرّك القوالب → الطبقة الوسطى → المسارات → الأخطاء
 * كل جزء يعيش في ملفه: config/ و lib/ و services/ و middleware/ و routes/.
 */
const path = require("path");
const express = require("express");
const session = require("express-session");
const nunjucks = require("nunjucks");
const bodyParser = require("body-parser");
const SequelizeStore = require("connect-session-sequelize")(session.Store);

const config = require("./config");
const db = require("./services/db");
const { passport } = require("./lib/auth");
const { registerFilters } = require("./lib/format");
const { securityHeaders, requestLogger } = require("./middleware");
const routes = require("./routes");

/** يطبع حالة الإعدادات عند الإقلاع حتى تعرف فوراً ما الناقص */
function reportConfig() {
  const { errors, warnings } = config.inspect();
  for (const message of errors) console.error(`❌ ${message}`);
  for (const message of warnings) console.warn(`⚠️  ${message}`);
  if (!errors.length && !warnings.length) console.log("✅ كل الإعدادات مضبوطة.");
}

async function createApp() {
  const connection = await db.init();
  const app = express();

  // خلف بروكسي (Cloud Run وغيره) حتى تعمل الكوكيز الآمنة وعناوين IP بشكل صحيح
  if (config.isProduction) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // ---------------------------------------------------------------- القوالب
  const env = nunjucks.configure(path.join(__dirname, "views"), {
    express: app,
    autoescape: true,
    noCache: !config.isProduction,
  });
  registerFilters(env);
  app.set("view engine", "html");

  // متغيّرات متاحة في كل قالب
  app.locals.appName = config.appName;
  app.locals.appId = config.salla.appId;
  app.locals.currency = config.ui.currency;

  // ------------------------------------------------------------ الطبقة الوسطى
  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(express.static(path.join(__dirname, "public"), { maxAge: config.isProduction ? "7d" : 0 }));
  app.use(bodyParser.urlencoded({ extended: false, limit: "1mb" }));
  app.use(bodyParser.json({ limit: "1mb" }));

  // الجلسات محفوظة في قاعدة البيانات، فلا تضيع عند إعادة تشغيل الخادم
  const sessionStore = new SequelizeStore({ db: connection, tableName: "Sessions" });
  await sessionStore.sync();

  app.use(
    session({
      secret: config.session.secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      name: "salla.sid",
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        maxAge: config.session.maxAgeMs,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // ملاحظة: لم نعد نستخدم `SallaAPI.setExpressVerify`.
  // كانت تحتفظ بتوكن واحد لكل العملية (فيدوس تاجر على توكن تاجر آخر)
  // وتستبدل `req.query` بالكامل، فتُفقد معاملات البحث والصفحات.
  // جلسات passport تؤدي نفس الغرض بشكل صحيح ولكل مستخدم على حدة.

  // ---------------------------------------------------------------- المسارات
  app.use(routes);

  // -------------------------------------------------------------- الأخطاء
  app.use((req, res) => {
    res.status(404).render("error.html", {
      isLogin: req.user,
      user: req.user,
      pageTitle: "الصفحة غير موجودة",
      pageSubtitle: "الرابط الذي فتحته غير صحيح",
      code: "404",
      message: "لم نعثر على الصفحة التي تبحث عنها.",
    });
  });

  app.use((err, req, res, next) => {
    console.error("خطأ غير متوقع:", err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).render("error.html", {
      isLogin: req.user,
      user: req.user,
      pageTitle: "حدث خطأ",
      pageSubtitle: "نعتذر، حصل خلل غير متوقع",
      code: String(err.status || 500),
      message: config.isProduction
        ? "حدث خطأ غير متوقع في التطبيق. حاول مرة أخرى بعد قليل."
        : err.message,
    });
  });

  return app;
}

async function start() {
  reportConfig();

  const app = await createApp();

  // عامل الأتمتة يبدأ مع الخادم فقط (لا داخل createApp حتى لا يعمل في الاختبارات)
  const automation = db.automation();
  if (automation) automation.startWorker();

  const server = app.listen(config.port, () => {
    console.log(`🚀 ${config.appName} يعمل على http://localhost:${config.port}`);
  });

  // إغلاق مرتّب: منصّات الاستضافة ترسل SIGTERM قبل إيقاف الحاوية
  const shutdown = (signal) => async () => {
    console.log(`\n${signal} — جارٍ الإغلاق بهدوء...`);
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown("SIGTERM"));
  process.on("SIGINT", shutdown("SIGINT"));

  return server;
}

// يُشغَّل مباشرة عبر `npm run dev`، ويُستورد في الاختبارات دون تشغيل
if (require.main === module) {
  start().catch((err) => {
    console.error("فشل إقلاع التطبيق:", err);
    process.exit(1);
  });
}

module.exports = { createApp, start };
