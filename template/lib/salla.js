/**
 * عميل واجهة سلة البرمجية (Salla Admin API v2).
 *
 * لماذا هذا الملف موجود؟
 * مكتبة سلة الرسمية (@salla.sa/passport-strategy) تحتفظ بتوكن واحد فقط داخل
 * ذاكرة العملية كلها، فلو دخل تاجران في نفس الوقت يدوس أحدهما على توكن الآخر،
 * و`logout` يمسح التوكن للجميع. هنا كل طلب يحمل توكن متجره الخاص، ويُجدَّد
 * تلقائياً عند انتهاء صلاحيته.
 */
const config = require("../config");

const ACCEPT_JSON = { Accept: "application/json" };

class SallaApiError extends Error {
  constructor(message, { status = 0, code = "", details = null } = {}) {
    super(message);
    this.name = "SallaApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** رسالة عربية مفهومة بدل رمز HTTP الجاف */
function humanMessage(status, fallback) {
  if (status === 401) return "انتهت صلاحية الاتصال بسلة. جرّب تسجيل الدخول من جديد.";
  if (status === 403) return "التطبيق لا يملك صلاحية الوصول لهذه البيانات. راجع صلاحيات التطبيق في بوابة الشركاء.";
  if (status === 404) return "العنصر المطلوب غير موجود في متجرك.";
  if (status === 422) return "البيانات المُرسلة غير مقبولة من سلة.";
  if (status === 429) return "تجاوزت الحد المسموح من الطلبات على سلة. انتظر قليلاً ثم أعد المحاولة.";
  if (status >= 500) return "خدمة سلة لا تستجيب حالياً. حاول بعد قليل.";
  return fallback || "تعذّر الاتصال بواجهة سلة البرمجية.";
}

/**
 * يطلب توكن وصول جديداً باستخدام refresh token.
 * @returns {Promise<{accessToken:string, refreshToken:string, expiresIn:number}>}
 */
async function refreshAccessToken(refreshToken) {
  if (!refreshToken) throw new SallaApiError("لا يوجد refresh token محفوظ لهذا المتجر.", { status: 401 });

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.salla.clientId,
    client_secret: config.salla.clientSecret,
  });

  const res = await fetch(`${config.salla.accountsBase}/oauth2/token`, {
    method: "POST",
    headers: { ...ACCEPT_JSON, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(config.salla.timeoutMs),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new SallaApiError("تعذّر تجديد الاتصال بسلة. سجّل الدخول من جديد.", {
      status: res.status,
      details: json,
    });
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresIn: json.expires_in || 0,
  };
}

class SallaClient {
  /**
   * @param {object} options
   * @param {string} options.accessToken       توكن هذا المتجر
   * @param {string} [options.refreshToken]    لتجديد التوكن تلقائياً
   * @param {function} [options.onTokenRefresh] تُستدعى بالتوكن الجديد لحفظه في قاعدة البيانات
   */
  constructor({ accessToken, refreshToken = "", onTokenRefresh = null } = {}) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.onTokenRefresh = onTokenRefresh;
    this._refreshing = null;
  }

  /** يجدّد التوكن مرّة واحدة حتى لو تزامنت عدة طلبات */
  async _refreshOnce() {
    if (!this._refreshing) {
      this._refreshing = refreshAccessToken(this.refreshToken)
        .then(async (tokens) => {
          this.accessToken = tokens.accessToken;
          this.refreshToken = tokens.refreshToken;
          if (this.onTokenRefresh) await this.onTokenRefresh(tokens);
          return tokens;
        })
        .finally(() => {
          this._refreshing = null;
        });
    }
    return this._refreshing;
  }

  /**
   * طلب عام إلى واجهة سلة. يعيد المحاولة مرّة واحدة بعد تجديد التوكن عند 401.
   * @returns {Promise<{data:any, pagination:object|null}>}
   */
  async request(path, { method = "GET", query = null, body = null, baseUrl = null, _retried = false } = {}) {
    const base = baseUrl || config.salla.apiBase;
    const url = new URL(path.startsWith("http") ? path : base + (path.startsWith("/") ? path : "/" + path));

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, value);
      }
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...ACCEPT_JSON,
          Authorization: `Bearer ${this.accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.salla.timeoutMs),
      });
    } catch (err) {
      const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
      throw new SallaApiError(
        timedOut ? "استغرق الاتصال بسلة وقتاً أطول من المسموح." : "تعذّر الوصول إلى خوادم سلة. تحقّق من اتصال الإنترنت.",
        { status: 0, details: err.message }
      );
    }

    if (res.status === 401 && !_retried && this.refreshToken) {
      await this._refreshOnce();
      return this.request(path, { method, query, body, baseUrl, _retried: true });
    }

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const apiMessage = json?.error?.message || json?.message || "";
      throw new SallaApiError(humanMessage(res.status, apiMessage), {
        status: res.status,
        code: json?.error?.code || "",
        details: json,
      });
    }

    return {
      data: json?.data !== undefined ? json.data : json,
      pagination: json?.pagination || null,
    };
  }

  // ---------------------------------------------------------------- resources

  /** بيانات صاحب الحساب والمتجر (accounts.salla.sa) */
  async getUserInfo() {
    const { data } = await this.request("/oauth2/user/info", { baseUrl: config.salla.accountsBase });
    return data;
  }

  async getStoreInfo() {
    const { data } = await this.request("/store/info");
    return data;
  }

  async listOrders({ page = 1, perPage = config.ui.perPage, status = "", keyword = "" } = {}) {
    return this.request("/orders", {
      query: { page, per_page: perPage, status, keyword },
    });
  }

  async getOrder(id) {
    const { data } = await this.request(`/orders/${encodeURIComponent(id)}`);
    return data;
  }

  async listOrderStatuses() {
    const { data } = await this.request("/orders/statuses");
    return Array.isArray(data) ? data : [];
  }

  async listCustomers({ page = 1, perPage = config.ui.perPage, keyword = "" } = {}) {
    return this.request("/customers", { query: { page, per_page: perPage, keyword } });
  }

  async listProducts({ page = 1, perPage = config.ui.perPage, keyword = "" } = {}) {
    return this.request("/products", { query: { page, per_page: perPage, keyword } });
  }

  /**
   * يسحب كل الصفحات لمورد ما — يُستخدم في التصدير إلى CSV.
   * محدود بعدد أقصى من الصفحات حتى لا يعلق الطلب على متجر ضخم.
   */
  async fetchAll(listFn, { maxPages = 20, perPage = 50 } = {}) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data, pagination } = await listFn({ page, perPage });
      const rows = Array.isArray(data) ? data : [];
      all.push(...rows);
      const totalPages = pagination?.totalPages || pagination?.total_pages || 0;
      if (!rows.length || (totalPages && page >= totalPages)) break;
    }
    return all;
  }
}

module.exports = { SallaClient, SallaApiError, refreshAccessToken };
