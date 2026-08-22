/**
 * Fired when Salla reports an abandoned cart (created or updated).
 * We upsert it into our local database so the merchant can act on it
 * from the dashboard (/abandoned).
 */
const db = require("../../helpers/salla-db");

module.exports = async (eventBody, userArgs) => {
  try {
    const d = eventBody.data || {};
    await db.saveAbandonedCart({
      merchant: eventBody.merchant,
      cart_id: d.id,
      customer_name: (d.customer && d.customer.name) || "",
      customer_mobile: (d.customer && d.customer.mobile) || "",
      customer_email: (d.customer && d.customer.email) || "",
      total_amount: (d.total && d.total.amount) || 0,
      currency: (d.total && d.total.currency) || "SAR",
      checkout_url: d.checkout_url || "",
      items_count: Array.isArray(d.items) ? d.items.length : 0,
      abandoned_at: Math.floor(Date.now() / 1000),
    });
    console.log(`[abandoned.cart] saved cart #${d.id} for merchant ${eventBody.merchant}`);
  } catch (err) {
    console.log("[abandoned.cart] error:", err.message);
  }
};
