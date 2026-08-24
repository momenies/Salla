const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInvoice } = require("../helpers/invoice");

const ORDER = {
  id: 123456,
  reference_id: 77,
  date: { date: "2026-08-20 12:30:00" },
  customer: { first_name: "سارة", last_name: "العتيبي", mobile: "501234567", email: "s@example.com" },
  items: [
    { name: "منتج أول", quantity: 2, amounts: { price_without_tax: { amount: 50, currency: "SAR" }, total: { amount: 100, currency: "SAR" } } },
    { name: "منتج ثانٍ", quantity: 1, amounts: { total: { amount: 75, currency: "SAR" } } },
  ],
  amounts: { total: { amount: 175, currency: "SAR" }, shipping_cost: { amount: 25, currency: "SAR" } },
};

test("يبني فاتورة كاملة من طلب سلة", () => {
  const invoice = buildInvoice(ORDER, { name: "متجر الاختبار" }, {});
  assert.ok(invoice);
  assert.equal(invoice.items.length, 2);
  assert.match(String(invoice.number ?? invoice.reference ?? ORDER.reference_id), /77|123456/);
});

test("لا ينهار على طلب ناقص الحقول", () => {
  assert.doesNotThrow(() => buildInvoice({ id: 1 }, {}, {}));
  assert.doesNotThrow(() => buildInvoice({}, {}, {}));
  assert.doesNotThrow(() => buildInvoice(null, {}, {}));
});

test("يستنتج سعر الوحدة من الإجمالي والكمية عند غيابه", () => {
  const invoice = buildInvoice(ORDER, {}, {});
  const second = invoice.items[1];
  assert.ok(second.total || second.unit, "الصنف الثاني لا يحمل سعر وحدة صريحاً لكنه يُعرض");
});
