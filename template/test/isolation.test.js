/**
 * عزل المتاجر — أهم اختبار في هذا المشروع.
 *
 * النسخة السابقة كانت تحتفظ بتوكن واحد على مستوى العملية، فكان التاجر
 * الثاني يرى بيانات الأول. هذه الاختبارات تمنع عودة ذلك بصمت.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { useTempDatabase } = require("./helpers");

const tmp = useTempDatabase("isolation");
const db = require("../helpers/salla-db");

const A = 700001;
const B = 700002;

test.before(async () => {
  await db.connect();
  await db.saveOauth({ user_id: 1, merchant: A, access_token: "token-A", refresh_token: "refresh-A", expires_in: 1209600 });
  await db.saveOauth({ user_id: 2, merchant: B, access_token: "token-B", refresh_token: "refresh-B", expires_in: 1209600 });
});
test.after(async () => { await db.close(); tmp.cleanup(); });

test("كل متجر يقرأ توكنه هو", async () => {
  const salla = require("../lib/salla");
  assert.equal(await salla.tokenFor(A), "token-A");
  assert.equal(await salla.tokenFor(B), "token-B");
  assert.equal(await salla.tokenFor(999999), null, "متجر غير مربوط لا يحصل على توكن غيره");
});

test("saveOauth يحسب لحظة الانتهاء لا المدة فقط", async () => {
  const row = await db.getOauthToken(A);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(row.expires_at > now, "لحظة الانتهاء محسوبة");
  assert.ok(row.expires_at <= now + 1209600 + 5);
  assert.equal(row.isFresh(), true);
});

test("إعادة الربط تحدّث الصف نفسه ولا تكرّره", async () => {
  await db.saveOauth({ user_id: 1, merchant: A, access_token: "token-A2", refresh_token: "refresh-A2", expires_in: 3600 });
  const models = await db.models();
  const count = await models.OauthTokens.count({ where: { merchant: A } });
  assert.equal(count, 1);
  assert.equal((await db.getOauthToken(A)).access_token, "token-A2");
});

test("السلات والرسائل مقيّدة بالمتجر", async () => {
  await db.saveAbandonedCart({ merchant: A, cart_id: 1, customer_name: "عميل أ", total_amount: 100, abandoned_at: 1 });
  await db.saveAbandonedCart({ merchant: B, cart_id: 2, customer_name: "عميل ب", total_amount: 200, abandoned_at: 1 });
  await db.insertMessage({ merchant: A, kind: "cart_reminder", customer_mobile: "966500000001", body: "رسالة أ" });
  await db.insertMessage({ merchant: B, kind: "cart_reminder", customer_mobile: "966500000002", body: "رسالة ب" });

  const cartsA = await db.listAbandonedCarts(A, {});
  assert.equal(cartsA.count, 1);
  assert.equal(cartsA.rows[0].customer_name, "عميل أ");

  const msgsB = await db.listMessages(B, {});
  assert.equal(msgsB.count, 1);
  assert.equal(msgsB.rows[0].body, "رسالة ب");
});

test("لا يستطيع متجر تعديل سلة متجر آخر", async () => {
  const result = await db.setAbandonedCartStatus(A, 2, "recovered");
  assert.equal(result, null, "سلة المتجر ب لا تُلمس بمعرّف المتجر أ");
  assert.equal((await db.getCart(B, 2)).status, "new");
});

test("لا يستطيع متجر إلغاء رسالة متجر آخر", async () => {
  const msgsB = await db.listMessages(B, {});
  const idOfB = msgsB.rows[0].id;
  assert.equal(await db.cancelMessage(A, idOfB), null);
  assert.equal(await db.retryMessage(A, idOfB), null);
});

test("لا يستطيع متجر حذف عميل متجر آخر", async () => {
  const created = await db.saveManualCustomer({ merchant: B, name: "عميل ب", mobile: "966500000009" });
  assert.equal(await db.deleteManualCustomer(A, created.id), 0);
  assert.equal((await db.listManualCustomers(B)).length, 1);
});

test("getAllMerchantIds يعيد المتاجر المربوطة فقط", async () => {
  const ids = (await db.getAllMerchantIds()).map(Number);
  assert.ok(ids.includes(A) && ids.includes(B));
  assert.equal(ids.length, 2);
});

test("purgeMerchant يمحو بيانات متجر واحد فقط", async () => {
  await db.purgeMerchant(A);
  assert.equal((await db.listAbandonedCarts(A, {})).count, 0);
  assert.equal((await db.listAbandonedCarts(B, {})).count, 1, "بيانات المتجر الآخر سليمة");
});
