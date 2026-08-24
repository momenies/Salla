"use strict";
const { Model } = require("sequelize");

/**
 * جلسات تسجيل الدخول.
 *
 * الافتراضي في express-session هو تخزينها في ذاكرة العملية — وهذا يعني:
 * كل إعادة تشغيل (أو كل نسخة جديدة على Cloud Run) تطرد كل التجار من التطبيق،
 * والذاكرة تتضخّم بلا حد. الجدول هنا يجعل الجلسة تنجو من إعادة التشغيل
 * وتُشارَك بين النسخ.
 */
module.exports = (sequelize, DataTypes) => {
  class Sessions extends Model {
    static associate() {}
  }
  Sessions.init(
    {
      sid: { type: DataTypes.STRING, primaryKey: true },
      data: DataTypes.TEXT,
      expires_at: DataTypes.INTEGER,
    },
    {
      sequelize,
      modelName: "Sessions",
      indexes: [{ fields: ["expires_at"] }],
    }
  );
  return Sessions;
};
