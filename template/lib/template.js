/**
 * محرّك بسيط لنصوص الرسائل: يستبدل {variable} بقيمتها.
 *
 * مقصود أن يكون محدوداً — لا شروط ولا حلقات ولا تنفيذ كود. نص الرسالة
 * يكتبه التاجر، فلا يجوز أن يتحوّل إلى منفذ لتنفيذ شيء داخل الخادم.
 */

const PLACEHOLDER = /\{\s*([a-zA-Z0-9_]+)\s*\}/g;

/**
 * @param {string} template نص فيه {متغيّرات}
 * @param {object} variables القيم
 * @param {object} [options] fallback: ما يوضع مكان متغيّر غير موجود
 */
function render(template, variables = {}, { fallback = "" } = {}) {
  if (!template) return "";
  return String(template).replace(PLACEHOLDER, (match, name) => {
    // ملكية مباشرة فقط: بدون هذا الفحص كان {constructor} أو {__proto__}
    // يسحب قيماً من سلسلة النماذج ويسرّبها إلى رسالة العميل.
    if (!Object.prototype.hasOwnProperty.call(variables, name)) return fallback;
    const value = variables[name];
    if (value === undefined || value === null || value === "") return fallback;
    return String(value);
  });
}

/** أسماء المتغيّرات المستخدمة داخل نص ما */
function usedVariables(template) {
  const found = new Set();
  for (const match of String(template || "").matchAll(PLACEHOLDER)) found.add(match[1]);
  return [...found];
}

/** متغيّرات كُتبت في النص لكنها غير متاحة لهذا الحدث */
function unknownVariables(template, availableNames = []) {
  const available = new Set(availableNames);
  return usedVariables(template).filter((name) => !available.has(name));
}

/** شرح عربي لسبب تخطّي رسالة، لعرضه في صندوق الصادر */
function describeSkip(reason) {
  const map = {
    "لا يوجد مستلم": "لم نجد رقم جوال للعميل في هذا الحدث.",
    "الشرط غير متحقّق": "الشرط المحدّد في القاعدة لم يتحقّق، فلم تُرسل.",
    "نص الرسالة فارغ": "نص الرسالة فارغ بعد استبدال المتغيّرات.",
  };
  return map[reason] || reason;
}

module.exports = { render, usedVariables, unknownVariables, describeSkip };
