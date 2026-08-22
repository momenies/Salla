/**
 * قناة الويبهوك: ترسل الرسالة كـ JSON إلى رابط تختاره أنت.
 *
 * هذه أعمّ قناة — تربط التطبيق بأي خدمة: Make أو Zapier أو n8n أو
 * مزوّد رسائل محلي (مثل خدمات SMS السعودية) أو خادمك الخاص.
 *
 * في .env:
 *   AUTOMATION_WEBHOOK_URL     الرابط المستقبِل
 *   AUTOMATION_WEBHOOK_SECRET  (اختياري) يُرسل في ترويسة X-App-Secret للتحقّق
 */
const config = require("../../config");

module.exports = {
  id: "webhook",
  label: "ربط خارجي (Make / Zapier / n8n)",
  hint: "يرسل الرسالة كـ JSON إلى رابط تختاره، لتتصرّف به أي خدمة تريدها.",
  setupHint: "يحتاج AUTOMATION_WEBHOOK_URL في ملف .env.",
  needsRecipient: false,

  isConfigured() {
    return Boolean(config.automation.webhookUrl);
  },

  async send({ recipient, body, context }) {
    if (!this.isConfigured()) {
      throw new Error("قناة الربط الخارجي غير مهيّأة — اضبط AUTOMATION_WEBHOOK_URL.");
    }

    const headers = { "Content-Type": "application/json" };
    if (config.automation.webhookSecret) headers["X-App-Secret"] = config.automation.webhookSecret;

    const res = await fetch(config.automation.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        recipient,
        message: body,
        event: context?.event || "",
        store_id: context?.store_id || null,
        variables: context?.variables || {},
        sent_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(config.automation.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`الرابط الخارجي ردّ بـ ${res.status}${text ? ": " + text.slice(0, 200) : ""}`);
    }

    return { id: "", raw: null };
  },
};
