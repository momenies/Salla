/**
 * السلة تحوّلت إلى طلب — التذكير نجح (أو عاد العميل وحده).
 * نعلّمها «مستعادة» ونلغي أي رسالة ما زالت في الانتظار حتى لا يصل
 * العميل تذكيرٌ بسلة اشتراها فعلاً؛ لا شيء يُفقد الثقة أسرع من ذلك.
 */
const db = require("../../helpers/salla-db");
const cache = require("../../lib/cache");
const log = require("../../lib/logger");

module.exports = async (eventBody) => {
  const merchant = eventBody.merchant;
  const cartId = eventBody.data && eventBody.data.id;
  if (!merchant || !cartId) return;

  await db.setAbandonedCartStatus(merchant, cartId, "recovered");

  const models = await db.models();
  const [cancelled] = await models.Messages.update(
    { status: "cancelled" },
    { where: { merchant, cart_id: cartId, status: "pending" } }
  );

  cache.invalidate(`stats:${merchant}:`);
  log.info("سلة مستعادة", { merchant, cart: cartId, cancelled });
};
