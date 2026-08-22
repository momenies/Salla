/**
 * Fired when an abandoned cart status changes (e.g. "purchased").
 */
const db = require("../../helpers/salla-db");

module.exports = async (eventBody, userArgs) => {
  try {
    const status = (eventBody.data && eventBody.data.status) || "";
    const cartId = eventBody.data && eventBody.data.id;
    if (status === "purchased") {
      await db.setAbandonedCartStatus(eventBody.merchant, cartId, "recovered");
    }
    console.log(`[abandoned.cart.status.changed] cart #${cartId} -> ${status}`);
  } catch (err) {
    console.log("[abandoned.cart.status.changed] error:", err.message);
  }
};
