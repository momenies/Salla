/**
 * اختبار تكامل للتطبيق الحقيقي: استقبال الويبهوك، فحص السلامة، وصفحة 404.
 * يشغّل `createApp()` نفسها التي يستخدمها الإنتاج.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const DB = path.join(os.tmpdir(), `salla-webhook-test-${process.pid}.sqlite`);

process.env.NODE_ENV = "development";
process.env.DATABASE_STORAGE = DB;
process.env.SALLA_DATABASE_ORM = "Sequelize";
process.env.SESSION_SECRET = "test-secret-long-enough-for-tests";
process.env.SALLA_WEBHOOK_SECRET = "the-webhook-secret";
process.env.SALLA_OAUTH_CLIENT_ID = "id";
process.env.SALLA_OAUTH_CLIENT_SECRET = "secret";
process.env.SALLA_OAUTH_CLIENT_REDIRECT_URI = "http://localhost/oauth/callback";
process.env.REQUEST_LOG = "false";

let server;
let origin;
let db;

test.before(async () => {
  const { createApp } = require("../app");
  db = require("../services/db");
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db.close().catch(() => {});
  fs.rmSync(DB, { force: true });
});

function postWebhook(body, authorization) {
  return fetch(`${origin}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body),
  });
}

test("/healthz يرجّع حالة سليمة", async () => {
  const res = await fetch(`${origin}/healthz`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.database, true);
});

test("الويبهوك يرفض سراً خاطئاً", async () => {
  const res = await postWebhook({ event: "order.created", merchant: 1 }, "wrong-secret");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).ok, false);
});

test("الويبهوك يرفض طلباً بلا ترويسة تفويض", async () => {
  const res = await postWebhook({ event: "order.created", merchant: 1 });
  assert.equal(res.status, 401);
});

test("الويبهوك يرفض سراً بطول مختلف دون أن ينهار", async () => {
  const res = await postWebhook({ event: "order.created", merchant: 1 }, "x");
  assert.equal(res.status, 401);
});

test("الويبهوك يقبل السر الصحيح ويسجّل الحدث", async () => {
  const res = await postWebhook({ event: "order.created", merchant: 4242, data: { id: 7 } }, "the-webhook-secret");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);

  const page = await db.stores().listEvents({ storeId: 4242 });
  assert.equal(page.total, 1);
  assert.equal(page.rows[0].event, "order.created");
  assert.equal(page.rows[0].status, "processed");
});

test("حدث الاشتراك يحدّث حالة المتجر", async () => {
  await postWebhook(
    { event: "app.subscription.started", merchant: 4242, data: { plan_name: "احترافية", end_date: "2099-01-01" } },
    "the-webhook-secret"
  );
  const store = await db.stores().findByMerchantId(4242);
  assert.equal(store.subscription_status, "active");
  assert.equal(store.isSubscriptionActive(), true);
});

test("الصفحات المحمية تحوّل غير المسجّلين إلى الدخول", async () => {
  const res = await fetch(`${origin}/orders`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("رابط غير موجود يعرض صفحة 404 مصمّمة", async () => {
  const res = await fetch(`${origin}/no-such-page`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /الصفحة غير موجودة/);
});

test("رؤوس الأمان موجودة على كل رد", async () => {
  const res = await fetch(`${origin}/healthz`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(res.headers.get("x-powered-by"), null, "لا نكشف نوع الخادم");
});
