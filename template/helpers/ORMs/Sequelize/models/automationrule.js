"use strict";
const { Model } = require("sequelize");

/**
 * قاعدة أتمتة: "عند حدوث كذا، أرسل هذه الرسالة عبر هذه القناة".
 * كل متجر يملك قواعده الخاصة.
 */
module.exports = (sequelize, DataTypes) => {
  class AutomationRule extends Model {
    static associate() {}

    getConditions() {
      try {
        return JSON.parse(this.conditions || "{}");
      } catch (err) {
        return {};
      }
    }

    setConditions(value) {
      this.conditions = JSON.stringify(value || {});
    }
  }

  AutomationRule.init(
    {
      store_id: { type: DataTypes.BIGINT, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      event: { type: DataTypes.STRING, allowNull: false },
      channel: { type: DataTypes.STRING, allowNull: false, defaultValue: "whatsapp" },
      template: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },

      // تأخير الإرسال بالدقائق — مفيد للسلة المتروكة مثلاً
      delay_minutes: { type: DataTypes.INTEGER, defaultValue: 0 },

      // شروط اختيارية، مثل: أرسل فقط إذا كانت حالة الطلب "completed"
      conditions: { type: DataTypes.TEXT, defaultValue: "{}" },

      enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      last_run_at: DataTypes.DATE,
      run_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: "AutomationRule",
      tableName: "AutomationRules",
      indexes: [{ fields: ["store_id"] }, { fields: ["event"] }],
    }
  );

  return AutomationRule;
};
