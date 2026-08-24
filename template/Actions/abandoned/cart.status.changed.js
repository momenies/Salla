/** تغيّرت حالة سلة متروكة لدى سلة — نعكس ما يهمّنا منها فقط */
const db = require("../../helpers/salla-db");
const cache = require("../../lib/cache");
const log = require("../../lib/logger");

const RECOVERED = ["purchased", "completed", "converted"];

module.exports = async (eventBody) => {
  const merchant = eventBody.merchant;
  const data = eventBody.data || {};
  const cartId = data.id;
  if (!merchant || !cartId) return;

  const status = String(data.status || "").toLowerCase();
  if (RECOVERED.includes(status)) {
    await db.setAbandonedCartStatus(merchant, cartId, "recovered");
    cache.invalidate(`stats:${merchant}:`);
  }
  log.debug("تغيّرت حالة سلة", { merchant, cart: cartId, status });
};
