/**
 * اختبار تكامل الصفحات: نبني تطبيقاً بنفس إعدادات العرض الحقيقية، ونركّب
 * المسارات ذاتها مع مستخدم مُثبَّت — فيرندَر كل قالب ببيانات حقيقية.
 *
 * الغرض: خطأ في اسم متغيّر داخل قالب لا يظهر إلا حين يفتح تاجر الصفحة.
 * هذه الاختبارات تُظهره الآن.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { useTempDatabase, seedMerchant } = require("./helpers");

const tmp = useTempDatabase("pages");
const express = require("express");
const db = require("../helpers/salla-db");
const { configureViews } = require("../lib/views");

const MERCHANT = 880001;
const USER = {
  id: 1,
  name: "أحمد التاجر",
  email: "merchant@example.com",
  merchant: { id: MERCHANT, name: "متجر الاختبار", avatar: "" },
};

let server;
let baseUrl;

test.before(async () => {
  await seedMerchant(db, MERCHANT);

  // بيانات واقعية حتى تُختبر فروع العرض لا الحالة الفارغة فقط
  const now = Math.floor(Date.now() / 1000);
  await db.saveAbandonedCart({
    merchant: MERCHANT, cart_id: 4001, customer_name: "سارة العتيبي",
    customer_mobile: "966501234567", customer_email: "s@example.com",
    total_amount: 349.5, currency: "SAR", checkout_url: "https://demo.salla.sa/cart/x",
    items_count: 3, abandoned_at: now - 7200,
  });
  await db.setAbandonedCartStatus(MERCHANT, 4001, "contacted");
  await db.saveAbandonedCart({
    merchant: MERCHANT, cart_id: 4002, customer_name: "محمد",
    customer_mobile: "966505555555", total_amount: 120, abandoned_at: now - 600,
  });
  await db.insertMessage({
    merchant: MERCHANT, kind: "cart_reminder", cart_id: 4001, customer_name: "سارة العتيبي",
    customer_mobile: "966501234567", body: "مرحباً سارة 👋 سلتك بانتظارك", status: "sent",
    sent_at: now - 3600, created_at: now - 3600, channel: "cloud",
  });
  await db.insertMessage({
    merchant: MERCHANT, kind: "order_thanks", customer_name: "محمد", customer_mobile: "966505555555",
    body: "شكراً لك", status: "failed", error: "رمز الوصول غير صالح", attempts: 3, created_at: now - 1800,
  });
  await db.insertMessage({
    merchant: MERCHANT, kind: "review_request", customer_name: "نورة", customer_mobile: "966509999999",
    body: "شاركنا رأيك", status: "pending", scheduled_at: now + 3600, created_at: now - 100,
  });
  await db.saveManualCustomer({ merchant: MERCHANT, name: "عميل يدوي", mobile: "966501112222", email: "m@example.com" });
  await db.saveAutomation(MERCHANT, "order_thanks", { enabled: true, delay_minutes: 0 });
  await db.grantFeature(MERCHANT, "invoices", { plan_label: "خطة الفواتير", source: "purchase" });
  await db.grantFeature(MERCHANT, "customers_crm", { source: "purchase" });

  const app = express();
  configureViews(app, { cache: false });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // جلسة ومستخدم مثبّتان — نختبر العرض لا آلية الدخول
  app.use((req, res, next) => {
    req.session = { csrfToken: "test-csrf" };
    req.user = USER;
    req.isAuthenticated = () => true;
    res.locals.csrfToken = "test-csrf";
    res.locals.nonce = "test-nonce";
    next();
  });
  app.use(require("../middleware").withFeatures);
  app.use(require("../routes"));

  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message, stack: err.stack });
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  tmp.cleanup();
});

/** يجلب صفحة ويفشل برسالة مفيدة إن رجعت خطأ */
async function get(pathname) {
  const res = await fetch(baseUrl + pathname, { headers: { Accept: "text/html" } });
  const body = await res.text();
  if (res.status >= 500) assert.fail(`${pathname} → ${res.status}\n${body.slice(0, 900)}`);
  return { status: res.status, body };
}

const PAGES = [
  ["/", ["نظرة عامة", "إيراد مستعاد"]],
  ["/abandoned", ["السلات المتروكة", "سارة العتيبي"]],
  ["/abandoned?status=new", ["محمد"]],
  ["/abandoned?q=سارة", ["سارة العتيبي"]],
  ["/automations", ["الأتمتة", "شكر على الطلب"]],
  ["/automations?status=failed", ["رمز الوصول غير صالح"]],
  ["/settings", ["قناة الإرسال", "ساعات الهدوء"]],
  ["/plans", ["الباقات", "الباقة الشاملة"]],
  ["/customers", ["العملاء", "عميل يدوي"]],
  ["/account", ["حسابي", "حالة الربط"]],
];

