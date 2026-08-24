/**
 * تهيئة محرّك القوالب.
 *
 * وُضعت هنا لا في app.js لأن القوالب تعتمد على مرشّحات مخصّصة (`money`,
 * `timeAgo`…): أي مكان يرندر قالباً — التطبيق أو الاختبارات أو أي سكربت —
 * يحتاج نفس التهيئة، وإلا انفجر القالب بـ "filter not found" وقت التشغيل.
 */
const path = require("path");
const nunjucks = require("nunjucks");
const format = require("./format");

const VIEWS_DIR = path.join(__dirname, "..", "views");

/**
 * @param {import("express").Express} app
 * @param {{cache?: boolean}} options  cache=true يترجم القوالب مرة واحدة (الإنتاج)
 */
function configureViews(app, { cache = true } = {}) {
  const env = nunjucks.configure(VIEWS_DIR, {
    autoescape: true, // يمنع حقن HTML من أسماء العملاء ونصوص سلة
    express: app,
    // `noCache` وحده يكفي لإعادة القراءة أثناء التطوير. لا نفعّل `watch`:
    // فهو يفتح مراقب ملفات يبقي حلقة الأحداث حيّة، فلا تنتهي عملية الاختبار.
    noCache: !cache,
  });

  env.addFilter("money", format.money);
  env.addFilter("timeAgo", format.timeAgo);
  env.addFilter("shortDate", format.shortDate);
  env.addFilter("truncate2", format.truncate);

  env.addGlobal("appName", "منقذ السلات");
  env.addGlobal("year", new Date().getFullYear());

  app.set("view engine", "html");
  app.set("views", VIEWS_DIR);
  return env;
}

module.exports = { configureViews, VIEWS_DIR };
