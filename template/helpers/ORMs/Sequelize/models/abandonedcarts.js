"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class AbandonedCarts extends Model {
    static associate(models) {}
  }
  AbandonedCarts.init(
    {
      merchant: DataTypes.INTEGER,
      cart_id: DataTypes.INTEGER,
      customer_name: DataTypes.STRING,
      customer_mobile: DataTypes.STRING,
      customer_email: DataTypes.STRING,
      total_amount: DataTypes.FLOAT,
      currency: DataTypes.STRING,
      checkout_url: DataTypes.STRING,
      items_count: DataTypes.INTEGER,
      status: DataTypes.STRING,
      last_contacted_at: DataTypes.INTEGER,
      abandoned_at: DataTypes.INTEGER,
    },
    {
      sequelize,
      modelName: "AbandonedCarts",
      indexes: [{ unique: true, fields: ["merchant", "cart_id"] }],
    }
  );
  return AbandonedCarts;
};
