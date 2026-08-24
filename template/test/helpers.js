/**
 * تهيئة مشتركة للاختبارات: قاعدة بيانات مؤقتة لكل ملف اختبار،
 * حتى لا يرث اختبارٌ صفوفَ اختبارٍ آخر فتظهر أعطال وهمية.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

function useTempDatabase(name) {
  const file = path.join(os.tmpdir(), `cart-rescuer-test-${name}-${process.pid}.sqlite`);
  process.env.NODE_ENV = "test";
  process.env.DATABASE_STORAGE = file;
  process.env.SESSION_SECRET = "test-secret-value-long-enough-for-checks";
  process.env.SALLA_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.UNLOCK_ALL_FEATURES = "false";
  process.env.DISABLE_INTERNAL_TICKER = "1";

  return {
    file,
    cleanup() {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        try { fs.unlinkSync(file + suffix); } catch { /* لم يُنشأ */ }
      }
    },
  };
}

/** متجر تجريبي جاهز الإعدادات */
async function seedMerchant(db, merchant, overrides = {}) {
  await db.connect();
  await db.saveMerchantSettings(merchant, {
    store_name: "متجر الاختبار",
    channel: "cloud",
    wa_token: "test-token",
    wa_phone_id: "12345",
    template_name: "cart_reminder",
    delay_minutes: 60,
    auto_enabled: true,
    daily_cap: 200,
    ...overrides,
  });
  return db.getMerchantSettings(merchant);
}

module.exports = { useTempDatabase, seedMerchant };
