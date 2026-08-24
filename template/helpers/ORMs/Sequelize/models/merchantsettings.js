"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class MerchantSettings extends Model {
    static associate(models) {}
  }
  MerchantSettings.init(
    {
      merchant: { type: DataTypes.INTEGER, unique: true },
      store_name: DataTypes.STRING,
      channel: DataTypes.STRING,
      wa_token: DataTypes.STRING,
      wa_phone_id: DataTypes.STRING,
      template_name: { type: DataTypes.STRING, defaultValue: "cart_reminder" },
      msg_template: DataTypes.TEXT,
      delay_minutes: { type: DataTypes.INTEGER, defaultValue: 60 },
      auto_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
      /** "22:00-08:00" — لا نرسل داخل هذه الساعات احتراماً لنوم العميل */
      quiet_hours: DataTypes.STRING,
      /** سقف الرسائل اليومي لكل متجر — حماية من الحظر ومن الفواتير المفاجئة */
      daily_cap: { type: DataTypes.INTEGER, defaultValue: 200 },
      /** اسم يظهر في نص الرسالة بدل اسم المتجر إن رغب التاجر */
      sender_name: DataTypes.STRING,
    },
    {
      sequelize,
      modelName: "MerchantSettings",
      indexes: [{ unique: true, fields: ["merchant"] }],
    }
  );
  return MerchantSettings;
};
