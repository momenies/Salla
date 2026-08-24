/**
 * طبقة الحماية: ترويسات، حدّ للطلبات، وحماية CSRF خفيفة.
 *
 * كتبناها يدوياً بدل helmet + express-rate-limit لسببين: لا حزم إضافية في
 * صورة الإنتاج (أسرع إقلاعاً وأقل سطح هجوم)، والسلوك هنا مضبوط على حالتنا
 * بالضبط — تطبيق يُفتح داخل لوحة سلة ويستقبل ويبهوك.
 */
const crypto = require("crypto");
const env = require("../config/env");
const log = require("./logger");

/**
 * سياسة محتوى صارمة قدر ما يسمح به التصميم:
 * لا سكربتات خارجية إطلاقاً، والخطوط من Google فقط.
 * `unsafe-inline` للأنماط لأن الصفحات تستخدم style مضمّناً كثيراً؛
 * السكربتات المضمّنة موقّعة بـ nonce بدل السماح العام.
 */
function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'self' https://*.salla.sa https://*.salla.dev",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function securityHeaders(req, res, next) {
  // nonce لكل طلب — يسمح لسكربتاتنا المضمّنة ويمنع أي سكربت محقون
  res.locals.nonce = crypto.randomBytes(16).toString("base64");

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0"); // المرشّح القديم يسبّب ثغرات، وCSP يغني عنه
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy(res.locals.nonce));
  if (env.isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.removeHeader("X-Powered-By");
  next();
}

/**
 * حدّ بسيط للطلبات بنافذة منزلقة داخل الذاكرة.
 * الغرض حماية المسارات الحسّاسة (تسجيل الدخول، الويبهوك، الاختبارات) من
 * التكرار الآلي — لا استبدال جدار حماية كامل.
 */
function rateLimit({ windowMs = 60000, max = 60, key, message = "طلبات كثيرة — انتظر قليلاً ثم أعد المحاولة." } = {}) {
  const hits = new Map();

  const prune = () => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      kept.length ? hits.set(k, kept) : hits.delete(k);
    }
  };
  const timer = setInterval(prune, windowMs);
  if (timer.unref) timer.unref();

  return function limiter(req, res, next) {
    const id = key ? key(req) : req.ip || req.connection?.remoteAddress || "anon";
    const cutoff = Date.now() - windowMs;
    const list = (hits.get(id) || []).filter((t) => t > cutoff);
    list.push(Date.now());
    hits.set(id, list);

    const remaining = Math.max(0, max - list.length);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));

    if (list.length > max) {
      log.warn("تجاوز حدّ الطلبات", { path: req.path, id });
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      if (req.accepts("html")) return res.status(429).send(message);
      return res.status(429).json({ ok: false, error: message });
    }
    next();
  };
}

/**
 * حماية CSRF للنماذج الداخلية.
 *
 * الجلسة تُرسل مع كل طلب تلقائياً، فبدون رمز إضافي يستطيع موقع خبيث أن يجعل
 * متصفّح التاجر يُرسل نموذجاً باسمه (تغيير الإعدادات، حذف عميل).
 * نستخدم رمزاً في الجلسة يُقارَن مقارنة زمنية ثابتة.
 */
function csrf({ ignorePaths = [] } = {}) {
  const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

  return function csrfMiddleware(req, res, next) {
    if (!req.session) return next();

    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    }
    res.locals.csrfToken = req.session.csrfToken;

    if (SAFE.has(req.method)) return next();
    if (ignorePaths.some((p) => req.path === p || req.path.startsWith(p))) return next();

    const sent = String(
      req.body?._csrf || req.get("x-csrf-token") || req.query?._csrf || ""
    );
    const expected = req.session.csrfToken;
    const ok =
      sent.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

    if (!ok) {
      log.warn("طلب مرفوض: رمز CSRF غير صحيح", { path: req.path });
      if (req.accepts("html")) {
        return res.status(403).render("error.html", {
          code: 403,
          title: "انتهت صلاحية الصفحة",
          message: "أعد تحميل الصفحة ثم حاول مرة أخرى — هذا إجراء حماية لحسابك.",
          isLogin: req.user,
          user: req.user,
        });
      }
      return res.status(403).json({ ok: false, error: "رمز الحماية غير صحيح — أعد تحميل الصفحة." });
    }
    next();
  };
}

module.exports = { securityHeaders, rateLimit, csrf, contentSecurityPolicy };
