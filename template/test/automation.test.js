/**
 * اختبارات محرّك الأتمتة: مطابقة القواعد، الشروط، التأخير، والإرسال مع إعادة المحاولة.
 * قناة الاختبار حقيقية (خادم HTTP محلي) لا كائن وهمي.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const DB = path.join(os.tmpdir(), `salla-automation-${process.pid}.sqlite`);

// خادم يستقبل ما ترسله قناة الويبهوك، ويتحكّم فيه الاختبار
const received = [];
let failTimes = 0;
let receiver;
let receiverUrl;

process.env.DATABASE_STORAGE = DB;
process.env.SALLA_DATABASE_ORM = "Sequelize";
process.env.AUTOMATION_ENABLED = "true";
process.env.AUTOMATION_MAX_ATTEMPTS = "3";

let connection;
let automation;
let stores;

test.before(async () => {
  await new Promise((resolve) => {
    receiver = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (failTimes > 0) {
          failTimes--;
          res.statusCode = 500;
          return res.end("boom");
        }
        received.push(JSON.parse(raw || "{}"));
        res.statusCode = 200;
        res.end("ok");
      });
    });
    receiver.listen(0, () => {
      receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
      resolve();
    });
  });

  process.env.AUTOMATION_WEBHOOK_URL = receiverUrl;

  connection = await require("../database")("Sequelize").connect();
  stores = require("../services/stores")(connection);
  automation = require("../services/automation")(connection);
});

test.after(async () => {
  if (connection) await connection.close();
  if (receiver) await new Promise((r) => receiver.close(r));
  fs.rmSync(DB, { force: true });
});

const MERCHANT = 5150;
const STORE = { name: "متجر النخبة", domain: "https://alnokhba.salla.sa" };

function orderEvent(overrides = {}) {
  return {
    event: "order.created",
    merchant: MERCHANT,
    data: {
      id: 90001,
      reference_id: 40001,
      total: { amount: 350, currency: "SAR" },
      status: { slug: "under_review", name: "بانتظار المراجعة" },
      items: [{ name: "قميص قطن", quantity: 2 }],
      customer: { first_name: "سارة", last_name: "العتيبي", mobile: "0555555555" },
      ...overrides,
    },
  };
}

test("القاعدة المفعّلة تنتج رسالة في صندوق الصادر بنص مُستبدَل", async () => {
  await automation.createRule(MERCHANT, {
    name: "تأكيد الطلب",
    event: "order.created",
    channel: "dry-run",
    template: "أهلاً {customer_name}، طلبك {order_id} بقيمة {order_total} {order_currency} من {store_name}.",
  });

  const results = await automation.handleEvent(orderEvent(), STORE);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "queued");

  const outbox = await automation.listOutbox({ storeId: MERCHANT });
  assert.equal(outbox.total, 1);
  assert.equal(
    outbox.rows[0].body,
    "أهلاً سارة العتيبي، طلبك 40001 بقيمة 350 SAR من متجر النخبة."
  );
  assert.equal(outbox.rows[0].recipient, "0555555555");
});

test("القاعدة الموقوفة لا تعمل", async () => {
  const rule = await automation.createRule(MERCHANT, {
    name: "موقوفة", event: "customer.created", channel: "dry-run", template: "أهلاً {customer_name}", enabled: false,
  });
  const results = await automation.handleEvent(
    { event: "customer.created", merchant: MERCHANT, data: { first_name: "خالد", mobile: "0500000000" } },
    STORE
  );
  assert.equal(results.length, 0);
  await rule.destroy();
});

test("قاعدة متجر آخر لا تتأثّر بأحداث هذا المتجر", async () => {
  await automation.createRule(9999, { name: "متجر آخر", event: "order.created", channel: "dry-run", template: "x" });
  const results = await automation.handleEvent(orderEvent(), STORE);
  // قاعدة هذا المتجر فقط
  assert.equal(results.length, 1);
});

test("الشرط يمنع الإرسال عندما لا يتحقّق ويسمح عندما يتحقّق", async () => {
  const rule = await automation.createRule(MERCHANT, {
    name: "عند التنفيذ فقط",
    event: "order.status.updated",
    channel: "dry-run",
    template: "طلبك {order_id}: {order_status}",
    conditions: JSON.stringify({ field: "order_status", equals: "تم التنفيذ" }),
  });

  const notMatching = await automation.handleEvent(
    { ...orderEvent(), event: "order.status.updated" },
    STORE
  );
  assert.equal(notMatching[0].status, "skipped");

  const matching = await automation.handleEvent(
    { event: "order.status.updated", merchant: MERCHANT,
      data: { ...orderEvent().data, status: { slug: "completed", name: "تم التنفيذ" } } },
    STORE
  );
  assert.equal(matching[0].status, "queued");

  await rule.destroy();
});

test("التأخير يجدول الرسالة في المستقبل فلا تُرسل الآن", async () => {
  const rule = await automation.createRule(MERCHANT, {
    name: "سلة متروكة", event: "abandoned.cart", channel: "dry-run",
    template: "سلتك بانتظارك يا {customer_name}", delay_minutes: 60,
  });

  await automation.handleEvent(
    { event: "abandoned.cart", merchant: MERCHANT,
      data: { customer: { first_name: "نورة", mobile: "0544444444" }, total: { amount: 210, currency: "SAR" } } },
    STORE
  );

  const pending = await automation.listOutbox({ storeId: MERCHANT, status: "pending" });
  const delayed = pending.rows.find((m) => m.event === "abandoned.cart");
  assert.ok(delayed.scheduled_at.getTime() > Date.now() + 55 * 60 * 1000, "لا بد أن تُجدول بعد ساعة");

  // نتحقّق من هذه الرسالة تحديداً، لا من العدّاد العام (رسائل أخرى قد تُرسل في نفس الدورة)
  await automation.dispatch();
  await delayed.reload();
  assert.equal(delayed.status, "pending", "الرسالة المؤجّلة لا تُرسل قبل موعدها");
  assert.equal(delayed.attempts, 0, "ولا تُحتسب لها محاولة");

  await rule.destroy();
});

test("قناة تحتاج مستلماً تُخطّى بوضوح عند غياب الجوال", async () => {
  const rule = await automation.createRule(MERCHANT, {
    name: "بلا جوال", event: "customer.created", channel: "whatsapp", template: "أهلاً {customer_name}",
  });

  const results = await automation.handleEvent(
    { event: "customer.created", merchant: MERCHANT, data: { first_name: "بدون", mobile: "" } },
    STORE
  );
  assert.equal(results[0].status, "skipped");

  const skipped = await automation.listOutbox({ storeId: MERCHANT, status: "skipped" });
  assert.ok(skipped.total >= 1);
  assert.match(skipped.rows[0].last_error, /رقم جوال/);

  await rule.destroy();
});

test("الإرسال الفعلي عبر قناة الويبهوك يصل بالمحتوى الصحيح", async () => {
  received.length = 0;
  const rule = await automation.createRule(MERCHANT, {
    name: "ربط خارجي", event: "order.refunded", channel: "webhook",
    template: "تم استرجاع مبلغ الطلب {order_id}",
  });

  await automation.handleEvent({ ...orderEvent(), event: "order.refunded" }, STORE);
  const summary = await automation.dispatch();

  assert.ok(summary.sent >= 1);
  const payload = received.find((r) => r.event === "order.refunded");
  assert.ok(payload, "لا بد أن يصل الطلب إلى الخادم المستقبِل");
  assert.equal(payload.message, "تم استرجاع مبلغ الطلب 40001");
  assert.equal(payload.recipient, "0555555555");
  assert.equal(payload.variables.store_name, "متجر النخبة");

  await rule.destroy();
});

test("الفشل يعيد المحاولة ثم يستسلم بعد الحد الأقصى", async () => {
  received.length = 0;
  const rule = await automation.createRule(MERCHANT, {
    name: "قناة تفشل", event: "product.quantity.low", channel: "webhook", template: "نفدت {product_name}",
  });

  failTimes = 99; // كل المحاولات ستفشل
  await automation.handleEvent(
    { event: "product.quantity.low", merchant: MERCHANT, data: { name: "عطر", quantity: 1 } },
    STORE
  );

  const findMsg = async () => {
    const all = await automation.listOutbox({ storeId: MERCHANT, perPage: 100 });
    return all.rows.find((m) => m.event === "product.quantity.low");
  };

  await automation.dispatch();
  let msg = await findMsg();
  assert.equal(msg.status, "pending", "بعد الفشل الأول تبقى للمحاولة");
  assert.equal(msg.attempts, 1);
  assert.match(msg.last_error, /500/);

  // نُقدّم الموعد يدوياً لتجاوز التراجع الأُسّي
  for (let i = 0; i < 3; i++) {
    msg = await findMsg();
    if (msg.status !== "pending") break;
    await msg.update({ scheduled_at: new Date(Date.now() - 1000) });
    await automation.dispatch();
  }

  msg = await findMsg();
  assert.equal(msg.status, "failed");
  assert.equal(msg.attempts, 3, "يتوقّف عند AUTOMATION_MAX_ATTEMPTS");

  failTimes = 0;
  await rule.destroy();
});

test("إعادة المحاولة يدوياً تُصفّر العداد وترسل بنجاح", async () => {
  received.length = 0;
  const all = await automation.listOutbox({ storeId: MERCHANT, status: "failed" });
  const failed = all.rows[0];
  assert.ok(failed, "لدينا رسالة فاشلة من الاختبار السابق");

  await automation.retryMessage(MERCHANT, failed.id);
  const summary = await automation.dispatch();

  assert.ok(summary.sent >= 1);
  await failed.reload();
  assert.equal(failed.status, "sent");
  assert.equal(failed.attempts, 1);
});

test("حدث بلا مُشغّل معروف يُتجاهل بهدوء", async () => {
  const results = await automation.handleEvent({ event: "brand.created", merchant: MERCHANT, data: {} }, STORE);
  assert.deepEqual(results, []);
});

test("الإرسال التجريبي يعمل دون حدث حقيقي", async () => {
  received.length = 0;
  const rule = await automation.createRule(MERCHANT, {
    name: "تجربة", event: "order.created", channel: "webhook", template: "مرحباً {customer_name}",
  });

  const { sampleEventFor } = require("../routes/automation");
  await automation.sendTest(rule, STORE, sampleEventFor("order.created", MERCHANT));
  await automation.dispatch();

  assert.ok(received.some((r) => r.message === "مرحباً سارة العتيبي"));
  await rule.destroy();
});
