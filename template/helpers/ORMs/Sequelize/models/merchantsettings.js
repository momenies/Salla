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
    },
    {
      sequelize,
      modelName: "MerchantSettings",
    }
  );
  return MerchantSettings;
};
