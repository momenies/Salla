/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  طبقة الإرسال — قناة واحدة في الأعلى، قناتان في الأسفل
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * بقية التطبيق تقول «أرسل هذا النص لهذا الرقم»، وهذا الملف يقرّر:
 * أي قناة (Meta الرسمية أم الباركود)، وهل الوقت مناسب، وهل تجاوزنا سقف اليوم.
 *
 * القواعد الثلاث ليست تجميلاً: الإرسال ليلاً يجلب شكاوى، وتجاوز السقف يجلب
 * حظراً لرقم التاجر — وكلاهما يُفقده ثقته بالتطبيق فوراً.
 */
const wa = require("../helpers/wa");
const wweb = require("../helpers/wa-wweb");
const db = require("../helpers/salla-db");
const log = require("../lib/logger");
const { normalizeMobile } = require("../lib/format");

const DEFAULT_DAILY_CAP = 200;

/** أي قناة مهيّأة فعلاً لهذا المتجر؟ */
function resolveChannel(settings) {
  if (!settings) return null;
  if (settings.channel === "wweb") return wweb.isAvailable() ? "wweb" : null;
  if (settings.wa_token && settings.wa_phone_id) return "cloud";
  return null;
}

/** شرح سبب تعذّر الإرسال — يظهر للتاجر في صفحة الأتمتة */
function channelProblem(settings) {
  if (!settings) return "لم تُضبط إعدادات الإرسال بعد.";
  if (settings.channel === "wweb" && !wweb.isAvailable()) {
    return "قناة الباركود غير متاحة على هذا الخادم — انتقل إلى قناة Meta الرسمية.";
  }
  if (settings.channel === "wweb") return "واتساب غير متصل — امسح الباركود من صفحة الإعدادات.";
  return "أكمل ربط Meta: أدخل معرّف الرقم ورمز الوصول في صفحة الإعدادات.";
}

/**
 * ساعات الهدوء بصيغة "22:00-08:00" (بتوقيت الرياض افتراضياً).
 * نقارن بالدقائق منذ منتصف الليل حتى تعمل الفترات التي تعبر منتصف الليل.
 */
function isQuietNow(settings, now = new Date()) {
  const raw = (settings && settings.quiet_hours) || "";
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return false;

  const [, h1, m1, h2, m2] = match.map(Number);
  const start = h1 * 60 + m1;
  const end = h2 * 60 + m2;
  const tz = process.env.APP_TIMEZONE || "Asia/Riyadh";
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const current = local.getHours() * 60 + local.getMinutes();

  return start <= end ? current >= start && current < end : current >= start || current < end;
}

/** متى تنتهي فترة الهدوء (طابع زمني بالثواني) — لإعادة جدولة الرسالة */
function quietUntil(settings, now = new Date()) {
  const raw = (settings && settings.quiet_hours) || "";
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const endHour = Number(match[3]);
  const endMin = Number(match[4]);
  const target = new Date(now);
  target.setHours(endHour, endMin, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.floor(target.getTime() / 1000);
}

/**
 * يرسل رسالة واحدة عبر القناة المناسبة.
 *
 * @param {object} params
 * @param {number} params.merchantId
 * @param {object} params.settings   صف MerchantSettings
 * @param {string} params.to         رقم الجوال (يُوحَّد داخلياً)
 * @param {string} params.text       النص الجاهز (قناة الباركود)
 * @param {string} params.templateName اسم قالب Meta
 * @param {string[]} params.params   متغيّرات القالب
 * @returns {Promise<{ok: boolean, channel?: string, id?: string, error?: string, retryable?: boolean}>}
 */
async function send({ merchantId, settings, to, text, templateName, params = [] }) {
  const channel = resolveChannel(settings);
  if (!channel) return { ok: false, error: channelProblem(settings), retryable: false };

  const mobile = normalizeMobile(to);
  if (!mobile) return { ok: false, error: "رقم الجوال غير صالح", retryable: false };

  if (channel === "cloud") {
    const result = await wa.sendTemplate(
      settings.wa_token,
      settings.wa_phone_id,
      mobile,
      templateName || settings.template_name || "cart_reminder",
      params
    );
    return { ...result, channel };
  }

  const result = await wweb.sendMessage(merchantId, mobile, text || "");
  return { ...result, channel };
}

/** هل بقي رصيد في سقف اليوم؟ */
async function withinDailyCap(merchantId, settings) {
  const cap = parseInt(settings?.daily_cap, 10) || DEFAULT_DAILY_CAP;
  if (cap <= 0) return { ok: true, cap: 0, used: 0 };
  const used = await db.sentTodayCount(merchantId);
  return { ok: used < cap, cap, used };
}

/**
 * فحص شامل قبل الإرسال — يعيد سبب المنع إن وُجد.
 * @returns {Promise<{allowed: boolean, reason?: string, retryAt?: number}>}
 */
async function guard(merchantId, settings) {
  if (isQuietNow(settings)) {
    return { allowed: false, reason: "ساعات هدوء — أُجّل الإرسال", retryAt: quietUntil(settings) };
  }
  const cap = await withinDailyCap(merchantId, settings);
  if (!cap.ok) {
    log.info("بلغ المتجر سقفه اليومي", { merchant: merchantId, cap: cap.cap });
    // نعيد المحاولة بعد ساعة — السقف يُحتسب على آخر ٢٤ ساعة منزلقة
    return { allowed: false, reason: `بلغت سقف ${cap.cap} رسالة يومياً`, retryAt: Math.floor(Date.now() / 1000) + 3600 };
  }
  return { allowed: true };
}

module.exports = {
  resolveChannel,
  channelProblem,
  isQuietNow,
  quietUntil,
  send,
  guard,
  withinDailyCap,
  DEFAULT_DAILY_CAP,
};
