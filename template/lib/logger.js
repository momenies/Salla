/**
 * سجلّ موحّد — JSON في الإنتاج (تقرأه Cloud Logging مباشرة)، وسطور ملوّنة محلياً.
 *
 * لماذا ملف خاص بدل console.log المتناثر؟ لأن أي منصّة استضافة تحتاج سطراً
 * منظّماً لتصنّف الأخطاء وتنبّهك عليها، ولأننا نريد إخفاء الأسرار تلقائياً.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const isProd = process.env.NODE_ENV === "production";
const threshold = LEVELS[process.env.LOG_LEVEL] || (isProd ? LEVELS.info : LEVELS.debug);

/** يمنع تسرّب التوكنات إلى السجل حتى لو مُرّرت بالخطأ */
const SECRET_KEYS = /(token|secret|password|authorization|client_secret)/i;
function redact(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { message: value.message, stack: isProd ? undefined : value.stack };
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) && typeof v === "string" ? mask(v) : redact(v, depth + 1);
  }
  return out;
}

function mask(str) {
  if (!str) return str;
  return str.length <= 4 ? "****" : "****" + str.slice(-4);
}

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const payload = meta ? redact(meta) : undefined;
  if (isProd) {
    // Cloud Run/Cloud Logging يفهم `severity` و`message`
    process.stdout.write(
      JSON.stringify({ severity: level.toUpperCase(), message: msg, time: new Date().toISOString(), ...(payload ? { meta: payload } : {}) }) + "\n"
    );
    return;
  }
  const tag = { debug: "·", info: "ℹ", warn: "⚠", error: "✖" }[level];
  const line = `${tag} ${msg}`;
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  payload === undefined ? stream(line) : stream(line, payload);
}

module.exports = {
  debug: (msg, meta) => emit("debug", msg, meta),
  info: (msg, meta) => emit("info", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
  mask,
};