for (const [pathname, needles] of PAGES) {
  test(`تُعرض الصفحة ${pathname} بلا أخطاء`, async () => {
    const { status, body } = await get(pathname);
    assert.equal(status, 200, `${pathname} أعادت ${status}`);
    for (const needle of needles) {
      assert.ok(body.includes(needle), `لم نجد "${needle}" في ${pathname}`);
    }
    assert.ok(!body.includes("undefined</"), "قيمة غير معرّفة ظهرت في الصفحة");
  });
}

test("الصفحات المقفلة تعرض صفحة الباقات برمز 402", async () => {
  const { status, body } = await get("/orders");
  assert.equal(status, 402);
  assert.ok(body.includes("الباقات"));
});

test("الميزة المشتراة تُفتح فعلاً", async () => {
  const { status } = await get("/invoices");
  assert.equal(status, 200, "الفواتير مشتراة فتُفتح");
});

test("تصدير CSV يعيد ملفاً بالترميز الصحيح", async () => {
  const res = await fetch(baseUrl + "/abandoned/export.csv");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  // fetch يزيل BOM عند فك الترميز، فنفحص البايتات نفسها
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf], "BOM موجود ليفتحه Excel سليماً");
  assert.ok(Buffer.from(bytes).toString("utf8").includes("سارة العتيبي"));
});

test("واجهة الإحصاءات تعيد نصوصاً جاهزة للعرض", async () => {
  const res = await fetch(baseUrl + "/api/stats");
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.cards.recovered.includes("ر.س"));
  assert.equal(typeof json.cards.rate, "string");
});

test("معاينة النص تستبدل المتغيّرات على الخادم", async () => {
  const res = await fetch(baseUrl + "/automations/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "test-csrf" },
    body: JSON.stringify({ template: "مرحباً [الاسم] من [المتجر]" }),
  });
  const json = await res.json();
  assert.equal(json.text, "مرحباً أحمد من متجر الاختبار");
});

test("تفعيل سيناريو يُحفظ فعلاً في قاعدة البيانات", async () => {
  const res = await fetch(baseUrl + "/automations/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "test-csrf" },
    body: JSON.stringify({ key: "review_request", enabled: true }),
  });
  assert.equal((await res.json()).ok, true);
  const rows = await db.getAutomations(MERCHANT);
  assert.ok(rows.find((r) => r.key === "review_request").enabled);
});

test("صفحة الصحة تعمل", async () => {
  const res = await fetch(baseUrl + "/healthz");
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.database, "ok");
});

test("الحقول المعادية تُهرَّب ولا تُنفَّذ", async () => {
  await db.saveAbandonedCart({
    merchant: MERCHANT, cart_id: 4099,
    customer_name: '<img src=x onerror="alert(1)">',
    customer_mobile: "966507777777", total_amount: 10, abandoned_at: Math.floor(Date.now() / 1000),
  });
  const { body } = await get("/abandoned");
  assert.ok(!body.includes('<img src=x onerror'), "لم يُهرَّب اسم العميل الخبيث");
  assert.ok(body.includes("&lt;img"), "الاسم ظهر مُهرَّباً كنص");
});

/**
 * ما يراه التاجر يجب ألّا يحمل داخليّاتنا: أسماء متغيّرات البيئة، ملفات
 * الشيفرة، أو نص أحداث سلة الخام. هذه الاختبارات تحرس ذلك.
 */
test("صفحات التاجر خالية من أسماء ملفات الشيفرة ومتغيّرات البيئة", async () => {
  const LEAKS = [
    "config/features.js", "addonMatch", "SESSION_SECRET", "SALLA_OAUTH_CLIENT_SECRET",
    "SALLA_WEBHOOK_SECRET", "DATABASE_STORAGE", "CRON_SECRET", ".env", "randomBytes",
  ];
  for (const pathname of ["/", "/abandoned", "/automations", "/plans", "/customers", "/account"]) {
    const { body } = await get(pathname);
    for (const leak of LEAKS) {
      assert.ok(!body.includes(leak), `${pathname} تسرّب "${leak}" إلى واجهة التاجر`);
    }
  }
});

test("نص حدث الاشتراك الخام لا يُعرض على التاجر", async () => {
  // نسجّل اشتراكاً بإضافة مجهولة — يحفظ التطبيق نصها الخام للتشخيص
  const { handleSubscriptionEvent } = require("../helpers/subscriptions");
  await handleSubscriptionEvent({
    event: "app.subscription.started",
    merchant: MERCHANT,
    data: { name: "إضافة-مجهولة-للاختبار", plan_name: "خطة غامضة" },
  });

  const { body } = await get("/plans");
  assert.ok(!body.includes("إضافة-مجهولة-للاختبار"), "النص الخام ظهر للتاجر");
  assert.ok(!body.includes("addonMatch"), "اسم حقل داخلي ظهر للتاجر");
  assert.ok(body.includes("لم نتمكّن من مطابقته"), "التاجر يستحق إشعاراً مفهوماً بلغته");
});
