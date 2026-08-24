const test = require("node:test");
const assert = require("node:assert/strict");
const { useTempDatabase } = require("./helpers");

const tmp = useTempDatabase("subs");
const db = require("../helpers/salla-db");
const { matchFeatures, FEATURES, BUNDLE } = require("../config/features");
const subs = require("../helpers/subscriptions");

const MERCHANT = 555001;
const OTHER = 555002;

test.before(async () => { await db.connect(); });
test.after(async () => { await db.close(); tmp.cleanup(); });

test("matchFeatures يتعرّف على الإضافة بالاسم أو المعرّف", () => {
  assert.deepEqual(matchFeatures({ data: { name: "invoices" } }), ["invoices"]);
  assert.deepEqual(matchFeatures({ data: { plan_name: "الفواتير" } }), ["invoices"]);
});

test("الباقة الشاملة تفتح كل الميزات", () => {
  const keys = matchFeatures({ data: { name: BUNDLE.addonMatch[0] } });
  assert.equal(keys.length, FEATURES.length);
});

test("الإضافة المجهولة لا تفتح شيئاً", () => {
  assert.deepEqual(matchFeatures({ data: { name: "شيء لم نعرفه" } }), []);
});

test("حدث الشراء يفتح الميزة فعلاً", async () => {
  const result = await subs.handleSubscriptionEvent({
    event: "app.subscription.started",
    merchant: MERCHANT,
    data: { name: "invoices", end_date: "2030-01-01 00:00:00" },
  });
  assert.equal(result.action, "grant");

  const open = await subs.activeFeatures(MERCHANT);
  assert.ok(open.has("invoices"));
  assert.ok(open.has("abandoned_carts"), "المجانية مفتوحة دائماً");
  assert.ok(!open.has("order_followups"), "ما لم يُشترَ يبقى مقفلاً");
});

test("الصلاحيات لا تتسرّب بين المتاجر", async () => {
  const other = await subs.activeFeatures(OTHER);
  assert.ok(!other.has("invoices"), "متجر آخر لا يرث مشتريات غيره");
});

test("الإلغاء يقفل الميزة ويُبقي السجل", async () => {
  await subs.handleSubscriptionEvent({
    event: "app.subscription.canceled",
    merchant: MERCHANT,
    data: { name: "invoices" },
  });
  const open = await subs.activeFeatures(MERCHANT);
  assert.ok(!open.has("invoices"));

  const rows = await db.listEntitlements(MERCHANT);
  assert.ok(rows.some((r) => r.feature_key === "invoices" && r.status === "canceled"), "السجل محفوظ للتاريخ");
});

test("انتهاء التاريخ يقفل الميزة تلقائياً", async () => {
  await db.grantFeature(MERCHANT, "customers_crm", { expires_at: new Date(Date.now() - 1000) });
  const open = await subs.activeFeatures(MERCHANT);
  assert.ok(!open.has("customers_crm"));
});

test("إزالة التطبيق تقفل كل شيء", async () => {
  await db.grantFeature(MERCHANT, "order_followups", {});
  await subs.handleSubscriptionEvent({ event: "app.uninstalled", merchant: MERCHANT, data: {} });
  const open = await subs.activeFeatures(MERCHANT);
  assert.ok(!open.has("order_followups"));
});

test("الإضافة المجهولة تُحفظ للتشخيص بلا فتح أي ميزة", async () => {
  const result = await subs.handleSubscriptionEvent({
    event: "app.subscription.started",
    merchant: MERCHANT,
    data: { name: "إضافة-لم-نعرّفها", plan_name: "خطة غامضة" },
  });
  assert.equal(result.action, "unmatched");

  const raw = await db.lastSubscriptionPayload(MERCHANT);
  assert.match(raw, /إضافة-لم-نعرّفها/);

  const open = await subs.activeFeatures(MERCHANT);
  assert.ok(!open.has("__unmatched__"), "الصف التشخيصي لا يظهر كميزة");
});

test("التجديد بلا payload لا يمسح اسم الخطة المحفوظ", async () => {
  await db.grantFeature(OTHER, "invoices", { plan_label: "خطة الفواتير", raw: '{"a":1}' });
  await db.grantFeature(OTHER, "invoices", {});
  const rows = await db.listEntitlements(OTHER);
  const row = rows.find((r) => r.feature_key === "invoices");
  assert.equal(row.plan_label, "خطة الفواتير");
  assert.equal(row.raw, '{"a":1}');
});

test("حدث بلا معرّف متجر يُرفض بأمان", async () => {
  const result = await subs.handleSubscriptionEvent({ event: "app.subscription.started", data: {} });
  assert.equal(result.ok, false);
});

test("الأحداث غير المتعلقة بالاشتراك تُتجاهل", async () => {
  assert.equal(await subs.handleSubscriptionEvent({ event: "order.created", merchant: MERCHANT }), null);
});
