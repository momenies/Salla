"use strict";
const { Model } = require("sequelize");

/**
 * المتجر: كل متجر ثبّت التطبيق يحصل على صف هنا.
 * يحمل بيانات المتجر، إعدادات التطبيق الخاصة به، وحالة اشتراكه.
 */
module.exports = (sequelize, DataTypes) => {
  class Store extends Model {
    // العلاقة مع AppEvent تُعرَّف داخل AppEvent لأنه يُسجَّل بعد Store
    static associate() {}

    /** إعدادات التطبيق مخزّنة كنص JSON — هذان المساعدان يخفيان التحويل */
    getSettings() {
      try {
        return JSON.parse(this.settings || "{}");
      } catch (err) {
        return {};
      }
    }

    setSettings(values) {
      this.settings = JSON.stringify(values || {});
    }

    /** هل الاشتراك يسمح باستخدام الميزات المدفوعة الآن؟ */
    isSubscriptionActive() {
      if (!["active", "trial"].includes(this.subscription_status)) return false;
      const endsAt = this.subscription_ends_at || this.trial_ends_at;
      if (!endsAt) return true;
      return new Date(endsAt).getTime() > Date.now();
    }
  }

  Store.init(
    {
      salla_store_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
      user_id: DataTypes.INTEGER,
      name: DataTypes.STRING,
      username: DataTypes.STRING,
      domain: DataTypes.STRING,
      avatar: DataTypes.STRING,
      email: DataTypes.STRING,
      mobile: DataTypes.STRING,
      plan: DataTypes.STRING,
      status: { type: DataTypes.STRING, defaultValue: "installed" }, // installed | uninstalled
      scopes: DataTypes.TEXT,

      subscription_status: { type: DataTypes.STRING, defaultValue: "none" }, // none | trial | active | expired | canceled
      subscription_plan: DataTypes.STRING,
      subscription_started_at: DataTypes.DATE,
      subscription_ends_at: DataTypes.DATE,
      trial_ends_at: DataTypes.DATE,

      installed_at: DataTypes.DATE,
      uninstalled_at: DataTypes.DATE,
      last_synced_at: DataTypes.DATE,

      settings: { type: DataTypes.TEXT, defaultValue: "{}" },
    },
    { sequelize, modelName: "Store", tableName: "Stores" }
  );

  return Store;
};
