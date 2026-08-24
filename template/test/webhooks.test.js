const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const webhooks = require("../lib/webhooks");

const SECRET = "super-secret-value";
const body = JSON.stringify({ event: "order.created", merchant: 42, data: { id: 7 } });

test("يقبل التوقيع الصحيح (HMAC-SHA256)", () => {
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const result = webhooks.verify({ headers: { "x-salla-signature": signature }, rawBody: body, secret: SECRET });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, "signature");
});

test("يرفض التوقيع المزوّر", () => {
  const result = webhooks.verify({
    headers: { "x-salla-signature": crypto.createHmac("sha256", "wrong").update(body).digest("hex") },
    rawBody: body,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad-signature");
});

test("يرفض التوقيع إن تغيّر الجسم بحرف واحد", () => {
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const tampered = body.replace('"merchant":42', '"merchant":43');
  const result = webhooks.verify({ headers: { "x-salla-signature": signature }, rawBody: tampered, secret: SECRET });
  assert.equal(result.ok, false);
});

test("يقبل استراتيجية التوكن بصيغتيها", () => {
  assert.equal(webhooks.verify({ headers: { authorization: SECRET }, rawBody: body, secret: SECRET }).ok, true);
  assert.equal(webhooks.verify({ headers: { authorization: `Bearer ${SECRET}` }, rawBody: body, secret: SECRET }).ok, true);
});

test("يرفض كل شيء إن لم يُضبط السرّ", () => {
  const result = webhooks.verify({ headers: { authorization: "anything" }, rawBody: body, secret: "" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-secret");
});

test("safeEqual لا ينهار على أطوال مختلفة", () => {
  assert.equal(webhooks.safeEqual("abc", "abcdef"), false);
  assert.equal(webhooks.safeEqual("abc", "abc"), true);
  assert.equal(webhooks.safeEqual(undefined, "abc"), false);
});

test("يمنع الخروج من مجلد Actions عبر اسم حدث ملفّق", () => {
  assert.equal(webhooks.actionPathFor("../../etc/passwd"), null);
  assert.equal(webhooks.actionPathFor("order/../../secret.evil"), null);
  assert.equal(webhooks.actionPathFor("order"), null);

  const legit = webhooks.actionPathFor("order.status.updated");
  assert.ok(legit.startsWith(webhooks.ACTIONS_DIR));
  assert.equal(path.basename(legit), "status.updated.js");
});

test("يكتشف الحدث المكرّر ويسمح بالجديد", () => {
  webhooks._reset();
  const event = { event: "order.created", merchant: 1, data: { id: 5 }, created_at: "x" };
  assert.equal(webhooks.isDuplicate(event), false);
  assert.equal(webhooks.isDuplicate(event), true);
  assert.equal(webhooks.isDuplicate({ ...event, data: { id: 6 } }), false);
});

test("dispatch ينتظر المعالجات غير المتزامنة ولا يبتلع أخطاءها", async () => {
  webhooks._reset();
  const seen = [];
  webhooks.on("all", async () => { seen.push("all"); });
  webhooks.on("test.event", async () => {
    await new Promise((r) => setTimeout(r, 5));
    seen.push("specific");
  });
  webhooks.on("test.event", () => { throw new Error("معالج فاشل"); });

  const result = await webhooks.dispatch({ event: "test.event" });
  assert.deepEqual(seen, ["all", "specific"]);
  assert.equal(result.handled, 2, "المعالج الفاشل لا يُحتسب لكنه لا يوقف البقية");
});
