/**
 * جسر واتساب عبر الباركود (الأجهزة المرتبطة).
 *
 * الفائدة: التاجر يربط رقمه في دقيقة بلا حساب Meta ولا قوالب معتمدة.
 * الثمن: يعتمد على متصفّح Chromium داخل الخادم، وغير رسمي من واتساب.
 *
 * لذلك:
 *   • نحمّل المكتبة **عند الحاجة فقط** — صورة الإنتاج تُبنى بلا Chromium
 *     لتوفير ~400MB، فلا يصحّ أن ينهار التطبيق كله عند غيابها.
 *   • عند غيابها نُرجع رسالة عربية واضحة تشرح البديل بدل خطأ تقني.
 */
const path = require("path");
const fs = require("fs");
const log = require("../lib/logger");

const SESSIONS_DIR = process.env.WWEB_SESSIONS_DIR || path.join(process.cwd(), ".wweb-sessions");

/** merchant -> { client, status, qr, phone, startedAt } */
const clients = new Map();

let libState = null;     // { Client, LocalAuth, qrcode } أو { error }
let browserPath = null;  // مسار المتصفّح المتحقَّق من وجوده، أو null

/**
 * هل القناة متاحة على هذا الخادم فعلاً؟
 *
 * لا يكفي أن تُحمَّل الحزمة. صورة الإنتاج تُبنى بلا Chromium توفيراً لـ
 * ~400MB، لكن `require("whatsapp-web.js")` ينجح رغم ذلك — فكانت الدالة
 * تُرجع true، فنعرض للتاجر خيار الباركود ثم يفشل عند الضغط. المتصفّح
 * الغائب هو الشرط الحقيقي، فنفحص وجود الملف نفسه.
 */
function isAvailable() {
  return loadLib().error === undefined && findBrowser() !== null;
}

/** سبب التعذّر بالعربية، أو null إن كانت القناة تعمل */
function unavailableReason() {
  if (loadLib().error) return "مكتبة الباركود غير مثبّتة على هذا الخادم.";
  if (findBrowser() === null) {
    return "لا يوجد متصفّح مثبّت على الخادم (Chromium)، وهو شرط لربط الباركود.";
  }
  return null;
}

/**
 * يبحث عن متصفّح صالح: المسار الصريح إن ضُبط، وإلا ما يشير إليه puppeteer.
 * النتيجة مخزّنة — لا نفحص القرص عند كل طلب.
 */
function findBrowser() {
  if (browserPath !== null) return browserPath || null;

  const candidates = [];
  if (process.env.CHROMIUM_PATH) candidates.push(process.env.CHROMIUM_PATH);
  try {
    candidates.push(require("puppeteer").executablePath());
  } catch {
    /* puppeteer قد لا يكون مثبّتاً — نكتفي بالمسار الصريح */
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        browserPath = candidate;
        return browserPath;
      }
    } catch {
      /* مسار غير قابل للقراءة — نجرّب التالي */
    }
  }

  browserPath = "";  // فحصنا ولم نجد؛ لا نعيد الفحص
  return null;
}

function loadLib() {
  if (libState) return libState;
  try {
    const { Client, LocalAuth } = require("whatsapp-web.js");
    const qrcode = require("qrcode");
    libState = { Client, LocalAuth, qrcode };
  } catch (err) {
    log.warn("قناة الباركود غير متاحة على هذا الخادم", { error: err.message });
    libState = { error: err.message };
  }
  return libState;
}

function unavailable() {
  return {
    ok: false,
    status: "unavailable",
    error: (unavailableReason() || "ربط الباركود غير متاح هنا.") +
      " استخدم قناة Meta الرسمية — وهي الأنسب للإنتاج على أي حال.",
  };
}

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function hasSavedSession(merchant) {
  try {
    return fs.existsSync(path.join(SESSIONS_DIR, "session-m" + merchant)) ||
      fs.existsSync(path.join(SESSIONS_DIR, "m" + merchant));
  } catch {
    return false;
  }
}

