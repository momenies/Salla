"use strict";
const { Model } = require("sequelize");

/**
 * صندوق الصادر: كل رسالة تنتظر الإرسال أو أُرسلت بالفعل.
 *
 * لماذا صندوق صادر بدل الإرسال المباشر من الويبهوك؟
 * لأن سلة تنتظر رداً سريعاً، والإرسال قد يفشل أو يتأخّر. نخزّن الرسالة أولاً
 * ثم نرسلها في الخلفية مع إعادة محاولة — فلا يضيع شيء ولا يتعطّل الويبهوك.
 */
module.exports = (sequelize, DataTypes) => {
  class OutboxMessage extends Model {
    static associate() {}

    getContext() {
      try {
        return JSON.parse(this.context || "{}");
      } catch (err) {
        return {};
      }
    }
  }

  OutboxMessage.init(
    {
      store_id: { type: DataTypes.BIGINT, allowNull: false },
      rule_id: DataTypes.INTEGER,
      event: DataTypes.STRING,
      channel: { type: DataTypes.STRING, allowNull: false },

      recipient: DataTypes.STRING,
      body: { type: DataTypes.TEXT, defaultValue: "" },

      // pending → sent | failed | skipped
      status: { type: DataTypes.STRING, defaultValue: "pending" },
      attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
      last_error: DataTypes.TEXT,

      scheduled_at: DataTypes.DATE,
      sent_at: DataTypes.DATE,

      // نسخة من بيانات الحدث، لإعادة المحاولة والتشخيص
      context: DataTypes.TEXT,
    },
    {
      sequelize,
      modelName: "OutboxMessage",
      tableName: "OutboxMessages",
      indexes: [{ fields: ["store_id"] }, { fields: ["status"] }, { fields: ["scheduled_at"] }],
    }
  );

  return OutboxMessage;
};
