"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Automations extends Model {
    static associate(models) {}
  }
  Automations.init(
    {
      merchant: DataTypes.INTEGER,
      key: DataTypes.STRING,
      enabled: DataTypes.BOOLEAN,
      delay_minutes: DataTypes.INTEGER,
      msg_template: DataTypes.TEXT,
    },
    {
      sequelize,
      modelName: "Automations",
      indexes: [{ unique: true, fields: ["merchant", "key"] }],
    }
  );
  return Automations;
};