function getState(merchant) {
  const entry = clients.get(merchant);
  if (!entry) {
    return { status: hasSavedSession(merchant) ? "disconnected" : "disconnected", qr: null, phone: null };
  }
  return { status: entry.status, qr: entry.qr || null, phone: entry.phone || null };
}

async function connect(merchant) {
  // الفحص الكامل — لا تحميل الحزمة وحده: بلا متصفّح ينتهي `initialize`
  // إلى فشل بعد أن يكون التاجر قد انتظر الباركود بلا طائل.
  if (!isAvailable()) return unavailable();
  const lib = loadLib();
  ensureDir();

  let entry = clients.get(merchant);
  if (entry && (entry.status === "qr" || entry.status === "ready")) return getState(merchant);
  if (entry) {
    try {
      await entry.client.destroy();
    } catch {
      /* العميل قد يكون ميتاً أصلاً */
    }
    clients.delete(merchant);
  }

  const client = new lib.Client({
    authStrategy: new lib.LocalAuth({ clientId: "m" + merchant, dataPath: SESSIONS_DIR }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      executablePath: findBrowser(),
    },
  });

  entry = { client, status: "initializing", qr: null, phone: null, startedAt: Date.now() };
  clients.set(merchant, entry);

  client.on("qr", async (qr) => {
    entry.status = "qr";
    entry.qr = await lib.qrcode.toDataURL(qr, { margin: 1, width: 260 });
    log.info("باركود واتساب جاهز", { merchant });
  });
  client.on("authenticated", () => {
    entry.status = "authenticating";
  });
  client.on("ready", async () => {
    entry.status = "ready";
    entry.qr = null;
    try {
      entry.phone = (await client.getWid()).user;
    } catch {
      /* الرقم للعرض فقط */
    }
    log.info("واتساب متصل", { merchant, phone: entry.phone });
  });
  client.on("auth_failure", () => {
    entry.status = "auth_failure";
  });
  client.on("disconnected", (reason) => {
    log.warn("انقطع اتصال واتساب", { merchant, reason });
    clients.delete(merchant);
  });

  client.initialize().catch((err) => {
    entry.status = "error";
    entry.error = err.message;
    log.error("فشل تشغيل جلسة واتساب", { merchant, error: err.message });
  });

  return getState(merchant);
}

/** يستعيد جلسة سبق ربطها بلا طلب باركود جديد */
async function restoreIfNeeded(merchant) {
  if (!isAvailable()) return unavailable();
  if (!clients.has(merchant) && hasSavedSession(merchant)) await connect(merchant);
  return getState(merchant);
}

async function disconnect(merchant) {
  const entry = clients.get(merchant);
  if (!entry) return false;
  try {
    await entry.client.logout();
  } catch {
    /* قد تكون الجلسة منتهية */
  }
  try {
    await entry.client.destroy();
  } catch {
    /* لا شيء نفعله */
  }
  clients.delete(merchant);
  return true;
}

async function sendMessage(merchant, toDigits, text) {
  if (!isAvailable()) return { ok: false, error: unavailable().error };
  const entry = clients.get(merchant);
  if (!entry || entry.status !== "ready") {
    return { ok: false, error: "واتساب غير متصل — افتح الإعدادات وامسح الباركود." };
  }
  const digits = String(toDigits).replace(/[^0-9]/g, "");
  if (!digits) return { ok: false, error: "رقم الجوال غير صالح" };
  try {
    await entry.client.sendMessage(digits + "@c.us", text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** إغلاق كل الجلسات — عند إيقاف الخادم بلطف */
async function shutdown() {
  for (const [merchant, entry] of clients) {
    try {
      await entry.client.destroy();
    } catch {
      /* تجاهل */
    }
    clients.delete(merchant);
  }
}

module.exports = { connect, disconnect, getState, restoreIfNeeded, sendMessage, hasSavedSession, isAvailable, unavailableReason, findBrowser, shutdown, SESSIONS_DIR };
