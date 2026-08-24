/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  طبقة البيانات
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * كل استعلام في التطبيق يمرّ من هنا. الفائدة: مكان واحد لضبط الفهارس
 * والحدود والتحقق من ملكية المتجر — فلا يتسرّب صفّ متجر إلى متجر آخر.
 *
 * الدوال الخاصة بالمنتج (السلات، الرسائل، الصلاحيات) مبنية على Sequelize.
 * تبقى فروع Mongoose/TypeORM لدوال المستخدم والتوكن كما في قالب سلة الرسمي.
 */
const log = require("../lib/logger");

const DEFAULT_TOKEN_LIFETIME = 1209600; // أسبوعان — القيمة التي تصدرها سلة عادةً

/** بداية اليوم الحالي بتوقيت المتجر، كطابع زمني بالثواني */
function startOfDayUnix(timeZone = process.env.APP_TIMEZONE || "Asia/Riyadh") {
  const now = new Date();
  // نقرأ الساعة والدقيقة في المنطقة المطلوبة ثم نطرحها من اللحظة الحالية
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const secondsIntoDay = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.floor(now.getTime() / 1000) - secondsIntoDay;
}

class SallaDatabase {
  constructor(DATABASE_ORM) {
    this.Database = require("../helpers/ORMs/" + DATABASE_ORM);
    this.DATABASE_ORM = DATABASE_ORM;
    this.connection = null;
    this._connecting = null;
  }

  /**
   * اتصال واحد يُعاد استخدامه. الطلبات المتزامنة عند الإقلاع تنتظر نفس
   * الوعد بدل أن يفتح كل منها اتصالاً ويشغّل sync() بالتوازي.
   */
  async connect() {
    if (this.connection) return this.connection;
    if (this._connecting) return this._connecting;
    this._connecting = this.Database.connect()
      .then((conn) => {
        this.connection = conn;
        return conn;
      })
      .catch((err) => {
        log.error("تعذّر الاتصال بقاعدة البيانات", { error: err.message });
        return null;
      })
      .finally(() => {
        this._connecting = null;
      });
    return this._connecting;
  }

  async ensureConnection() {
    const conn = this.connection || (await this.connect());
    if (!conn) throw new Error("Database connection failed");
    return conn;
  }

  /** يغلق الاتصال — يُستدعى عند الإيقاف الرشيق */
  async close() {
    if (this.connection && typeof this.connection.close === "function") {
      await this.connection.close();
      this.connection = null;
    }
  }

  get isSequelize() {
    return this.DATABASE_ORM === "Sequelize";
  }

  async models() {
    const db = await this.ensureConnection();
    return db.models;
  }

  async op() {
    const db = await this.ensureConnection();
    return db.Sequelize.Op;
  }

  // ══════════════════════ المستخدمون والتوكنات ══════════════════════

  async retrieveUser(data, includeRelatedData) {
    if (this.DATABASE_ORM === "TypeORM") {
      return this.connection.getRepository("User").findOne({ where: data });
    }
    if (this.isSequelize) {
      const db = await this.ensureConnection();
      return db.models.User.findOne({
        where: { ...data },
        include: includeRelatedData ? db.models.OauthTokens : undefined,
      });
    }
    if (this.DATABASE_ORM === "Mongoose") {
      const models = this.connection.Mongoose.models;
      return includeRelatedData
        ? models.User.findOne(data).populate({ path: "oauthId", select: "access_token" })
        : models.User.findOne(data);
    }
    return null;
  }

  async saveUser(data) {
    if (this.isSequelize) {
      const db = await this.ensureConnection();
      const [user] = await db.models.User.findOrCreate({
        where: { email: data.email },
        defaults: data,
      });
      return user.id;
    }
    if (this.DATABASE_ORM === "Mongoose") {
      const user = await this.connection.Mongoose.models.User.findOneAndUpdate(
        { email: data.email },
        data,
        { upsert: true, new: true }
      );
      return user._id;
    }
    if (this.DATABASE_ORM === "TypeORM") {
      const saved = await this.connection.getRepository("User").save(data);
      return saved.id;
    }
    return null;
  }

