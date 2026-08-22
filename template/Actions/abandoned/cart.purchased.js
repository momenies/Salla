/**
 * Fired when an abandoned cart is purchased — the merchant's reminder
 * worked (or the customer returned on their own). Mark as recovered.
 */
const db = require("../../helpers/salla-db");

module.exports = async (eventBody, userArgs) => {
  try {
    const cartId = eventBody.data && eventBody.data.id;
    await db.setAbandonedCartStatus(eventBody.merchant, cartId, "recovered");
    console.log(`[abandoned.cart.purchased] cart #${cartId} marked recovered`);
  } catch (err) {
    console.log("[abandoned.cart.purchased] error:", err.message);
  }
};
