/** اختبارات طبقة الخدمات على قاعدة بيانات SQLite في الذاكرة. */
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

process.env.DATABASE_STORAGE = path.join(os.tmpdir(), `salla-test-${process.pid}.sqlite`);
process.env.SALLA_DATABASE_ORM = "Sequelize";

const createDatabase = require("../database");
const createStoreService = require("../services/stores");

let connection;
let stores;

test.before(async () => {
  connection = await createDatabase("Sequelize").connect();
  stores = createStoreService(connection);
});

test.after(async () => {
  if (connection) await connection.close();
  require("node:fs").rmSync(process.env.DATABASE_STORAGE, { force: true });
});

test("upsertUser يرجّع المستخدم دائماً — في الإنشاء وفي التحديث", async () => {
  const first = await stores.upsertUser({ username: "محمد", email: "m@example.com" });
  assert.ok(first && first.id, "لا بد أن يرجّع صف المستخدم عند الإنشاء");

  const second = await stores.upsertUser({ username: "محمد الراشد", email: "m@example.com" });
  assert.equal(second.id, first.id, "نفس المستخدم لا يتكرّر");
  assert.equal(second.username, "محمد الراشد", "الاسم يُحدَّث");
});

test("upsertFromAuth ينشئ المتجر ثم يحدّثه دون تكرار", async () => {
  const profile = { email: "m@example.com", merchant: { id: 555, name: "متجر أ", domain: "https://a.salla.sa" } };
  const created = await stores.upsertFromAuth(profile, { userId: 1 });
  const updated = await stores.upsertFromAuth({ merchant: { id: 555, name: "متجر ب" } });

  assert.equal(created.id, updated.id);
  assert.equal(updated.name, "متجر ب");
  assert.equal(await connection.models.Store.count({ where: { salla_store_id: 555 } }), 1);
});

test("upsertFromAuth يتجاهل رداً بلا معرّف متجر", async () => {
  assert.equal(await stores.upsertFromAuth({ email: "x@y.z" }), null);
});

test("saveTokens يحدّث صفاً واحداً بدل تكديس الصفوف", async () => {
  await stores.saveTokens(555, { accessToken: "a1", refreshToken: "r1", expiresIn: 3600 });
  await stores.saveTokens(555, { accessToken: "a2", refreshToken: "r2", expiresIn: 7200 });

  assert.equal(await connection.models.OauthTokens.count({ where: { merchant: 555 } }), 1);
  const tokens = await stores.getTokens(555);
  assert.equal(tokens.access_token, "a2");
  assert.equal(tokens.expires_in, 7200);
});

test("clientFor يبني عميلاً بتوكن المتجر، وnull لمتجر بلا توكن", async () => {
  const client = await stores.clientFor(555);
  assert.equal(client.accessToken, "a2");
  assert.equal(client.refreshToken, "r2");
  assert.equal(await stores.clientFor(999999), null);
});

test("الإعدادات تُحفظ وتُقرأ كـ JSON", async () => {
  await stores.updateSettings(555, { notify_email: "o@e.com", low_stock_threshold: 12 });
  const store = await stores.findByMerchantId(555);
  assert.deepEqual(store.getSettings(), { notify_email: "o@e.com", low_stock_threshold: 12 });
});

test("getSettings لا ينهار على JSON تالف", async () => {
  const store = await stores.findByMerchantId(555);
  await store.update({ settings: "{ليس JSON" });
  assert.deepEqual(store.getSettings(), {});
});

test("أحداث التطبيق تحرّك حالة الاشتراك بالشكل الصحيح", async () => {
  const merchant = 777;

  await stores.applyAppEvent("app.installed", { merchant, data: { app_scopes: ["orders.read"] } });
  let store = await stores.findByMerchantId(merchant);
  assert.equal(store.status, "installed");
  assert.equal(store.scopes, "orders.read");

  await stores.applyAppEvent("app.trial.started", { merchant, data: { end_date: "2099-01-01" } });
  store = await stores.findByMerchantId(merchant);
  assert.equal(store.subscription_status, "trial");
  assert.equal(store.isSubscriptionActive(), true);

  await stores.applyAppEvent("app.subscription.started", {
    merchant,
    data: { plan_name: "احترافية", start_date: "2026-01-01", end_date: "2099-01-01" },
  });
  store = await stores.findByMerchantId(merchant);
  assert.equal(store.subscription_status, "active");
  assert.equal(store.subscription_plan, "احترافية");

  await stores.applyAppEvent("app.uninstalled", { merchant, data: {} });
  store = await stores.findByMerchantId(merchant);
  assert.equal(store.status, "uninstalled");
  assert.equal(store.isSubscriptionActive(), false, "إلغاء التثبيت يوقف الاشتراك");
});

test("اشتراك منتهي التاريخ لا يُعتبر فعّالاً", async () => {
  const merchant = 888;
  await stores.applyAppEvent("app.subscription.started", {
    merchant,
    data: { plan_name: "شهرية", start_date: "2020-01-01", end_date: "2020-02-01" },
  });
  const store = await stores.findByMerchantId(merchant);
  assert.equal(store.subscription_status, "active");
  assert.equal(store.isSubscriptionActive(), false, "التاريخ المنتهي يغلب الحالة المخزّنة");
});

test("حدث لا يخصّ الاشتراك لا يغيّر الحالة", async () => {
  const before = await stores.findByMerchantId(777);
  await stores.applyAppEvent("order.created", { merchant: 777, data: { id: 1 } });
  const after = await stores.findByMerchantId(777);
  assert.equal(after.subscription_status, before.subscription_status);
});

test("سجل الأحداث يدعم الترقيم والتصفية", async () => {
  for (let i = 0; i < 5; i++) {
    await stores.recordEvent({ storeId: 555, event: i % 2 ? "order.created" : "customer.created", payload: { i } });
  }
  await stores.recordEvent({ storeId: 555, event: "order.created", status: "failed", error: "سبب الفشل" });

  const all = await stores.listEvents({ storeId: 555, perPage: 4 });
  assert.equal(all.total, 6);
  assert.equal(all.totalPages, 2);
  assert.equal(all.rows.length, 4);

  const filtered = await stores.listEvents({ storeId: 555, event: "order.created", perPage: 50 });
  assert.equal(filtered.total, 3);

  const names = await stores.distinctEventNames(555);
  assert.deepEqual(names, ["customer.created", "order.created"]);
});

test("getPayload يرجّع كائناً فارغاً بدل الانهيار", async () => {
  const event = await stores.recordEvent({ storeId: 555, event: "x.y", payload: { a: 1 } });
  assert.deepEqual(event.getPayload(), { a: 1 });
  await event.update({ payload: "تالف" });
  assert.deepEqual(event.getPayload(), {});
});
