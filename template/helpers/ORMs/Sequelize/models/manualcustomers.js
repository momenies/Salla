"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class ManualCustomers extends Model {
    static associate(models) {}
  }
  ManualCustomers.init(
    {
      merchant: DataTypes.INTEGER,
      name: DataTypes.STRING,
      mobile: DataTypes.STRING,
      email: DataTypes.STRING,
      created_at: DataTypes.INTEGER,
    },
    {
      sequelize,
      modelName: "ManualCustomers",
    }
  );
  return ManualCustomers;
};
