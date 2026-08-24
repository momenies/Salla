const { Sequelize, DataTypes } = require("sequelize");
const log = require("../../../lib/logger");

const modelFiles = [
  require("./models/oauthtokens"),
  require("./models/passwordresets"),
  require("./models/user"),
  require("./models/abandonedcarts"),
  require("./models/merchantsettings"),
  require("./models/manualcustomers"),
  require("./models/messages"),
  require("./models/automations"),
  require("./models/entitlements"),
  require("./models/sessions"),
];

/**
 * أعمدة أُضيفت بعد إطلاق نسخ سابقة. `sequelize.sync()` ينشئ الجداول الناقصة
 * لكنه لا يضيف عموداً إلى جدول موجود — فتنكسر التركيبات القديمة عند التحديث.
 * هذه القائمة تسدّ تلك الفجوة بأمان (تُنفَّذ فقط إن كان العمود غائباً).
 */
const COLUMN_PATCHES = [
  ["MerchantSettings", "channel", { type: DataTypes.STRING }],
  ["MerchantSettings", "msg_template", { type: DataTypes.TEXT }],
  ["MerchantSettings", "quiet_hours", { type: DataTypes.STRING }],
  ["MerchantSettings", "daily_cap", { type: DataTypes.INTEGER }],
  ["MerchantSettings", "sender_name", { type: DataTypes.STRING }],
  ["OauthTokens", "expires_at", { type: DataTypes.INTEGER }],
  ["OauthTokens", "merchant", { type: DataTypes.BIGINT }],
  ["OauthTokens", "scope", { type: DataTypes.STRING }],
  ["Messages", "channel", { type: DataTypes.STRING }],
  ["AbandonedCarts", "recovered_at", { type: DataTypes.INTEGER }],
  ["AbandonedCarts", "reminders_sent", { type: DataTypes.INTEGER }],
];

function buildSequelize() {
  const {
    DATABASE_STORAGE,
    DATABASE_SERVER,
    DATABASE_USERNAME,
    DATABASE_PASSWORD,
    DATABASE_NAME,
    DATABASE_URL,
    DATABASE_DIALECT,
    DATABASE_POOL_MAX,
  } = process.env;

  const pool = { max: parseInt(DATABASE_POOL_MAX, 10) || 10, min: 0, idle: 10000, acquire: 30000 };
  const logging = process.env.DATABASE_LOG === "1" ? (sql) => log.debug(sql) : false;

  // 1) رابط كامل (Postgres/MySQL على منصّات السحابة عادةً)
  if (DATABASE_URL) {
    return new Sequelize(DATABASE_URL, { logging, pool });
  }
  // 2) ملف SQLite محلي — صفر إعدادات، وهو الافتراضي للتطوير
  if (DATABASE_STORAGE || !DATABASE_SERVER) {
    return new Sequelize({
      dialect: "sqlite",
      storage: DATABASE_STORAGE || "database.sqlite",
      logging,
    });
  }
  // 3) خادم قاعدة بيانات صريح
  return new Sequelize({
    host: DATABASE_SERVER,
    username: DATABASE_USERNAME,
    password: DATABASE_PASSWORD,
    database: DATABASE_NAME,
    dialect: DATABASE_DIALECT || "mysql",
    logging,
    pool,
  });
}

async function applyColumnPatches(sequelize) {
  const qi = sequelize.getQueryInterface();
  for (const [modelName, column, spec] of COLUMN_PATCHES) {
    const model = sequelize.models[modelName];
    if (!model) continue;
    try {
      const table = model.getTableName();
      const cols = await qi.describeTable(table);
      if (!cols[column]) {
        await qi.addColumn(table, column, spec);
        log.info(`ترقية قاعدة البيانات: أُضيف العمود ${modelName}.${column}`);
      }
    } catch (err) {
      log.warn(`تعذّرت ترقية ${modelName}.${column}`, { error: err.message });
    }
  }
}

module.exports = {
  connect: async () => {
    const sequelize = buildSequelize();

    for (const definer of modelFiles) {
      definer(sequelize, DataTypes);
    }
    for (const model of Object.values(sequelize.models)) {
      if (typeof model.associate === "function") model.associate(sequelize.models);
    }

    await sequelize.authenticate();
    await sequelize.sync();
    await applyColumnPatches(sequelize);

    // SQLite: WAL يجعل القراءة والكتابة تتزامنان بلا أقفال — فرق ملموس
    // حين يعمل مُرسل الرسائل في الخلفية بينما التاجر يتصفّح لوحته.
    if (sequelize.getDialect() === "sqlite") {
      await sequelize.query("PRAGMA journal_mode = WAL;");
      await sequelize.query("PRAGMA synchronous = NORMAL;");
      await sequelize.query("PRAGMA busy_timeout = 5000;");
    }

    return sequelize;
  },
};
