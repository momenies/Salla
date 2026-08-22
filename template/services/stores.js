/**
 * طبقة الخدمات للمتاجر والتوكنات والأحداث.
 * كل تعامل مع قاعدة البيانات يمرّ من هنا، فلا تتناثر الاستعلامات في المسارات.
 */
const { SallaClient } = require("../lib/salla");

/** يحسب لحظة انتهاء صلاحية التوكن من عدد الثواني الذي ترسله سلة */
function expiryFrom(expiresIn) {
  const seconds = Number.parseInt(expiresIn, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
}

class StoreService {
  constructor(connection) {
    this.db = connection;
    this.models = connection.models;
  }

  // ---------------------------------------------------------------- مستخدم

  /**
   * ينشئ المستخدم أو يحدّثه ويعيد صفّه دائماً.
   * (النسخة القديمة كانت ترجع `undefined` لو كان المستخدم موجوداً، فينكسر
   *  حفظ التوكن عند تسجيل الدخول للمرة الثانية.)
   */
  async upsertUser({ username, email, ...rest }) {
    if (!email) return null;
    const existing = await this.models.User.findOne({ where: { email } });
    if (existing) {
      await existing.update({ username: username || existing.username, ...rest });
      return existing;
    }
    return this.models.User.create({ username, email, ...rest });
  }

  // ------------------------------------------------------------------ متاجر

  /**
   * ينشئ المتجر أو يحدّثه بعد نجاح تسجيل الدخول.
   * `userInfo` هو ما يعيده /oauth2/user/info من سلة.
   */
  async upsertFromAuth(userInfo, { userId = null } = {}) {
    const merchant = userInfo?.merchant || userInfo?.store || {};
    const sallaStoreId = merchant.id;
    if (!sallaStoreId) return null;

    const values = {
      salla_store_id: sallaStoreId,
      user_id: userId,
      name: merchant.name || null,
      username: merchant.username || null,
      domain: merchant.domain || null,
      avatar: merchant.avatar || null,
      email: merchant.email || userInfo.email || null,
      mobile: merchant.mobile || userInfo.mobile || null,
      plan: merchant.plan || null,
      status: "installed",
      last_synced_at: new Date(),
    };

    const existing = await this.models.Store.findOne({ where: { salla_store_id: sallaStoreId } });
    if (existing) {
      await existing.update(values);
      return existing;
    }
    return this.models.Store.create({ ...values, installed_at: new Date(), settings: "{}" });
  }

  findByMerchantId(sallaStoreId) {
    return this.models.Store.findOne({ where: { salla_store_id: sallaStoreId } });
  }

  async updateSettings(sallaStoreId, settings) {
    const store = await this.findByMerchantId(sallaStoreId);
    if (!store) return null;
    store.setSettings(settings);
    await store.save();
    return store;
  }

  // --------------------------------------------------------------- التوكنات

  /**
   * يحفظ توكن متجر — يحدّث الصف الموجود بدل إنشاء صف جديد كل تسجيل دخول
   * (السلوك القديم كان يكدّس صفوفاً مكرّرة ويقرأ أحياناً توكناً قديماً).
   */
  async saveTokens(sallaStoreId, { accessToken, refreshToken, expiresIn, userId = null }) {
    const values = {
      merchant: sallaStoreId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number.parseInt(expiresIn, 10) || 0,
    };
    if (userId) values.user_id = userId;

    const existing = await this.models.OauthTokens.findOne({ where: { merchant: sallaStoreId } });
    if (existing) {
      await existing.update(values);
      return existing;
    }
    return this.models.OauthTokens.create(values);
  }

  getTokens(sallaStoreId) {
    return this.models.OauthTokens.findOne({ where: { merchant: sallaStoreId } });
  }

  /**
   * يبني عميل سلة جاهزاً لمتجر معيّن، ويحفظ التوكن الجديد تلقائياً عند تجديده.
   * @returns {Promise<SallaClient|null>}
   */
  async clientFor(sallaStoreId) {
    const tokens = await this.getTokens(sallaStoreId);
    if (!tokens || !tokens.access_token) return null;

    return new SallaClient({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      onTokenRefresh: async ({ accessToken, refreshToken, expiresIn }) => {
        await tokens.update({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: Number.parseInt(expiresIn, 10) || tokens.expires_in,
        });
      },
    });
  }

  // ---------------------------------------------------------------- الأحداث

  recordEvent({ storeId = null, event, payload = null, status = "received", error = null }) {
    return this.models.AppEvent.create({
      store_id: storeId,
      event,
      status,
      error: error ? String(error).slice(0, 2000) : null,
      payload: payload ? JSON.stringify(payload).slice(0, 20000) : null,
    });
  }

  async listEvents({ storeId = null, page = 1, perPage = 20, event = "" } = {}) {
    const where = {};
    if (storeId) where.store_id = storeId;
    if (event) where.event = event;

    const { rows, count } = await this.models.AppEvent.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: perPage,
      offset: (page - 1) * perPage,
    });

    return { rows, total: count, page, perPage, totalPages: Math.max(1, Math.ceil(count / perPage)) };
  }

  /** أسماء الأحداث المسجّلة، لعرضها كفلتر في صفحة السجل */
  async distinctEventNames(storeId = null) {
    const where = storeId ? { store_id: storeId } : {};
    const rows = await this.models.AppEvent.findAll({
      where,
      attributes: [[this.db.fn("DISTINCT", this.db.col("event")), "event"]],
      raw: true,
    });
    return rows.map((r) => r.event).filter(Boolean).sort();
  }

  // -------------------------------------------------------------- الاشتراك

  /**
   * يترجم أحداث سلة الخاصة بالتطبيق إلى حالة اشتراك مفهومة.
   * تُستدعى من مستقبل الـ webhooks.
   */
  async applyAppEvent(eventName, body) {
    const sallaStoreId = body?.merchant;
    if (!sallaStoreId) return null;

    const [store] = await this.models.Store.findOrCreate({
      where: { salla_store_id: sallaStoreId },
      defaults: { salla_store_id: sallaStoreId, status: "installed", installed_at: new Date(), settings: "{}" },
    });

    const data = body?.data || {};
    const patch = {};

    switch (eventName) {
      case "app.installed":
        patch.status = "installed";
        patch.installed_at = new Date();
        patch.uninstalled_at = null;
        if (Array.isArray(data.app_scopes)) patch.scopes = data.app_scopes.join(" ");
        break;

      case "app.uninstalled":
        patch.status = "uninstalled";
        patch.uninstalled_at = new Date();
        patch.subscription_status = "canceled";
        break;

      case "app.trial.started":
        patch.subscription_status = "trial";
        patch.trial_ends_at = data.end_date ? new Date(data.end_date) : null;
        break;

      case "app.trial.expired":
        patch.subscription_status = "expired";
        break;

      case "app.subscription.started":
      case "app.subscription.renewed":
        patch.subscription_status = "active";
        patch.subscription_plan = data.plan_name || data.plan_type || patch.subscription_plan || null;
        patch.subscription_started_at = data.start_date ? new Date(data.start_date) : new Date();
        patch.subscription_ends_at = data.end_date ? new Date(data.end_date) : null;
        break;

      case "app.subscription.canceled":
        patch.subscription_status = "canceled";
        patch.subscription_ends_at = data.end_date ? new Date(data.end_date) : new Date();
        break;

      case "app.subscription.expired":
        patch.subscription_status = "expired";
        break;

      case "app.settings.updated":
        if (data && typeof data === "object") {
          store.setSettings({ ...store.getSettings(), ...data });
          patch.settings = store.settings;
        }
        break;

      default:
        return store; // حدث لا يخصّ حالة الاشتراك
    }

    await store.update(patch);
    return store;
  }
}

module.exports = (connection) => new StoreService(connection);
module.exports.StoreService = StoreService;
module.exports.expiryFrom = expiryFrom;
