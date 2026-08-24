"use strict";
const { Model } = require("sequelize");

/**
 * توكنات سلة لكل تاجر.
 *
 * أُضيف `expires_at` (طابع زمني بالثواني) لأن `expires_in` وحده لا يكفي:
 * فهو مدّة لا لحظة، وبدون معرفة وقت الإصدار لا يمكن معرفة متى ينتهي التوكن —
 * فكان التطبيق ينتظر خطأ 401 من سلة ليكتشف ذلك، والتاجر يرى صفحة فارغة.
 */
module.exports = (sequelize, DataTypes) => {
  class OauthTokens extends Model {
    static associate(models) {
      // العلاقة معرّفة في نموذج User
    }
    /** هل التوكن ما زال صالحاً (مع هامش أمان بالثواني)؟ */
    isFresh(marginSeconds = 300) {
      if (!this.expires_at) return true; // لا نعرف — نفترض الصلاحية ونعالج 401 عند حدوثه
      return this.expires_at - marginSeconds > Math.floor(Date.now() / 1000);
    }
  }
  OauthTokens.init(
    {
      user_id: DataTypes.INTEGER,
      merchant: { type: DataTypes.BIGINT, index: true },
      access_token: DataTypes.TEXT,
      expires_in: DataTypes.INTEGER,
      /** لحظة الانتهاء الفعلية (unix seconds) */
      expires_at: DataTypes.INTEGER,
      refresh_token: DataTypes.TEXT,
      scope: DataTypes.STRING,
    },
    {
      sequelize,
      modelName: "OauthTokens",
      indexes: [{ fields: ["merchant"] }],
    }
  );
  return OauthTokens;
};
