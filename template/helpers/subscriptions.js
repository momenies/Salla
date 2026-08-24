/**
 * ترجمة أحداث الاشتراك القادمة من سلة إلى صلاحيات داخل التطبيق.
 *
 * سلة تحصّل المبلغ من التاجر، لكنها لا تعرف ما هي "الميزة" عندك — هذا الملف
 * هو الجسر: يقرأ الحدث، يستنتج أي إضافة اشتُريت، ويفتح الميزة المقابلة.
 *
 * مبدأ مهم: إن لم نتعرّف على الإضافة، **نحفظ نص الحدث كما هو** ولا نفتح شيئاً.
 * تشوفه بعدها في صفحة الباقات وتضبط `addonMatch` في config/features.js.
 * البديل (فتح كل شيء عند الشك) يعني خسارة مالية صامتة.
 */
const SallaDatabase = require("./salla-db");
const { matchFeatures, FEATURES, BUNDLE } = require("../config/features");
const env = require("../config/env");
const log = require("../lib/logger");

/**
 * هل وضع "افتح كل الميزات" مفعّل؟
 * يُتجاهل في الإنتاج مهما كانت قيمة المتغيّر.
 */
function unlockAllEnabled() {
  if (!env.unlockAll) return false;
  if (env.isProd) {
    if (!unlockAllEnabled._warned) {
      log.error("UNLOCK_ALL_FEATURES مفعّل لكن البيئة إنتاج — تم تجاهله. احذفه من متغيّرات البيئة.");
      unlockAllEnabled._warned = true;
    }
    return false;
  }
  return true;
}

/** الأحداث التي تفتح ميزة */
const GRANT_EVENTS = new Set([
  "app.subscription.started",
  "app.subscription.renewed",
  "app.trial.started",
]);

/** الأحداث التي تقفل ميزة */
const REVOKE_EVENTS = new Set([
  "app.subscription.expired",
  "app.subscription.canceled",
  "app.subscription.cancelled",
  "app.trial.expired",
  "app.uninstalled",
]);

function isSubscriptionEvent(eventName) {
  return GRANT_EVENTS.has(eventName) || REVOKE_EVENTS.has(eventName);
}

/** يقرأ تاريخ الانتهاء من أي حقل محتمل */
function readExpiry(data) {
  const candidates = [
    data?.end_date, data?.expiry_date, data?.expires_at, data?.ends_at,
    data?.subscription?.end_date, data?.plan?.end_date,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const d = new Date(String(value).replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** اسم الخطة كما يعرضه التاجر */
function readPlanLabel(data) {
  return (
    data?.plan_name || data?.plan?.name || data?.name ||
    data?.subscription?.plan_name || data?.addon?.name || null
  );
}

/**
 * المعالج الرئيسي. يُستدعى من /webhook لكل حدث وارد.
 *
 * @returns {Promise<object|null>} ملخّص لما جرى (للّوج والاختبار)، أو null
 *          إن لم يكن الحدث متعلّقاً بالاشتراكات.
 */
async function handleSubscriptionEvent(eventBody) {
  const eventName = eventBody?.event;
  const merchant = eventBody?.merchant;

  if (!eventName || !isSubscriptionEvent(eventName)) return null;
  if (!merchant) {
    log.warn(`اشتراك: حدث ${eventName} بلا معرّف متجر — تُجوهل.`);
    return { event: eventName, ok: false, reason: "لا يوجد معرّف متجر" };
  }

  const data = eventBody.data || {};
  const raw = JSON.stringify(eventBody);

  // ── قفل ────────────────────────────────────────────────────────────────
  if (REVOKE_EVENTS.has(eventName)) {
    const status = eventName.includes("canceled") || eventName.includes("cancelled")
      ? "canceled"
      : "expired";

    // إزالة التطبيق أو انتهاء التجربة يقفل كل شيء؛
    // وإلا نقفل ما يخصّ هذه الإضافة تحديداً إن عرفناها
    const targets = eventName === "app.uninstalled" || eventName === "app.trial.expired"
      ? null
      : matchFeatures(eventBody);

    let closed;
    if (!targets || !targets.length) {
      closed = await SallaDatabase.revokeAllFeatures(merchant, status);
      closed = { all: true, count: closed };
    } else {
      for (const key of targets) await SallaDatabase.revokeFeature(merchant, key, status);
      closed = { all: false, keys: targets };
    }

    log.info(`اشتراك: ${eventName} للمتجر ${merchant} → قفل`, { closed });
    return { event: eventName, merchant, action: "revoke", status, closed };
  }

  // ── فتح ────────────────────────────────────────────────────────────────
  const keys = matchFeatures(eventBody);
  const source = eventName === "app.trial.started" ? "trial" : "purchase";
  const expires_at = readExpiry(data);
  const plan_label = readPlanLabel(data);

  if (!keys.length) {
    // لم نتعرّف على الإضافة. نحفظ النص الخام على صفٍّ خاص حتى يظهر
    // في صفحة الباقات، ولا نفتح أي ميزة.
    await SallaDatabase.grantFeature(merchant, "__unmatched__", {
      source, plan_label, expires_at, raw,
    });
    await SallaDatabase.revokeFeature(merchant, "__unmatched__", "expired");

    log.warn(
      `اشتراك: ${eventName} للمتجر ${merchant} — لم نتعرّف على الإضافة "${plan_label || "?"}". ` +
      `افتح صفحة /plans وانسخ المعرّف إلى addonMatch في config/features.js`
    );
    return { event: eventName, merchant, action: "unmatched", plan_label };
  }

  for (const key of keys) {
    await SallaDatabase.grantFeature(merchant, key, { source, plan_label, expires_at, raw });
  }

  log.info(
    `اشتراك: ${eventName} للمتجر ${merchant} → فتح ${keys.join("، ")}` +
    (expires_at ? ` حتى ${expires_at.toISOString().slice(0, 10)}` : "")
  );
  return { event: eventName, merchant, action: "grant", keys, source, expires_at, plan_label };
}

/**
 * الميزات المفتوحة لمتجر — المجانية دائماً + ما اشتُري وما زال سارياً.
 * @returns {Promise<Set<string>>}
 */
async function activeFeatures(merchant) {
  const free = FEATURES.filter((f) => f.free).map((f) => f.key);

  // وضع التجربة: يفتح كل الميزات بلا شراء، للتطوير والتجربة المحلية فقط.
  // مُعطَّل قسراً في الإنتاج — لو بقي مفعّلاً بعد النشر لأعطى التطبيق مجاناً للجميع.
  if (unlockAllEnabled()) return new Set(FEATURES.map((f) => f.key));

  if (!merchant) return new Set(free);

  let purchased = [];
  try {
    purchased = await SallaDatabase.activeFeatureKeys(merchant);
  } catch (err) {
    log.warn("تعذّر قراءة الصلاحيات", { error: err.message });
  }
  return new Set([...free, ...purchased.filter((k) => k !== "__unmatched__")]);
}

module.exports = {
  unlockAllEnabled,
  handleSubscriptionEvent,
  activeFeatures,
  isSubscriptionEvent,
  GRANT_EVENTS,
  REVOKE_EVENTS,
  readExpiry,
  readPlanLabel,
};
