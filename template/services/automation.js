/**
 * محرّك الأتمتة.
 *
 * التدفّق كاملاً:
 *   1. يصل حدث من سلة إلى /webhook
 *   2. `handleEvent` يبحث عن قواعد هذا المتجر المفعّلة لهذا الحدث
 *   3. لكل قاعدة: يفحص الشروط، يبني نص الرسالة، ويضعها في صندوق الصادر
 *   4. `dispatch` يعمل في الخلفية: يرسل الرسائل المستحقّة ويعيد المحاولة عند الفشل
 *
 * الفصل بين الخطوتين 3 و4 مقصود: سلة تنتظر رداً سريعاً على الويبهوك،
 * والإرسال قد يستغرق ثوانيَ أو يفشل. الصندوق يضمن ألّا تضيع رسالة.
 */
const { Op } = require("sequelize");

const config = require("../config");
const { getTrigger } = require("../lib/triggers");
const { getChannel } = require("../lib/channels");
const { render, describeSkip } = require("../lib/template");

class AutomationService {
  constructor(connection) {
    this.db = connection;
    this.models = connection.models;
    this._timer = null;
    this._running = false;
  }

  // ------------------------------------------------------------------ القواعد

  listRules(storeId) {
    return this.models.AutomationRule.findAll({
      where: { store_id: storeId },
      order: [["createdAt", "DESC"]],
    });
  }

  findRule(storeId, id) {
    return this.models.AutomationRule.findOne({ where: { store_id: storeId, id } });
  }

  createRule(storeId, values) {
    return this.models.AutomationRule.create({ ...values, store_id: storeId });
  }

  async updateRule(storeId, id, values) {
    const rule = await this.findRule(storeId, id);
    if (!rule) return null;
    await rule.update(values);
    return rule;
  }

  async deleteRule(storeId, id) {
    const rule = await this.findRule(storeId, id);
    if (!rule) return false;
    await rule.destroy();
    return true;
  }

  async toggleRule(storeId, id) {
    const rule = await this.findRule(storeId, id);
    if (!rule) return null;
    await rule.update({ enabled: !rule.enabled });
    return rule;
  }

  // -------------------------------------------------------------- تنفيذ الحدث

  /**
   * يُستدعى من مستقبل الويبهوك لكل حدث وارد.
   * @returns {Promise<Array>} ملخّص ما حدث لكل قاعدة (للتشخيص والاختبار)
   */
  async handleEvent(body, store) {
    if (!config.automation.enabled) return [];

    const eventName = body?.event;
    const storeId = body?.merchant;
    if (!eventName || !storeId) return [];

    const trigger = getTrigger(eventName);
    if (!trigger) return []; // حدث لا نبني عليه أتمتة

    const rules = await this.models.AutomationRule.findAll({
      where: { store_id: storeId, event: eventName, enabled: true },
    });

    const results = [];
    for (const rule of rules) {
      try {
        results.push(await this._runRule(rule, trigger, body, store));
      } catch (err) {
        results.push({ rule: rule.id, status: "error", reason: err.message });
      }
    }
    return results;
  }

  async _runRule(rule, trigger, body, store) {
    const variables = trigger.variables(body, store);

    // الشروط: { field: "order_status", equals: "تم التنفيذ" }
    const conditions = rule.getConditions();
    if (conditions.field && conditions.equals !== undefined) {
      const actual = String(variables[conditions.field] ?? "").trim();
      if (actual !== String(conditions.equals).trim()) {
        return { rule: rule.id, status: "skipped", reason: "الشرط غير متحقّق" };
      }
    }

    const channel = getChannel(rule.channel);
    if (!channel) {
      return { rule: rule.id, status: "skipped", reason: `قناة غير معروفة: ${rule.channel}` };
    }

    const recipient = trigger.recipient(body?.data) || "";
    if (channel.needsRecipient && !recipient) {
      // نسجّلها كمتخطّاة حتى يرى التاجر السبب بدل اختفاء الرسالة بصمت
      await this._enqueue({ rule, body, channel, recipient, variables, status: "skipped",
        error: "لا يوجد رقم جوال للمستلم في هذا الحدث." });
      return { rule: rule.id, status: "skipped", reason: "لا يوجد مستلم" };
    }

    const bodyText = render(rule.template, variables);
    if (!bodyText.trim()) {
      return { rule: rule.id, status: "skipped", reason: "نص الرسالة فارغ" };
    }

    const message = await this._enqueue({ rule, body, channel, recipient, variables, bodyText });
    await rule.update({ last_run_at: new Date(), run_count: rule.run_count + 1 });

    return { rule: rule.id, status: "queued", message: message.id, recipient };
  }

