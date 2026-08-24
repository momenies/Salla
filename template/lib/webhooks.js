/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  استقبال أحداث سلة (Webhooks) — تحقّق ثم توزيع
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * لماذا لم نكتفِ بـ `@salla.sa/webhooks-actions`؟
 *   • تدعم استراتيجية «التوكن» فقط، بينما بوابة الشركاء تتيح أيضاً «التوقيع»
 *     (HMAC-SHA256) وهو الأقوى — والسرّ لا يُرسل عبر الشبكة أصلاً.
 *   • تقارن السرّ بـ `!==` وهي مقارنة تتسرّب منها المعلومات زمنياً.
 *   • تبحث عن ملفات الأحداث في `./Actions` نسبةً إلى مجلد التشغيل، فتفشل
 *     صامتة إن شُغّل التطبيق من مجلد آخر (وهذا ما يحدث في كثير من الحاويات).
 *   • تتجاهل الوعود، فأي خطأ داخل معالج غير متزامن يضيع بلا أثر.
 *
 * هنا نصلح الأربعة، ونبقي على نفس اصطلاح المجلدات: `Actions/order/created.js`.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const log = require("./logger");

const ACTIONS_DIR = path.join(__dirname, "..", "Actions");

/** مقارنة لا يتغيّر زمنها بحسب موضع أول اختلاف */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * يتحقّق من صحة الحدث الوارد.
 *
 * @param {object} params
 * @param {object} params.headers   ترويسات الطلب
 * @param {Buffer|string} params.rawBody  الجسم الخام كما وصل (ضروري للتوقيع)
 * @param {string} params.secret    السر من بوابة الشركاء
 * @param {string} params.strategy  auto | token | signature
 * @returns {{ok: boolean, strategy: string, reason?: string}}
 */
function verify({ headers = {}, rawBody = "", secret = "", strategy = "auto" }) {
  if (!secret) return { ok: false, strategy: "none", reason: "no-secret" };

  const signature = headers["x-salla-signature"] || headers["X-Salla-Signature"];
  const authorization = headers.authorization || headers.Authorization || "";

  const wantSignature = strategy === "signature" || (strategy === "auto" && signature);
  if (wantSignature) {
    if (!signature) return { ok: false, strategy: "signature", reason: "missing-signature" };
    const expected = crypto
      .createHmac("sha256", secret)
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"))
      .digest("hex");
    return safeEqual(signature, expected)
      ? { ok: true, strategy: "signature" }
      : { ok: false, strategy: "signature", reason: "bad-signature" };
  }

  // استراتيجية التوكن: سلة ترسل السر نفسه في ترويسة Authorization
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  return safeEqual(token, secret)
    ? { ok: true, strategy: "token" }
    : { ok: false, strategy: "token", reason: "bad-token" };
}

/**
 * ذاكرة أحداث معالَجة — سلة تعيد الإرسال عند أي شك في التسليم، فبدون هذا
 * قد يصل التاجر تذكيران لنفس السلة.
 */
const seen = new Map();
const SEEN_TTL = 10 * 60 * 1000;

function eventFingerprint(body) {
  const id = body?.event_id || body?.id || "";
  const base = id
    ? `${body.event}:${id}`
    : `${body?.event}:${body?.merchant}:${body?.data?.id}:${body?.created_at || ""}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

function isDuplicate(body) {
  const key = eventFingerprint(body);
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > SEEN_TTL) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

// ─────────────────────────── التوزيع ───────────────────────────

const listeners = new Map();

/** يسجّل معالجاً لحدث معيّن، أو "all" لكل الأحداث */
function on(event, handler) {
  if (!event || typeof handler !== "function") return;
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(handler);
}

/** `order.status.updated` → `Actions/order/status.updated.js` */
function actionPathFor(eventName) {
  const parts = String(eventName || "").split(".");
  if (parts.length < 2) return null;
  const folder = parts.shift();
  // نمنع الخروج من مجلد Actions عبر أسماء أحداث ملفّقة
  if (!/^[a-z0-9_-]+$/i.test(folder)) return null;
  const file = parts.join(".") + ".js";
  if (!/^[a-z0-9_.-]+$/i.test(file)) return null;
  const full = path.join(ACTIONS_DIR, folder, file);
  return full.startsWith(ACTIONS_DIR) ? full : null;
}

/**
 * ينفّذ كل ما يخصّ الحدث: المستمعون المسجّلون ثم ملف المجلد إن وُجد.
 * ينتظر الوعود ويسجّل أخطاءها بدل ابتلاعها.
 */
async function dispatch(body, userArgs = {}) {
  const eventName = body?.event;
  if (!eventName) return { handled: 0 };

  const handlers = [...(listeners.get("all") || []), ...(listeners.get(eventName) || [])];

  const actionFile = actionPathFor(eventName);
  if (actionFile && fs.existsSync(actionFile)) {
    try {
      const mod = require(actionFile);
      if (typeof mod === "function") handlers.push(mod);
    } catch (err) {
      log.error("تعذّر تحميل ملف الحدث", { event: eventName, error: err.message });
    }
  }

  let handled = 0;
  for (const handler of handlers) {
    try {
      await handler(body, userArgs);
      handled++;
    } catch (err) {
      log.error("فشل معالج حدث", { event: eventName, error: err.message, stack: err.stack });
    }
  }
  return { handled };
}

/** لأغراض الاختبار */
function _reset() {
  listeners.clear();
  seen.clear();
}

module.exports = { verify, safeEqual, isDuplicate, eventFingerprint, on, dispatch, actionPathFor, _reset, ACTIONS_DIR };
