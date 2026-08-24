/**
 * دوال عرض مشتركة — نص عربي طبيعي بدل أرقام خام.
 * موضوعة في ملف واحد لأن نفس المنطق كان مكرّراً في ثلاث صفحات بثلاث نسخ.
 */

/**
 * صيغة الجمع العربية الصحيحة: "دقيقة واحدة"، "دقيقتان"، "٥ دقائق".
 * الترجمة الحرفية ("قبل 2 ساعة") تبدو ركيكة، وهذه أول ما يقرأه التاجر.
 */
function plural(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** "قبل ٣ ساعات" من طابع زمني بالثواني */
function timeAgo(unixSeconds) {
  if (!unixSeconds) return "—";
  const mins = Math.floor(Math.max(0, Date.now() / 1000 - unixSeconds) / 60);
  if (mins < 1) return "الآن";
  if (mins < 60) return "قبل " + plural(mins, "دقيقة", "دقيقتين", "دقائق", "دقيقة");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "قبل " + plural(hours, "ساعة", "ساعتين", "ساعات", "ساعة");
  const days = Math.floor(hours / 24);
  if (days < 30) return "قبل " + plural(days, "يوم", "يومين", "أيام", "يوماً");
  const months = Math.floor(days / 30);
  if (months < 12) return "قبل " + plural(months, "شهر", "شهرين", "أشهر", "شهراً");
  return "قبل " + plural(Math.floor(months / 12), "سنة", "سنتين", "سنوات", "سنة");
}

/** مبلغ بصيغة سعودية مقروءة */
function money(amount, currency = "SAR") {
  const value = Number(amount) || 0;
  const label = currency === "SAR" || !currency ? "ر.س" : currency;
  // أرقام لاتينية عمداً: التجار يقرأون المبالغ بها أسرع، وهي أوضح في الجداول
  return `${value.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${label}`;
}

/**
 * توحيد رقم الجوال إلى صيغة دولية بلا رموز.
 * يعالج الحالات الشائعة في السعودية: 05xxxxxxxx و 5xxxxxxxx و +9665xxxxxxxx.
 * @returns {string} أرقام فقط، أو "" إن كان الرقم غير صالح
 */
function normalizeMobile(raw, countryCode = "966") {
  let digits = String(raw || "").replace(/[^0-9+]/g, "");
  if (!digits) return "";
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/\+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const cc = String(countryCode || "966").replace(/[^0-9]/g, "") || "966";

  if (!hadPlus) {
    if (digits.startsWith("0")) digits = cc + digits.slice(1);
    else if (digits.length <= 9 && !digits.startsWith(cc)) digits = cc + digits;
  }
  // رقم سعودي صالح: 966 + 9 أرقام تبدأ بـ 5
  if (digits.length < 10 || digits.length > 15) return "";
  return digits;
}

/** أول حرف للاسم في الدوائر الرمزية */
function initial(name) {
  const s = String(name || "").trim();
  return s ? s[0] : "؟";
}

/** لون ثابت مشتق من النص — نفس العميل يأخذ نفس اللون دائماً */
const AVATAR_COLORS = [
  "linear-gradient(135deg,#34d399,#059669)",
  "linear-gradient(135deg,#60a5fa,#2563eb)",
  "linear-gradient(135deg,#fbbf24,#d97706)",
  "linear-gradient(135deg,#f472b6,#db2777)",
  "linear-gradient(135deg,#a78bfa,#7c3aed)",
  "linear-gradient(135deg,#22d3ee,#0891b2)",
];
function avatarColor(seed) {
  const s = String(seed || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** تاريخ ميلادي عربي قصير */
function shortDate(value) {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });
}

/** يقصّ النص الطويل مع نقاط، للجداول */
function truncate(text, max = 60) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** يحوّل مصفوفة كائنات إلى CSV مع BOM حتى يفتحه Excel العربي سليماً */
function toCsv(rows, columns) {
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => escape(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escape(typeof c.value === "function" ? c.value(row) : row[c.key])).join(","))
    .join("\n");
  return "﻿" + head + "\n" + body;
}

module.exports = { plural, timeAgo, money, normalizeMobile, initial, avatarColor, shortDate, truncate, toCsv };
