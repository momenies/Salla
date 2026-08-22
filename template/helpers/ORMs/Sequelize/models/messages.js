"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Messages extends Model {
    static associate(models) {}
  }
  Messages.init(
    {
      merchant: DataTypes.INTEGER,
      kind: DataTypes.STRING,
      order_id: DataTypes.INTEGER,
      cart_id: DataTypes.INTEGER,
      customer_name: DataTypes.STRING,
      customer_mobile: DataTypes.STRING,
      body: DataTypes.TEXT,
      status: DataTypes.STRING,
      channel: DataTypes.STRING,
      scheduled_at: DataTypes.INTEGER,
      sent_at: DataTypes.INTEGER,
      error: DataTypes.TEXT,
      attempts: DataTypes.INTEGER,
      created_at: DataTypes.INTEGER,
    },
    {
      sequelize,
      modelName: "Messages",
      indexes: [
        { fields: ["merchant", "status"] },
        { fields: ["status", "scheduled_at"] },
        { fields: ["merchant", "order_id"] },
      ],
    }
  );
  return Messages;
};
