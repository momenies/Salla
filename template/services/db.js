/**
 * اتصال واحد بقاعدة البيانات تشترك فيه كل أجزاء التطبيق.
 * يُهيّأ مرة عند الإقلاع، ثم تُستدعى `stores()` من أي مكان.
 */
const config = require("../config");
const createDatabase = require("../database");
const createStoreService = require("./stores");
const createAutomationService = require("./automation");

let connection = null;
let storeService = null;
let automationService = null;
let connecting = null;

const database = createDatabase(config.database.orm);

/** يفتح الاتصال (مرة واحدة حتى لو استُدعي بالتوازي) */
async function init() {
  if (connection) return connection;
  if (!connecting) {
    connecting = database
      .connect()
      .then((conn) => {
        if (!conn) throw new Error("تعذّر الاتصال بقاعدة البيانات.");
        connection = conn;
        storeService = createStoreService(conn);
        automationService = createAutomationService(conn);
        return conn;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

function getConnection() {
  return connection;
}

function stores() {
  return storeService;
}

function automation() {
  return automationService;
}

/** يُستخدم في فحص السلامة و/healthz */
async function ping() {
  if (!connection) return false;
  try {
    await connection.authenticate();
    return true;
  } catch (err) {
    return false;
  }
}

async function close() {
  if (connection && typeof connection.close === "function") {
    await connection.close();
    if (automationService) automationService.stopWorker();
    connection = null;
    storeService = null;
    automationService = null;
  }
}

module.exports = { init, getConnection, stores, automation, ping, close, database };
