const test = require("node:test");
const assert = require("node:assert/strict");
const cache = require("../lib/cache");

test.beforeEach(() => cache.invalidate());

test("يخزّن ويُرجع القيمة خلال المهلة", async () => {
  let calls = 0;
  const produce = async () => { calls++; return "قيمة"; };

  assert.equal(await cache.remember("k1", 1000, produce), "قيمة");
  assert.equal(await cache.remember("k1", 1000, produce), "قيمة");
  assert.equal(calls, 1, "النداء الثاني جاء من الذاكرة");
});

test("ينتهي التخزين بانتهاء المهلة", async () => {
  let calls = 0;
  const produce = async () => { calls++; return calls; };
  await cache.remember("k2", 20, produce);
  await new Promise((r) => setTimeout(r, 40));
  await cache.remember("k2", 20, produce);
  assert.equal(calls, 2);
});

test("الطلبات المتزامنة تشترك في نداء واحد (منع الانهيار الجماعي)", async () => {
  let calls = 0;
  const slow = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return "نتيجة";
  };
  const results = await Promise.all([
    cache.remember("k3", 1000, slow),
    cache.remember("k3", 1000, slow),
    cache.remember("k3", 1000, slow),
  ]);
  assert.deepEqual(results, ["نتيجة", "نتيجة", "نتيجة"]);
  assert.equal(calls, 1, "نداء واحد فقط رغم ثلاثة طلبات متزامنة");
});

test("لا يخزّن القيم الفارغة حتى لا يثبّت فشلاً مؤقتاً", async () => {
  let calls = 0;
  const failing = async () => { calls++; return null; };
  await cache.remember("k4", 1000, failing);
  await cache.remember("k4", 1000, failing);
  assert.equal(calls, 2);
});

test("الإبطال بالبادئة يمسح مفاتيح متجر واحد فقط", () => {
  cache.set("salla:1:orders", "أ", 5000);
  cache.set("salla:1:customers", "ب", 5000);
  cache.set("salla:2:orders", "ج", 5000);

  cache.invalidate("salla:1:");
  assert.equal(cache.get("salla:1:orders"), undefined);
  assert.equal(cache.get("salla:1:customers"), undefined);
  assert.equal(cache.get("salla:2:orders"), "ج", "متجر آخر لم يتأثر");
});
