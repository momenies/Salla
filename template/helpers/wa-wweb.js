// helpers/wa-wweb.js — WhatsApp connection via QR scan (Linked-Devices bridge)
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const path = require("path");
const fs = require("fs");

const SESSIONS_DIR = path.join(process.cwd(), ".wweb-sessions");
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// merchant -> { client, status, qr, phone }
const clients = new Map();

function hasSavedSession(merchant) {
  return fs.existsSync(path.join(SESSIONS_DIR, "m" + merchant));
}

function getState(merchant) {
  const e = clients.get(merchant);
  if (!e) return { status: "disconnected", qr: null, phone: null };
  return { status: e.status, qr: e.qr || null, phone: e.phone || null };
}

async function connect(merchant) {
  let e = clients.get(merchant);
  if (e && (e.status === "qr" || e.status === "ready")) return getState(merchant);
  if (e) {
    try { await e.client.destroy(); } catch (_) {}
    clients.delete(merchant);
  }
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "m" + merchant,
      dataPath: SESSIONS_DIR,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    },
  });
  e = { client, status: "initializing", qr: null, phone: null };
  clients.set(merchant, e);
  client.on("qr", async (qr) => {
    e.status = "qr";
    e.qr = await qrcode.toDataURL(qr, { margin: 1, width: 260 });
    console.log(`[wweb:${merchant}] QR ready`);
  });
  client.on("authenticated", () => { e.status = "authenticating"; });
  client.on("ready", async () => {
    e.status = "ready";
    e.qr = null;
    try { e.phone = (await client.getWid()).user; } catch (_) {}
    console.log(`[wweb:${merchant}] connected as ${e.phone}`);
  });
  client.on("auth_failure", () => { e.status = "auth_failure"; });
  client.on("disconnected", (reason) => {
    console.log(`[wweb:${merchant}] disconnected:`, reason);
    clients.delete(merchant);
  });
  client.initialize().catch((err) => {
    e.status = "error";
    console.log(`[wweb:${merchant}] init error:`, err.message);
  });
  return getState(merchant);
}

// restore a previously linked session without asking for QR again
async function restoreIfNeeded(merchant) {
  if (!clients.has(merchant) && hasSavedSession(merchant)) {
    await connect(merchant);
  }
  return getState(merchant);
}

async function disconnect(merchant) {
  const e = clients.get(merchant);
  if (!e) return false;
  try { await e.client.destroy(); } catch (_) {}
  clients.delete(merchant);
  return true;
}

async function sendMessage(merchant, toDigits, text) {
  const e = clients.get(merchant);
  if (!e || e.status !== "ready") return { ok: false, error: "واتساب غير متصل بعد" };
  try {
    const chatId = String(toDigits).replace(/[^0-9]/g, "") + "@c.us";
    await e.client.sendMessage(chatId, text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { connect, disconnect, getState, restoreIfNeeded, sendMessage, hasSavedSession };
