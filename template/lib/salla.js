/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  عميل واجهة سلة — لكل تاجر توكنه
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * لماذا لا نستخدم دوال المكتبة الرسمية (`SallaAPI.getAllOrders()`) مباشرة؟
 *
 * لأن تلك المكتبة تحتفظ بتوكن **واحد** على مستوى العملية كلها: آخر تاجر سجّل
 * دخوله يصبح هو التوكن الافتراضي للجميع. في تطبيق يخدم متجراً واحداً لا يظهر
 * الخلل؛ وفي متجر ثانٍ يعني أن التاجر (أ) قد يرى طلبات التاجر (ب).
 *
 * هنا نقرأ توكن التاجر من قاعدة البيانات في كل طلب، ونجدّده تلقائياً عند
 * انتهائه، ونخزّن النتيجة دقيقة واحدة حتى لا نُثقل سلة ولا نُبطئ الصفحة.
 */
const db = require("../helpers/salla-db");
const cache = require("./cache");
const log = require("./logger");
const env = require("../config/env");

const API_BASE = "https://api.salla.dev/admin/v2";
const TOKEN_URL = "https://accounts.salla.sa/oauth2/token";
const USER_INFO_URL = "https://accounts.salla.sa/oauth2/user/info";

/** مهلة قصوى لأي نداء — بدونها قد تتجمّد الصفحة إلى ما لا نهاية */
const TIMEOUT_MS = 12000;
/** عمر التخزين المؤقت لبيانات العرض */
const TTL = { orders: 60 * 1000, customers: 60 * 1000, store: 5 * 60 * 1000, owner: 5 * 60 * 1000 };
/** نجدّد التوكن قبل انتهائه بخمس دقائق، لا بعده */
const REFRESH_MARGIN_SEC = 300;

class SallaApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "SallaApiError";
    this.status = status;
    this.body = body;
  }
  /** رسالة صالحة للعرض للتاجر بالعربية */
  get userMessage() {
    if (this.status === 401 || this.status === 403) return "انتهت صلاحية ربط متجرك بسلة — سجّل الدخول مرة أخرى.";
    if (this.status === 429) return "طلبات كثيرة على سلة في وقت قصير — جرّب بعد قليل.";
    if (this.status >= 500) return "خدمة سلة لا تستجيب حالياً — حاول بعد دقائق.";
    return "تعذّر جلب البيانات من سلة.";
  }
}

async function requestJson(url, { method = "GET", token, body, timeout = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* رد غير JSON — نتركه null ونعتمد على الحالة */
    }
    if (!res.ok) {
      const message = json?.error?.message || json?.message || `HTTP ${res.status}`;
      throw new SallaApiError(message, res.status, json);
    }
    return json;
  } catch (err) {
    if (err.name === "AbortError") throw new SallaApiError("انتهت مهلة الاتصال بسلة", 408, null);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * يطلب توكناً جديداً بواسطة refresh_token ويحفظه.
 * سلة تُصدر refresh_token جديداً في كل تجديد، فالحفظ ليس اختيارياً:
 * إهماله يعني أن التجديد التالي يفشل والتاجر يُطرد من التطبيق.
 */
async function refreshAccessToken(row) {
  if (!row?.refresh_token) throw new SallaApiError("لا يوجد refresh token محفوظ", 401, null);
  if (!env.sallaConfigured) throw new SallaApiError("مفاتيح سلة غير مضبوطة", 500, null);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    client_id: env.salla.clientId,
    client_secret: env.salla.clientSecret,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let payload;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: params,
      signal: controller.signal,
    });
    payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.access_token) {
      throw new SallaApiError(payload?.error_description || "فشل تجديد التوكن", res.status, payload);
    }
  } finally {
    clearTimeout(timer);
  }

  const saved = await db.updateOauthToken(row.merchant, {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || row.refresh_token,
    expires_in: payload.expires_in || 1209600,
  });
  log.info("تم تجديد توكن سلة", { merchant: row.merchant });
  return saved || { ...row.toJSON?.() , ...payload };
}

/**
 * توكن صالح للتاجر — يُجدَّد تلقائياً إن قارب على الانتهاء.
 * @returns {Promise<string|null>}
 */