  /**
   * يحفظ توكن التاجر. المفتاح هو **المتجر** لا المستخدم: التاجر نفسه قد
   * يملك أكثر من متجر، وكل متجر يحتاج توكنه المستقل.
   */
  async saveOauth({ user_id, ...data }) {
    if (this.isSequelize) {
      const db = await this.ensureConnection();
      const expiresIn = parseInt(data.expires_in, 10) || DEFAULT_TOKEN_LIFETIME;
      const values = {
        user_id,
        merchant: data.merchant,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        scope: data.scope || null,
      };
      const existing = data.merchant
        ? await db.models.OauthTokens.findOne({ where: { merchant: data.merchant } })
        : await db.models.OauthTokens.findOne({ where: { user_id } });
      if (existing) {
        await existing.update(values);
        return existing;
      }
      return db.models.OauthTokens.create(values);
    }
    if (this.DATABASE_ORM === "Mongoose") {
      const models = this.connection.Mongoose.models;
      const token = await models.oAuthToken.findOneAndUpdate(
        { user: user_id },
        { user: user_id, ...data },
        { upsert: true, new: true }
      );
      await models.User.findOneAndUpdate({ _id: user_id }, { $set: { oauthId: token._id } }, { new: true });
      return token;
    }
    return null;
  }

  /** توكن متجر بعينه */
  async getOauthToken(merchant) {
    if (!this.isSequelize || !merchant) return null;
    const db = await this.ensureConnection();
    return db.models.OauthTokens.findOne({ where: { merchant } });
  }

