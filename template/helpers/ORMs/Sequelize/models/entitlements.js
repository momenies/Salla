"use strict";
const { Model } = require("sequelize");

/**
 * الصلاحيات: أي ميزة مفتوحة لأي متجر، ومتى تنتهي.
 *
 * صف واحد لكل (متجر × ميزة). نحتفظ بـ `source` و`raw` حتى تعرف دائماً
 * من أين جاءت هذه الصلاحية — من شراء حقيقي، أم من تجربة، أم فتحتها يدوياً.
 */
module.exports = (sequelize, DataTypes) => {
  class Entitlements extends Model {
    static associate(models) {}

    /** هل الصلاحية سارية الآن؟ */
    isActive() {
      if (this.status !== "active") return false;
      if (!this.expires_at) return true; // بلا تاريخ انتهاء = دائمة
      return new Date(this.expires_at).getTime() > Date.now();
    }
  }

  Entitlements.init(
    {
      merchant: { type: DataTypes.BIGINT, allowNull: false },
      feature_key: { type: DataTypes.STRING, allowNull: false },

      // active | expired | canceled
      status: { type: DataTypes.STRING, defaultValue: "active" },

      // purchase | trial | manual — من أين جاءت
      source: { type: DataTypes.STRING, defaultValue: "purchase" },

      plan_label: DataTypes.STRING, // اسم الخطة كما وصل من سلة، للعرض
      started_at: DataTypes.DATE,
      expires_at: DataTypes.DATE,

      raw: DataTypes.TEXT, // نص الحدث الأصلي، للتشخيص
    },
    {
      sequelize,
      modelName: "Entitlements",
      indexes: [{ unique: true, fields: ["merchant", "feature_key"] }],
    }
  );

  return Entitlements;
};
