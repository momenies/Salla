/** اختبارات دوال التنسيق — تُشغَّل بـ `npm test`. */
const test = require("node:test");
const assert = require("node:assert/strict");

const f = require("../lib/format");

test("money يعرض المبلغ مع رمز العملة", () => {
  assert.equal(f.money(1350.5, "SAR"), "1,350.50 ر.س");
  assert.equal(f.money(210, "SAR"), "210 ر.س");
  assert.equal(f.money(null), "—");
  assert.equal(f.money("غير رقم"), "—");
});

test("number يضيف فواصل الآلاف", () => {
  assert.equal(f.number(15000), "15,000");
  assert.equal(f.number(1.239, 2), "1.24");
  assert.equal(f.number(undefined), "—");
});

test("date يفهم صيغة سلة وكائن Date والقيم الفارغة", () => {
  assert.match(f.date({ date: "2026-08-19 10:22:31.000000" }), /2026/);
  assert.match(f.date("2026-08-19"), /2026/);
  assert.equal(f.date(null), "—");
  assert.equal(f.date("نص ليس تاريخاً"), "—");
});

test("count يطبّق قواعد الجمع العربية", () => {
  const args = ["طلب", "طلبان", "طلبات"];
  assert.equal(f.count(0, ...args), "لا طلبات");
  assert.equal(f.count(1, ...args), "طلب واحد");
  assert.equal(f.count(2, ...args), "طلبان");
  assert.equal(f.count(7, ...args), "7 طلبات");
  assert.equal(f.count(23, ...args), "23 طلب");
});

test("statusTone يربط حالة الطلب بلون الشارة", () => {
  assert.equal(f.statusTone("completed"), "success");
  assert.equal(f.statusTone("canceled"), "danger");
  assert.equal(f.statusTone("under_review"), "warning");
  assert.equal(f.statusTone("shipped"), "info");
  assert.equal(f.statusTone("حالة غير معروفة"), "");
});

test("subscriptionText يترجم كل الحالات ويعالج المجهولة", () => {
  assert.equal(f.subscriptionText("active"), "اشتراك فعّال");
  assert.equal(f.subscriptionText("canceled"), "ملغى");
  assert.equal(f.subscriptionText("لا شيء"), "بدون اشتراك");
});

test("toCsv يضيف BOM ويهرّب الفواصل والاقتباسات", () => {
  const csv = f.toCsv(
    ["الاسم", "المبلغ"],
    [["العتيبي, سارة", 350], ['قال "مرحباً"', 1], ["سطر\nجديد", 2]]
  );
  assert.ok(csv.startsWith("﻿"), "لا بد من BOM ليقرأ Excel العربية");
  assert.ok(csv.includes('"العتيبي, سارة"'), "الفاصلة الإنجليزية تفصل الأعمدة فيجب تغليفها");
  assert.ok(csv.includes('"قال ""مرحباً"""'));
  assert.ok(csv.includes('"سطر\nجديد"'));
  // الفاصلة العربية (،) ليست فاصل أعمدة، فلا داعي لتغليفها
  assert.ok(f.toCsv(["أ"], [["سارة، العتيبي"]]).includes("سارة، العتيبي,") === false);
  assert.ok(f.toCsv(["أ"], [["سارة، العتيبي"]]).includes('"') === false);
});

test("initial يرجّع أول حرف حتى مع الحروف متعدّدة البايت", () => {
  assert.equal(f.initial("محمد"), "م");
  assert.equal(f.initial(""), "؟");
  assert.equal(f.initial(null), "؟");
});
