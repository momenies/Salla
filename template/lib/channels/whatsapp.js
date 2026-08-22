/**
 * واتساب عبر WhatsApp Cloud API الرسمية من Meta.
 *
 * ما تحتاجه في .env:
 *   WHATSAPP_TOKEN            توكن دائم من Meta for Developers
 *   WHATSAPP_PHONE_NUMBER_ID  معرّف رقم المرسِل
 *
 * ملاحظة مهمة: واتساب لا يسمح بإرسال نص حر إلا خلال ٢٤ ساعة من آخر رسالة
 * من العميل. خارج هذه النافذة يجب استخدام قالب معتمد من Meta — نرسل حينها
 * القالب المحدّد في WHATSAPP_TEMPLATE_NAME إن كان مضبوطاً.
 */
const config = require("../../config");

/** يحوّل رقم الجوال إلى صيغة دولية بلا رموز */
function toInternational(mobile, countryCode = config.automation.defaultCountryCode) {
  let digits = String(mobile || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  if (digits.length <= 9) digits = countryCode + digits;
  return digits;
}

module.exports = {
  id: "whatsapp",
  label: "واتساب",
  hint: "يرسل الرسالة مباشرة إلى جوال العميل عبر واتساب.",
  setupHint: "يحتاج WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID في ملف .env.",
  needsRecipient: true,

  isConfigured() {
    return Boolean(config.automation.whatsapp.token && config.automation.whatsapp.phoneNumberId);
  },

  async send({ recipient, body }) {
    if (!this.isConfigured()) {
      throw new Error("قناة واتساب غير مهيّأة — اضبط WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID.");
    }

    const to = toInternational(recipient);
    if (!to) throw new Error("رقم المستلم غير صالح.");

    const { token, phoneNumberId, apiVersion, templateName, templateLanguage } = config.automation.whatsapp;

    const payload = templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLanguage },
            components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: true, body } };

    const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.automation.timeoutMs),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = json?.error?.message || `فشل الإرسال (${res.status})`;
      throw new Error(`واتساب: ${message}`);
    }

    return { id: json?.messages?.[0]?.id || "", raw: json };
  },

  toInternational,
};
