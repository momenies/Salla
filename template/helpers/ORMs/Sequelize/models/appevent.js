"use strict";
const { Model } = require("sequelize");

/**
 * سجل الأحداث: كل webhook يصل من سلة يُحفظ هنا.
 * الفائدة العملية: تعرف أن الربط يعمل، وتقدر تشخّص أي حدث فشل ولماذا.
 */
module.exports = (sequelize, DataTypes) => {
  class AppEvent extends Model {
    static associate(models) {
      const { Store, AppEvent } = models;
      if (Store) {
        // `constraints: false` مقصود: السجل يجب أن يقبل أي حدث حتى لو وصل
        // من متجر لم يُسجَّل عندنا بعد. قيد المفتاح الأجنبي كان يرفض الحدث
        // ويضيّعه، وهو أسوأ من صف يتيم في سجل تشخيصي.
        Store.hasMany(AppEvent, { foreignKey: "store_id", sourceKey: "salla_store_id", constraints: false });
        AppEvent.belongsTo(Store, { foreignKey: "store_id", targetKey: "salla_store_id", constraints: false });
      }
    }

    getPayload() {
      try {
        return JSON.parse(this.payload || "{}");
      } catch (err) {
        return {};
      }
    }
  }

  AppEvent.init(
    {
      store_id: DataTypes.BIGINT,
      event: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, defaultValue: "received" }, // received | processed | failed
      error: DataTypes.TEXT,
      payload: DataTypes.TEXT,
    },
    {
      sequelize,
      modelName: "AppEvent",
      tableName: "AppEvents",
      indexes: [{ fields: ["store_id"] }, { fields: ["event"] }],
    }
  );

  return AppEvent;
};
