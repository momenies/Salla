/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  الإحصاءات — ما يريد التاجر رؤيته أول ما يفتح اللوحة
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * السؤال الوحيد الذي يقرّر بقاء التاجر مشتركاً: «كم ريالاً أعاد لي التطبيق؟»
 * لذلك بطاقة الإيراد المستعاد أولاً، ثم ما يفسّرها: كم رسالة، وكم نسبة
 * الاستعادة، وأين التسريب.
 *
 * كل الأرقام تُحسب من قاعدتنا المحلية (لا نداء شبكة) فتظهر اللوحة فوراً.
 */
const db = require("../helpers/salla-db");
const cache = require("../lib/cache");

const DAY = 86400;

/** يوم بصيغة YYYY-MM-DD بتوقيت المتجر */
function dayKey(unixSeconds, timeZone = process.env.APP_TIMEZONE || "Asia/Riyadh") {
  const d = new Date(unixSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** أسماء الأيام السبعة الأخيرة بالعربية، من الأقدم للأحدث */
function lastDays(count = 7) {
  const out = [];
  const now = Math.floor(Date.now() / 1000);
  for (let i = count - 1; i >= 0; i--) {
    const ts = now - i * DAY;
    out.push({
      key: dayKey(ts),
      label: new Date(ts * 1000).toLocaleDateString("ar-SA-u-nu-latn", { weekday: "short" }),
      carts: 0,
      recovered: 0,
      messages: 0,
      amount: 0,
    });
  }
  return out;
}

/**
 * لوحة المؤشرات الكاملة لمتجر.
 * @param {number} merchantId
 * @param {{days?: number, ttl?: number}} options
 */
async function dashboard(merchantId, { days = 7, ttl = 30000 } = {}) {
  if (!merchantId) return empty(days);

  return cache.remember(`stats:${merchantId}:${days}`, ttl, async () => {
    const since = Math.floor(Date.now() / 1000) - days * DAY;

    // كلها مستقلة — نطلقها معاً بدل انتظار كل واحدة بدورها
    const [counts, amounts, carts, messages, msgStats, settings] = await Promise.all([
      db.cartStatusCounts(merchantId),
      db.cartAmountByStatus(merchantId),
      db.cartsSince(merchantId, since),
      db.messagesSince(merchantId, since),
      db.messageStats(merchantId),
      db.getMerchantSettings(merchantId),
    ]);

    const series = lastDays(days);
    const byDay = new Map(series.map((d) => [d.key, d]));

    for (const cart of carts) {
      const bucket = byDay.get(dayKey(cart.abandoned_at || 0));
      if (bucket) {
        bucket.carts++;
        bucket.amount += Number(cart.total_amount) || 0;
      }
      if (cart.recovered_at) {
        const recoveredBucket = byDay.get(dayKey(cart.recovered_at));
        if (recoveredBucket) recoveredBucket.recovered++;
      }
    }
    for (const msg of messages) {
      const bucket = byDay.get(dayKey(msg.created_at || 0));
      if (bucket) bucket.messages++;
    }

    const totalCarts = counts.new + counts.contacted + counts.recovered + counts.ignored;
    const handled = counts.contacted + counts.recovered;
    const recoveryRate = handled ? Math.round((counts.recovered / handled) * 100) : 0;

    // القيمة المهدورة = ما زال «جديداً» أو «تم التواصل» ولم يُستعد
    const pendingValue = (amounts.new || 0) + (amounts.contacted || 0);

    return {
      counts,
      totals: {
        carts: totalCarts,
        recovered: counts.recovered,
        recoveredAmount: amounts.recovered || 0,
        pendingValue,
        avgCart: totalCarts ? Math.round(((amounts.new || 0) + (amounts.contacted || 0) + (amounts.recovered || 0)) / totalCarts) : 0,
        recoveryRate,
      },
      messages: msgStats,
      series,
      /** أعلى قيمة في المنحنى — يحتاجها الرسم لضبط المقياس */
      peak: Math.max(1, ...series.map((d) => Math.max(d.carts, d.messages))),
      ready: Boolean(settings && settings.auto_enabled),
      updatedAt: Date.now(),
    };
  });
}

function empty(days = 7) {
  return {
    counts: { new: 0, contacted: 0, recovered: 0, ignored: 0 },
    totals: { carts: 0, recovered: 0, recoveredAmount: 0, pendingValue: 0, avgCart: 0, recoveryRate: 0 },
    messages: { pending: 0, sent: 0, failed: 0, cancelled: 0, sentToday: 0, sentTotal: 0 },
    series: lastDays(days),
    peak: 1,
    ready: false,
    updatedAt: Date.now(),
  };
}

/**
 * خطوات التهيئة — أول ما يراه التاجر الجديد.
 * منتج SaaS جيّد لا يترك المستخدم أمام لوحة فارغة يتساءل «وماذا الآن؟».
 */
async function onboarding(merchantId) {
  const [settings, scenarios, counts] = await Promise.all([
    db.getMerchantSettings(merchantId),
    db.getAutomations(merchantId),
    db.cartStatusCounts(merchantId),
  ]);

  const messaging = require("./messaging");
  const channelReady = Boolean(messaging.resolveChannel(settings));
  const anyScenario = scenarios.some((s) => s.enabled);
  const gotCarts = counts.new + counts.contacted + counts.recovered > 0;

  const steps = [
    {
      key: "connect",
      title: "اربط قناة واتساب",
      desc: "Meta الرسمية للإنتاج، أو الباركود للتجربة السريعة.",
      href: "/settings",
      cta: "افتح الإعدادات",
      done: channelReady,
    },
    {
      key: "template",
      title: "اكتب نص التذكير",
      desc: "عدّل الرسالة لتشبه صوت متجرك، وشاهد معاينتها مباشرة.",
      href: "/settings#template",
      cta: "تعديل النص",
      done: Boolean(settings && settings.msg_template && settings.msg_template.trim()),
    },
    {
      key: "enable",
      title: "فعّل الأتمتة",
      desc: "بعدها يعمل التطبيق وحده — حتى وأنت نائم.",
      href: "/automations",
      cta: "تفعيل",
      done: Boolean(settings && settings.auto_enabled) || anyScenario,
    },
    {
      key: "data",
      title: "وصلت أول سلة",
      desc: "سلة تخبرنا بكل سلة متروكة فور حدوثها.",
      href: "/abandoned",
      cta: "عرض السلات",
      done: gotCarts,
    },
  ];

  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    complete: steps.every((s) => s.done),
  };
}

module.exports = { dashboard, onboarding, dayKey, lastDays, empty };
