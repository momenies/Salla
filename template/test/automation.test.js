const test = require("node:test");
const assert = require("node:assert/strict");
const { useTempDatabase, seedMerchant } = require("./helpers");

const tmp = useTempDatabase("automation");
const db = require("../helpers/salla-db");
const automation = require("../services/automation");
const messaging = require("../services/messaging");

const MERCHANT = 999001;

test.before(async () => {
  await seedMerchant(db, MERCHANT);
});
test.after(async () => {
  await db.close();
  tmp.cleanup();
});

test("renderTemplate يستبدل كل المتغيّرات", () => {
  const out = automation.renderTemplate("مرحباً [الاسم] من [المتجر]، طلبك #[رقم الطلب] بقيمة [المبلغ] — [الرابط]", {
    name: "أحمد", store: "متجري", order: 55, amount: "240", url: "https://x.co",
  });
  assert.equal(out, "مرحباً أحمد من متجري، طلبك #55 بقيمة 240 — https://x.co");
});

test("renderTemplate يترك الفراغ نظيفاً عند نقص القيم", () => {
  const out = automation.renderTemplate("مرحباً [الاسم]", {});
  assert.equal(out, "مرحباً");
});

test("لا تُجدول رسالة لسيناريو غير مفعّل", async () => {
  const scheduled = await automation.schedule(MERCHANT, "order_thanks", {
    orderId: 1, name: "أحمد", mobile: "0501234567",
  });
  assert.equal(scheduled, false);
  const { count } = await db.listMessages(MERCHANT, {});
  assert.equal(count, 0);
});

test("تُجدول الرسالة بعد التفعيل، ولا تتكرّر لنفس الطلب", async () => {
  await db.saveAutomation(MERCHANT, "order_thanks", { enabled: true, delay_minutes: 0 });

  assert.equal(await automation.schedule(MERCHANT, "order_thanks", { orderId: 2, name: "سارة", mobile: "0501234567" }), true);
  assert.equal(await automation.schedule(MERCHANT, "order_thanks", { orderId: 2, name: "سارة", mobile: "0501234567" }), false,
    "نفس الطلب مرتين = رسالة واحدة");

  const { rows } = await db.listMessages(MERCHANT, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_mobile, "966501234567", "الرقم يُوحَّد قبل الحفظ");
  assert.match(rows[0].body, /سارة/);
});

test("لا تُجدول رسالة بلا رقم جوال صالح", async () => {
  assert.equal(await automation.schedule(MERCHANT, "order_thanks", { orderId: 3, name: "بلا رقم", mobile: "" }), false);
  assert.equal(await automation.schedule(MERCHANT, "order_thanks", { orderId: 4, name: "رقم خاطئ", mobile: "12" }), false);
});

test("إلغاء الطلب يلغي رسائله المعلّقة", async () => {
  await automation.handleOrderStatusUpdated({
    merchant: MERCHANT,
    data: { id: 2, status: { slug: "canceled" }, customer: { first_name: "سارة", mobile: "0501234567" } },
  });
  const { rows } = await db.listMessages(MERCHANT, { status: "cancelled" });
  assert.equal(rows.length, 1);
});

test("الطلب المدفوع عند الاستلام يختار سيناريو التأكيد", async () => {
  await db.saveAutomation(MERCHANT, "cod_confirm", { enabled: true, delay_minutes: 0 });
  await automation.handleOrderCreated({
    merchant: MERCHANT,
    data: { id: 77, payment_method: "cod", customer: { first_name: "خالد", mobile: "0555555555" } },
  });
  const { rows } = await db.listMessages(MERCHANT, {});
  assert.ok(rows.some((r) => r.kind === "cod_confirm" && r.order_id === 77));
});

test("تسليم الطلب يجدول طلب التقييم", async () => {
  await db.saveAutomation(MERCHANT, "review_request", { enabled: true, delay_minutes: 10 });
  await automation.handleOrderStatusUpdated({
    merchant: MERCHANT,
    data: { id: 88, status: "delivered", customer: { first_name: "منى", mobile: "0533333333" } },
  });
  const { rows } = await db.listMessages(MERCHANT, {});
  const review = rows.find((r) => r.kind === "review_request");
  assert.ok(review, "جُدول طلب التقييم");
  assert.ok(review.scheduled_at > Math.floor(Date.now() / 1000) + 500, "مؤجَّل عشر دقائق لا فوري");
});