async function tokenFor(merchantId) {
  if (!merchantId) return null;
  const row = await db.getOauthToken(merchantId);
  if (!row) return null;

  const expiresAt = row.expires_at || 0;
  const nearExpiry = expiresAt > 0 && expiresAt - REFRESH_MARGIN_SEC <= Math.floor(Date.now() / 1000);
  if (!nearExpiry) return row.access_token || null;

  try {
    const fresh = await refreshAccessToken(row);
    return fresh.access_token;
  } catch (err) {
    log.warn("تعذّر تجديد توكن سلة", { merchant: merchantId, error: err.message });
    // نعيد القديم: قد يظل صالحاً لدقائق، وأسوأ الأحوال 401 نعالجها فوق
    return row.access_token || null;
  }
}

/** يجلب صفحات متتابعة حتى `maxPages` ويعيدها مدموجة */
async function paged(path, token, { perPage = 50, maxPages = 1, params = {} } = {}) {
  const all = [];
  let pagination = null;
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ page: String(page), per_page: String(perPage), ...params });
    const json = await requestJson(`${API_BASE}${path}?${qs}`, { token });
    const rows = Array.isArray(json?.data) ? json.data : [];
    all.push(...rows);
    pagination = json?.pagination || null;
    if (!pagination || page >= (pagination.totalPages || 1) || rows.length === 0) break;
  }
  return { data: all, pagination };
}

/**
 * واجهة تاجر واحد. كل دالة تُعيد بيانات هذا التاجر فقط.
 * @param {number|string} merchantId
 */
function forMerchant(merchantId) {
  const key = (suffix) => `salla:${merchantId}:${suffix}`;

  /** ينفّذ نداءً ويعيد المحاولة مرة واحدة بعد تجديد التوكن عند 401 */
  async function withToken(run) {
    const token = await tokenFor(merchantId);
    if (!token) throw new SallaApiError("لا يوجد ربط فعّال مع سلة", 401, null);
    try {
      return await run(token);
    } catch (err) {
      if (!(err instanceof SallaApiError) || err.status !== 401) throw err;
      const row = await db.getOauthToken(merchantId);
      const fresh = await refreshAccessToken(row);
      return run(fresh.access_token);
    }
  }

  return {
    merchantId,

    async getOrders({ page = 1, perPage = 50, status = "" } = {}) {
      return cache.remember(key(`orders:${page}:${perPage}:${status}`), TTL.orders, () =>
        withToken(async (token) => {
          const params = status ? { status } : {};
          const qs = new URLSearchParams({ page: String(page), per_page: String(perPage), ...params });
          const json = await requestJson(`${API_BASE}/orders?${qs}`, { token });
          return { data: Array.isArray(json?.data) ? json.data : [], pagination: json?.pagination || null };
        })
      );
    },

    async getOrder(orderId) {
      return cache.remember(key(`order:${orderId}`), TTL.orders, () =>
        withToken(async (token) => {
          const json = await requestJson(`${API_BASE}/orders/${encodeURIComponent(orderId)}`, { token });
          return json?.data || null;
        })
      );
    },

    async getCustomers({ page = 1, perPage = 50 } = {}) {
      return cache.remember(key(`customers:${page}:${perPage}`), TTL.customers, () =>
        withToken(async (token) => {
          const json = await requestJson(
            `${API_BASE}/customers?${new URLSearchParams({ page: String(page), per_page: String(perPage) })}`,
            { token }
          );
          return { data: Array.isArray(json?.data) ? json.data : [], pagination: json?.pagination || null };
        })
      );
    },

    async getStore() {
      return cache.remember(key("store"), TTL.store, () =>
        withToken(async (token) => {
          const json = await requestJson(`${API_BASE}/store/info`, { token });
          return json?.data || null;
        })
      );
    },

    async getResourceOwner() {
      return cache.remember(key("owner"), TTL.owner, () =>
        withToken(async (token) => {
          const json = await requestJson(USER_INFO_URL, { token });
          return json?.data || null;
        })
      );
    },

    /**
     * السلات المتروكة من سلة مباشرة.
     * مفيدة عند أول تثبيت: الويبهوك لا يرسل ما حدث قبل التثبيت، فتبدو اللوحة
     * فارغة بلا سبب واضح. تتطلّب صلاحية السلات في التطبيق؛ إن لم تُمنح
     * نرجع خطأً واضحاً بدل صفحة فارغة صامتة.
     */
    async getAbandonedCarts({ maxPages = 3, perPage = 50 } = {}) {
      return withToken((token) => paged("/carts/abandoned", token, { perPage, maxPages }));
    },

    /** يمسح كل ما خُزّن لهذا التاجر — بعد أي عملية تغيّر البيانات */
    invalidate() {
      cache.invalidate(`salla:${merchantId}:`);
    },
  };
}

module.exports = { forMerchant, tokenFor, refreshAccessToken, SallaApiError, API_BASE };
