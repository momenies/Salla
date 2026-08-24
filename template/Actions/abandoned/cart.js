/**
 * حدث «سلة متروكة» من سلة (إنشاء أو تحديث).
 *
 * نخزّنها محلياً لسببين: تظهر للتاجر في لوحته فوراً، ويصبح لدينا مصدر
 * موثوق نجدول منه التذكيرات حتى لو تأخّرت سلة أو تكرّر الحدث.
 */
const db = require("../../helpers/salla-db");
const log = require("../../lib/logger");
const { normalizeMobile } = require("../../lib/format");

/** سلة ترسل الاسم مجزّأً أحياناً وكاملاً أحياناً — نتعامل مع الشكلين */
function customerName(customer = {}) {
  const full = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  return full || customer.name || "";
}

/** المبلغ قد يصل رقماً أو كائناً { amount, currency } */
function amountOf(total) {
  if (total === null || total === undefined) return 0;
  if (typeof total === "object") return Number(total.amount) || 0;
  return Number(total) || 0;
}

module.exports = async (eventBody) => {
  const data = eventBody.data || {};
  const customer = data.customer || {};
  if (!eventBody.merchant || !data.id) return;

  await db.saveAbandonedCart({
    merchant: eventBody.merchant,
    cart_id: data.id,
    customer_name: customerName(customer),
    customer_mobile: normalizeMobile(customer.mobile, customer.country_code || customer.mobile_code),
    customer_email: customer.email || "",
    total_amount: amountOf(data.total ?? data.amounts?.total),
    currency: (typeof data.total === "object" && data.total?.currency) || "SAR",
    checkout_url: data.checkout_url || data.url || "",
    items_count: Array.isArray(data.items) ? data.items.length : 0,
    abandoned_at: Math.floor(Date.now() / 1000),
  });

  log.info("حُفظت سلة متروكة", { merchant: eventBody.merchant, cart: data.id });
};
