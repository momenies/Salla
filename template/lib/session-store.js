/**
 * مخزن جلسات على قاعدة البيانات.
 *
 * البديل الافتراضي (MemoryStore) يحذّر منه express-session نفسه في الإنتاج:
 * الجلسات تعيش في ذاكرة العملية، فتضيع مع كل إعادة تشغيل ولا تُشارَك بين
 * النسخ، وتتضخّم بلا حد. عشرون سطراً هنا تحلّ ذلك بلا حزمة إضافية.
 */
const session = require("express-session");
const log = require("./logger");

const Store = session.Store;

class SequelizeStore extends Store {
  /**
   * @param {object} opts
   * @param {object} opts.db  كائن SallaDatabase المشترك
   * @param {number} opts.cleanupMs  كل كم مللي ثانية ننظّف المنتهية
   */
  constructor({ db, cleanupMs = 15 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupMs);
    // لا نمنع الخروج من العملية بسبب مؤقّت تنظيف
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  async model() {
    const conn = await this.db.ensureConnection();
    return conn.models.Sessions;
  }

  async get(sid, cb) {
    try {
      const Sessions = await this.model();
      const row = await Sessions.findByPk(sid);
      if (!row) return cb(null, null);
      if (row.expires_at && row.expires_at <= Math.floor(Date.now() / 1000)) {
        await row.destroy();
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  async set(sid, sess, cb) {
    try {
      const Sessions = await this.model();
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 14 * 86400 * 1000;
      await Sessions.upsert({
        sid,
        data: JSON.stringify(sess),
        expires_at: Math.floor((Date.now() + maxAge) / 1000),
      });
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  async touch(sid, sess, cb) {
    try {
      const Sessions = await this.model();
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 14 * 86400 * 1000;
      await Sessions.update(
        { expires_at: Math.floor((Date.now() + maxAge) / 1000) },
        { where: { sid } }
      );
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      const Sessions = await this.model();
      await Sessions.destroy({ where: { sid } });
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  /** يحذف الجلسات المنتهية حتى لا ينمو الجدول بلا سقف */
  async cleanup() {
    try {
      const Sessions = await this.model();
      const conn = await this.db.ensureConnection();
      const removed = await Sessions.destroy({
        where: { expires_at: { [conn.Sequelize.Op.lte]: Math.floor(Date.now() / 1000) } },
      });
      if (removed) log.debug(`تنظيف الجلسات: حُذفت ${removed}`);
    } catch (err) {
      log.warn("تعذّر تنظيف الجلسات", { error: err.message });
    }
  }

  stop() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = SequelizeStore;