  _enqueue({ rule, body, channel, recipient, variables, bodyText = "", status = "pending", error = null }) {
    const delayMs = Math.max(0, Number(rule.delay_minutes) || 0) * 60 * 1000;
    return this.models.OutboxMessage.create({
      store_id: rule.store_id,
      rule_id: rule.id,
      event: body?.event || rule.event,
      channel: channel.id,
      recipient,
      body: bodyText,
      status,
      last_error: error,
      scheduled_at: new Date(Date.now() + delayMs),
      context: JSON.stringify({ event: body?.event, store_id: rule.store_id, variables }),
    });
  }

  /** إرسال تجريبي من الواجهة، لا يعتمد على وصول حدث حقيقي */
  async sendTest(rule, store, sampleBody) {
    const trigger = getTrigger(rule.event);
    if (!trigger) throw new Error("الحدث غير معروف.");

    const channel = getChannel(rule.channel);
    if (!channel) throw new Error("القناة غير معروفة.");

    const variables = trigger.variables(sampleBody, store);
    const message = await this._enqueue({
      rule,
      body: sampleBody,
      channel,
      recipient: trigger.recipient(sampleBody?.data) || "",
      variables,
      bodyText: render(rule.template, variables),
    });
    // نتجاوز التأخير في التجربة
    await message.update({ scheduled_at: new Date() });
    return message;
  }

  // -------------------------------------------------------- صندوق الصادر

  async listOutbox({ storeId, page = 1, perPage = 20, status = "" } = {}) {
    const where = { store_id: storeId };
    if (status) where.status = status;

    const { rows, count } = await this.models.OutboxMessage.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: perPage,
      offset: (page - 1) * perPage,
    });

    return { rows, total: count, page, perPage, totalPages: Math.max(1, Math.ceil(count / perPage)) };
  }

  async outboxCounts(storeId) {
    const rows = await this.models.OutboxMessage.findAll({
      where: { store_id: storeId },
      attributes: ["status", [this.db.fn("COUNT", this.db.col("id")), "n"]],
      group: ["status"],
      raw: true,
    });
    const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const row of rows) counts[row.status] = Number(row.n);
    return counts;
  }

  async retryMessage(storeId, id) {
    const message = await this.models.OutboxMessage.findOne({ where: { store_id: storeId, id } });
    if (!message) return null;
    await message.update({ status: "pending", attempts: 0, last_error: null, scheduled_at: new Date() });
    return message;
  }

  /**
   * يرسل الرسائل المستحقّة. يعيد عدد ما نجح وما فشل.
   * آمن للاستدعاء بالتوازي: `_running` يمنع تداخل دورتين.
   */
  async dispatch({ limit = config.automation.batchSize } = {}) {
    if (this._running) return { skipped: true, sent: 0, failed: 0 };
    this._running = true;

    const summary = { sent: 0, failed: 0, retried: 0 };
    try {
      const due = await this.models.OutboxMessage.findAll({
        where: {
          status: "pending",
          scheduled_at: { [Op.lte]: new Date() },
          attempts: { [Op.lt]: config.automation.maxAttempts },
        },
        order: [["scheduled_at", "ASC"]],
        limit,
      });

      for (const message of due) {
        const channel = getChannel(message.channel);
        const attempts = message.attempts + 1;

        if (!channel) {
          await message.update({ status: "failed", attempts, last_error: "قناة غير معروفة." });
          summary.failed++;
          continue;
        }

        try {
          await channel.send({
            recipient: message.recipient,
            body: message.body,
            context: message.getContext(),
          });
          await message.update({ status: "sent", attempts, sent_at: new Date(), last_error: null });
          summary.sent++;
        } catch (err) {
          const giveUp = attempts >= config.automation.maxAttempts;
          // تراجع أُسّي: ١ ثم ٥ ثم ٢٥ دقيقة
          const backoffMin = Math.pow(5, attempts - 1);
          await message.update({
            status: giveUp ? "failed" : "pending",
            attempts,
            last_error: String(err.message).slice(0, 1000),
            scheduled_at: giveUp ? message.scheduled_at : new Date(Date.now() + backoffMin * 60 * 1000),
          });
          if (giveUp) summary.failed++;
          else summary.retried++;
        }
      }
    } finally {
      this._running = false;
    }

    return summary;
  }

  /** مؤقّت داخلي — يكفي للخوادم التي تعمل باستمرار */
  startWorker() {
    if (this._timer || !config.automation.enabled) return;
    const everyMs = Math.max(5, config.automation.dispatchIntervalSec) * 1000;
    this._timer = setInterval(() => {
      this.dispatch().catch((err) => console.error("dispatch:", err.message));
    }, everyMs);
    this._timer.unref();
    console.log(`⏱️  عامل الأتمتة يعمل كل ${config.automation.dispatchIntervalSec} ثانية.`);
  }

  stopWorker() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

module.exports = (connection) => new AutomationService(connection);
module.exports.AutomationService = AutomationService;
module.exports.describeSkip = describeSkip;