  /** يحدّث التوكن بعد تجديده لدى سلة */
  async updateOauthToken(merchant, { access_token, refresh_token, expires_in }) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.OauthTokens.findOne({ where: { merchant } });
    if (!row) return null;
    const lifetime = parseInt(expires_in, 10) || DEFAULT_TOKEN_LIFETIME;
    await row.update({
      access_token,
      refresh_token: refresh_token || row.refresh_token,
      expires_in: lifetime,
      expires_at: Math.floor(Date.now() / 1000) + lifetime,
    });
    return row;
  }

  /** كل المتاجر التي ربطت التطبيق فعلاً — أساس المجدول */
  async getAllMerchantIds() {
    if (!this.isSequelize) return [];
    const db = await this.ensureConnection();
    const rows = await db.models.OauthTokens.findAll({
      attributes: ["merchant"],
      where: { merchant: { [db.Sequelize.Op.ne]: null } },
      group: ["merchant"],
      raw: true,
    });
    return rows.map((r) => r.merchant).filter(Boolean);
  }

  /** يمسح ربط متجر عند إزالته التطبيق */
  async deleteOauthToken(merchant) {
    if (!this.isSequelize || !merchant) return 0;
    const db = await this.ensureConnection();
    return db.models.OauthTokens.destroy({ where: { merchant } });
  }

  // ══════════════════════ السلات المتروكة ══════════════════════

  async saveAbandonedCart(data) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.AbandonedCarts.findOne({
      where: { merchant: data.merchant, cart_id: data.cart_id },
    });
    if (row) {
      // لا نُرجع سلة عولجت إلى "جديدة" لمجرد وصول تحديث لها
      const { status, ...rest } = data;
      await row.update(rest);
      return row.id;
    }
    const created = await db.models.AbandonedCarts.create({ ...data, status: data.status || "new" });
    return created.id;
  }

  /**
   * سلات متجر مع بحث وتصفية وترقيم.
   * @returns {Promise<{rows: any[], count: number}>}
   */
  async listAbandonedCarts(merchant, { status = "", search = "", limit = 50, offset = 0 } = {}) {
    if (!this.isSequelize) return { rows: [], count: 0 };
    const db = await this.ensureConnection();
    const { Op } = db.Sequelize;
    const where = {};
    if (merchant) where.merchant = merchant;
    if (status && status !== "all") where.status = status;
    if (search) {
      const like = { [Op.like]: `%${search}%` };
      where[Op.or] = [{ customer_name: like }, { customer_mobile: like }, { customer_email: like }];
    }
    return db.models.AbandonedCarts.findAndCountAll({
      where,
      order: [["abandoned_at", "DESC"], ["id", "DESC"]],
      limit: Math.min(limit, 200),
      offset,
    });
  }

  async getCart(merchant, cart_id) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    return db.models.AbandonedCarts.findOne({ where: { merchant, cart_id } });
  }

  async setAbandonedCartStatus(merchant, cart_id, status) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.AbandonedCarts.findOne({ where: { merchant, cart_id } });
    if (!row) return null;
    const now = Math.floor(Date.now() / 1000);
    const update = { status };
    if (status === "contacted") {
      update.last_contacted_at = now;
      update.reminders_sent = (row.reminders_sent || 0) + 1;
    }
    if (status === "recovered" && !row.recovered_at) update.recovered_at = now;
    await row.update(update);
    return row;
  }

  /** عدّادات الحالات في استعلام واحد بدل ثلاثة */
  async cartStatusCounts(merchant) {
    const base = { new: 0, contacted: 0, recovered: 0, ignored: 0 };
    if (!this.isSequelize) return base;
    const db = await this.ensureConnection();
    const rows = await db.models.AbandonedCarts.findAll({
      attributes: ["status", [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "n"]],
      where: { merchant },
      group: ["status"],
      raw: true,
    });
    for (const r of rows) if (r.status in base) base[r.status] = Number(r.n) || 0;
    return base;
  }

  /** مجموع المبالغ حسب الحالة — أساس بطاقة "الإيراد المستعاد" */
  async cartAmountByStatus(merchant) {
    if (!this.isSequelize) return {};
    const db = await this.ensureConnection();
    const rows = await db.models.AbandonedCarts.findAll({
      attributes: ["status", [db.Sequelize.fn("SUM", db.Sequelize.col("total_amount")), "sum"]],
      where: { merchant },
      group: ["status"],
      raw: true,
    });
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.sum) || 0]));
  }

  /** سلات المتجر خلال فترة — لرسم المنحنى اليومي */
  async cartsSince(merchant, sinceUnix) {
    if (!this.isSequelize) return [];
    const db = await this.ensureConnection();
    return db.models.AbandonedCarts.findAll({
      where: { merchant, abandoned_at: { [db.Sequelize.Op.gte]: sinceUnix } },
      attributes: ["status", "abandoned_at", "recovered_at", "total_amount"],
      raw: true,
    });
  }

  /** السلات المستحقّة للتذكير الآن (حسب مهلة المتجر) */
  async dueCarts(merchant, cutoffUnix, limit = 100) {
    if (!this.isSequelize) return [];
    const db = await this.ensureConnection();
    const { Op } = db.Sequelize;
    return db.models.AbandonedCarts.findAll({
      where: {
        merchant,
        status: "new",
        abandoned_at: { [Op.lte]: cutoffUnix },
        customer_mobile: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] },
      },
      order: [["abandoned_at", "ASC"]],
      limit,
    });
  }

  // ══════════════════════ إعدادات المتجر ══════════════════════

  async getMerchantSettings(merchant) {
    if (!this.isSequelize || !merchant) return null;
    const db = await this.ensureConnection();
    return db.models.MerchantSettings.findOne({ where: { merchant } });
  }

  async saveMerchantSettings(merchant, data) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.MerchantSettings.findOne({ where: { merchant } });
    if (row) {
      await row.update(data);
      return row;
    }
    return db.models.MerchantSettings.create({ merchant, ...data });
  }

  // ══════════════════════ العملاء المضافون يدوياً ══════════════════════

  async saveManualCustomer(data) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const existing = await db.models.ManualCustomers.findOne({
      where: { merchant: data.merchant, mobile: data.mobile },
    });
    if (existing) {
      await existing.update({ name: data.name, email: data.email });
      return existing;
    }
    return db.models.ManualCustomers.create({ ...data, created_at: Math.floor(Date.now() / 1000) });
  }

  async listManualCustomers(merchant) {
    if (!this.isSequelize) return [];
    const db = await this.ensureConnection();
    return db.models.ManualCustomers.findAll({ where: { merchant }, order: [["id", "DESC"]], limit: 500 });
  }

  async deleteManualCustomer(merchant, id) {
    if (!this.isSequelize) return 0;
    const db = await this.ensureConnection();
    return db.models.ManualCustomers.destroy({ where: { merchant, id } });
  }

  // ══════════════════════ الأتمتة ══════════════════════

  async saveAutomation(merchant, key, data) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Automations.findOne({ where: { merchant, key } });
    if (row) {
      await row.update(data);
      return row;
    }
    return db.models.Automations.create({ merchant, key, ...data });
  }

  async getAutomations(merchant) {
    if (!this.isSequelize || !merchant) return [];
    const db = await this.ensureConnection();
    return db.models.Automations.findAll({ where: { merchant } });
  }

  // ══════════════════════ الصلاحيات (المشتريات) ══════════════════════

  async listEntitlements(merchant) {
    if (!this.isSequelize || !merchant) return [];
    const db = await this.ensureConnection();
    return db.models.Entitlements.findAll({ where: { merchant } });
  }

  async activeFeatureKeys(merchant) {
    const rows = await this.listEntitlements(merchant);
    return rows.filter((r) => r.isActive()).map((r) => r.feature_key);
  }

  async grantFeature(merchant, feature_key, data = {}) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const values = {
      status: "active",
      source: data.source || "purchase",
      started_at: data.started_at || new Date(),
      expires_at: data.expires_at || null,
    };
    // التجديد قد يصل بلا payload؛ لا نمسح ما حفظناه سابقاً
    if (data.plan_label) values.plan_label = data.plan_label;
    if (data.raw) values.raw = String(data.raw).slice(0, 20000);

    const row = await db.models.Entitlements.findOne({ where: { merchant, feature_key } });
    if (row) {
      await row.update(values);
      return row;
    }
    return db.models.Entitlements.create({ merchant, feature_key, plan_label: null, raw: null, ...values });
  }

  async revokeFeature(merchant, feature_key, status = "expired") {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Entitlements.findOne({ where: { merchant, feature_key } });
    if (!row) return null;
    await row.update({ status });
    return row;
  }

  async revokeAllFeatures(merchant, status = "canceled") {
    if (!this.isSequelize) return 0;
    const db = await this.ensureConnection();
    const [count] = await db.models.Entitlements.update(
      { status },
      { where: { merchant, status: "active" } }
    );
    return count;
  }

  async lastSubscriptionPayload(merchant) {
    if (!this.isSequelize || !merchant) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Entitlements.findOne({
      where: { merchant, raw: { [db.Sequelize.Op.ne]: null } },
      order: [["updatedAt", "DESC"]],
    });
    return row ? row.raw : null;
  }

  // ══════════════════════ طابور الرسائل ══════════════════════

  async insertMessage(data) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    return db.models.Messages.create({
      attempts: 0,
      status: "pending",
      created_at: Math.floor(Date.now() / 1000),
      ...data,
    });
  }

  async listMessages(merchant, { status = "", limit = 40, offset = 0 } = {}) {
    if (!this.isSequelize) return { rows: [], count: 0 };
    const db = await this.ensureConnection();
    const where = { merchant };
    if (status && status !== "all") where.status = status;
    return db.models.Messages.findAndCountAll({
      where,
      order: [["id", "DESC"]],
      limit: Math.min(limit, 200),
      offset,
    });
  }

  async getMessage(merchant, id) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    return db.models.Messages.findOne({ where: { merchant, id } });
  }

  async listDueMessages(limit = 50) {
    if (!this.isSequelize) return [];
    const db = await this.ensureConnection();
    const { Op } = db.Sequelize;
    return db.models.Messages.findAll({
      where: {
        status: "pending",
        scheduled_at: { [Op.lte]: Math.floor(Date.now() / 1000) },
        attempts: { [Op.lt]: 3 },
      },
      order: [["scheduled_at", "ASC"]],
      limit,
    });
  }

  async markMessageSent(id, channel) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Messages.findByPk(id);
    if (!row) return null;
    await row.update({ status: "sent", channel, sent_at: Math.floor(Date.now() / 1000), error: null });
    return row;
  }

  async bumpMessageAttempt(id, error) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Messages.findByPk(id);
    if (!row) return null;
    const attempts = (row.attempts || 0) + 1;
    await row.update({ attempts, error: String(error || "").slice(0, 500), status: attempts >= 3 ? "failed" : "pending" });
    return row;
  }

  /** يعيد رسالة فاشلة إلى الطابور — زر "إعادة المحاولة" في اللوحة */
  async retryMessage(merchant, id) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Messages.findOne({ where: { merchant, id } });
    if (!row) return null;
    await row.update({ status: "pending", attempts: 0, error: null, scheduled_at: Math.floor(Date.now() / 1000) });
    return row;
  }

  async cancelMessage(merchant, id) {
    if (!this.isSequelize) return null;
    const db = await this.ensureConnection();
    const row = await db.models.Messages.findOne({ where: { merchant, id, status: "pending" } });
    if (!row) return null;
    await row.update({ status: "cancelled" });
    return row;
  }

  async cancelPendingForOrder(merchant, order_id, kinds = null) {
    if (!this.isSequelize) return 0;
    const db = await this.ensureConnection();
    const where = { merchant, order_id, status: "pending" };
    if (kinds) where.kind = kinds;
    const [count] = await db.models.Messages.update({ status: "cancelled" }, { where });
    return count;
  }

  async hasMessageForOrder(merchant, kind, order_id) {
    if (!this.isSequelize) return false;
    const db = await this.ensureConnection();
    const n = await db.models.Messages.count({
      where: { merchant, kind, order_id, status: { [db.Sequelize.Op.in]: ["pending", "sent"] } },
    });
    return n > 0;
  }

  /**
   * كم رسالة أُرسلت **اليوم** لهذا المتجر.
   *
   * نحسبها من بداية اليوم بتوقيت المتجر لا من آخر ٢٤ ساعة: البطاقة تقول
   * «رسائل اليوم»، ونافذة منزلقة تجعل الرقم يتناقص وحده بلا سبب مفهوم
   * للتاجر. والسقف اليومي كذلك يُفهم على أنه سقف يوم تقويمي.
   */
  async sentTodayCount(merchant) {
    if (!this.isSequelize) return 0;
    const db = await this.ensureConnection();
    return db.models.Messages.count({
      where: { merchant, status: "sent", sent_at: { [db.Sequelize.Op.gte]: startOfDayUnix() } },
    });
  }

  /** إحصاءات الرسائل في استعلام تجميعي واحد */
  async messageStats(merchant) {
    const out = { pending: 0, sent: 0, failed: 0, cancelled: 0, sentToday: 0, sentTotal: 0 };
    if (!this.isSequelize) return out;
    const db = await this.ensureConnection();
    const rows = await db.models.Messages.findAll({
      attributes: ["status", [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "n"]],
      where: { merchant },
      group: ["status"],
      raw: true,
    });
    for (const r of rows) if (r.status in out) out[r.status] = Number(r.n) || 0;
    out.sentTotal = out.sent;
    out.sentToday = await this.sentTodayCount(merchant);
    return out;
  }

  /** رسائل خلال فترة — لمنحنى الأداء */
  async messagesSince(merchant, sinceUnix) {
    if (!this.isSequelize) return [];
    const db = await this.ensureConnection();
    return db.models.Messages.findAll({
      where: { merchant, created_at: { [db.Sequelize.Op.gte]: sinceUnix } },
      attributes: ["status", "kind", "created_at", "sent_at"],
      raw: true,
    });
  }

  /** حذف كل بيانات متجر — يُنفَّذ عند إزالة التطبيق (حق التاجر في بياناته) */
  async purgeMerchant(merchant) {
    if (!this.isSequelize || !merchant) return {};
    const db = await this.ensureConnection();
    const out = {};
    for (const name of ["AbandonedCarts", "Messages", "Automations", "ManualCustomers", "MerchantSettings", "Entitlements", "OauthTokens"]) {
      out[name] = await db.models[name].destroy({ where: { merchant } });
    }
    return out;
  }
}

module.exports = (DATABASE_ORM) => new SallaDatabase(DATABASE_ORM);