test("تذكير السلات يجدول للمستحقّ فقط ويعلّم السلة", async () => {
  const now = Math.floor(Date.now() / 1000);
  await db.saveAbandonedCart({
    merchant: MERCHANT, cart_id: 5001, customer_name: "عميل قديم", customer_mobile: "966501111111",
    total_amount: 300, checkout_url: "https://x.co/c/1", abandoned_at: now - 7200,
  });
  await db.saveAbandonedCart({
    merchant: MERCHANT, cart_id: 5002, customer_name: "عميل جديد", customer_mobile: "966502222222",
    total_amount: 150, checkout_url: "https://x.co/c/2", abandoned_at: now,
  });

  const result = await automation.scheduleCartReminders(MERCHANT);
  assert.equal(result.queued, 1, "السلة الحديثة لم تبلغ مهلة الساعة بعد");

  const old = await db.getCart(MERCHANT, 5001);
  assert.equal(old.status, "contacted");
  const fresh = await db.getCart(MERCHANT, 5002);
  assert.equal(fresh.status, "new");
});

test("الأتمتة المعطّلة توقف جدولة السلات وتشرح السبب", async () => {
  await db.saveMerchantSettings(MERCHANT, { auto_enabled: false });
  const result = await automation.scheduleCartReminders(MERCHANT);
  assert.equal(result.queued, 0);
  assert.match(result.skipped, /غير مفعّلة/);
  await db.saveMerchantSettings(MERCHANT, { auto_enabled: true });
});

test("ساعات الهدوء تؤجّل ولا تُفشل", () => {
  const night = new Date("2026-08-23T23:30:00+03:00");
  const noon = new Date("2026-08-23T12:00:00+03:00");
  assert.equal(messaging.isQuietNow({ quiet_hours: "22:00-08:00" }, night), true);
  assert.equal(messaging.isQuietNow({ quiet_hours: "22:00-08:00" }, noon), false);
  assert.equal(messaging.isQuietNow({ quiet_hours: "" }, night), false);
  assert.equal(messaging.isQuietNow({ quiet_hours: "غير صالح" }, night), false);

  const until = messaging.quietUntil({ quiet_hours: "22:00-08:00" }, night);
  assert.ok(until > Math.floor(night.getTime() / 1000), "وقت الاستئناف في المستقبل");
});

test("القناة تُحلّ صحيحاً وتشرح نقصها", () => {
  assert.equal(messaging.resolveChannel({ channel: "cloud", wa_token: "t", wa_phone_id: "p" }), "cloud");
  assert.equal(messaging.resolveChannel({ channel: "cloud" }), null);
  assert.equal(messaging.resolveChannel(null), null);
  assert.match(messaging.channelProblem(null), /لم تُضبط/);
  assert.match(messaging.channelProblem({ channel: "cloud" }), /Meta/);
});

test("السقف اليومي يُحسب من الرسائل المُرسلة فعلاً", async () => {
  const settings = await db.getMerchantSettings(MERCHANT);
  const before = await messaging.withinDailyCap(MERCHANT, settings);
  assert.equal(before.ok, true);

  const zero = await messaging.withinDailyCap(MERCHANT, { daily_cap: 1 });
  assert.equal(typeof zero.used, "number");
});

test("عدّاد رسائل اليوم يبدأ من بداية اليوم لا من قبل ٢٤ ساعة", async () => {
  const now = Math.floor(Date.now() / 1000);
  const merchant = 999002;
  // رسالة أُرسلت قبل ٢٣ ساعة: داخل نافذة ٢٤ ساعة، لكنها غالباً «أمس»
  await db.insertMessage({
    merchant, kind: "cart_reminder", customer_mobile: "966500000001",
    body: "أمس", status: "sent", sent_at: now - 23 * 3600, created_at: now - 23 * 3600,
  });
  await db.insertMessage({
    merchant, kind: "cart_reminder", customer_mobile: "966500000002",
    body: "الآن", status: "sent", sent_at: now, created_at: now,
  });

  const count = await db.sentTodayCount(merchant);
  const hourNow = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour12: false, hour: "2-digit" }).format(new Date())
  );
  // الرسالة القديمة تُحتسب فقط إن كانت الساعة الآن بعد الـ٢٣ من اليوم نفسه
  assert.equal(count, hourNow >= 23 ? 2 : 1);
});
