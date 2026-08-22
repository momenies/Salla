/**
 * قناة التجربة: لا ترسل شيئاً، فقط تسجّل الرسالة في صندوق الصادر.
 *
 * استخدمها لتجرّب قواعد الأتمتة وتتأكّد من نصوصها قبل ربط قناة حقيقية —
 * تعمل دائماً بلا أي إعداد.
 */
module.exports = {
  id: "dry-run",
  label: "تجربة فقط (بدون إرسال)",
  hint: "يسجّل الرسالة في صندوق الصادر لتراجعها، دون إرسالها لأحد.",
  setupHint: "",
  needsRecipient: false,

  isConfigured() {
    return true;
  },

  async send({ recipient, body }) {
    console.log(`[dry-run] رسالة إلى ${recipient || "—"}: ${String(body).slice(0, 120)}`);
    return { id: "dry-run", raw: null };
  },
};
