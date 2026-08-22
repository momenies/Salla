const { Sequelize, DataTypes } = require("sequelize");

const OauthTokens = require("./models/oauthtokens");
const PasswordResets = require("./models/passwordresets");
const User = require("./models/user");
const Store = require("./models/store");
const AppEvent = require("./models/appevent");
const AutomationRule = require("./models/automationrule");
const OutboxMessage = require("./models/outboxmessage");

// We export the sequelize connection instance to be used around our app.
module.exports = {
  connect: async () => {
    // In a real app, you should keep the database connection URL as an environment variable.
    // But for this example, we will just use a local SQLite database.
    // const sequelize = new Sequelize(process.env.DB_CONNECTION_URL);
    // If DATABASE_STORAGE is set, use a local SQLite file (zero setup, great for dev).
    // Otherwise fall back to MySQL using the standard DATABASE_* environment variables.
    const sequelize = process.env.DATABASE_STORAGE
      ? new Sequelize({
          dialect: "sqlite",
          storage: process.env.DATABASE_STORAGE,
          logging: false,
        })
      : new Sequelize({
          host: process.env.DATABASE_SERVER,
          username: process.env.DATABASE_USERNAME,
          password: process.env.DATABASE_PASSWORD,
          database: process.env.DATABASE_NAME,
          dialect: "mysql",
          logging: true,
        });

    const modelDefiners = [
      OauthTokens,
      PasswordResets,
      User,
      Store,
      AppEvent,
      AutomationRule,
      OutboxMessage,
      // Add more models here...
      // require('./models/item'),
    ];

    // We define all models according to their files.
    for (let i = 0; i < modelDefiners.length; i++) {
      modelDefiners[i] = modelDefiners[i](sequelize, DataTypes);
      modelDefiners[i].associate(sequelize.models);
    }

    // We execute any associates  after the models are defined .

    // ننتظر إنشاء الجداول قبل إرجاع الاتصال، وإلا قد يُستعلم عن جدول لم يُنشأ بعد
    await sequelize.sync();
    return sequelize;
  },
};
