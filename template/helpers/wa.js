/**
 * واجهة واتساب الرسمية من Meta (WhatsApp Cloud API).
 *
 * هذه القناة الموصى بها للإنتاج: مستقرة، ومسموح بها رسمياً، ولا تعرّض رقم
 * التاجر للحظر — بشرط استخدام «قالب معتمد» لأي رسالة تبدأ من طرفنا.
 */
const log = require("../lib/logger");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 12000;

/** ترجمة أخطاء Meta الشائعة إلى جُمل يفهمها التاجر */
const ERROR_HINTS = [
  [/access token/i, "رمز الوصول غير صالح أو انتهت صلاحيته — أنشئ رمزاً دائماً جديداً من Meta."],
  [/permission|scope/i, "الرمز لا يملك صلاحية إرسال رسائل واتساب (whatsapp_business_messaging)."],
  [/template.*not exist|does not exist/i, "اسم القالب غير موجود لدى Meta — تأكد من الاسم واللغة (ar)."],
  [/not.*approved|pending/i, "القالب لم يُعتمد بعد من Meta — انتظر الموافقة ثم أعد المحاولة."],
  [/re-?engagement|24 hour/i, "لا يمكن إرسال رسالة حرة بعد ٢٤ ساعة من آخر رد للعميل — استخدم قالباً معتمداً."],
  [/rate limit|too many/i, "تجاوزت حد الإرسال المسموح مؤقتاً — سيُعاد المحاولة لاحقاً."],
  [/invalid.*phone|recipient/i, "رقم الجوال غير صالح بصيغته الدولية."],
];

function friendly(message) {
  for (const [pattern, hint] of ERROR_HINTS) if (pattern.test(message || "")) return hint;
  return message || "خطأ غير معروف من Meta";
}

async function graphFetch(url, options = {}, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      // نعيد المحاولة فقط على أخطاء عابرة — لا فائدة من تكرار رمز خاطئ
      if (!res.ok && (res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      return { res, data };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("network");
}

/** يتحقّق من صحة الرمز ومعرّف الرقم، ويعيد اسم الرقم وجودته */
async function verifyNumber(token, phoneId) {
  try {
    const { data } = await graphFetch(
      `${GRAPH}/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (data.error) return { ok: false, error: friendly(data.error.message) };
    return {
      ok: true,
      phone: data.display_phone_number,
      name: data.verified_name,
      quality: data.quality_rating,
    };
  } catch (err) {
    return { ok: false, error: "تعذّر الوصول إلى Meta: " + err.message };
  }
}

/**
 * إرسال قالب معتمد.
 * @param {string[]} params القيم التي تحلّ محل {{1}} {{2}} … في نص القالب
 */
async function sendTemplate(token, phoneId, to, templateName, params = [], language = "ar") {
  const recipient = String(to).replace(/[^0-9]/g, "");
  if (!recipient) return { ok: false, error: "رقم الجوال غير صالح" };
  try {
    const { data } = await graphFetch(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          components: params.length
            ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text ?? "") })) }]
            : [],
        },
      }),
    });
    if (data.error) {
      log.warn("فشل إرسال قالب واتساب", { error: data.error.message, template: templateName });
      return { ok: false, error: friendly(data.error.message), code: data.error.code };
    }
    return { ok: true, id: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: "تعذّر الوصول إلى Meta: " + err.message };
  }
}

/**
 * رسالة نصية حرّة — تعمل فقط داخل نافذة الـ٢٤ ساعة بعد رد العميل.
 * نستخدمها للردود، لا للحملات.
 */
async function sendText(token, phoneId, to, text) {
  const recipient = String(to).replace(/[^0-9]/g, "");
  if (!recipient) return { ok: false, error: "رقم الجوال غير صالح" };
  try {
    const { data } = await graphFetch(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { preview_url: true, body: String(text || "").slice(0, 4000) },
      }),
    });
    if (data.error) return { ok: false, error: friendly(data.error.message), code: data.error.code };
    return { ok: true, id: data.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: "تعذّر الوصول إلى Meta: " + err.message };
  }
}

module.exports = { verifyNumber, sendTemplate, sendText, friendly, GRAPH_VERSION };
