/**
 * قنوات الإرسال. كل قناة ملف واحد يصدّر:
 *   id, label, hint, needsRecipient, isConfigured(), send({ recipient, body, context })
 *
 * إضافة قناة جديدة = ملف جديد + سطر في `CHANNELS`.
 */
const whatsapp = require("./whatsapp");
const webhook = require("./webhook");
const dryRun = require("./dry-run");

const CHANNELS = [whatsapp, webhook, dryRun];
const BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

function getChannel(id) {
  return BY_ID.get(id) || null;
}

/** القنوات مع حالة تهيئتها — لعرضها في الواجهة */
function channelStatus() {
  return CHANNELS.map((c) => ({
    id: c.id,
    label: c.label,
    hint: c.hint,
    needsRecipient: c.needsRecipient,
    configured: c.isConfigured(),
    setupHint: c.setupHint || "",
  }));
}

module.exports = { CHANNELS, getChannel, channelStatus };
