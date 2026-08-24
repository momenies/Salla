const test = require("node:test");
const assert = require("node:assert/strict");
const format = require("../lib/format");

test("normalizeMobile يوحّد الصيغ السعودية الشائعة", () => {
  assert.equal(format.normalizeMobile("0501234567"), "966501234567");
  assert.equal(format.normalizeMobile("+966 50 123 4567"), "966501234567");
  assert.equal(format.normalizeMobile("00966501234567"), "966501234567");
  assert.equal(format.normalizeMobile("501234567"), "966501234567");
  assert.equal(format.normalizeMobile("966501234567"), "966501234567");
});

test("normalizeMobile يرفض ما ليس رقماً صالحاً", () => {
  assert.equal(format.normalizeMobile(""), "");
  assert.equal(format.normalizeMobile("123"), "");
  assert.equal(format.normalizeMobile(null), "");
  assert.equal(format.normalizeMobile("لا يوجد"), "");
});

test("normalizeMobile يحترم مفاتيح دول أخرى", () => {
  assert.equal(format.normalizeMobile("+201001234567"), "201001234567");
  assert.equal(format.normalizeMobile("0501234567", "971"), "971501234567");
});

test("timeAgo يستخدم صيغة الجمع العربية الصحيحة", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(format.timeAgo(now), "الآن");
  assert.equal(format.timeAgo(now - 60), "قبل دقيقة");
  assert.equal(format.timeAgo(now - 120), "قبل دقيقتين");
  assert.equal(format.timeAgo(now - 3600 * 2), "قبل ساعتين");
  assert.equal(format.timeAgo(now - 3600 * 5), "قبل 5 ساعات");
  assert.equal(format.timeAgo(0), "—");
});

test("money ينسّق بأرقام لاتينية ورمز الريال", () => {
  assert.match(format.money(1240.5), /1,240\.5/);
  assert.match(format.money(0), /ر\.س/);
});

test("toCsv يهرّب الفواصل وعلامات الاقتباس ويضيف BOM", () => {
  const csv = format.toCsv([{ a: 'قيمة, بفاصلة', b: 'فيها "اقتباس"' }], [
    { label: "أ", key: "a" },
    { label: "ب", key: "b" },
  ]);
  assert.ok(csv.startsWith("﻿"), "يبدأ بـ BOM ليفتحه Excel سليماً");
  assert.ok(csv.includes('"قيمة, بفاصلة"'));
  assert.ok(csv.includes('"فيها ""اقتباس"""'));
});

test("avatarColor ثابت لنفس المدخل", () => {
  assert.equal(format.avatarColor("أحمد"), format.avatarColor("أحمد"));
});
