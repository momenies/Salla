/**
 * دوال تنسيق تُسجَّل كفلاتر في nunjucks لتُستخدم داخل القوالب مباشرة.
 * الهدف: ألّا تحتوي القوالب على منطق، وأن تكون كل الأرقام والتواريخ موحّدة الشكل.
 */
const config = require("../config");

const AR_LOCALE = "ar-SA-u-nu-latn"; // أرقام لاتينية مع أسماء عربية للأشهر
const CURRENCY_LABELS = { SAR: "ر.س", USD: "$", AED: "د.إ", KWD: "د.ك", EGP: "ج.م", BHD: "د.ب", QAR: "ر.ق", OMR: "ر.ع" };

function toNumber(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** 1350.5 → "1,350.50" */
function number(value, decimals = 0) {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** يعرض مبلغاً مع رمز عملته */
function money(value, currency = config.ui.currency) {
  const n = toNumber(value);
  if (n === null) return "—";
  const symbol = CURRENCY_LABELS[currency] || currency || "";
  const decimals = Number.isInteger(n) ? 0 : 2;
  return `${number(n, decimals)} ${symbol}`.trim();
}

/** يقبل نص تاريخ، أو كائن سلة {date: "..."} ، أو Date */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = typeof value === "object" ? value.date || value.datetime || value.value : value;
  if (!raw) return null;
  // سلة ترسل "2026-08-19 10:22:31.000000" — نحوّلها لصيغة يفهمها JS
  const normalized = String(raw).replace(" ", "T").replace(/\.\d+$/, "");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function date(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(AR_LOCALE, { year: "numeric", month: "short", day: "numeric" });
}

function datetime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${date(d)} · ${d.toLocaleTimeString(AR_LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

/** "قبل ٣ ساعات" */
function fromNow(value) {
  const d = toDate(value);
  if (!d) return "—";
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  const units = [
    ["year", 31536000], ["month", 2592000], ["week", 604800],
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return rtf.format(-Math.round(seconds / secondsInUnit), unit);
    }
  }
  return rtf.format(-seconds, "second");
}

/** جمع عربي صحيح: 1 طلب / 2 طلبان / 3-10 طلبات / 11+ طلباً */
function count(n, singular, dual, plural) {
  const value = toNumber(n) || 0;
  if (value === 0) return `لا ${plural}`;
  if (value === 1) return `${singular} واحد`;
  if (value === 2) return dual;
  if (value <= 10) return `${number(value)} ${plural}`;
  return `${number(value)} ${singular}`;
}

/** أول حرف من الاسم للصورة الرمزية */
function initial(name) {
  const text = String(name || "").trim();
  return text ? Array.from(text)[0] : "؟";
}

/** يصنّف حالة الطلب إلى لون شارة */
function statusTone(slug) {
  const key = String(slug || "").toLowerCase();
  if (["completed", "delivered", "payment_paid", "paid"].includes(key)) return "success";
  if (["canceled", "cancelled", "refunded", "failed", "expired"].includes(key)) return "danger";
  if (["under_review", "payment_pending", "pending", "restoring", "restored", "trial"].includes(key)) return "warning";
  if (["in_progress", "shipped", "delivering", "processing", "active"].includes(key)) return "info";
  return "";
}

/** حالة الاشتراك بالعربية + لون شارتها */
const SUBSCRIPTION_LABELS = {
  none: { text: "بدون اشتراك", tone: "" },
  trial: { text: "فترة تجريبية", tone: "warning" },
  active: { text: "اشتراك فعّال", tone: "success" },
  expired: { text: "منتهي", tone: "danger" },
  canceled: { text: "ملغى", tone: "danger" },
};

function subscriptionLabel(status) {
  return SUBSCRIPTION_LABELS[status] || SUBSCRIPTION_LABELS.none;
}

/** النص العربي وحده — مفيد داخل جملة */
function subscriptionText(status) {
  return subscriptionLabel(status).text;
}

/** يقصّ نصاً طويلاً مع "…" */
function shorten(value, length = 60) {
  const text = String(value ?? "");
  return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

/** يحوّل صفوفاً إلى CSV يفتحه Excel بالعربية بشكل صحيح (BOM + فاصلة) */
function toCsv(headers, rows) {
  const escape = (cell) => {
    const text = cell === null || cell === undefined ? "" : String(cell);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return "﻿" + lines.join("\r\n");
}

/** يسجّل كل الفلاتر على بيئة nunjucks */
function registerFilters(env) {
  env.addFilter("number", number);
  env.addFilter("money", money);
  env.addFilter("date", date);
  env.addFilter("datetime", datetime);
  env.addFilter("fromNow", fromNow);
  env.addFilter("count", count);
  env.addFilter("initial", initial);
  env.addFilter("statusTone", statusTone);
  env.addFilter("shorten", shorten);
  env.addFilter("subscriptionText", subscriptionText);
  env.addFilter("subscriptionTone", (status) => subscriptionLabel(status).tone);
  return env;
}

module.exports = {
  number, money, date, datetime, fromNow, count, initial,
  statusTone, shorten, toCsv, toDate, registerFilters,
  subscriptionLabel, subscriptionText, SUBSCRIPTION_LABELS,
};
