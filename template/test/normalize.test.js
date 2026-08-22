/** اختبارات توحيد شكل بيانات سلة. */
const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeUser, merchantIdOf, normalizePagination } = require("../lib/normalize");

test("normalizeUser يقبل merchant أو store", () => {
  const a = normalizeUser({ id: 1, name: "محمد", merchant: { id: 99, name: "متجري" } });
  const b = normalizeUser({ id: 1, name: "محمد", store: { id: 99, name: "متجري" } });
  assert.equal(a.store.id, 99);
  assert.equal(b.store.id, 99);
  assert.equal(a.store.name, "متجري");
});

test("normalizeUser لا ينهار على مدخل فارغ", () => {
  assert.equal(normalizeUser(null), null);
  assert.equal(normalizeUser({}).store, null);
});

test("merchantIdOf يجد المعرّف مهما كان شكل الرد", () => {
  assert.equal(merchantIdOf({ merchant: { id: 5 } }), 5);
  assert.equal(merchantIdOf({ store: { id: 6 } }), 6);
  assert.equal(merchantIdOf({ merchant: 7 }), 7);
  assert.equal(merchantIdOf({}), null);
});

test("normalizePagination يوحّد أسماء الحقول المختلفة", () => {
  const a = normalizePagination({ currentPage: 2, totalPages: 5, total: 73 }, { page: 2, perPage: 15 });
  assert.deepEqual(
    { page: a.page, totalPages: a.totalPages, hasPrev: a.hasPrev, hasNext: a.hasNext },
    { page: 2, totalPages: 5, hasPrev: true, hasNext: true }
  );

  const b = normalizePagination({ current_page: 5, total_pages: 5 }, { page: 5, perPage: 15 });
  assert.equal(b.hasNext, false);
});

test("normalizePagination يستنتج آخر صفحة عند غياب البيانات", () => {
  // صفحة ناقصة العناصر تعني أنها الأخيرة
  const last = normalizePagination(null, { page: 3, perPage: 15, itemsOnPage: 4 });
  assert.equal(last.hasNext, false);

  // صفحة ممتلئة تعني أن هناك المزيد
  const more = normalizePagination(null, { page: 3, perPage: 15, itemsOnPage: 15 });
  assert.equal(more.hasNext, true);
});
