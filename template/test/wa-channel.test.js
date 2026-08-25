/**
 * كشف توفّر قناة الباركود.
 *
 * الخلل الذي تحرسه هذه الاختبارات: تحميل الحزمة كان كافياً لاعتبار القناة
 * متاحة. صورة الإنتاج تُبنى بلا Chromium، فكان `require` ينجح والدالة
 * تُرجع true — فيُعرض للتاجر خيار يفشل عند الضغط.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/** كل اختبار يحتاج نسخة نظيفة: الوحدة تخزّن نتيجة الفحص عمداً */
function freshModule(chromiumPath) {
  delete require.cache[require.resolve("../helpers/wa-wweb")];
  const previous = process.env.CHROMIUM_PATH;
  if (chromiumPath === undefined) delete process.env.CHROMIUM_PATH;
  else process.env.CHROMIUM_PATH = chromiumPath;
  const mod = require("../helpers/wa-wweb");
  return { mod, restore: () => { if (previous === undefined) delete process.env.CHROMIUM_PATH; else process.env.CHROMIUM_PATH = previous; } };
}

test("متصفّح موجود ⇦ القناة متاحة بلا سبب تعذّر", () => {
  const fake = path.join(os.tmpdir(), `fake-chromium-${process.pid}`);
  fs.writeFileSync(fake, "#!/bin/sh\n");
  const { mod, restore } = freshModule(fake);
  try {
    assert.equal(mod.isAvailable(), true);
    assert.equal(mod.unavailableReason(), null);
    assert.equal(mod.findBrowser(), fake);
  } finally {
    restore();
    fs.unlinkSync(fake);
  }
});

test("مسار متصفّح غير موجود ⇦ غير متاحة، بسبب عربي مفهوم", () => {
  const { mod, restore } = freshModule("/لا/يوجد/متصفّح");
  try {
    assert.equal(mod.isAvailable(), false);
    assert.match(mod.unavailableReason(), /متصفّح/);
    assert.equal(mod.findBrowser(), null);
  } finally {
    restore();
  }
});

test("الإرسال يُرفض برسالة مفهومة حين لا متصفّح — لا يتعطّل", async () => {
  const { mod, restore } = freshModule("/لا/يوجد/متصفّح");
  try {
    const result = await mod.sendMessage(1, "966501234567", "مرحباً");
    assert.equal(result.ok, false);
    assert.match(result.error, /متصفّح|Meta/);
  } finally {
    restore();
  }
});

test("الاتصال يعيد حالة unavailable بدل أن يرمي خطأً", async () => {
  const { mod, restore } = freshModule("/لا/يوجد/متصفّح");
  try {
    const state = await mod.connect(1);
    assert.equal(state.status, "unavailable");
    assert.match(state.error, /Meta/, "نوجّه التاجر إلى البديل العملي");
  } finally {
    restore();
  }
});
